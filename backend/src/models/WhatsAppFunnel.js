const mongoose = require('mongoose');

// Step Action Schema - defines what happens at each step
const stepActionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      'send_message',      // Send a text/template message
      'send_media',        // Send image/document/video
      'send_interactive',  // Send buttons/list message
      'wait_for_response', // Wait for user input
      'condition',         // Conditional branching
      'delay',             // Wait for specified time
      'set_variable',      // Set a variable
      'api_call',          // Make external API call
      'assign_agent',      // Assign to human agent
      'add_tag',           // Add tag to conversation
      'remove_tag',        // Remove tag
      'goto_step',         // Jump to another step
      'end_funnel',        // End the funnel
      'trigger_funnel',    // Start another funnel
      'webhook',           // Send webhook notification
      'update_contact'     // Update contact information
    ],
    required: true
  },

  // Message content (for send_message, send_media, send_interactive)
  message: {
    type: { type: String, enum: ['text', 'template', 'image', 'document', 'video', 'audio'] },
    text: String,
    templateName: String,
    templateParams: [String],
    mediaUrl: String,
    caption: String,
    // Supports variable interpolation like {{contact.name}} or {{variables.orderNumber}}
    useVariables: { type: Boolean, default: true }
  },

  // Interactive message config
  interactive: {
    type: { type: String, enum: ['button', 'list'] },
    header: String,
    body: String,
    footer: String,
    buttons: [{
      id: String,
      title: String,
      nextStepId: String
    }],
    sections: [{
      title: String,
      rows: [{
        id: String,
        title: String,
        description: String,
        nextStepId: String
      }]
    }]
  },

  // Wait for response config
  waitConfig: {
    timeoutMinutes: { type: Number, default: 60 },
    timeoutStepId: String, // Step to go to on timeout
    expectedResponses: [{
      pattern: String,        // Regex pattern
      exactMatch: String,     // Exact text match
      buttonId: String,       // For button responses
      listRowId: String,      // For list responses
      nextStepId: String,
      setVariable: { key: String, value: String }
    }],
    defaultNextStepId: String, // If no pattern matches
    saveResponseAs: String     // Variable name to save response
  },

  // Condition config
  condition: {
    rules: [{
      field: String,          // e.g., 'variables.response', 'contact.tags', 'message.text'
      operator: {
        type: String,
        enum: ['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'is_empty', 'is_not_empty', 'matches_regex', 'in_list']
      },
      value: mongoose.Schema.Types.Mixed,
      nextStepId: String
    }],
    defaultNextStepId: String
  },

  // Delay config
  delay: {
    duration: Number,
    unit: { type: String, enum: ['seconds', 'minutes', 'hours', 'days'], default: 'minutes' }
  },

  // Variable setting
  variable: {
    key: String,
    value: String,
    source: { type: String, enum: ['static', 'response', 'api_result', 'expression'] }
  },

  // API call config
  apiCall: {
    url: String,
    method: { type: String, enum: ['GET', 'POST', 'PUT', 'PATCH'], default: 'POST' },
    headers: mongoose.Schema.Types.Mixed,
    body: mongoose.Schema.Types.Mixed,
    saveResponseAs: String,
    successStepId: String,
    failureStepId: String
  },

  // Webhook config
  webhook: {
    url: String,
    headers: mongoose.Schema.Types.Mixed,
    includeConversation: { type: Boolean, default: true },
    includeVariables: { type: Boolean, default: true }
  },

  // Agent assignment
  assignAgent: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    teamId: String,
    roundRobin: Boolean,
    notifyAgent: { type: Boolean, default: true }
  },

  // Tags
  tags: [String],

  // Goto step
  gotoStepId: String,

  // Trigger funnel
  triggerFunnelId: { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsAppFunnel' }
});

// Funnel Step Schema
const funnelStepSchema = new mongoose.Schema({
  stepId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  description: String,
  order: {
    type: Number,
    default: 0
  },
  actions: [stepActionSchema],
  nextStepId: String, // Default next step if not specified in action
  isEntryPoint: {
    type: Boolean,
    default: false
  },
  isExitPoint: {
    type: Boolean,
    default: false
  }
});

// Main Funnel Schema
const whatsappFunnelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: String,
  category: {
    type: String,
    enum: ['tat_breach', 'order_update', 'feedback', 'support', 'marketing', 'onboarding', 'custom'],
    default: 'custom'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isTemplate: {
    type: Boolean,
    default: false
  },

  // Trigger Configuration
  triggers: [{
    type: {
      type: String,
      enum: [
        'manual',           // Manually triggered via API
        'tat_breach',       // TAT breach event
        'order_status',     // Order status change
        'job_status',       // Job status change
        'inbound_message',  // Any inbound message
        'keyword',          // Specific keyword detected
        'schedule',         // Scheduled time
        'webhook',          // External webhook
        'tag_added',        // When tag is added
        'conversation_idle' // When conversation is idle for X time
      ]
    },
    conditions: {
      keywords: [String],
      orderStatuses: [String],
      jobStatuses: [String],
      tatStages: [String],
      scheduleExpression: String, // Cron expression
      idleMinutes: Number,
      tags: [String]
    },
    isActive: { type: Boolean, default: true }
  }],

  // Steps
  steps: [funnelStepSchema],

  // Entry step
  entryStepId: String,

  // Global Variables (available to all steps)
  globalVariables: mongoose.Schema.Types.Mixed,

  // Settings
  settings: {
    maxRunsPerContact: { type: Number, default: 0 }, // 0 = unlimited
    cooldownMinutes: { type: Number, default: 0 },   // Time before funnel can run again for same contact
    runDuringBusinessHours: { type: Boolean, default: false },
    businessHours: {
      timezone: { type: String, default: 'Asia/Kolkata' },
      days: [{ type: Number, min: 0, max: 6 }], // 0 = Sunday
      startTime: String, // HH:mm
      endTime: String
    },
    pauseOnAgentAssignment: { type: Boolean, default: true },
    stopOnOptOut: { type: Boolean, default: true }
  },

  // Statistics
  stats: {
    totalRuns: { type: Number, default: 0 },
    completedRuns: { type: Number, default: 0 },
    activeRuns: { type: Number, default: 0 },
    droppedRuns: { type: Number, default: 0 },
    averageCompletionTime: Number
  },

  // Created by
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes
whatsappFunnelSchema.index({ isActive: 1, category: 1 });
whatsappFunnelSchema.index({ 'triggers.type': 1 });

// Method to get entry step
whatsappFunnelSchema.methods.getEntryStep = function() {
  return this.steps.find(s => s.stepId === this.entryStepId || s.isEntryPoint);
};

// Method to get step by ID
whatsappFunnelSchema.methods.getStepById = function(stepId) {
  return this.steps.find(s => s.stepId === stepId);
};

// Static method to find funnels by trigger
whatsappFunnelSchema.statics.findByTrigger = async function(triggerType, conditions = {}) {
  const query = {
    isActive: true,
    'triggers.type': triggerType,
    'triggers.isActive': true
  };

  const funnels = await this.find(query);

  // Filter by conditions
  return funnels.filter(funnel => {
    const trigger = funnel.triggers.find(t => t.type === triggerType && t.isActive);
    if (!trigger) return false;

    // Check specific conditions based on trigger type
    switch (triggerType) {
      case 'keyword':
        if (trigger.conditions.keywords && trigger.conditions.keywords.length > 0) {
          const messageText = (conditions.messageText || '').toLowerCase();
          return trigger.conditions.keywords.some(kw => messageText.includes(kw.toLowerCase()));
        }
        return true;

      case 'tat_breach':
        if (trigger.conditions.tatStages && trigger.conditions.tatStages.length > 0) {
          return trigger.conditions.tatStages.includes(conditions.tatStage);
        }
        return true;

      case 'order_status':
        if (trigger.conditions.orderStatuses && trigger.conditions.orderStatuses.length > 0) {
          return trigger.conditions.orderStatuses.includes(conditions.orderStatus);
        }
        return true;

      case 'job_status':
        if (trigger.conditions.jobStatuses && trigger.conditions.jobStatuses.length > 0) {
          return trigger.conditions.jobStatuses.includes(conditions.jobStatus);
        }
        return true;

      default:
        return true;
    }
  });
};

module.exports = mongoose.model('WhatsAppFunnel', whatsappFunnelSchema);
