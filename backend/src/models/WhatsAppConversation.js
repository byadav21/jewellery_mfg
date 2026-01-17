const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  messageId: {
    type: String,
    required: true
  },
  direction: {
    type: String,
    enum: ['inbound', 'outbound'],
    required: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'document', 'audio', 'video', 'location', 'contact', 'template', 'interactive', 'button', 'list'],
    default: 'text'
  },
  content: {
    text: String,
    caption: String,
    mediaUrl: String,
    mediaId: String,
    mimeType: String,
    fileName: String,
    latitude: Number,
    longitude: Number,
    templateName: String,
    templateParams: [String],
    interactiveType: String,
    buttonId: String,
    buttonText: String,
    listId: String,
    listTitle: String
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
    default: 'pending'
  },
  statusTimestamps: {
    sent: Date,
    delivered: Date,
    read: Date,
    failed: Date
  },
  errorDetails: {
    code: String,
    message: String
  },
  metadata: {
    funnelId: { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsAppFunnel' },
    stepId: String,
    automationTriggerId: { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsAppAutomation' },
    context: mongoose.Schema.Types.Mixed
  },
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date
}, { _id: true, timestamps: true });

const whatsappConversationSchema = new mongoose.Schema({
  // Contact Information
  phoneNumber: {
    type: String,
    required: true,
    index: true
  },
  formattedPhone: String,
  countryCode: String,

  // Contact Details (if known)
  contact: {
    name: String,
    email: String,
    profilePicture: String,
    // Link to existing entities
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    customerId: String,
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceOrder' }
  },

  // Conversation State
  status: {
    type: String,
    enum: ['active', 'pending_response', 'closed', 'blocked'],
    default: 'active'
  },

  // Session Management (24-hour window for Meta)
  sessionStartedAt: Date,
  sessionExpiresAt: Date,
  isWithinSessionWindow: {
    type: Boolean,
    default: false
  },

  // Funnel/Automation State
  currentFunnel: {
    funnelId: { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsAppFunnel' },
    currentStepId: String,
    startedAt: Date,
    variables: mongoose.Schema.Types.Mixed,
    waitingForResponse: Boolean,
    responseTimeout: Date
  },

  // Tags for segmentation
  tags: [String],

  // Messages
  messages: [messageSchema],

  // Statistics
  stats: {
    totalMessages: { type: Number, default: 0 },
    inboundMessages: { type: Number, default: 0 },
    outboundMessages: { type: Number, default: 0 },
    lastInboundAt: Date,
    lastOutboundAt: Date,
    averageResponseTime: Number // in seconds
  },

  // Assigned Agent
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Notes
  internalNotes: [{
    note: String,
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    addedAt: { type: Date, default: Date.now }
  }],

  // Opt-out status
  optedOut: {
    type: Boolean,
    default: false
  },
  optedOutAt: Date,
  optedOutReason: String

}, {
  timestamps: true
});

// Indexes (phoneNumber already indexed via field definition)
whatsappConversationSchema.index({ 'contact.userId': 1 });
whatsappConversationSchema.index({ 'contact.jobId': 1 });
whatsappConversationSchema.index({ status: 1, updatedAt: -1 });
whatsappConversationSchema.index({ 'currentFunnel.funnelId': 1 });
whatsappConversationSchema.index({ tags: 1 });

// Virtual for checking if within 24-hour window
whatsappConversationSchema.virtual('canSendFreeformMessage').get(function() {
  if (!this.sessionExpiresAt) return false;
  return new Date() < this.sessionExpiresAt;
});

// Method to add a message
whatsappConversationSchema.methods.addMessage = async function(messageData) {
  this.messages.push(messageData);
  this.stats.totalMessages++;

  if (messageData.direction === 'inbound') {
    this.stats.inboundMessages++;
    this.stats.lastInboundAt = new Date();
    // Start/extend session window
    this.sessionStartedAt = new Date();
    this.sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    this.isWithinSessionWindow = true;
  } else {
    this.stats.outboundMessages++;
    this.stats.lastOutboundAt = new Date();
  }

  return this.save();
};

// Method to update message status
whatsappConversationSchema.methods.updateMessageStatus = async function(messageId, status, timestamp) {
  const message = this.messages.find(m => m.messageId === messageId);
  if (message) {
    message.status = status;
    message.statusTimestamps = message.statusTimestamps || {};
    message.statusTimestamps[status] = timestamp || new Date();

    if (status === 'delivered') message.deliveredAt = timestamp;
    if (status === 'read') message.readAt = timestamp;

    return this.save();
  }
  return this;
};

// Static method to find or create conversation
whatsappConversationSchema.statics.findOrCreateByPhone = async function(phoneNumber, contactData = {}) {
  let conversation = await this.findOne({ phoneNumber });

  if (!conversation) {
    conversation = new this({
      phoneNumber,
      formattedPhone: phoneNumber,
      contact: contactData,
      status: 'active'
    });
    await conversation.save();
  }

  return conversation;
};

module.exports = mongoose.model('WhatsAppConversation', whatsappConversationSchema);
