const mongoose = require('mongoose');

const syncLogSchema = new mongoose.Schema({
  syncType: {
    type: String,
    required: true,
    enum: ['amazon', 'ebay', 'manual', 'token_refresh']
  },
  accountCode: {
    type: String
  },
  status: {
    type: String,
    required: true,
    enum: ['started', 'success', 'partial', 'failed']
  },
  triggeredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  triggerType: {
    type: String,
    enum: ['manual', 'cron', 'api', 'url_trigger'],
    default: 'manual'
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  },
  duration: {
    type: Number // in milliseconds
  },
  stats: {
    totalRetrieved: { type: Number, default: 0 },
    ordersImported: { type: Number, default: 0 },
    ordersSkipped: { type: Number, default: 0 },
    jobsCreated: { type: Number, default: 0 },
    errors: { type: Number, default: 0 },
    // Amazon-specific stats
    mfnPending: { type: Number, default: 0 },
    fbaExcluded: { type: Number, default: 0 },
    shippedExcluded: { type: Number, default: 0 },
    otherExcluded: { type: Number, default: 0 }
  },
  errorMessage: {
    type: String
  },
  errorDetails: {
    type: mongoose.Schema.Types.Mixed
  },
  troubleshooting: [{
    type: String
  }],
  requestParams: {
    type: mongoose.Schema.Types.Mixed
  },
  responseData: {
    type: mongoose.Schema.Types.Mixed
  },
  missingSKUs: [{
    sku: String,
    productName: String,
    asin: String
  }]
}, {
  timestamps: true
});

// Indexes
syncLogSchema.index({ syncType: 1, createdAt: -1 });
syncLogSchema.index({ accountCode: 1, createdAt: -1 });
syncLogSchema.index({ status: 1 });
syncLogSchema.index({ triggeredBy: 1 });

// Static method to create a new sync log entry
syncLogSchema.statics.startSync = async function(data) {
  return this.create({
    ...data,
    status: 'started',
    startedAt: new Date()
  });
};

// Instance method to complete the sync
syncLogSchema.methods.complete = async function(status, stats, errorMessage = null, errorDetails = null) {
  this.status = status;
  this.stats = { ...this.stats, ...stats };
  this.completedAt = new Date();
  this.duration = this.completedAt - this.startedAt;
  if (errorMessage) this.errorMessage = errorMessage;
  if (errorDetails) this.errorDetails = errorDetails;
  return this.save();
};

// Static method to get recent sync logs
syncLogSchema.statics.getRecentLogs = async function(syncType, limit = 20) {
  const query = syncType ? { syncType } : {};
  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('triggeredBy', 'name email');
};

// Static method to get sync statistics
syncLogSchema.statics.getStatistics = async function(days = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return this.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: {
          syncType: '$syncType',
          status: '$status'
        },
        count: { $sum: 1 },
        totalOrders: { $sum: '$stats.ordersImported' },
        totalJobs: { $sum: '$stats.jobsCreated' },
        totalErrors: { $sum: '$stats.errors' },
        avgDuration: { $avg: '$duration' }
      }
    },
    {
      $group: {
        _id: '$_id.syncType',
        statuses: {
          $push: {
            status: '$_id.status',
            count: '$count',
            totalOrders: '$totalOrders',
            totalJobs: '$totalJobs',
            totalErrors: '$totalErrors',
            avgDuration: '$avgDuration'
          }
        },
        totalSyncs: { $sum: '$count' }
      }
    }
  ]);
};

module.exports = mongoose.model('SyncLog', syncLogSchema);
