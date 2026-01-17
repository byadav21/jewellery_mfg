const mongoose = require('mongoose');

const whatsappConfigSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  provider: {
    type: String,
    enum: ['meta', 'twilio', 'gupshup', 'wati', 'interakt'],
    default: 'meta'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  credentials: {
    // Meta (Facebook) Business API
    accessToken: String,
    phoneNumberId: String,
    businessAccountId: String,
    appSecret: String,
    verifyToken: String,

    // Twilio
    accountSid: String,
    authToken: String,
    twilioPhoneNumber: String,

    // Generic API Key based
    apiKey: String,
    apiSecret: String,
    baseUrl: String
  },
  webhookUrl: {
    type: String
  },
  settings: {
    defaultCountryCode: { type: String, default: '+91' },
    messageRetryAttempts: { type: Number, default: 3 },
    retryDelaySeconds: { type: Number, default: 60 },
    sessionTimeoutHours: { type: Number, default: 24 },
    enableReadReceipts: { type: Boolean, default: true },
    enableTypingIndicator: { type: Boolean, default: true }
  },
  rateLimits: {
    messagesPerSecond: { type: Number, default: 80 },
    messagesPerDay: { type: Number, default: 1000 },
    templateMessagesPerDay: { type: Number, default: 250 }
  },
  templates: [{
    templateId: String,
    name: String,
    language: { type: String, default: 'en' },
    category: { type: String, enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'] },
    status: { type: String, enum: ['APPROVED', 'PENDING', 'REJECTED'] },
    components: mongoose.Schema.Types.Mixed
  }]
}, {
  timestamps: true
});

// Encrypt sensitive credentials before save
whatsappConfigSchema.pre('save', function(next) {
  // In production, encrypt credentials here
  next();
});

module.exports = mongoose.model('WhatsAppConfig', whatsappConfigSchema);
