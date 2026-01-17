const mongoose = require('mongoose');
const CryptoJS = require('crypto-js');

const systemSettingsSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  value: {
    type: String
  },
  valueType: {
    type: String,
    enum: ['string', 'number', 'boolean', 'json', 'encrypted'],
    default: 'string'
  },
  category: {
    type: String,
    enum: ['general', 'amazon', 'ebay', 'whatsapp', 'email', 'tat', 'notification'],
    default: 'general'
  },
  description: {
    type: String
  },
  isEditable: {
    type: Boolean,
    default: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// key already indexed via unique: true
systemSettingsSchema.index({ category: 1 });

// Encrypt sensitive values
systemSettingsSchema.methods.encryptValue = function (plainValue) {
  const encryptionKey = process.env.ENCRYPTION_KEY || 'default_key';
  return CryptoJS.AES.encrypt(plainValue, encryptionKey).toString();
};

// Decrypt sensitive values
systemSettingsSchema.methods.decryptValue = function () {
  if (this.valueType !== 'encrypted') return this.value;

  const encryptionKey = process.env.ENCRYPTION_KEY || 'default_key';
  const bytes = CryptoJS.AES.decrypt(this.value, encryptionKey);
  return bytes.toString(CryptoJS.enc.Utf8);
};

// Static method to get setting by key
systemSettingsSchema.statics.getSetting = async function (key, decrypt = false) {
  const setting = await this.findOne({ key });
  if (!setting) return null;

  if (decrypt && setting.valueType === 'encrypted') {
    return setting.decryptValue();
  }

  // Parse based on type
  switch (setting.valueType) {
    case 'number':
      return parseFloat(setting.value);
    case 'boolean':
      return setting.value === 'true';
    case 'json':
      try {
        return JSON.parse(setting.value);
      } catch {
        return setting.value;
      }
    default:
      return setting.value;
  }
};

// Static method to set setting
systemSettingsSchema.statics.setSetting = async function (key, value, options = {}) {
  const { category = 'general', description, valueType = 'string', encrypt = false, userId } = options;

  let finalValue = value;
  let finalValueType = valueType;

  if (encrypt) {
    const encryptionKey = process.env.ENCRYPTION_KEY || 'default_key';
    finalValue = CryptoJS.AES.encrypt(String(value), encryptionKey).toString();
    finalValueType = 'encrypted';
  } else if (typeof value === 'object') {
    finalValue = JSON.stringify(value);
    finalValueType = 'json';
  } else {
    finalValue = String(value);
  }

  return this.findOneAndUpdate(
    { key },
    {
      key,
      value: finalValue,
      valueType: finalValueType,
      category,
      description,
      updatedBy: userId
    },
    { upsert: true, new: true }
  );
};

// Static method to initialize default settings
systemSettingsSchema.statics.initializeDefaultSettings = async function () {
  const defaults = [
    { key: 'tat_cad_hours', value: '24', valueType: 'number', category: 'tat', description: 'TAT for CAD stage in business hours' },
    { key: 'tat_manufacturing_hours', value: '72', valueType: 'number', category: 'tat', description: 'TAT for Manufacturing stage in business hours' },
    { key: 'whatsapp_enabled', value: 'true', valueType: 'boolean', category: 'whatsapp', description: 'Global WhatsApp toggle' },
    { key: 'whatsapp_template_sync_summary', value: 'order_sync_summary', valueType: 'string', category: 'whatsapp', description: 'Template for sync summary report' },
    { key: 'whatsapp_template_cad_assigned', value: 'designer_assigned', valueType: 'string', category: 'whatsapp', description: 'Template for designer assignment notification' },
    { key: 'whatsapp_template_tat_breach', value: 'tat_breach_alert', valueType: 'string', category: 'whatsapp', description: 'Template for TAT breach alerts' },
    { key: 'business_hours', value: JSON.stringify({ start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5, 6] }), valueType: 'json', category: 'general', description: 'Business hours configuration' },
    { key: 'sku_normalization_rules', value: JSON.stringify({ strip: ["-", " "], uppercase: true }), valueType: 'json', category: 'general', description: 'Rules for SKU normalization' },
    { key: 'auto_assignment_rules', value: JSON.stringify({ amazon: null, ebay: null, etsy: null, manual: null }), valueType: 'json', category: 'general', description: 'Auto-assignment rules per channel' }
  ];

  for (const def of defaults) {
    const existing = await this.findOne({ key: def.key });
    if (!existing) {
      await this.create(def);
      console.log(`[SystemSettings] Initialized default setting: ${def.key}`);
    }
  }
};

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);
