const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  action: {
    type: String,
    required: true
  },
  entity: {
    type: String
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId
  },
  description: {
    type: String
  },
  oldValues: {
    type: mongoose.Schema.Types.Mixed
  },
  newValues: {
    type: mongoose.Schema.Types.Mixed
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: { createdAt: 'performedAt', updatedAt: false }
});

auditLogSchema.index({ user: 1, performedAt: -1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ entity: 1, entityId: 1 });
auditLogSchema.index({ performedAt: -1 });

// Static method to create audit log
auditLogSchema.statics.log = async function(data) {
  return this.create(data);
};

module.exports = mongoose.model('AuditLog', auditLogSchema);
