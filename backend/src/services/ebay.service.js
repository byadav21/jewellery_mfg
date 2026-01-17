const axios = require('axios');
const { SystemSettings, MarketplaceOrder, MarketplaceOrderItem, Job, AuditLog, SkuMaster } = require('../models');
const notificationService = require('./notification.service');
const orderController = require('../controllers/order.controller');
const { applyAutoAssignment } = require('../utils/assignment.utils');

class EbayService {
  constructor() {
    this.baseUrl = 'https://api.ebay.com';
    this.accessToken = null;
    this.tokenExpiry = null;
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

  async getAccessToken(credentials = null) {
    const creds = credentials || await this.getCredentials();

    // Only use cache for default credentials
    if (!credentials) {
      if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
        return this.accessToken;
      }
    }

    if (!creds.appId || !creds.certId) {
      throw new Error('eBay credentials not configured');
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

      // Only cache for default credentials
      if (!credentials) {
        this.accessToken = token;
        this.tokenExpiry = new Date(Date.now() + (response.data.expires_in - 300) * 1000);
      }

      return token;
    } catch (error) {
      console.error('Error getting eBay access token:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with eBay');
    }
  }

  async makeRequest(method, endpoint, data = null, credentials = null) {
    const accessToken = await this.getAccessToken(credentials);

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
      console.error('eBay API error:', error.response?.data || error.message);
      throw error;
    }
  }

  async fetchOrders(fromDate, toDate, importAll = false) {
    try {
      const isEnabled = await SystemSettings.getSetting('ebay_enabled');
      if (!isEnabled) {
        console.log('eBay integration is disabled');
        return { success: false, message: 'eBay integration disabled' };
      }

      const startDate = fromDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const endDate = toDate || new Date();
      const formattedStartDate = startDate.toISOString();
      const formattedEndDate = endDate.toISOString();

      let filter = `creationdate:[${formattedStartDate}..${formattedEndDate}]`;

      // If not importAll, only fetch Paid orders
      if (!importAll) {
        filter += `,orderPaymentStatus:{PAID}`;
      }

      const response = await this.makeRequest('GET', '/sell/fulfillment/v1/order', {
        filter: filter,
        limit: 50
      });

      if (!response.orders || response.orders.length === 0) {
        return { success: true, orders: [], message: 'No new orders', stats: { ordersFound: 0, ordersImported: 0, errors: 0 } };
      }

      const importedOrders = [];
      const importedJobs = [];

      for (const ebayOrder of response.orders) {
        const existingOrder = await MarketplaceOrder.findOne({
          channel: 'ebay',
          externalOrderId: ebayOrder.orderId
        });

        if (existingOrder) continue;

        const order = await MarketplaceOrder.create({
          channel: 'ebay',
          externalOrderId: ebayOrder.orderId,
          buyerName: ebayOrder.buyer?.username || 'eBay Customer',
          buyerEmail: ebayOrder.buyer?.buyerRegistrationAddress?.email,
          shippingAddress: ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo ? {
            name: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.fullName,
            addressLine1: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.addressLine1,
            addressLine2: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.addressLine2,
            city: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.city,
            state: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.stateOrProvince,
            postalCode: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.postalCode,
            country: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.countryCode
          } : {},
          status: 'pending',
          orderDate: new Date(ebayOrder.creationDate),
          promisedDate: ebayOrder.fulfillmentStartInstructions?.[0]?.maxEstimatedDeliveryDate
            ? new Date(ebayOrder.fulfillmentStartInstructions[0].maxEstimatedDeliveryDate)
            : null,
          totalAmount: parseFloat(ebayOrder.pricingSummary?.total?.value || 0),
          currency: ebayOrder.pricingSummary?.total?.currency || 'USD',
          rawPayload: ebayOrder
        });

        importedOrders.push(order);

        for (const lineItem of ebayOrder.lineItems || []) {
          const skuStatus = await SkuMaster.checkCadStatus(lineItem.sku || '');

          const orderItem = await MarketplaceOrderItem.create({
            order: order._id,
            sku: lineItem.sku,
            asinOrItemId: lineItem.legacyItemId,
            productName: lineItem.title,
            quantity: lineItem.quantity,
            itemPrice: parseFloat(lineItem.lineItemCost?.value || 0),
            hasCadFile: skuStatus.hasCadFile,
            cadFilePath: skuStatus.cadFilePath
          });

          const jobData = {
            sourceType: 'order',
            channel: 'ebay',
            orderItem: orderItem._id,
            order: order._id,
            sku: lineItem.sku,
            productName: lineItem.title,
            quantity: lineItem.quantity,
            dueDate: order.promisedDate,
            customerName: order.buyerName,
            priority: 'medium',
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
      }

      await AuditLog.log({
        action: 'order_sync',
        entity: 'order',
        description: `eBay sync: ${importedOrders.length} orders, ${importedJobs.length} jobs imported`,
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
          ordersFound: response.orders.length,
          ordersImported: importedOrders.length,
          ordersSkipped: response.orders.length - importedOrders.length,
          errors: 0
        }
      };
    } catch (error) {
      console.error('Error fetching eBay orders:', error);
      return {
        success: false,
        message: error.message,
        stats: { ordersFound: 0, ordersImported: 0, errors: 1 }
      };
    }
  }

  // Multi-account: Fetch orders for a specific account
  async fetchOrdersForAccount(account, credentials, fromDate, toDate, importAll = false) {
    try {
      const syncDays = account.settings?.syncLastNDays || 7;
      const startDate = fromDate || new Date(Date.now() - syncDays * 24 * 60 * 60 * 1000);
      const endDate = toDate || new Date();
      const formattedStartDate = startDate.toISOString();
      const formattedEndDate = endDate.toISOString();

      let filter = `creationdate:[${formattedStartDate}..${formattedEndDate}]`;

      if (!importAll) {
        filter += `,orderPaymentStatus:{PAID}`;
      }

      const response = await this.makeRequest('GET', '/sell/fulfillment/v1/order', {
        filter: filter,
        limit: 50
      }, credentials);

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

          const order = await MarketplaceOrder.create({
            channel: 'ebay',
            externalOrderId: ebayOrder.orderId,
            buyerName: ebayOrder.buyer?.username || 'eBay Customer',
            buyerEmail: ebayOrder.buyer?.buyerRegistrationAddress?.email,
            shippingAddress: ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo ? {
              name: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.fullName,
              addressLine1: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.addressLine1,
              addressLine2: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.addressLine2,
              city: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.city,
              state: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.stateOrProvince,
              postalCode: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.postalCode,
              country: ebayOrder.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.countryCode
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
            const skuStatus = await SkuMaster.checkCadStatus(lineItem.sku || '');

            const orderItem = await MarketplaceOrderItem.create({
              order: order._id,
              sku: lineItem.sku,
              asinOrItemId: lineItem.legacyItemId,
              productName: lineItem.title,
              quantity: lineItem.quantity,
              itemPrice: parseFloat(lineItem.lineItemCost?.value || 0),
              hasCadFile: skuStatus.hasCadFile,
              cadFilePath: skuStatus.cadFilePath
            });

            const priority = account.settings?.defaultPriority || 'medium';

            const jobData = {
              sourceType: 'order',
              channel: 'ebay',
              orderItem: orderItem._id,
              order: order._id,
              sku: lineItem.sku,
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
}

module.exports = new EbayService();
