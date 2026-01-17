const { MarketplaceAccount, MarketplaceOrder, AuditLog } = require('../models');
const amazonService = require('../services/amazon.service');
const ebayService = require('../services/ebay.service');

// Get all marketplace accounts
exports.getAll = async (req, res) => {
  try {
    const { channel, isActive } = req.query;

    const query = {};
    if (channel && channel !== 'all') query.channel = channel;
    if (isActive !== undefined && isActive !== 'all') query.isActive = isActive === 'true';

    const accounts = await MarketplaceAccount.find(query)
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: accounts
    });
  } catch (error) {
    console.error('Get marketplace accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch marketplace accounts'
    });
  }
};

// Get single account
exports.getById = async (req, res) => {
  try {
    const account = await MarketplaceAccount.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    res.json({
      success: true,
      data: account
    });
  } catch (error) {
    console.error('Get account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch account'
    });
  }
};

// Create new marketplace account
exports.create = async (req, res) => {
  try {
    const {
      name,
      channel,
      accountCode,
      // Amazon credentials
      amazonRefreshToken,
      amazonClientId,
      amazonClientSecret,
      amazonMarketplaceId,
      amazonSellerId,
      // eBay credentials
      ebayAppId,
      ebayCertId,
      ebayOauthToken,
      ebayRefreshToken,
      // Settings
      syncEnabled,
      syncIntervalDays,
      autoCreateJobs,
      defaultPriority,
      syncLastNDays
    } = req.body;

    // Validate required fields
    if (!name || !channel || !accountCode) {
      return res.status(400).json({
        success: false,
        message: 'Name, channel, and account code are required'
      });
    }

    // Check if account code already exists
    const existing = await MarketplaceAccount.findOne({ accountCode: accountCode.toUpperCase() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Account code already exists'
      });
    }

    const accountData = {
      name,
      channel,
      accountCode: accountCode.toUpperCase(),
      settings: {
        syncEnabled: syncEnabled !== false,
        syncIntervalDays: syncIntervalDays || 7,
        autoCreateJobs: autoCreateJobs !== false,
        defaultPriority: defaultPriority || 'medium',
        syncLastNDays: syncLastNDays || 7
      },
      createdBy: req.userId
    };

    // Set credentials based on channel
    if (channel === 'amazon') {
      accountData.amazonCredentials = {
        refreshToken: amazonRefreshToken,
        clientId: amazonClientId,
        clientSecret: amazonClientSecret,
        marketplaceId: amazonMarketplaceId || 'ATVPDKIKX0DER',
        sellerId: amazonSellerId
      };
    } else if (channel === 'ebay') {
      accountData.ebayCredentials = {
        appId: ebayAppId,
        certId: ebayCertId,
        oauthToken: ebayOauthToken,
        refreshToken: ebayRefreshToken
      };
    }

    const account = await MarketplaceAccount.create(accountData);

    await AuditLog.log({
      user: req.userId,
      action: 'create',
      entity: 'marketplace_account',
      entityId: account._id,
      description: `Created marketplace account: ${name} (${accountCode})`,
      newValues: { name, channel, accountCode },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(201).json({
      success: true,
      message: 'Marketplace account created successfully',
      data: account
    });
  } catch (error) {
    console.error('Create account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create marketplace account'
    });
  }
};

// Update marketplace account
exports.update = async (req, res) => {
  try {
    const account = await MarketplaceAccount.findById(req.params.id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    const oldValues = account.toObject();

    const {
      name,
      // Amazon credentials
      amazonRefreshToken,
      amazonClientId,
      amazonClientSecret,
      amazonMarketplaceId,
      amazonSellerId,
      // eBay credentials
      ebayAppId,
      ebayCertId,
      ebayOauthToken,
      ebayRefreshToken,
      // Settings
      syncEnabled,
      syncIntervalDays,
      autoCreateJobs,
      defaultPriority,
      syncLastNDays,
      isActive
    } = req.body;

    // Update basic fields
    if (name) account.name = name;
    if (isActive !== undefined) account.isActive = isActive;

    // Update settings
    if (syncEnabled !== undefined) account.settings.syncEnabled = syncEnabled;
    if (syncIntervalDays) account.settings.syncIntervalDays = syncIntervalDays;
    if (autoCreateJobs !== undefined) account.settings.autoCreateJobs = autoCreateJobs;
    if (defaultPriority) account.settings.defaultPriority = defaultPriority;
    if (syncLastNDays) account.settings.syncLastNDays = syncLastNDays;

    // Update credentials based on channel
    if (account.channel === 'amazon') {
      if (amazonRefreshToken) account.amazonCredentials.refreshToken = amazonRefreshToken;
      if (amazonClientId) account.amazonCredentials.clientId = amazonClientId;
      if (amazonClientSecret) account.amazonCredentials.clientSecret = amazonClientSecret;
      if (amazonMarketplaceId) account.amazonCredentials.marketplaceId = amazonMarketplaceId;
      if (amazonSellerId) account.amazonCredentials.sellerId = amazonSellerId;
    } else if (account.channel === 'ebay') {
      if (ebayAppId) account.ebayCredentials.appId = ebayAppId;
      if (ebayCertId) account.ebayCredentials.certId = ebayCertId;
      if (ebayOauthToken) account.ebayCredentials.oauthToken = ebayOauthToken;
      if (ebayRefreshToken) account.ebayCredentials.refreshToken = ebayRefreshToken;
    }

    account.updatedBy = req.userId;
    await account.save();

    await AuditLog.log({
      user: req.userId,
      action: 'update',
      entity: 'marketplace_account',
      entityId: account._id,
      description: `Updated marketplace account: ${account.name}`,
      oldValues: { name: oldValues.name },
      newValues: { name: account.name },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Account updated successfully',
      data: account
    });
  } catch (error) {
    console.error('Update account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update account'
    });
  }
};

// Delete (deactivate) marketplace account
exports.delete = async (req, res) => {
  try {
    const account = await MarketplaceAccount.findById(req.params.id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    account.isActive = false;
    account.updatedBy = req.userId;
    await account.save();

    await AuditLog.log({
      user: req.userId,
      action: 'delete',
      entity: 'marketplace_account',
      entityId: account._id,
      description: `Deactivated marketplace account: ${account.name}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Account deactivated successfully'
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate account'
    });
  }
};

// Test connection for an account
exports.testConnection = async (req, res) => {
  try {
    const account = await MarketplaceAccount.findById(req.params.id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    let result;
    const credentials = account.getDecryptedCredentials();

    if (account.channel === 'amazon') {
      result = await amazonService.testConnectionWithCredentials(credentials);
    } else if (account.channel === 'ebay') {
      result = await ebayService.testConnectionWithCredentials(credentials);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid channel'
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Test connection error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Connection test failed'
    });
  }
};

// Sync orders for a specific account
exports.syncAccount = async (req, res) => {
  try {
    const account = await MarketplaceAccount.findById(req.params.id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    if (!account.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Cannot sync inactive account'
      });
    }

    let result;
    const credentials = account.getDecryptedCredentials();

    if (account.channel === 'amazon') {
      result = await amazonService.fetchOrdersForAccount(account, credentials);
    } else if (account.channel === 'ebay') {
      result = await ebayService.fetchOrdersForAccount(account, credentials);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid channel'
      });
    }

    // Update account sync status
    await account.updateSyncStatus(
      result.success ? 'success' : 'failed',
      result.message,
      result.stats
    );

    await AuditLog.log({
      user: req.userId,
      action: 'sync',
      entity: 'marketplace_account',
      entityId: account._id,
      description: `Synced orders for account: ${account.name}`,
      metadata: result.stats,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: result.success,
      message: result.message,
      data: result.stats
    });
  } catch (error) {
    console.error('Sync account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync account'
    });
  }
};

// Sync all active accounts
exports.syncAll = async (req, res) => {
  try {
    const accounts = await MarketplaceAccount.find({
      isActive: true,
      'settings.syncEnabled': true
    });

    if (accounts.length === 0) {
      return res.json({
        success: true,
        message: 'No active accounts to sync',
        data: []
      });
    }

    const results = [];

    for (const account of accounts) {
      try {
        const credentials = account.getDecryptedCredentials();
        let result;

        if (account.channel === 'amazon') {
          result = await amazonService.fetchOrdersForAccount(account, credentials);
        } else if (account.channel === 'ebay') {
          result = await ebayService.fetchOrdersForAccount(account, credentials);
        } else {
          result = { success: false, message: 'Invalid channel', stats: {} };
        }

        await account.updateSyncStatus(
          result.success ? 'success' : 'failed',
          result.message,
          result.stats
        );

        results.push({
          accountId: account._id,
          accountCode: account.accountCode,
          channel: account.channel,
          success: result.success,
          message: result.message,
          stats: result.stats
        });
      } catch (err) {
        results.push({
          accountId: account._id,
          accountCode: account.accountCode,
          channel: account.channel,
          success: false,
          message: err.message,
          stats: {}
        });
      }
    }

    await AuditLog.log({
      user: req.userId,
      action: 'sync_all',
      entity: 'marketplace_account',
      description: `Synced all marketplace accounts: ${results.filter(r => r.success).length}/${results.length} successful`,
      metadata: { results },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: `Synced ${results.filter(r => r.success).length}/${results.length} accounts successfully`,
      data: results
    });
  } catch (error) {
    console.error('Sync all accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync accounts'
    });
  }
};

// Get sync history for an account
exports.getSyncHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const logs = await AuditLog.find({
      entity: 'marketplace_account',
      entityId: req.params.id,
      action: { $in: ['sync', 'sync_all'] }
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('user', 'name');

    const total = await AuditLog.countDocuments({
      entity: 'marketplace_account',
      entityId: req.params.id,
      action: { $in: ['sync', 'sync_all'] }
    });

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get sync history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sync history'
    });
  }
};

// Get order count by account
exports.getOrderCount = async (req, res) => {
  try {
    const account = await MarketplaceAccount.findById(req.params.id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    const totalOrders = await MarketplaceOrder.countDocuments({
      marketplaceAccount: account._id
    });

    const byStatus = await MarketplaceOrder.aggregate([
      { $match: { marketplaceAccount: account._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        total: totalOrders,
        byStatus: byStatus.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('Get order count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order count'
    });
  }
};

// Get all available marketplace IDs
exports.getMarketplaceIds = async (req, res) => {
  try {
    const amazonMarketplaces = [
      { id: 'ATVPDKIKX0DER', name: 'United States', country: 'US' },
      { id: 'A2EUQ1WTGCTBG2', name: 'Canada', country: 'CA' },
      { id: 'A1AM78C64UM0Y8', name: 'Mexico', country: 'MX' },
      { id: 'A1F83G8C2ARO7P', name: 'United Kingdom', country: 'UK' },
      { id: 'A1PA6795UKMFR9', name: 'Germany', country: 'DE' },
      { id: 'A13V1IB3VIYBER', name: 'France', country: 'FR' },
      { id: 'A1RKKUPIHCS9HS', name: 'Spain', country: 'ES' },
      { id: 'APJ6JRA9NG5V4', name: 'Italy', country: 'IT' },
      { id: 'A21TJRUUN4KGV', name: 'India', country: 'IN' },
      { id: 'A1VC38T7YXB528', name: 'Japan', country: 'JP' },
      { id: 'AAHKV2X7AFYLW', name: 'China', country: 'CN' },
      { id: 'A39IBJ37TRP1C6', name: 'Australia', country: 'AU' }
    ];

    const ebayMarketplaces = [
      { id: 'EBAY_US', name: 'United States', country: 'US' },
      { id: 'EBAY_GB', name: 'United Kingdom', country: 'UK' },
      { id: 'EBAY_DE', name: 'Germany', country: 'DE' },
      { id: 'EBAY_AU', name: 'Australia', country: 'AU' },
      { id: 'EBAY_CA', name: 'Canada', country: 'CA' },
      { id: 'EBAY_FR', name: 'France', country: 'FR' },
      { id: 'EBAY_IT', name: 'Italy', country: 'IT' },
      { id: 'EBAY_ES', name: 'Spain', country: 'ES' }
    ];

    res.json({
      success: true,
      data: {
        amazon: amazonMarketplaces,
        ebay: ebayMarketplaces
      }
    });
  } catch (error) {
    console.error('Get marketplace IDs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch marketplace IDs'
    });
  }
};
