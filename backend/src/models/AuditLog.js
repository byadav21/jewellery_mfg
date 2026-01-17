const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  action: {
    type: String,
    required: true,
    enum: [
      'login',
      'logout',
      'login_failed',
      'password_change',
      'password_reset',
      'user_create',
      'user_update',
      'user_delete',
      'user_activate',
      'user_deactivate',
      'role_assign',
      'role_remove',
      'settings_update',
      'api_credentials_view',
      'api_credentials_update',
      'job_create',
      'job_update',
      'job_delete',
      'cad_upload',
      'cad_approve',
      'cad_reject',
      'component_issue',
      'component_return',
      'manufacturing_assign',
      'status_change',
      'bulk_status_update',
      'delivery_update',
      'order_sync',
      'order_create',
      'order_update',
      'order_view',
      'bulk_assign',
      'notification_send',
      'fetch_images',
      'upload',
      'delete',
      'update'
    ]
  },
  entity: {
    type: String,
    enum: ['user', 'role', 'job', 'order', 'cad', 'component', 'delivery', 'settings', 'notification', 'product', 'sync']
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
