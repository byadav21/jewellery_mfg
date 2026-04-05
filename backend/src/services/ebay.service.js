const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { SystemSettings, MarketplaceOrder, MarketplaceOrderItem, Job, AuditLog, SkuMaster, MarketplaceAccount } = require('../models');
const notificationService = require('./notification.service');
const orderController = require('../controllers/order.controller');
const { applyAutoAssignment } = require('../utils/assignment.utils');

// Account identifiers for multi-account support
const EBAY_ACCOUNT_CODES = {
  CSP: 'CSP',
  GEMHUB: 'GEMHUB'
};

class EbayService {
  constructor() {
    this.baseUrl = 'https://api.ebay.com';
    this.accessToken = null;
    this.tokenExpiry = null;
    // Token cache per account
    this.tokenCache = {};
  }

  /**
   * Get credentials for a specific account from .env file
   * @param {string} accountCode - Account code (CSP, GEMHUB)
   */
  getCredentialsFromEnv(accountCode) {
    const prefix = `${accountCode.toUpperCase()}_EBAY`;
    return {
      appId: process.env[`${prefix}_APP_ID`],
      certId: process.env[`${prefix}_CERT_ID`],
      refreshToken: process.env[`${prefix}_REFRESH_TOKEN`] || process.env[`${prefix}_OAUTH_TOKEN`]
    };
  }

  /**
   * Get all configured eBay accounts from .env
   */
  getConfiguredAccounts() {
    const accounts = [];
    for (const code of Object.values(EBAY_ACCOUNT_CODES)) {
      const creds = this.getCredentialsFromEnv(code);
      if (creds.appId && creds.certId && creds.refreshToken) {
        accounts.push({
          accountCode: code,
          credentials: creds
        });
      }
    }
    return accounts;
  }

  async getCredentials() {
    const appId = await SystemSettings.getSetting('ebay_app_id', true);
    const certId = await SystemSettings.getSetting('ebay_cert_id', true);
    const refreshToken = await SystemSettings.getSetting('ebay_refresh_token', true);

    return {
      appId: appId || process.env.CSP_EBAY_APP_ID || process.env.EBAY_APP_ID,
      certId: certId || process.env.CSP_EBAY_CERT_ID || process.env.EBAY_CERT_ID,
      refreshToken: refreshToken || process.env.CSP_EBAY_REFRESH_TOKEN || process.env.CSP_EBAY_OAUTH_TOKEN || process.env.EBAY_OAUTH_TOKEN
    };
  }

  async getAccessToken(credentials = null, accountCode = null) {
    const creds = credentials || await this.getCredentials();
    const cacheKey = accountCode || 'default';

    // Use token cache per account
    const cached = this.tokenCache[cacheKey];
    if (cached && cached.token && cached.expiry && new Date() < cached.expiry) {
      return cached.token;
    }

    if (!creds.appId || !creds.certId) {
      throw new Error('eBay credentials not configured');
    }

    if (!creds.refreshToken) {
      throw new Error('eBay refresh token not configured. Please set CSP_EBAY_REFRESH_TOKEN in .env or configure in Settings.');
    }

    try {
      const authString = Buffer.from(`${creds.appId}:${creds.certId}`).toString('base64');

      const response = await axios.post(`${this.baseUrl}/identity/v1/oauth2/token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: creds.refreshToken,
          scope: 'https://api.ebay.com/oauth/api_scope/sell.fulfillment'
        }), {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const token = response.data.access_token;
      const expiresIn = response.data.expires_in || 7200;

      // Cache token per account (refresh 5 minutes before expiry)
      this.tokenCache[cacheKey] = {
        token,
        expiry: new Date(Date.now() + (expiresIn - 300) * 1000)
      };

      return token;
    } catch (error) {
      const ebayError = error.response?.data;
      console.error(`Error getting eBay access token [${cacheKey}]:`, ebayError || error.message);

      // Clear cached token on auth failure
      delete this.tokenCache[cacheKey];

      if (ebayError?.error === 'invalid_client') {
        const err = new Error('eBay authentication failed: Invalid App ID or Cert ID. Please verify your eBay API credentials in Settings > API Credentials.');
        err.tokenExpired = false;
        throw err;
      }
      if (ebayError?.error === 'invalid_grant') {
        const err = new Error('eBay authentication failed: Refresh token is expired or invalid. Please generate a new OAuth token from eBay Developer Portal (https://developer.ebay.com/my/keys). Refresh tokens expire after 18 months.');
        err.tokenExpired = true;
        err.troubleshooting = [
          'Go to https://developer.ebay.com/my/keys',
          'Find your Production keyset and click "User Tokens"',
          'Generate a new refresh token with sell.fulfillment scope',
          'Update CSP_EBAY_REFRESH_TOKEN in backend/.env (wrap in double quotes if it contains # characters)',
          'Restart the backend server'
        ];
        throw err;
      }
      throw new Error(`Failed to authenticate with eBay: ${ebayError?.error_description || error.message}`);
    }
  }

  async makeRequest(method, endpoint, data = null, credentials = null, accountCode = null) {
    const accessToken = await this.getAccessToken(credentials, accountCode);

    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: method === 'GET' ? data : undefined,
        data: method !== 'GET' ? data : undefined
      });

      return response.data;
    } catch (error) {
      // If 401 Unauthorized, clear token cache and retry once
      if (error.response?.status === 401) {
        console.log(`[eBay] Access token expired, refreshing and retrying...`);
        const cacheKey = accountCode || 'default';
        delete this.tokenCache[cacheKey];

        const newAccessToken = await this.getAccessToken(credentials, accountCode);
        const retryResponse = await axios({
          method,
          url: `${this.baseUrl}${endpoint}`,
          headers: {
            'Authorization': `Bearer ${newAccessToken}`,
            'Content-Type': 'application/json'
          },
          params: method === 'GET' ? data : undefined,
          data: method !== 'GET' ? data : undefined
        });
        return retryResponse.data;
      }

      console.error('eBay API error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetch orders with automatic date adjustment if eBay rejects dates as "in the future".
   * This handles system clock mismatch (e.g., system clock is 2026 but eBay real time is 2025).
   */
  /**
   * Build eBay order filter string.
   * Note: eBay Fulfillment API only supports: creationdate, lastmodifieddate, orderfulfillmentstatus
   * Unlike Amazon, eBay doesn't have FBA/MFN distinction - all orders are fetched by date range.
   * Duplicate orders are skipped during import (checked by externalOrderId).
   */
  _buildEbayFilter(startDate, endDate) {
    return `creationdate:[${startDate.toISOString()}..${endDate.toISOString()}]`;
  }

  async _fetchOrdersWithDateRetry(startDate, endDate, importAll, credentials, accountCode) {
    const filter = this._buildEbayFilter(startDate, endDate);
    console.log(`[${accountCode}] eBay filter: ${filter}`);

    let response;
    try {
      response = await this.makeRequest('GET', '/sell/fulfillment/v1/order', {
        filter, limit: 50
      }, credentials, accountCode);
    } catch (error) {
      const ebayErrors = error.response?.data?.errors || [];
      const futureDateError = ebayErrors.find(e => e.errorId === 30850);

      if (futureDateError) {
        // Explicit "future dates" error - adjust by -1 year
        console.log(`[${accountCode}] eBay rejected dates as future. Auto-adjusting by -1 year...`);
        return this._retryWithAdjustedYear(startDate, endDate, importAll, credentials, accountCode);
      }
      throw error;
    }

    // If 0 orders returned, it might be because dates are in the future (eBay silently returns empty).
    // Try -1 year to detect system clock mismatch.
    if ((!response.orders || response.orders.length === 0)) {
      try {
        const adjustedResponse = await this._retryWithAdjustedYear(startDate, endDate, importAll, credentials, accountCode);
        if (adjustedResponse.orders && adjustedResponse.orders.length > 0) {
          console.log(`[${accountCode}] Found ${adjustedResponse.orders.length} orders with -1 year adjustment. System clock appears to be ahead.`);
          return adjustedResponse;
        }
      } catch (retryErr) {
        // If retry also fails, use original (empty) result
        console.log(`[${accountCode}] Year-adjusted retry also returned no results. Using original response.`);
      }
    }

    return response;
  }

  async _retryWithAdjustedYear(startDate, endDate, importAll, credentials, accountCode) {
    const adjustedStart = new Date(startDate);
    const adjustedEnd = new Date(endDate);
    adjustedStart.setFullYear(adjustedStart.getFullYear() - 1);
    adjustedEnd.setFullYear(adjustedEnd.getFullYear() - 1);

    const filter = this._buildEbayFilter(adjustedStart, adjustedEnd);
    console.log(`[${accountCode}] Retrying with -1 year: ${filter}`);

    return await this.makeRequest('GET', '/sell/fulfillment/v1/order', {
      filter, limit: 50
    }, credentials, accountCode);
  }

  /**
   * Fetch orders from all configured eBay accounts (multi-account support)
   * Similar to Amazon's fetchOrdersFromAllAccounts
   */
  async fetchOrdersFromAllAccounts(fromDate, toDate, importAll = false) {
    const isEnabled = await SystemSettings.getSetting('ebay_enabled');
    if (!isEnabled) {
      console.log('eBay integration is disabled');
      return { success: false, message: 'eBay integration disabled', accountResults: [] };
    }

    // Get accounts from .env
    const envAccounts = this.getConfiguredAccounts();
    // Also get accounts from database
    const dbAccounts = await MarketplaceAccount.find({ channel: 'ebay', isActive: true });

    const results = {
      success: true,
      totalOrders: 0,
      totalJobs: 0,
      accountResults: []
    };

    // Track processed account codes to avoid duplicates
    const processedCodes = new Set();

    // Process env-based accounts first
    for (const { accountCode, credentials } of envAccounts) {
      try {
        console.log(`\n[${accountCode}] Starting eBay order fetch...`);
        processedCodes.add(accountCode);

        // Find or create MarketplaceAccount in database
        let account = await MarketplaceAccount.findOne({ accountCode, channel: 'ebay' });
        if (!account) {
          // Check if accountCode is used by another channel (e.g., Amazon uses "CSP")
          const existingAccount = await MarketplaceAccount.findOne({ accountCode });
          if (existingAccount) {
            // Use a channel-prefixed accountCode to avoid unique constraint
            const ebayAccountCode = `${accountCode}_EBAY`;
            account = await MarketplaceAccount.findOne({ accountCode: ebayAccountCode, channel: 'ebay' });
            if (!account) {
              account = await MarketplaceAccount.create({
                name: `${accountCode} eBay`,
                channel: 'ebay',
                accountCode: ebayAccountCode,
                isActive: true,
                settings: { syncEnabled: true }
              });
            }
          } else {
            account = await MarketplaceAccount.create({
              name: `${accountCode} eBay`,
              channel: 'ebay',
              accountCode,
              isActive: true,
              settings: { syncEnabled: true }
            });
          }
        }

        // Track the actual DB accountCode to avoid re-processing
        processedCodes.add(account.accountCode);

        const result = await this.fetchOrdersForAccount(account, credentials, fromDate, toDate, importAll);

        results.accountResults.push({ accountCode: account.accountCode, ...result });

        if (result.success) {
          results.totalOrders += result.stats?.ordersImported || 0;
          results.totalJobs += result.stats?.jobsCreated || 0;
        }

        await account.updateSyncStatus(
          result.success ? 'success' : 'failed',
          result.message,
          result.stats
        );

      } catch (error) {
        console.error(`[${accountCode}] eBay Error:`, error.message);
        results.accountResults.push({
          accountCode,
          success: false,
          message: error.message,
          troubleshooting: error.troubleshooting || null,
          stats: { ordersFound: 0, ordersImported: 0, errors: 1 }
        });
      }
    }

    // Process database-only accounts (not already processed from .env)
    for (const account of dbAccounts) {
      if (processedCodes.has(account.accountCode)) continue;
      if (!account.settings?.syncEnabled) continue;

      try {
        console.log(`\n[${account.accountCode}] Starting eBay order fetch (DB account)...`);
        const credentials = await account.getDecryptedCredentials();
        const result = await this.fetchOrdersForAccount(account, credentials, fromDate, toDate, importAll);

        results.accountResults.push({ accountCode: account.accountCode, ...result });

        if (result.success) {
          results.totalOrders += result.stats?.ordersImported || 0;
          results.totalJobs += result.stats?.jobsCreated || 0;
        }

        await account.updateSyncStatus(
          result.success ? 'success' : 'failed',
          result.message,
          result.stats
        );
      } catch (error) {
        console.error(`[${account.accountCode}] eBay Error:`, error.message);
        results.accountResults.push({
          accountCode: account.accountCode,
          success: false,
          message: error.message,
          troubleshooting: error.troubleshooting || null,
          stats: { ordersFound: 0, ordersImported: 0, errors: 1 }
        });
      }
    }

    if (results.accountResults.length === 0) {
      return {
        success: false,
        message: 'No eBay accounts configured. Please add eBay credentials in .env or Settings > Marketplace Accounts.',
        accountResults: []
      };
    }

    // Log audit
    await AuditLog.log({
      action: 'order_sync',
      entity: 'order',
      description: `Multi-account eBay sync: ${results.totalOrders} orders from ${results.accountResults.length} accounts`,
      metadata: {
        accounts: results.accountResults.map(a => a.accountCode),
        ordersImported: results.totalOrders,
        jobsCreated: results.totalJobs
      }
    });

    results.success = results.accountResults.some(a => a.success);
    results.message = `Synced ${results.totalOrders} orders and ${results.totalJobs} jobs from ${results.accountResults.length} account(s)`;
    results.stats = {
      ordersFound: results.accountResults.reduce((sum, a) => sum + (a.stats?.ordersFound || 0), 0),
      ordersImported: results.totalOrders,
      ordersSkipped: results.accountResults.reduce((sum, a) => sum + (a.stats?.ordersSkipped || 0), 0),
      errors: results.accountResults.reduce((sum, a) => sum + (a.stats?.errors || 0), 0)
    };

    return results;
  }

  /**
   * Legacy fetchOrders - now delegates to fetchOrdersFromAllAccounts
   */
  async fetchOrders(fromDate, toDate, importAll = false) {
    return this.fetchOrdersFromAllAccounts(fromDate, toDate, importAll);
  }

  // Multi-account: Fetch orders for a specific account
  async fetchOrdersForAccount(account, credentials, fromDate, toDate, importAll = false) {
    try {
      // Validate credentials before attempting sync
      if (!credentials || !credentials.appId || !credentials.certId) {
        console.log(`eBay credentials not configured for account ${account.accountCode}`);
        return {
          success: false,
          message: `eBay credentials not configured for account ${account.accountCode}. Please configure API credentials.`,
          stats: { ordersFound: 0, ordersImported: 0, ordersSkipped: 0, errors: 1 }
        };
      }

      if (!credentials.refreshToken) {
        console.log(`eBay refresh token not configured for account ${account.accountCode}`);
        return {
          success: false,
          message: `eBay OAuth token not configured for account ${account.accountCode}. Please configure refresh token.`,
          stats: { ordersFound: 0, ordersImported: 0, ordersSkipped: 0, errors: 1 }
        };
      }

      const syncDays = account.settings?.syncLastNDays || 7;

      let startDate = fromDate || new Date(Date.now() - syncDays * 24 * 60 * 60 * 1000);
      let endDate = toDate || new Date();

      // Try fetching orders, auto-adjust dates if eBay says they're in the future
      const response = await this._fetchOrdersWithDateRetry(
        startDate, endDate, importAll, credentials, account.accountCode
      );

      if (!response.orders || response.orders.length === 0) {
        return {
          success: true,
          message: 'No new orders',
          stats: { ordersFound: 0, ordersImported: 0, ordersSkipped: 0, errors: 0 }
        };
      }

      const importedOrders = [];
      const importedJobs = [];
      let errors = 0;

      for (const ebayOrder of response.orders) {
        try {
          const existingOrder = await MarketplaceOrder.findOne({
            channel: 'ebay',
            externalOrderId: ebayOrder.orderId
          });

          if (existingOrder) continue;

          // Extract authentic buyer contact info from shipTo (preferred) or buyer registration
          const shipTo = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
          const buyerReg = ebayOrder.buyer?.buyerRegistrationAddress;

          const buyerName = shipTo?.fullName
            || buyerReg?.fullName
            || ebayOrder.buyer?.username
            || 'eBay Customer';

          const buyerEmail = shipTo?.email
            || buyerReg?.email
            || null;

          const buyerPhone = shipTo?.primaryPhone?.phoneNumber
            || buyerReg?.primaryPhone?.phoneNumber
            || null;

          const order = await MarketplaceOrder.create({
            channel: 'ebay',
            externalOrderId: ebayOrder.orderId,
            buyerName,
            buyerEmail,
            buyerPhone,
            shippingAddress: shipTo ? {
              name: shipTo.fullName,
              addressLine1: shipTo.contactAddress?.addressLine1,
              addressLine2: shipTo.contactAddress?.addressLine2,
              city: shipTo.contactAddress?.city,
              state: shipTo.contactAddress?.stateOrProvince,
              postalCode: shipTo.contactAddress?.postalCode,
              country: shipTo.contactAddress?.countryCode,
              phone: buyerPhone,
              email: buyerEmail
            } : {},
            status: 'pending',
            orderDate: new Date(ebayOrder.creationDate),
            promisedDate: ebayOrder.fulfillmentStartInstructions?.[0]?.maxEstimatedDeliveryDate
              ? new Date(ebayOrder.fulfillmentStartInstructions[0].maxEstimatedDeliveryDate)
              : null,
            totalAmount: parseFloat(ebayOrder.pricingSummary?.total?.value || 0),
            currency: ebayOrder.pricingSummary?.total?.currency || 'USD',
            rawPayload: ebayOrder,
            marketplaceAccount: account._id,
            accountCode: account.accountCode
          });

          importedOrders.push(order);

          for (const lineItem of ebayOrder.lineItems || []) {
            const normalizedSku = (lineItem.sku || '').toUpperCase().trim();
            const skuStatus = await SkuMaster.checkCadStatus(normalizedSku);

            const orderItem = await MarketplaceOrderItem.create({
              order: order._id,
              sku: normalizedSku,
              asinOrItemId: lineItem.legacyItemId,
              productName: lineItem.title,
              quantity: lineItem.quantity,
              itemPrice: parseFloat(lineItem.lineItemCost?.value || 0),
              hasCadFile: skuStatus.hasCadFile,
              cadFilePath: skuStatus.cadFilePath
            });

            // Fetch and save product images
            if (lineItem.legacyItemId && normalizedSku) {
              try {
                const existingSkuMaster = await SkuMaster.findOne({ sku: normalizedSku });
                if (!existingSkuMaster?.images?.length) {
                  console.log(`[eBay Image] Fetching images for SKU ${normalizedSku}, Item ${lineItem.legacyItemId}`);
                  const imageResult = await this.downloadProductImages(lineItem.legacyItemId, normalizedSku, credentials);

                  if (imageResult.success && imageResult.images?.length > 0) {
                    const newImages = imageResult.images.map(img => ({
                      fileName: img.fileName,
                      filePath: img.filePath,
                      uploadedAt: new Date(),
                      source: 'ebay'
                    }));

                    if (existingSkuMaster) {
                      existingSkuMaster.images = [...(existingSkuMaster.images || []), ...newImages];
                      await existingSkuMaster.save();
                      console.log(`[eBay Image] Added ${newImages.length} images to SKU Master for ${normalizedSku}`);
                    } else {
                      await SkuMaster.create({
                        sku: normalizedSku,
                        productName: lineItem.title || `eBay Product ${lineItem.legacyItemId}`,
                        images: newImages,
                        isActive: true
                      });
                      console.log(`[eBay Image] Created SKU Master with ${newImages.length} images for ${normalizedSku}`);
                    }
                  }
                }
              } catch (imgErr) {
                console.error(`[eBay Image] Error fetching images for ${normalizedSku}:`, imgErr.message);
              }
            }

            const priority = account.settings?.defaultPriority || 'medium';

            const jobData = {
              sourceType: 'order',
              channel: 'ebay',
              orderItem: orderItem._id,
              order: order._id,
              sku: normalizedSku,
              productName: lineItem.title,
              quantity: lineItem.quantity,
              dueDate: order.promisedDate,
              customerName: order.buyerName,
              priority,
              status: 'new',
              hasCadFile: skuStatus.hasCadFile,
              cadFilePath: skuStatus.cadFilePath,
              cadRequired: !skuStatus.hasCadFile
            };

            const assignedJobData = await applyAutoAssignment(jobData, 'ebay');
            const job = await Job.create(assignedJobData);

            orderItem.isJobCreated = true;
            await orderItem.save();

            importedJobs.push(job);
          }

          await orderController.updateOrderCadSummary(order._id);
          await notificationService.sendOrderImportNotification(order, importedJobs.length);
        } catch (err) {
          console.error(`Error importing eBay order ${ebayOrder.orderId}:`, err);
          errors++;
        }
      }

      return {
        success: errors === 0,
        message: `Imported ${importedOrders.length} orders and created ${importedJobs.length} jobs`,
        stats: {
          ordersFound: response.orders.length,
          ordersImported: importedOrders.length,
          ordersSkipped: response.orders.length - importedOrders.length - errors,
          jobsCreated: importedJobs.length,
          errors
        }
      };
    } catch (error) {
      console.error('Error fetching eBay orders for account:', error);
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
      return { success: true, message: 'Successfully connected to eBay API' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // Multi-account: Test connection with specific credentials
  async testConnectionWithCredentials(credentials) {
    try {
      await this.getAccessToken(credentials);
      return { success: true, message: 'Successfully connected to eBay API' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Get application-level OAuth token for Browse API
   * This uses client credentials grant (no user context required)
   */
  async getApplicationToken(credentials = null) {
    const creds = credentials || await this.getCredentials();

    if (!creds.appId || !creds.certId) {
      throw new Error('eBay credentials not configured');
    }

    try {
      const authString = Buffer.from(`${creds.appId}:${creds.certId}`).toString('base64');

      const response = await axios.post(`${this.baseUrl}/identity/v1/oauth2/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          scope: 'https://api.ebay.com/oauth/api_scope'
        }), {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      return response.data.access_token;
    } catch (error) {
      console.error('Error getting eBay application token:', error.response?.data || error.message);
      throw new Error('Failed to get eBay application token');
    }
  }

  /**
   * Fetch product images from eBay Browse API using legacy item ID
   * @param {string} legacyItemId - The eBay legacy item ID (from order line items)
   * @param {object} credentials - Optional credentials for specific account
   * @returns {Promise<object>} - Product images data
   */
  async getProductImages(legacyItemId, credentials = null) {
    try {
      if (!legacyItemId) {
        return { success: false, message: 'Legacy Item ID is required', images: [] };
      }

      // Use application token for Browse API
      const accessToken = await this.getApplicationToken(credentials);

      // Try to get item by legacy ID
      const response = await axios({
        method: 'GET',
        url: `${this.baseUrl}/buy/browse/v1/item/get_item_by_legacy_id`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
        },
        params: {
          legacy_item_id: legacyItemId
        }
      });

      const item = response.data;
      const images = [];

      // Get primary image
      if (item.image) {
        images.push({
          url: item.image.imageUrl,
          variant: 'MAIN',
          height: item.image.height || null,
          width: item.image.width || null
        });
      }

      // Get additional images
      if (item.additionalImages && Array.isArray(item.additionalImages)) {
        item.additionalImages.forEach((img, index) => {
          images.push({
            url: img.imageUrl,
            variant: `PT${String(index + 1).padStart(2, '0')}`,
            height: img.height || null,
            width: img.width || null
          });
        });
      }

      return {
        success: true,
        legacyItemId,
        itemId: item.itemId,
        productTitle: item.title || '',
        images,
        imageCount: images.length
      };

    } catch (error) {
      // If item not found via legacy ID, try direct item endpoint if itemId format
      if (error.response?.status === 404) {
        console.log(`Item ${legacyItemId} not found via legacy ID lookup`);
      }
      console.error(`Error fetching eBay product images for item ${legacyItemId}:`, error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.errors?.[0]?.message || error.message,
        images: []
      };
    }
  }

  /**
   * Fetch and download product images to local storage
   * @param {string} legacyItemId - The eBay legacy item ID
   * @param {string} sku - The SKU to associate images with
   * @param {object} credentials - Optional credentials
   * @returns {Promise<object>} - Downloaded images info
   */
  async downloadProductImages(legacyItemId, sku, credentials = null) {
    try {
      const imageData = await this.getProductImages(legacyItemId, credentials);

      if (!imageData.success || imageData.images.length === 0) {
        return imageData;
      }

      const downloadedImages = [];

      // Create SKU-wise folder structure
      const normalizedSku = (sku || legacyItemId).toUpperCase().replace(/[^a-zA-Z0-9-_]/g, '_');
      const skuDir = path.join(__dirname, '../../uploads/product-images', normalizedSku);

      // Ensure SKU directory exists
      if (!fs.existsSync(skuDir)) {
        fs.mkdirSync(skuDir, { recursive: true });
        console.log(`[eBay Image Download] Created SKU folder: ${skuDir}`);
      }

      // Download up to 5 images
      const imagesToDownload = imageData.images.slice(0, 5);

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
          const fileName = `${normalizedSku}_ebay_${legacyItemId}_${i + 1}${ext}`;
          const filePath = path.join(skuDir, fileName);

          fs.writeFileSync(filePath, response.data);

          downloadedImages.push({
            fileName,
            filePath: `/uploads/product-images/${normalizedSku}/${fileName}`,
            originalUrl: img.url,
            variant: img.variant
          });

          console.log(`[eBay Image Download] Saved: ${fileName}`);

        } catch (downloadError) {
          console.error(`Failed to download eBay image ${i + 1} for item ${legacyItemId}:`, downloadError.message);
        }
      }

      return {
        success: true,
        legacyItemId,
        sku,
        productTitle: imageData.productTitle,
        downloadedCount: downloadedImages.length,
        images: downloadedImages
      };

    } catch (error) {
      console.error(`Error downloading eBay product images for item ${legacyItemId}:`, error.message);
      return {
        success: false,
        message: error.message,
        images: []
      };
    }
  }
}

module.exports = new EbayService();
