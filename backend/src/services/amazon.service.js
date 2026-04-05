const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { applyAutoAssignment } = require('../utils/assignment.utils');
const { SystemSettings, MarketplaceOrder, MarketplaceOrderItem, Job, AuditLog, SkuMaster, MarketplaceAccount } = require('../models');
const notificationService = require('./notification.service');
const orderController = require('../controllers/order.controller');

// Account identifiers for multi-account support
const ACCOUNT_CODES = {
  CSP: 'CSP',
  GEMHUB: 'GEMHUB'
};

class AmazonService {
  constructor() {
    this.baseUrl = 'https://sellingpartnerapi-na.amazon.com';
    this.tokenUrl = 'https://api.amazon.com/auth/o2/token';
    // Token cache per account
    this.tokenCache = {};
  }

  /**
   * Get credentials for a specific account from .env file
   * @param {string} accountCode - Account code (CSP, GEMHUB)
   */
  getCredentialsFromEnv(accountCode) {
    const prefix = `${accountCode.toUpperCase()}_AMAZON`;
    return {
      refreshToken: process.env[`${prefix}_REFRESH_TOKEN`],
      clientId: process.env[`${prefix}_CLIENT_ID`],
      clientSecret: process.env[`${prefix}_CLIENT_SECRET`],
      accessToken: process.env[`${prefix}_ACCESS_TOKEN`],
      marketplaceId: process.env[`${prefix}_MARKETPLACE_ID`] || 'ATVPDKIKX0DER',
      sellerId: process.env[`${prefix}_SELLER_ID`]
    };
  }

  /**
   * Get all configured Amazon accounts
   */
  getConfiguredAccounts() {
    const accounts = [];
    for (const code of Object.values(ACCOUNT_CODES)) {
      const creds = this.getCredentialsFromEnv(code);
      if (creds.refreshToken && creds.clientId && creds.clientSecret) {
        accounts.push({
          accountCode: code,
          credentials: creds
        });
      }
    }
    return accounts;
  }

  async getCredentials() {
    // For backward compatibility, try SystemSettings first, then CSP from .env
    const refreshToken = await SystemSettings.getSetting('amazon_refresh_token', true);
    const clientId = await SystemSettings.getSetting('amazon_client_id', true);
    const clientSecret = await SystemSettings.getSetting('amazon_client_secret', true);
    const marketplaceId = await SystemSettings.getSetting('amazon_marketplace_id');

    // If SystemSettings has credentials, use them
    if (refreshToken && clientId && clientSecret) {
      return {
        refreshToken,
        clientId,
        clientSecret,
        marketplaceId: marketplaceId || process.env.AMAZON_MARKETPLACE_ID
      };
    }

    // Otherwise, try CSP account from .env
    const cspCreds = this.getCredentialsFromEnv('CSP');
    if (cspCreds.refreshToken) {
      return cspCreds;
    }

    // Fallback to legacy single-account .env variables
    return {
      refreshToken: process.env.AMAZON_REFRESH_TOKEN,
      clientId: process.env.AMAZON_CLIENT_ID,
      clientSecret: process.env.AMAZON_CLIENT_SECRET,
      marketplaceId: process.env.AMAZON_MARKETPLACE_ID
    };
  }

  async getAccessToken(credentials = null, accountCode = null) {
    // If credentials provided, get new token for that account
    const creds = credentials || await this.getCredentials();
    const cacheKey = accountCode || 'default';

    // Check if we have a pre-refreshed access token from the token refresh service
    const preRefreshedToken = this.getPreRefreshedToken(accountCode);
    if (preRefreshedToken) {
      console.log(`[${cacheKey}] Using pre-refreshed access token from token refresh service`);
      return preRefreshedToken;
    }

    // Use token cache per account
    const cached = this.tokenCache[cacheKey];
    if (cached && cached.token && cached.expiry && new Date() < cached.expiry) {
      return cached.token;
    }

    try {
      console.log(`[${cacheKey}] Refreshing Amazon access token...`);
      const response = await axios.post(this.tokenUrl, new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const token = response.data.access_token;

      // Cache the token
      this.tokenCache[cacheKey] = {
        token,
        expiry: new Date(Date.now() + (response.data.expires_in - 300) * 1000)
      };

      console.log(`[${cacheKey}] Access token refreshed successfully`);
      return token;
    } catch (error) {
      console.error(`[${cacheKey}] Error getting Amazon access token:`, error.response?.data || error.message);
      throw new Error(`Failed to authenticate with Amazon (${cacheKey})`);
    }
  }

  /**
   * Get pre-refreshed access token from environment (set by token refresh service)
   * The token refresh service updates process.env directly when tokens are refreshed
   * @param {string} accountCode - Account code (CSP, GEMHUB)
   */
  getPreRefreshedToken(accountCode) {
    const prefix = accountCode ? `${accountCode.toUpperCase()}_AMAZON` : 'AMAZON';
    const accessToken = process.env[`${prefix}_ACCESS_TOKEN`];
    const refreshedAt = process.env[`${prefix}_TOKEN_REFRESHED_AT`];

    // Debug logging
    console.log(`[${accountCode || 'default'}] Checking pre-refreshed token:`);
    console.log(`  Token exists: ${!!accessToken}`);
    console.log(`  RefreshedAt: ${refreshedAt || 'not set'}`);

    if (accessToken && refreshedAt) {
      // Check if token was refreshed within the last 50 minutes (tokens expire in 1 hour)
      const refreshTime = new Date(refreshedAt);
      const now = new Date();
      const ageMinutes = (now - refreshTime) / (1000 * 60);

      console.log(`  Token age: ${ageMinutes.toFixed(1)} minutes`);

      if (ageMinutes < 50) {
        console.log(`  Using pre-refreshed token (valid)`);
        return accessToken;
      } else {
        console.log(`  Pre-refreshed token too old, will get fresh token`);
      }
    }
    return null;
  }

  async makeRequest(method, endpoint, data = null, credentials = null, accountCode = null, extraParams = {}) {
    const accessToken = await this.getAccessToken(credentials, accountCode);
    const creds = credentials || await this.getCredentials();

    try {
      console.log(`[${accountCode || 'default'}] Making Amazon API request: ${method} ${endpoint}`);
      console.log(`[${accountCode || 'default'}] Params:`, JSON.stringify({ MarketplaceIds: creds.marketplaceId, ...extraParams }));

      const response = await axios({
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers: {
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json'
        },
        params: {
          MarketplaceIds: creds.marketplaceId,
          ...extraParams
        },
        data
      });

      console.log(`[${accountCode || 'default'}] Amazon API response status: ${response.status}`);
      return response.data;
    } catch (error) {
      console.error(`[${accountCode || 'default'}] Amazon API error status:`, error.response?.status);
      console.error(`[${accountCode || 'default'}] Amazon API error headers:`, JSON.stringify(error.response?.headers || {}));
      console.error(`[${accountCode || 'default'}] Amazon API error data:`, error.response?.data);

      // Try to parse error message from Amazon
      let errorMessage = error.message;
      let troubleshooting = null;

      if (error.response?.data?.errors) {
        errorMessage = error.response.data.errors.map(e => `${e.code}: ${e.message}`).join(', ');
      } else if (typeof error.response?.data === 'string' && error.response.data.includes('html')) {
        errorMessage = `Amazon SP-API authorization error (HTTP 400)`;
        troubleshooting = [
          'The refresh token may be expired - generate a new one from Seller Central',
          'The app may not be authorized for this seller account - re-authorize in Seller Central',
          'The app may be missing required API roles (Orders API) - check Developer Central app settings',
          'For SP-API, ensure you have completed the authorization workflow correctly'
        ];
      }

      const enhancedError = new Error(errorMessage);
      enhancedError.originalError = error;
      enhancedError.status = error.response?.status;
      enhancedError.troubleshooting = troubleshooting;
      throw enhancedError;
    }
  }

  /**
   * Fetch orders from all configured Amazon accounts
   */
  async fetchOrdersFromAllAccounts() {
    const accounts = this.getConfiguredAccounts();
    const results = {
      success: true,
      totalOrders: 0,
      totalJobs: 0,
      accountResults: []
    };

    console.log(`Fetching orders from ${accounts.length} Amazon accounts...`);

    for (const { accountCode, credentials } of accounts) {
      try {
        console.log(`\n[${accountCode}] Starting order fetch...`);

        // Find or create MarketplaceAccount in database
        let account = await MarketplaceAccount.findOne({ accountCode, channel: 'amazon' });
        if (!account) {
          account = await MarketplaceAccount.create({
            name: `${accountCode} Amazon`,
            channel: 'amazon',
            accountCode,
            isActive: true,
            settings: { syncEnabled: true }
          });
        }

        const result = await this.fetchOrdersForAccountByCode(accountCode, credentials, account);

        results.accountResults.push({
          accountCode,
          ...result
        });

        if (result.success) {
          results.totalOrders += result.stats.ordersImported;
          results.totalJobs += result.stats.jobsCreated || 0;
        }

        // Update account sync status
        await account.updateSyncStatus(
          result.success ? 'success' : 'failed',
          result.message,
          result.stats
        );

      } catch (error) {
        console.error(`[${accountCode}] Error:`, error.message);
        results.accountResults.push({
          accountCode,
          success: false,
          message: error.message,
          troubleshooting: error.troubleshooting || null,
          stats: { ordersFound: 0, ordersImported: 0, errors: 1 }
        });
      }
    }

    // Log audit
    await AuditLog.log({
      action: 'order_sync',
      entity: 'order',
      description: `Multi-account Amazon sync: ${results.totalOrders} orders from ${accounts.length} accounts`,
      metadata: {
        accounts: accounts.map(a => a.accountCode),
        ordersImported: results.totalOrders,
        jobsCreated: results.totalJobs
      }
    });

    return results;
  }

  /**
   * Fetch orders for a specific account by code
   */
  async fetchOrdersForAccountByCode(accountCode, credentials, marketplaceAccount, importAll = false) {
    try {
      const syncDays = marketplaceAccount?.settings?.syncLastNDays || 7;
      const createdAfter = new Date();
      createdAfter.setDate(createdAfter.getDate() - syncDays);

      console.log(`[${accountCode}] Fetching orders from last ${syncDays} days (since ${createdAfter.toISOString()})...`);
      console.log(`[${accountCode}] Marketplace ID: ${credentials.marketplaceId}`);
      console.log(`[${accountCode}] Import All: ${importAll}`);

      const params = {
        CreatedAfter: createdAfter.toISOString(),
        MaxResultsPerPage: 100
      };

      // Apply filters only if importAll is false
      if (!importAll) {
        params.OrderStatuses = 'Pending,Unshipped,PartiallyShipped';
        params.FulfillmentChannels = 'MFN';
      }

      const response = await this.makeRequest('GET', '/orders/v0/orders', null, credentials, accountCode, params);

      console.log(`[${accountCode}] Orders API response received`);

      if (!response.payload?.Orders) {
        console.log(`[${accountCode}] No orders in response payload`);
        return {
          success: true,
          message: 'No new pending orders found',
          stats: { ordersFound: 0, ordersImported: 0, ordersSkipped: 0, errors: 0, jobsCreated: 0 }
        };
      }

      const orders = response.payload.Orders;
      const importedOrders = [];
      const importedJobs = [];
      let errors = 0;

      for (const amazonOrder of orders) {
        try {
          const existingOrder = await MarketplaceOrder.findOne({
            channel: 'amazon',
            externalOrderId: amazonOrder.AmazonOrderId
          });

          if (existingOrder) continue;

          const order = await MarketplaceOrder.create({
            channel: 'amazon',
            externalOrderId: amazonOrder.AmazonOrderId,
            buyerName: amazonOrder.BuyerInfo?.BuyerName || 'Amazon Customer',
            buyerEmail: amazonOrder.BuyerInfo?.BuyerEmail,
            shippingAddress: amazonOrder.ShippingAddress ? {
              name: amazonOrder.ShippingAddress.Name,
              addressLine1: amazonOrder.ShippingAddress.AddressLine1,
              addressLine2: amazonOrder.ShippingAddress.AddressLine2,
              city: amazonOrder.ShippingAddress.City,
              state: amazonOrder.ShippingAddress.StateOrRegion,
              postalCode: amazonOrder.ShippingAddress.PostalCode,
              country: amazonOrder.ShippingAddress.CountryCode
            } : {},
            status: 'pending',
            orderDate: new Date(amazonOrder.PurchaseDate),
            promisedDate: amazonOrder.LatestShipDate ? new Date(amazonOrder.LatestShipDate) : null,
            totalAmount: parseFloat(amazonOrder.OrderTotal?.Amount || 0),
            currency: amazonOrder.OrderTotal?.CurrencyCode || 'USD',
            rawPayload: amazonOrder,
            marketplaceAccount: marketplaceAccount?._id,
            accountCode
          });

          importedOrders.push(order);

          const itemsResponse = await this.makeRequest(
            'GET',
            `/orders/v0/orders/${amazonOrder.AmazonOrderId}/orderItems`,
            null,
            credentials,
            accountCode
          );

          if (itemsResponse.payload?.OrderItems) {
            for (const item of itemsResponse.payload.OrderItems) {
              const skuStatus = await SkuMaster.checkCadStatus(item.SellerSKU || '');

              const orderItem = await MarketplaceOrderItem.create({
                order: order._id,
                sku: item.SellerSKU,
                asinOrItemId: item.ASIN,
                productName: item.Title,
                quantity: item.QuantityOrdered,
                itemPrice: parseFloat(item.ItemPrice?.Amount || 0),
                customizationInfo: item.BuyerCustomizedInfo?.CustomizedURL,
                hasCadFile: skuStatus.hasCadFile,
                cadFilePath: skuStatus.cadFilePath
              });

              const priority = marketplaceAccount?.settings?.defaultPriority || 'medium';

              const job = await Job.create({
                sourceType: 'order',
                channel: 'amazon',
                orderItem: orderItem._id,
                order: order._id,
                sku: item.SellerSKU,
                productName: item.Title,
                quantity: item.QuantityOrdered,
                dueDate: order.promisedDate,
                customerName: order.buyerName,
                priority,
                status: 'new',
                hasCadFile: skuStatus.hasCadFile,
                cadFilePath: skuStatus.cadFilePath,
                cadRequired: !skuStatus.hasCadFile,
                accountCode
              });

              orderItem.isJobCreated = true;
              await orderItem.save();

              importedJobs.push(job);
            }
          }

          await orderController.updateOrderCadSummary(order._id);
          await notificationService.sendOrderImportNotification(order, importedJobs.length);
        } catch (err) {
          console.error(`[${accountCode}] Error importing order ${amazonOrder.AmazonOrderId}:`, err);
          errors++;
        }
      }

      return {
        success: errors === 0,
        message: `Imported ${importedOrders.length} orders and created ${importedJobs.length} jobs`,
        stats: {
          ordersFound: orders.length,
          ordersImported: importedOrders.length,
          ordersSkipped: orders.length - importedOrders.length - errors,
          errors,
          jobsCreated: importedJobs.length
        }
      };
    } catch (error) {
      console.error(`[${accountCode}] Error fetching orders:`, error.message);
      return {
        success: false,
        message: error.message,
        troubleshooting: error.troubleshooting || null,
        stats: { ordersFound: 0, ordersImported: 0, ordersSkipped: 0, errors: 1, jobsCreated: 0 }
      };
    }
  }

  // Original fetchOrders for backward compatibility (uses default credentials)
  async fetchOrders() {
    try {
      const isEnabled = await SystemSettings.getSetting('amazon_enabled');
      if (!isEnabled) {
        console.log('Amazon integration is disabled');
        return { success: false, message: 'Amazon integration disabled' };
      }

      const createdAfter = new Date();
      createdAfter.setDate(createdAfter.getDate() - 7);

      const response = await this.makeRequest('GET', '/orders/v0/orders', null);

      if (!response.payload?.Orders) {
        return { success: true, orders: [], message: 'No new orders', stats: { ordersFound: 0, ordersImported: 0, errors: 0 } };
      }

      const orders = response.payload.Orders;
      const importedOrders = [];
      const importedJobs = [];

      for (const amazonOrder of orders) {
        const existingOrder = await MarketplaceOrder.findOne({
          channel: 'amazon',
          externalOrderId: amazonOrder.AmazonOrderId
        });

        if (existingOrder) continue;

        const order = await MarketplaceOrder.create({
          channel: 'amazon',
          externalOrderId: amazonOrder.AmazonOrderId,
          buyerName: amazonOrder.BuyerInfo?.BuyerName || 'Amazon Customer',
          buyerEmail: amazonOrder.BuyerInfo?.BuyerEmail,
          shippingAddress: amazonOrder.ShippingAddress ? {
            name: amazonOrder.ShippingAddress.Name,
            addressLine1: amazonOrder.ShippingAddress.AddressLine1,
            addressLine2: amazonOrder.ShippingAddress.AddressLine2,
            city: amazonOrder.ShippingAddress.City,
            state: amazonOrder.ShippingAddress.StateOrRegion,
            postalCode: amazonOrder.ShippingAddress.PostalCode,
            country: amazonOrder.ShippingAddress.CountryCode
          } : {},
          status: 'pending',
          orderDate: new Date(amazonOrder.PurchaseDate),
          promisedDate: amazonOrder.LatestShipDate ? new Date(amazonOrder.LatestShipDate) : null,
          totalAmount: parseFloat(amazonOrder.OrderTotal?.Amount || 0),
          currency: amazonOrder.OrderTotal?.CurrencyCode || 'USD',
          rawPayload: amazonOrder
        });

        importedOrders.push(order);

        const itemsResponse = await this.makeRequest('GET', `/orders/v0/orders/${amazonOrder.AmazonOrderId}/orderItems`);

        if (itemsResponse.payload?.OrderItems) {
          for (const item of itemsResponse.payload.OrderItems) {
            // Check SKU master for CAD file
            const skuStatus = await SkuMaster.checkCadStatus(item.SellerSKU || '');

            const orderItem = await MarketplaceOrderItem.create({
              order: order._id,
              sku: item.SellerSKU,
              asinOrItemId: item.ASIN,
              productName: item.Title,
              quantity: item.QuantityOrdered,
              itemPrice: parseFloat(item.ItemPrice?.Amount || 0),
              customizationInfo: item.BuyerCustomizedInfo?.CustomizedURL,
              hasCadFile: skuStatus.hasCadFile,
              cadFilePath: skuStatus.cadFilePath
            });

            const job = await Job.create({
              sourceType: 'order',
              channel: 'amazon',
              orderItem: orderItem._id,
              order: order._id,
              sku: item.SellerSKU,
              productName: item.Title,
              quantity: item.QuantityOrdered,
              dueDate: order.promisedDate,
              customerName: order.buyerName,
              priority: 'medium',
              status: 'new',
              hasCadFile: skuStatus.hasCadFile,
              cadFilePath: skuStatus.cadFilePath,
              cadRequired: !skuStatus.hasCadFile
            });

            orderItem.isJobCreated = true;
            await orderItem.save();

            importedJobs.push(job);
          }
        }

        // Update order CAD summary
        await orderController.updateOrderCadSummary(order._id);

        await notificationService.sendOrderImportNotification(order, importedJobs.length);
      }

      await AuditLog.log({
        action: 'order_sync',
        entity: 'order',
        description: `Amazon sync: ${importedOrders.length} orders, ${importedJobs.length} jobs imported`,
        metadata: {
          ordersImported: importedOrders.length,
          jobsCreated: importedJobs.length
        }
      });

      return {
        success: true,
        orders: importedOrders.length,
        jobs: importedJobs.length,
        message: `Imported ${importedOrders.length} orders and created ${importedJobs.length} jobs`,
        stats: {
          ordersFound: orders.length,
          ordersImported: importedOrders.length,
          ordersSkipped: orders.length - importedOrders.length,
          errors: 0
        }
      };
    } catch (error) {
      console.error('Error fetching Amazon orders:', error);
      return {
        success: false,
        message: error.message,
        stats: { ordersFound: 0, ordersImported: 0, errors: 1 }
      };
    }
  }

  // Multi-account: Fetch orders for a specific account
  async fetchOrdersForAccount(account, credentials) {
    try {
      const syncDays = account.settings?.syncLastNDays || 7;
      const createdAfter = new Date();
      createdAfter.setDate(createdAfter.getDate() - syncDays);

      const response = await this.makeRequest('GET', '/orders/v0/orders', null, credentials);

      if (!response.payload?.Orders) {
        return {
          success: true,
          message: 'No new orders',
          stats: { ordersFound: 0, ordersImported: 0, ordersSkipped: 0, errors: 0 }
        };
      }

      const orders = response.payload.Orders;
      const importedOrders = [];
      const importedJobs = [];
      let errors = 0;

      for (const amazonOrder of orders) {
        try {
          const existingOrder = await MarketplaceOrder.findOne({
            channel: 'amazon',
            externalOrderId: amazonOrder.AmazonOrderId
          });

          if (existingOrder) continue;

          const order = await MarketplaceOrder.create({
            channel: 'amazon',
            externalOrderId: amazonOrder.AmazonOrderId,
            buyerName: amazonOrder.BuyerInfo?.BuyerName || 'Amazon Customer',
            buyerEmail: amazonOrder.BuyerInfo?.BuyerEmail,
            shippingAddress: amazonOrder.ShippingAddress ? {
              name: amazonOrder.ShippingAddress.Name,
              addressLine1: amazonOrder.ShippingAddress.AddressLine1,
              addressLine2: amazonOrder.ShippingAddress.AddressLine2,
              city: amazonOrder.ShippingAddress.City,
              state: amazonOrder.ShippingAddress.StateOrRegion,
              postalCode: amazonOrder.ShippingAddress.PostalCode,
              country: amazonOrder.ShippingAddress.CountryCode
            } : {},
            status: 'pending',
            orderDate: new Date(amazonOrder.PurchaseDate),
            promisedDate: amazonOrder.LatestShipDate ? new Date(amazonOrder.LatestShipDate) : null,
            totalAmount: parseFloat(amazonOrder.OrderTotal?.Amount || 0),
            currency: amazonOrder.OrderTotal?.CurrencyCode || 'USD',
            rawPayload: amazonOrder,
            marketplaceAccount: account._id,
            accountCode: account.accountCode
          });

          importedOrders.push(order);

          const itemsResponse = await this.makeRequest(
            'GET',
            `/orders/v0/orders/${amazonOrder.AmazonOrderId}/orderItems`,
            null,
            credentials
          );

          if (itemsResponse.payload?.OrderItems) {
            for (const item of itemsResponse.payload.OrderItems) {
              const skuStatus = await SkuMaster.checkCadStatus(item.SellerSKU || '');

              const orderItem = await MarketplaceOrderItem.create({
                order: order._id,
                sku: item.SellerSKU,
                asinOrItemId: item.ASIN,
                productName: item.Title,
                quantity: item.QuantityOrdered,
                itemPrice: parseFloat(item.ItemPrice?.Amount || 0),
                customizationInfo: item.BuyerCustomizedInfo?.CustomizedURL,
                hasCadFile: skuStatus.hasCadFile,
                cadFilePath: skuStatus.cadFilePath
              });

              const priority = account.settings?.defaultPriority || 'medium';

              const jobData = {
                sourceType: 'order',
                channel: 'amazon',
                orderItem: orderItem._id,
                order: order._id,
                sku: item.SellerSKU,
                productName: item.Title,
                quantity: item.QuantityOrdered,
                dueDate: order.promisedDate,
                customerName: order.buyerName,
                priority,
                status: 'new',
                hasCadFile: skuStatus.hasCadFile,
                cadFilePath: skuStatus.cadFilePath,
                cadRequired: !skuStatus.hasCadFile
              };

              const assignedJobData = await applyAutoAssignment(jobData, 'amazon');
              const job = await Job.create(assignedJobData);

              orderItem.isJobCreated = true;
              await orderItem.save();

              importedJobs.push(job);
            }
          }

          await orderController.updateOrderCadSummary(order._id);
          await notificationService.sendOrderImportNotification(order, importedJobs.length);
        } catch (err) {
          console.error(`Error importing order ${amazonOrder.AmazonOrderId}:`, err);
          errors++;
        }
      }

      return {
        success: errors === 0,
        message: `Imported ${importedOrders.length} orders and created ${importedJobs.length} jobs`,
        stats: {
          ordersFound: orders.length,
          ordersImported: importedOrders.length,
          ordersSkipped: orders.length - importedOrders.length - errors,
          errors
        }
      };
    } catch (error) {
      console.error('Error fetching Amazon orders for account:', error);
      return {
        success: false,
        message: error.message,
        stats: { ordersFound: 0, ordersImported: 0, ordersSkipped: 0, errors: 1 }
      };
    }
  }

  async testConnection() {
    try {
      await this.getAccessToken();
      return { success: true, message: 'Successfully connected to Amazon SP-API' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Fetch orders with configurable days back parameter
   * Used by cron job with settings from database
   */
  async fetchOrdersWithDaysBack(daysBack = 7, importAll = false) {
    try {
      const isEnabled = await SystemSettings.getSetting('amazon_sync_enabled');
      if (isEnabled === false || isEnabled === 'false') {
        console.log('Amazon sync is disabled in settings');
        return { success: false, message: 'Amazon sync disabled' };
      }

      const credentials = await this.getCredentials();
      if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
        return { success: false, message: 'Amazon credentials not configured' };
      }

      const createdAfter = new Date();
      createdAfter.setDate(createdAfter.getDate() - daysBack);
      const createdAfterISO = createdAfter.toISOString();

      console.log(`Fetching Amazon orders from last ${daysBack} days (since ${createdAfterISO}), importAll: ${importAll}`);

      const accessToken = await this.getAccessToken();
      const marketplaceId = credentials.marketplaceId || 'ATVPDKIKX0DER';

      // Fetch orders with pagination
      let allOrders = [];
      let nextToken = null;
      let pageCount = 0;

      do {
        pageCount++;
        const params = nextToken
          ? { NextToken: nextToken }
          : {
            MarketplaceIds: marketplaceId,
            CreatedAfter: createdAfterISO,
            MaxResultsPerPage: 100
          };

        // Add status filters if not importing all
        if (!importAll && !nextToken) {
          params.OrderStatuses = 'Pending,Unshipped,PartiallyShipped';
          params.FulfillmentChannels = 'MFN';
        }

        const response = await axios({
          method: 'GET',
          url: `${this.baseUrl}/orders/v0/orders`,
          headers: {
            'x-amz-access-token': accessToken,
            'Content-Type': 'application/json'
          },
          params
        });

        const payload = response.data.payload || {};
        const orders = payload.Orders || [];
        allOrders = allOrders.concat(orders);
        nextToken = payload.NextToken;

        console.log(`  Page ${pageCount}: Retrieved ${orders.length} orders`);

      } while (nextToken);

      console.log(`Total orders fetched: ${allOrders.length}`);

      // Import orders
      const importedOrders = [];
      const importedJobs = [];
      let errors = 0;

      for (const amazonOrder of allOrders) {
        try {
          const existingOrder = await MarketplaceOrder.findOne({
            channel: 'amazon',
            externalOrderId: amazonOrder.AmazonOrderId
          });

          if (existingOrder) continue;

          const order = await MarketplaceOrder.create({
            channel: 'amazon',
            externalOrderId: amazonOrder.AmazonOrderId,
            buyerName: amazonOrder.BuyerInfo?.BuyerName || 'Amazon Customer',
            buyerEmail: amazonOrder.BuyerInfo?.BuyerEmail,
            shippingAddress: amazonOrder.ShippingAddress ? {
              name: amazonOrder.ShippingAddress.Name,
              addressLine1: amazonOrder.ShippingAddress.AddressLine1,
              addressLine2: amazonOrder.ShippingAddress.AddressLine2,
              city: amazonOrder.ShippingAddress.City,
              state: amazonOrder.ShippingAddress.StateOrRegion,
              postalCode: amazonOrder.ShippingAddress.PostalCode,
              country: amazonOrder.ShippingAddress.CountryCode
            } : {},
            status: this.mapAmazonStatus(amazonOrder.OrderStatus),
            orderDate: new Date(amazonOrder.PurchaseDate),
            promisedDate: amazonOrder.LatestShipDate ? new Date(amazonOrder.LatestShipDate) : null,
            totalAmount: parseFloat(amazonOrder.OrderTotal?.Amount || 0),
            currency: amazonOrder.OrderTotal?.CurrencyCode || 'USD',
            rawPayload: amazonOrder
          });

          importedOrders.push(order);

          // Fetch order items
          const itemsResponse = await this.makeRequest('GET', `/orders/v0/orders/${amazonOrder.AmazonOrderId}/orderItems`);

          if (itemsResponse.payload?.OrderItems) {
            for (const item of itemsResponse.payload.OrderItems) {
              const skuStatus = await SkuMaster.checkCadStatus(item.SellerSKU || '');

              const orderItem = await MarketplaceOrderItem.create({
                order: order._id,
                sku: item.SellerSKU,
                asinOrItemId: item.ASIN,
                productName: item.Title,
                quantity: item.QuantityOrdered,
                itemPrice: parseFloat(item.ItemPrice?.Amount || 0),
                customizationInfo: item.BuyerCustomizedInfo?.CustomizedURL,
                hasCadFile: skuStatus.hasCadFile,
                cadFilePath: skuStatus.cadFilePath
              });

              const jobData = {
                sourceType: 'order',
                channel: 'amazon',
                orderItem: orderItem._id,
                order: order._id,
                sku: item.SellerSKU,
                productName: item.Title,
                quantity: item.QuantityOrdered,
                dueDate: order.promisedDate,
                customerName: order.buyerName,
                priority: 'medium',
                status: 'new',
                hasCadFile: skuStatus.hasCadFile,
                cadFilePath: skuStatus.cadFilePath,
                cadRequired: !skuStatus.hasCadFile
              };

              const assignedJobData = await applyAutoAssignment(jobData, 'amazon');
              const job = await Job.create(assignedJobData);

              orderItem.isJobCreated = true;
              await orderItem.save();
              importedJobs.push(job);
            }
          }

          // Update order CAD summary
          await orderController.updateOrderCadSummary(order._id);
        } catch (err) {
          console.error(`Error importing order ${amazonOrder.AmazonOrderId}:`, err.message);
          errors++;
        }
      }

      // Log audit
      await AuditLog.log({
        action: 'order_sync',
        entity: 'order',
        description: `Amazon cron sync: ${importedOrders.length} orders, ${importedJobs.length} jobs imported (${daysBack} days back)`,
        metadata: {
          daysBack,
          ordersFound: allOrders.length,
          ordersImported: importedOrders.length,
          jobsCreated: importedJobs.length,
          errors
        }
      });

      return {
        success: errors === 0,
        orders: importedOrders.length,
        jobs: importedJobs.length,
        message: `Imported ${importedOrders.length} orders and created ${importedJobs.length} jobs`,
        stats: {
          ordersFound: allOrders.length,
          ordersImported: importedOrders.length,
          ordersSkipped: allOrders.length - importedOrders.length - errors,
          errors
        }
      };
    } catch (error) {
      console.error('Error fetching Amazon orders:', error);
      return {
        success: false,
        message: error.message,
        stats: { ordersFound: 0, ordersImported: 0, errors: 1 }
      };
    }
  }

  /**
   * Map Amazon order status to internal status
   */
  mapAmazonStatus(amazonStatus) {
    const statusMap = {
      'Pending': 'pending',
      'Unshipped': 'pending',
      'PartiallyShipped': 'processing',
      'Shipped': 'shipped',
      'Canceled': 'cancelled',
      'Unfulfillable': 'cancelled'
    };
    return statusMap[amazonStatus] || 'pending';
  }

  // Multi-account: Test connection with specific credentials
  async testConnectionWithCredentials(credentials) {
    try {
      await this.getAccessToken(credentials);
      return { success: true, message: 'Successfully connected to Amazon SP-API' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Fetch product images from Amazon Catalog Items API
   * Uses the same API pattern as the reference amazon_image project
   * @param {string} asin - The ASIN of the product
   * @param {object} credentials - Optional credentials for specific account
   * @param {string} accountCode - Optional account code
   * @param {number} retryCount - Internal retry counter
   * @returns {Promise<object>} - Product images data
   */
  async getProductImages(asin, credentials = null, accountCode = null, retryCount = 0) {
    const cacheKey = accountCode || 'default';

    try {
      if (!asin) {
        return { success: false, message: 'ASIN is required', images: [] };
      }

      const creds = credentials || await this.getCredentials();
      const accessToken = await this.getAccessToken(credentials, accountCode);

      console.log(`[${cacheKey}] Fetching product images for ASIN: ${asin}`);

      // Use Catalog Items API v2022-04-01 with full includedData (matching reference project)
      const response = await axios({
        method: 'GET',
        url: `${this.baseUrl}/catalog/2022-04-01/items/${asin}`,
        headers: {
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        params: {
          marketplaceIds: creds.marketplaceId || 'ATVPDKIKX0DER',
          includedData: 'summaries,attributes,images,productTypes,dimensions'
        },
        timeout: 60000
      });

      const item = response.data;
      const images = [];

      console.log(`[${cacheKey}] Catalog API response for ${asin}:`, JSON.stringify({
        hasImages: !!item.images,
        imageArrayLength: item.images?.length || 0,
        hasSummaries: !!item.summaries
      }));

      // Extract images from the response (nested structure per reference project)
      // Structure: item.images = [{images: [{link, variant, height, width}, ...]}, ...]
      if (item.images && Array.isArray(item.images)) {
        for (const marketplaceImages of item.images) {
          if (marketplaceImages.images && Array.isArray(marketplaceImages.images)) {
            for (const img of marketplaceImages.images) {
              if (img.link) {
                images.push({
                  url: img.link,
                  variant: img.variant || 'MAIN',
                  height: img.height,
                  width: img.width
                });
              }
            }
          }
        }
      }

      // Get product title from summaries
      let productTitle = '';
      if (item.summaries && item.summaries.length > 0) {
        productTitle = item.summaries[0].itemName || '';
      }

      console.log(`[${cacheKey}] Found ${images.length} images for ASIN ${asin}`);

      return {
        success: true,
        asin,
        productTitle,
        images,
        imageCount: images.length
      };

    } catch (error) {
      // Handle rate limiting (429) - retry with backoff like reference project
      if (error.response?.status === 429 && retryCount < 3) {
        const retryAfter = parseInt(error.response.headers?.['retry-after'] || '30', 10);
        console.log(`[${cacheKey}] [Rate Limit] Waiting ${retryAfter}s before retry for ASIN ${asin}...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return this.getProductImages(asin, credentials, accountCode, retryCount + 1);
      }

      console.error(`[${cacheKey}] Error fetching product images for ASIN ${asin}:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });

      return {
        success: false,
        message: error.response?.data?.errors?.[0]?.message || error.message,
        images: []
      };
    }
  }

  /**
   * Fetch and download product images to local storage
   * Images are saved in SKU-wise folders: /uploads/product-images/{SKU}/
   * @param {string} asin - The ASIN of the product
   * @param {string} sku - The SKU to associate images with
   * @param {object} credentials - Optional credentials
   * @param {string} accountCode - Optional account code
   * @returns {Promise<object>} - Downloaded images info
   */
  async downloadProductImages(asin, sku, credentials = null, accountCode = null) {
    const cacheKey = accountCode || 'default';
    console.log(`[${cacheKey}] [Image Download] Starting download for ASIN: ${asin}, SKU: ${sku}`);

    try {
      const imageData = await this.getProductImages(asin, credentials, accountCode);

      if (!imageData.success) {
        console.log(`[${cacheKey}] [Image Download] Failed to fetch images: ${imageData.message}`);
        return imageData;
      }

      if (imageData.images.length === 0) {
        console.log(`[${cacheKey}] [Image Download] No images found for ASIN: ${asin}`);
        return imageData;
      }

      console.log(`[${cacheKey}] [Image Download] Found ${imageData.images.length} images, downloading...`);

      const downloadedImages = [];

      // Create SKU-wise folder structure
      const normalizedSku = (sku || asin).toUpperCase().replace(/[^a-zA-Z0-9-_]/g, '_');
      const skuDir = path.join(__dirname, '../../uploads/product-images', normalizedSku);

      // Ensure SKU directory exists
      if (!fs.existsSync(skuDir)) {
        fs.mkdirSync(skuDir, { recursive: true });
        console.log(`[${cacheKey}] [Image Download] Created SKU folder: ${skuDir}`);
      }

      // Download up to 5 main images
      const mainImages = imageData.images.filter(img => img.variant === 'MAIN' || !img.variant).slice(0, 5);
      const otherImages = imageData.images.filter(img => img.variant !== 'MAIN' && img.variant).slice(0, 3);
      const imagesToDownload = [...mainImages, ...otherImages].slice(0, 5);

      for (let i = 0; i < imagesToDownload.length; i++) {
        const img = imagesToDownload[i];
        try {
          const response = await axios({
            method: 'GET',
            url: img.url,
            responseType: 'arraybuffer',
            timeout: 30000
          });

          const ext = '.jpg';
          const fileName = `${normalizedSku}_amazon_${asin}_${i + 1}${ext}`;
          const filePath = path.join(skuDir, fileName);

          fs.writeFileSync(filePath, response.data);

          downloadedImages.push({
            fileName,
            filePath: `/uploads/product-images/${normalizedSku}/${fileName}`,
            originalUrl: img.url,
            variant: img.variant
          });

          console.log(`[${cacheKey}] [Image Download] Saved: ${fileName}`);

        } catch (downloadError) {
          console.error(`[${cacheKey}] [Image Download] Failed to download image ${i + 1} for ${asin}:`, downloadError.message);
        }
      }

      return {
        success: true,
        asin,
        sku,
        productTitle: imageData.productTitle,
        downloadedCount: downloadedImages.length,
        images: downloadedImages
      };

    } catch (error) {
      console.error(`Error downloading product images for ASIN ${asin}:`, error.message);
      return {
        success: false,
        message: error.message,
        images: []
      };
    }
  }
}

module.exports = new AmazonService();
