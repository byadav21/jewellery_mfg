const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema({
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job'
  },
  channel: {
    type: String,
    required: true,
    enum: ['whatsapp', 'email', 'sms']
  },
  recipient: {
    type: String,
    required: true
  },
  recipientUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  templateName: {
    type: String
  },
  subject: {
    type: String
  },
  message: {
    type: String
  },
  payload: {
    type: mongoose.Schema.Types.Mixed
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'failed', 'read'],
    default: 'pending'
  },
  sentAt: {
    type: Date
  },
  deliveredAt: {
    type: Date
  },
  readAt: {
    type: Date
  },
  providerResponse: {
    type: mongoose.Schema.Types.Mixed
  },
  errorMessage: {
    type: String
  },
  retryCount: {
    type: Number,
    default: 0
  },
  triggerType: {
    type: String,
    enum: [
      'order_imported',
      'cad_assigned',
      'cad_completed',
      'manufacturing_assigned',
      'manufacturing_in_progress',
      'manufacturing_ready',
      'ready_for_pickup',
      'shipped',
      'delivered',
      'tat_breach',
      'manual'
    ]
  }
}, {
  timestamps: true
});

notificationLogSchema.index({ job: 1 });
notificationLogSchema.index({ channel: 1 });
notificationLogSchema.index({ status: 1 });
notificationLogSchema.index({ recipient: 1 });
notificationLogSchema.index({ triggerType: 1 });
notificationLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
