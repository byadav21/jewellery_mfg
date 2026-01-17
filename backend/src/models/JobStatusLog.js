const mongoose = require('mongoose');

const jobStatusLogSchema = new mongoose.Schema({
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  statusFrom: {
    type: String
  },
  statusTo: {
    type: String,
    required: true
  },
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  remarks: {
    type: String
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: { createdAt: 'changedAt', updatedAt: false }
});

jobStatusLogSchema.index({ job: 1, changedAt: -1 });
jobStatusLogSchema.index({ changedBy: 1 });

module.exports = mongoose.model('JobStatusLog', jobStatusLogSchema);
