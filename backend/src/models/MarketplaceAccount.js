const mongoose = require('mongoose');
const CryptoJS = require('crypto-js');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production';

// Helper functions for encryption
const encrypt = (text) => {
  if (!text) return text;
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
};

const decrypt = (ciphertext) => {
  if (!ciphertext) return ciphertext;
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    return ciphertext;
  }
};

const marketplaceAccountSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  channel: {
    type: String,
    required: true,
    enum: ['amazon', 'ebay']
  },
  accountCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  // Amazon SP-API Credentials
  amazonCredentials: {
    refreshToken: String,
    clientId: String,
    clientSecret: String,
    marketplaceId: {
      type: String,
      default: 'ATVPDKIKX0DER' // US marketplace
    },
    sellerId: String
  },
  // eBay Credentials
  ebayCredentials: {
    appId: String,
    certId: String,
    oauthToken: String,
    refreshToken: String
  },
  // Settings
  settings: {
    syncEnabled: {
      type: Boolean,
      default: true
    },
    syncIntervalDays: {
      type: Number,
      default: 7,
      min: 1,
      max: 30
    },
    autoCreateJobs: {
      type: Boolean,
      default: true
    },
    defaultPriority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium'
    },
    syncLastNDays: {
      type: Number,
      default: 7,
      min: 1,
      max: 30
    }
  },
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  lastSyncAt: Date,
  lastSyncStatus: {
    type: String,
    enum: ['success', 'failed', 'partial', 'pending'],
    default: 'pending'
  },
  lastSyncMessage: String,
  lastSyncStats: {
    ordersFound: { type: Number, default: 0 },
    ordersImported: { type: Number, default: 0 },
    ordersSkipped: { type: Number, default: 0 },
    errors: { type: Number, default: 0 }
  },
  // Audit
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes (accountCode index already created via unique: true in schema)
marketplaceAccountSchema.index({ channel: 1 });
marketplaceAccountSchema.index({ isActive: 1 });
marketplaceAccountSchema.index({ lastSyncAt: 1 });

// Pre-save middleware to encrypt sensitive credentials
marketplaceAccountSchema.pre('save', function(next) {
  if (this.isModified('amazonCredentials.refreshToken') && this.amazonCredentials?.refreshToken) {
    this.amazonCredentials.refreshToken = encrypt(this.amazonCredentials.refreshToken);
  }
  if (this.isModified('amazonCredentials.clientSecret') && this.amazonCredentials?.clientSecret) {
    this.amazonCredentials.clientSecret = encrypt(this.amazonCredentials.clientSecret);
  }
  if (this.isModified('ebayCredentials.certId') && this.ebayCredentials?.certId) {
    this.ebayCredentials.certId = encrypt(this.ebayCredentials.certId);
  }
  if (this.isModified('ebayCredentials.oauthToken') && this.ebayCredentials?.oauthToken) {
    this.ebayCredentials.oauthToken = encrypt(this.ebayCredentials.oauthToken);
  }
  if (this.isModified('ebayCredentials.refreshToken') && this.ebayCredentials?.refreshToken) {
    this.ebayCredentials.refreshToken = encrypt(this.ebayCredentials.refreshToken);
  }
  next();
});

// Method to get decrypted credentials
marketplaceAccountSchema.methods.getDecryptedCredentials = function() {
  if (this.channel === 'amazon') {
    return {
      refreshToken: decrypt(this.amazonCredentials?.refreshToken),
      clientId: this.amazonCredentials?.clientId,
      clientSecret: decrypt(this.amazonCredentials?.clientSecret),
      marketplaceId: this.amazonCredentials?.marketplaceId,
      sellerId: this.amazonCredentials?.sellerId
    };
  } else if (this.channel === 'ebay') {
    return {
      appId: this.ebayCredentials?.appId,
      certId: decrypt(this.ebayCredentials?.certId),
      oauthToken: decrypt(this.ebayCredentials?.oauthToken),
      refreshToken: decrypt(this.ebayCredentials?.refreshToken)
    };
  }
  return {};
};

// Static method to get accounts due for sync
marketplaceAccountSchema.statics.getAccountsDueForSync = async function() {
  const accounts = await this.find({
    isActive: true,
    'settings.syncEnabled': true
  });

  return accounts.filter(account => {
    if (!account.lastSyncAt) return true;
    const daysSinceSync = (Date.now() - account.lastSyncAt.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceSync >= account.settings.syncIntervalDays;
  });
};

// Method to update sync status
marketplaceAccountSchema.methods.updateSyncStatus = async function(status, message, stats) {
  this.lastSyncAt = new Date();
  this.lastSyncStatus = status;
  this.lastSyncMessage = message;
  if (stats) {
    this.lastSyncStats = stats;
  }
  return this.save();
};

// Transform for API response (hide sensitive data)
marketplaceAccountSchema.methods.toJSON = function() {
  const obj = this.toObject();

  // Mask sensitive credentials
  if (obj.amazonCredentials) {
    obj.amazonCredentials = {
      clientId: obj.amazonCredentials.clientId,
      marketplaceId: obj.amazonCredentials.marketplaceId,
      sellerId: obj.amazonCredentials.sellerId,
      hasRefreshToken: !!obj.amazonCredentials.refreshToken,
      hasClientSecret: !!obj.amazonCredentials.clientSecret
    };
  }

  if (obj.ebayCredentials) {
    obj.ebayCredentials = {
      appId: obj.ebayCredentials.appId,
      hasOauthToken: !!obj.ebayCredentials.oauthToken,
      hasCertId: !!obj.ebayCredentials.certId,
      hasRefreshToken: !!obj.ebayCredentials.refreshToken
    };
  }

  return obj;
};

module.exports = mongoose.model('MarketplaceAccount', marketplaceAccountSchema);
