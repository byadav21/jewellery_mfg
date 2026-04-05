const mongoose = require('mongoose');

const marketplaceOrderSchema = new mongoose.Schema({
  channel: {
    type: String,
    required: true,
    enum: ['amazon', 'ebay', 'etsy', 'manual'],
    default: 'manual',
    lowercase: true
  },
  externalOrderId: {
    type: String,
    required: true
  },
  buyerName: {
    type: String,
    trim: true
  },
  buyerEmail: {
    type: String,
    trim: true,
    lowercase: true
  },
  buyerPhone: {
    type: String,
    trim: true
  },
  shippingAddress: {
    name: String,
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    postalCode: String,
    country: String
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  orderDate: {
    type: Date,
    required: true
  },
  promisedDate: {
    type: Date
  },
  totalAmount: {
    type: Number,
    default: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  rawPayload: {
    type: mongoose.Schema.Types.Mixed
  },
  syncedAt: {
    type: Date,
    default: Date.now
  },
  // Multi-account support
  marketplaceAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MarketplaceAccount'
  },
  accountCode: {
    type: String,
    trim: true
  },
  // CAD Summary (computed during sync/update)
  cadSummary: {
    total: { type: Number, default: 0 },
    withCad: { type: Number, default: 0 },
    withoutCad: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['all_cad', 'partial', 'no_cad', 'unknown'],
      default: 'unknown'
    }
  },
  // Soft delete support
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Compound index for unique orders per channel and account
marketplaceOrderSchema.index({ channel: 1, externalOrderId: 1 }, { unique: true });
marketplaceOrderSchema.index({ status: 1 });
marketplaceOrderSchema.index({ orderDate: -1 });
marketplaceOrderSchema.index({ marketplaceAccount: 1 });
marketplaceOrderSchema.index({ accountCode: 1 });
marketplaceOrderSchema.index({ 'cadSummary.status': 1 });
marketplaceOrderSchema.index({ isDeleted: 1, orderDate: -1 });

module.exports = mongoose.model('MarketplaceOrder', marketplaceOrderSchema);
