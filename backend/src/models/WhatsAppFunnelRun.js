const mongoose = require('mongoose');

// Schema to track individual funnel executions
const whatsappFunnelRunSchema = new mongoose.Schema({
  funnel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppFunnel',
    required: true
  },
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppConversation',
    required: true
  },
  phoneNumber: {
    type: String,
    required: true
  },

  // Trigger info
  triggeredBy: {
    type: { type: String },
    event: mongoose.Schema.Types.Mixed,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },

  // Execution State
  status: {
    type: String,
    enum: ['running', 'waiting', 'paused', 'completed', 'failed', 'cancelled'],
    default: 'running'
  },

  // Current position
  currentStepId: String,
  currentActionIndex: { type: Number, default: 0 },

  // Variables collected during run
  variables: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Waiting state
  waitingFor: {
    type: { type: String, enum: ['response', 'delay', 'api', 'agent'] },
    timeoutAt: Date,
    timeoutStepId: String,
    expectedPatterns: [mongoose.Schema.Types.Mixed]
  },

  // Execution history
  history: [{
    stepId: String,
    stepName: String,
    actionType: String,
    actionIndex: Number,
    status: { type: String, enum: ['success', 'failed', 'skipped'] },
    input: mongoose.Schema.Types.Mixed,
    output: mongoose.Schema.Types.Mixed,
    error: String,
    executedAt: { type: Date, default: Date.now },
    duration: Number // ms
  }],

  // Related entities
  relatedEntities: {
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceOrder' },
    tatBreachId: String
  },

  // Timing
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  pausedAt: Date,
  lastActivityAt: {
    type: Date,
    default: Date.now
  },

  // Error tracking
  errorCount: { type: Number, default: 0 },
  lastError: {
    message: String,
    stepId: String,
    actionIndex: Number,
    occurredAt: Date
  },

  // Metadata
  metadata: mongoose.Schema.Types.Mixed

}, {
  timestamps: true
});

// Indexes
whatsappFunnelRunSchema.index({ funnel: 1, status: 1 });
whatsappFunnelRunSchema.index({ conversation: 1, status: 1 });
whatsappFunnelRunSchema.index({ phoneNumber: 1, status: 1 });
whatsappFunnelRunSchema.index({ status: 1, 'waitingFor.timeoutAt': 1 });
whatsappFunnelRunSchema.index({ 'relatedEntities.jobId': 1 });

// Method to add history entry
whatsappFunnelRunSchema.methods.addHistoryEntry = async function(entry) {
  this.history.push({
    ...entry,
    executedAt: new Date()
  });
  this.lastActivityAt = new Date();
  return this.save();
};

// Method to set variable
whatsappFunnelRunSchema.methods.setVariable = async function(key, value) {
  if (!this.variables) this.variables = {};
  this.variables[key] = value;
  return this.save();
};

// Method to get variable (supports dot notation)
whatsappFunnelRunSchema.methods.getVariable = function(key) {
  if (!this.variables) return undefined;
  return key.split('.').reduce((obj, k) => obj && obj[k], this.variables);
};

// Method to complete the run
whatsappFunnelRunSchema.methods.complete = async function(status = 'completed') {
  this.status = status;
  this.completedAt = new Date();
  this.lastActivityAt = new Date();
  return this.save();
};

// Method to set waiting state
whatsappFunnelRunSchema.methods.setWaiting = async function(type, timeoutMinutes, timeoutStepId, expectedPatterns = []) {
  this.status = 'waiting';
  this.waitingFor = {
    type,
    timeoutAt: new Date(Date.now() + timeoutMinutes * 60 * 1000),
    timeoutStepId,
    expectedPatterns
  };
  this.lastActivityAt = new Date();
  return this.save();
};

// Static method to find runs waiting for response
whatsappFunnelRunSchema.statics.findWaitingForResponse = async function(phoneNumber) {
  return this.find({
    phoneNumber,
    status: 'waiting',
    'waitingFor.type': 'response'
  }).populate('funnel');
};

// Static method to find timed-out runs
whatsappFunnelRunSchema.statics.findTimedOutRuns = async function() {
  return this.find({
    status: 'waiting',
    'waitingFor.timeoutAt': { $lt: new Date() }
  }).populate('funnel conversation');
};

module.exports = mongoose.model('WhatsAppFunnelRun', whatsappFunnelRunSchema);
