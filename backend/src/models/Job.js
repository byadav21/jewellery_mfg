const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  jobCode: {
    type: String,
    required: true,
    unique: true
  },
  sourceType: {
    type: String,
    enum: ['order', 'manual'],
    default: 'order'
  },
  channel: {
    type: String,
    enum: ['amazon', 'ebay', 'etsy', 'manual'],
    default: 'manual'
  },
  // Multi-account support
  accountCode: {
    type: String,
    trim: true,
    uppercase: true
  },
  orderItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MarketplaceOrderItem'
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MarketplaceOrder'
  },
  sku: {
    type: String,
    trim: true
  },
  productName: {
    type: String,
    trim: true
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: [
      'new',
      'cad_assigned',
      'cad_in_progress',
      'cad_submitted',
      'cad_approved',
      'cad_rejected',
      'components_issued',
      'manufacturing_assigned',
      'manufacturing_accepted',
      'manufacturing_in_progress',
      'manufacturing_ready_qc',
      'manufacturing_ready_delivery',
      'ready_for_pickup',
      'shipped',
      'delivered',
      'cancelled'
    ],
    default: 'new'
  },
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  cadDesigner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  manufacturer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  productionCoordinator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  docket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Docket'
  },
  dueDate: {
    type: Date
  },
  // CAD related fields
  cadAssignedAt: {
    type: Date
  },
  cadDeadline: {
    type: Date
  },
  cadCompletedAt: {
    type: Date
  },
  cadNotes: {
    type: String
  },
  customerRequest: {
    type: String
  },
  referenceImages: [{
    type: String
  }],
  cadFilePath: {
    type: String
  },
  cadRequired: {
    type: Boolean,
    default: false
  },
  hasCadFile: {
    type: Boolean,
    default: false
  },
  // Manufacturing related fields
  manufacturingAssignedAt: {
    type: Date
  },
  manufacturingDeadline: {
    type: Date
  },
  manufacturingAcceptedAt: {
    type: Date
  },
  manufacturingCompletedAt: {
    type: Date
  },
  manufacturingNotes: {
    type: String
  },
  // Production Coordinator fields
  productionCoordinatorAssignedAt: {
    type: Date
  },
  productionCoordinatorDeadline: {
    type: Date
  },
  // TAT tracking
  tatBreaches: [{
    stage: String,
    breachedAt: Date,
    notificationSent: Boolean
  }],
  // Customer info (masked)
  customerName: {
    type: String
  },
  remarks: {
    type: String
  },
  // Sub-status for granular tracking within a main status
  subStatus: {
    type: String,
    trim: true
  },
  subStatusHistory: [{
    subStatus: String,
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    remarks: String
  }]
}, {
  timestamps: true
});

// Indexes (jobCode already indexed via unique: true)
jobSchema.index({ status: 1 });
jobSchema.index({ channel: 1 });
jobSchema.index({ accountCode: 1 });
jobSchema.index({ cadDesigner: 1 });
jobSchema.index({ manufacturer: 1 });
jobSchema.index({ productionCoordinator: 1 });
jobSchema.index({ dueDate: 1 });
jobSchema.index({ createdAt: -1 });
jobSchema.index({ priority: 1 });
jobSchema.index({ order: 1 });

// Auto-generate job code (must be pre-validate so required:true passes)
jobSchema.pre('validate', async function (next) {
  if (this.isNew && !this.jobCode) {
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(year, 0, 1),
        $lt: new Date(year + 1, 0, 1)
      }
    });
    this.jobCode = `JOB-${year}-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

// Virtual for checking if job is overdue
jobSchema.virtual('isOverdue').get(function () {
  if (!this.dueDate) return false;
  return new Date() > this.dueDate && !['delivered', 'cancelled'].includes(this.status);
});

// Method to check TAT breach
jobSchema.methods.checkTATBreach = function (stage, deadline) {
  if (!deadline) return false;
  return new Date() > deadline;
};

module.exports = mongoose.model('Job', jobSchema);
