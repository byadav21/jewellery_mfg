const mongoose = require('mongoose');

const marketplaceOrderItemSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MarketplaceOrder',
    required: true
  },
  sku: {
    type: String,
    required: true,
    trim: true
  },
  asinOrItemId: {
    type: String,
    trim: true
  },
  productName: {
    type: String,
    trim: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  itemPrice: {
    type: Number,
    default: 0
  },
  customizationInfo: {
    type: String
  },
  giftMessage: {
    type: String
  },
  isJobCreated: {
    type: Boolean,
    default: false
  },
  // CAD Status from SKU Master
  hasCadFile: {
    type: Boolean,
    default: false
  },
  cadFilePath: {
    type: String
  },
  skuMasterRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SkuMaster'
  }
}, {
  timestamps: true
});

marketplaceOrderItemSchema.index({ order: 1 });
marketplaceOrderItemSchema.index({ sku: 1 });
marketplaceOrderItemSchema.index({ isJobCreated: 1 });

module.exports = mongoose.model('MarketplaceOrderItem', marketplaceOrderItemSchema);
