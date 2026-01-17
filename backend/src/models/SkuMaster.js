const mongoose = require('mongoose');

const skuMasterSchema = new mongoose.Schema({
  sku: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  productName: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  category: {
    type: String,
    enum: ['ring', 'necklace', 'bracelet', 'earring', 'pendant', 'chain', 'bangle', 'other'],
    default: 'other'
  },
  // CAD File Information
  cadFile: {
    fileName: String,
    filePath: String,
    uploadedAt: Date,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    fileSize: Number
  },
  hasCadFile: {
    type: Boolean,
    default: false
  },
  // Reference Images
  images: [{
    fileName: String,
    filePath: String,
    isPrimary: { type: Boolean, default: false },
    uploadedAt: { type: Date, default: Date.now }
  }],
  // Pricing & Specifications
  basePrice: {
    type: Number,
    default: 0
  },
  weight: {
    type: Number,
    default: 0
  },
  metalType: {
    type: String,
    trim: true
  },
  purity: {
    type: String,
    trim: true
  },
  // Marketplace Mappings
  marketplaceMappings: [{
    channel: {
      type: String,
      enum: ['amazon', 'ebay']
    },
    externalId: String,
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceAccount' }
  }],
  // Status
  isActive: {
    type: Boolean,
    default: true
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

// Indexes (sku index already created via unique: true in schema)
skuMasterSchema.index({ productName: 'text', description: 'text' });
skuMasterSchema.index({ hasCadFile: 1 });
skuMasterSchema.index({ category: 1 });
skuMasterSchema.index({ isActive: 1 });
skuMasterSchema.index({ 'marketplaceMappings.externalId': 1 });

// Static method to find by SKU or external ID
skuMasterSchema.statics.findBySku = async function(sku) {
  return this.findOne({ sku: sku.toUpperCase(), isActive: true });
};

// Static method to find by ASIN or eBay Item ID
skuMasterSchema.statics.findByExternalId = async function(externalId, channel) {
  return this.findOne({
    'marketplaceMappings.externalId': externalId,
    'marketplaceMappings.channel': channel,
    isActive: true
  });
};

// Static method to check if SKU has CAD file
skuMasterSchema.statics.checkCadStatus = async function(sku) {
  const record = await this.findOne(
    { sku: sku.toUpperCase(), isActive: true },
    { hasCadFile: 1, cadFile: 1 }
  );
  return {
    exists: !!record,
    hasCadFile: record?.hasCadFile || false,
    cadFilePath: record?.cadFile?.filePath || null
  };
};

module.exports = mongoose.model('SkuMaster', skuMasterSchema);
