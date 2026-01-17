const WhatsAppConfig = require('../models/WhatsAppConfig');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppFunnel = require('../models/WhatsAppFunnel');
const WhatsAppFunnelRun = require('../models/WhatsAppFunnelRun');
const whatsAppService = require('../services/whatsapp.service');
const whatsAppFunnelEngine = require('../services/whatsappFunnelEngine.service');

// ==================== CONFIG MANAGEMENT ====================

// Get WhatsApp configuration
exports.getConfig = async (req, res) => {
  try {
    let config = await WhatsAppConfig.findOne({ isActive: true });

    if (!config) {
      return res.json({
        success: true,
        data: null,
        message: 'No WhatsApp configuration found'
      });
    }

    // Hide sensitive credentials
    const sanitizedConfig = config.toObject();
    if (sanitizedConfig.credentials) {
      if (sanitizedConfig.credentials.accessToken) {
        sanitizedConfig.credentials.accessToken = '***HIDDEN***';
      }
      if (sanitizedConfig.credentials.authToken) {
        sanitizedConfig.credentials.authToken = '***HIDDEN***';
      }
      if (sanitizedConfig.credentials.apiKey) {
        sanitizedConfig.credentials.apiKey = '***HIDDEN***';
      }
    }

    res.json({
      success: true,
      data: sanitizedConfig
    });
  } catch (error) {
    console.error('Error fetching WhatsApp config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch WhatsApp configuration',
      error: error.message
    });
  }
};

// Save or update WhatsApp configuration
exports.saveConfig = async (req, res) => {
  try {
    const { provider, credentials, businessInfo, settings, templates } = req.body;

    // Validate required fields
    if (!provider || !credentials) {
      return res.status(400).json({
        success: false,
        message: 'Provider and credentials are required'
      });
    }

    // Find existing config or create new
    let config = await WhatsAppConfig.findOne();

    if (config) {
      // Update existing config
      config.provider = provider;

      // Only update credentials if not placeholder
      if (credentials.accessToken && credentials.accessToken !== '***HIDDEN***') {
        config.credentials = credentials;
      } else {
        // Preserve existing credentials, update only non-sensitive fields
        config.credentials = {
          ...config.credentials.toObject(),
          phoneNumberId: credentials.phoneNumberId || config.credentials.phoneNumberId,
          businessAccountId: credentials.businessAccountId || config.credentials.businessAccountId,
          accountSid: credentials.accountSid || config.credentials.accountSid,
          fromNumber: credentials.fromNumber || config.credentials.fromNumber
        };
      }

      if (businessInfo) config.businessInfo = businessInfo;
      if (settings) config.settings = { ...config.settings.toObject(), ...settings };
      if (templates) config.templates = templates;

      config.updatedBy = req.user._id;
    } else {
      // Create new config
      config = new WhatsAppConfig({
        provider,
        credentials,
        businessInfo: businessInfo || {},
        settings: settings || {},
        templates: templates || [],
        createdBy: req.user._id,
        updatedBy: req.user._id
      });
    }

    await config.save();

    // Reinitialize the WhatsApp service with new config
    await whatsAppService.initialize();

    res.json({
      success: true,
      message: 'WhatsApp configuration saved successfully',
      data: { id: config._id }
    });
  } catch (error) {
    console.error('Error saving WhatsApp config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save WhatsApp configuration',
      error: error.message
    });
  }
};

// Test WhatsApp connection
exports.testConnection = async (req, res) => {
  try {
    const config = await WhatsAppConfig.findOne({ isActive: true });

    if (!config) {
      return res.status(400).json({
        success: false,
        message: 'No WhatsApp configuration found'
      });
    }

    // Initialize service if not already
    await whatsAppService.initialize();

    // Try to get account info
    const result = await whatsAppService.testConnection();

    res.json({
      success: true,
      message: 'Connection successful',
      data: result
    });
  } catch (error) {
    console.error('Error testing WhatsApp connection:', error);
    res.status(500).json({
      success: false,
      message: 'Connection test failed',
      error: error.message
    });
  }
};

// ==================== WEBHOOK HANDLING ====================

// Webhook verification (GET request from Meta)
exports.verifyWebhook = async (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const config = await WhatsAppConfig.findOne({ isActive: true });
    const verifyToken = config?.credentials?.webhookVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('WhatsApp webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      console.warn('WhatsApp webhook verification failed', { mode, tokenMatch: token === verifyToken });
      res.status(403).send('Forbidden');
    }
  } catch (error) {
    console.error('Error verifying webhook:', error);
    res.status(500).send('Error');
  }
};

// Webhook receiver (POST request with incoming messages)
exports.receiveWebhook = async (req, res) => {
  try {
    // Immediately respond with 200 to acknowledge receipt
    res.status(200).send('OK');

    const payload = req.body;
    console.log('Received WhatsApp webhook:', JSON.stringify(payload, null, 2));

    // Process the webhook asynchronously
    await whatsAppService.processWebhook(payload);

  } catch (error) {
    console.error('Error processing webhook:', error);
    // Already sent 200, so just log the error
  }
};

// ==================== CONVERSATION MANAGEMENT ====================

// Get all conversations with pagination
exports.getConversations = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search, tag } = req.query;

    const query = {};

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { phoneNumber: { $regex: search, $options: 'i' } },
        { 'contact.name': { $regex: search, $options: 'i' } }
      ];
    }

    if (tag) {
      query.tags = tag;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [conversations, total] = await Promise.all([
      WhatsAppConversation.find(query)
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('contact.userId', 'name email')
        .populate('contact.jobId', 'jobNumber')
        .lean(),
      WhatsAppConversation.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: conversations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversations',
      error: error.message
    });
  }
};

// Get single conversation with full messages
exports.getConversation = async (req, res) => {
  try {
    const { id } = req.params;

    const conversation = await WhatsAppConversation.findById(id)
      .populate('contact.userId', 'name email')
      .populate('contact.jobId', 'jobNumber customerName')
      .populate('currentFunnel.funnelId', 'name');

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    res.json({
      success: true,
      data: conversation
    });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversation',
      error: error.message
    });
  }
};

// Send message in conversation
exports.sendMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, text, templateName, templateParams, mediaUrl, mediaCaption, buttons } = req.body;

    const conversation = await WhatsAppConversation.findById(id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    let result;

    switch (type) {
      case 'text':
        result = await whatsAppService.sendTextMessage(conversation.phoneNumber, text, id);
        break;
      case 'template':
        result = await whatsAppService.sendTemplateMessage(conversation.phoneNumber, templateName, templateParams, id);
        break;
      case 'media':
        result = await whatsAppService.sendMediaMessage(conversation.phoneNumber, 'image', mediaUrl, mediaCaption, id);
        break;
      case 'buttons':
        result = await whatsAppService.sendButtonMessage(conversation.phoneNumber, text, buttons, id);
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid message type'
        });
    }

    res.json({
      success: result.success,
      message: result.success ? 'Message sent successfully' : 'Failed to send message',
      data: result
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
};

// Send message to phone number (new conversation)
exports.sendMessageToPhone = async (req, res) => {
  try {
    const { phoneNumber, type, text, templateName, templateParams, mediaUrl, mediaCaption, buttons } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    let result;

    switch (type) {
      case 'text':
        result = await whatsAppService.sendTextMessage(phoneNumber, text);
        break;
      case 'template':
        result = await whatsAppService.sendTemplateMessage(phoneNumber, templateName, templateParams);
        break;
      case 'media':
        result = await whatsAppService.sendMediaMessage(phoneNumber, 'image', mediaUrl, mediaCaption);
        break;
      case 'buttons':
        result = await whatsAppService.sendButtonMessage(phoneNumber, text, buttons);
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid message type'
        });
    }

    res.json({
      success: result.success,
      message: result.success ? 'Message sent successfully' : 'Failed to send message',
      data: result
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
};

// Update conversation (tags, status, etc.)
exports.updateConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, tags, assignedTo, notes } = req.body;

    const conversation = await WhatsAppConversation.findById(id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    if (status) conversation.status = status;
    if (tags) conversation.tags = tags;
    if (assignedTo !== undefined) conversation.assignedTo = assignedTo;
    if (notes !== undefined) conversation.notes = notes;

    await conversation.save();

    res.json({
      success: true,
      message: 'Conversation updated successfully',
      data: conversation
    });
  } catch (error) {
    console.error('Error updating conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update conversation',
      error: error.message
    });
  }
};

// ==================== FUNNEL MANAGEMENT ====================

// Get all funnels
exports.getFunnels = async (req, res) => {
  try {
    const { isActive, category, trigger } = req.query;

    const query = {};
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (category) query.category = category;
    if (trigger) query['triggers.type'] = trigger;

    const funnels = await WhatsAppFunnel.find(query)
      .sort({ updatedAt: -1 })
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .lean();

    res.json({
      success: true,
      data: funnels
    });
  } catch (error) {
    console.error('Error fetching funnels:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch funnels',
      error: error.message
    });
  }
};

// Get single funnel
exports.getFunnel = async (req, res) => {
  try {
    const { id } = req.params;

    const funnel = await WhatsAppFunnel.findById(id)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!funnel) {
      return res.status(404).json({
        success: false,
        message: 'Funnel not found'
      });
    }

    res.json({
      success: true,
      data: funnel
    });
  } catch (error) {
    console.error('Error fetching funnel:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch funnel',
      error: error.message
    });
  }
};

// Create funnel
exports.createFunnel = async (req, res) => {
  try {
    const { name, description, category, triggers, steps, settings } = req.body;

    if (!name || !steps || steps.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Name and at least one step are required'
      });
    }

    const funnel = new WhatsAppFunnel({
      name,
      description,
      category,
      triggers: triggers || [],
      steps,
      settings: settings || {},
      createdBy: req.user._id,
      updatedBy: req.user._id
    });

    await funnel.save();

    res.status(201).json({
      success: true,
      message: 'Funnel created successfully',
      data: funnel
    });
  } catch (error) {
    console.error('Error creating funnel:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create funnel',
      error: error.message
    });
  }
};

// Update funnel
exports.updateFunnel = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category, triggers, steps, settings, isActive } = req.body;

    const funnel = await WhatsAppFunnel.findById(id);

    if (!funnel) {
      return res.status(404).json({
        success: false,
        message: 'Funnel not found'
      });
    }

    if (name) funnel.name = name;
    if (description !== undefined) funnel.description = description;
    if (category) funnel.category = category;
    if (triggers) funnel.triggers = triggers;
    if (steps) funnel.steps = steps;
    if (settings) funnel.settings = { ...funnel.settings.toObject(), ...settings };
    if (isActive !== undefined) funnel.isActive = isActive;

    funnel.updatedBy = req.user._id;
    funnel.version += 1;

    await funnel.save();

    res.json({
      success: true,
      message: 'Funnel updated successfully',
      data: funnel
    });
  } catch (error) {
    console.error('Error updating funnel:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update funnel',
      error: error.message
    });
  }
};

// Delete funnel
exports.deleteFunnel = async (req, res) => {
  try {
    const { id } = req.params;

    const funnel = await WhatsAppFunnel.findById(id);

    if (!funnel) {
      return res.status(404).json({
        success: false,
        message: 'Funnel not found'
      });
    }

    // Check if there are running funnel instances
    const runningRuns = await WhatsAppFunnelRun.countDocuments({
      funnel: id,
      status: { $in: ['running', 'waiting'] }
    });

    if (runningRuns > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete funnel with ${runningRuns} active runs. Please cancel them first.`
      });
    }

    await funnel.deleteOne();

    res.json({
      success: true,
      message: 'Funnel deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting funnel:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete funnel',
      error: error.message
    });
  }
};

// Manually trigger funnel for phone number
exports.triggerFunnel = async (req, res) => {
  try {
    const { id } = req.params;
    const { phoneNumber, variables } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const funnel = await WhatsAppFunnel.findById(id);

    if (!funnel) {
      return res.status(404).json({
        success: false,
        message: 'Funnel not found'
      });
    }

    if (!funnel.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Funnel is not active'
      });
    }

    const result = await whatsAppFunnelEngine.startFunnel(id, phoneNumber, {
      type: 'manual',
      userId: req.user._id,
      variables: variables || {}
    });

    res.json({
      success: result.success,
      message: result.success ? 'Funnel triggered successfully' : 'Failed to trigger funnel',
      data: result
    });
  } catch (error) {
    console.error('Error triggering funnel:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger funnel',
      error: error.message
    });
  }
};

// ==================== FUNNEL RUN MANAGEMENT ====================

// Get funnel runs
exports.getFunnelRuns = async (req, res) => {
  try {
    const { funnelId, status, phoneNumber, page = 1, limit = 20 } = req.query;

    const query = {};
    if (funnelId) query.funnel = funnelId;
    if (status) query.status = status;
    if (phoneNumber) query.phoneNumber = { $regex: phoneNumber, $options: 'i' };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [runs, total] = await Promise.all([
      WhatsAppFunnelRun.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('funnel', 'name')
        .populate('conversation', 'phoneNumber contact.name')
        .lean(),
      WhatsAppFunnelRun.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: runs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching funnel runs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch funnel runs',
      error: error.message
    });
  }
};

// Get single funnel run with full history
exports.getFunnelRun = async (req, res) => {
  try {
    const { id } = req.params;

    const run = await WhatsAppFunnelRun.findById(id)
      .populate('funnel')
      .populate('conversation');

    if (!run) {
      return res.status(404).json({
        success: false,
        message: 'Funnel run not found'
      });
    }

    res.json({
      success: true,
      data: run
    });
  } catch (error) {
    console.error('Error fetching funnel run:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch funnel run',
      error: error.message
    });
  }
};

// Cancel funnel run
exports.cancelFunnelRun = async (req, res) => {
  try {
    const { id } = req.params;

    const run = await WhatsAppFunnelRun.findById(id);

    if (!run) {
      return res.status(404).json({
        success: false,
        message: 'Funnel run not found'
      });
    }

    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel run with status: ${run.status}`
      });
    }

    await run.complete('cancelled');

    res.json({
      success: true,
      message: 'Funnel run cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling funnel run:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel funnel run',
      error: error.message
    });
  }
};

// ==================== TEMPLATES ====================

// Get available templates from WhatsApp Business API
exports.getTemplates = async (req, res) => {
  try {
    const templates = await whatsAppService.getTemplates();

    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch templates',
      error: error.message
    });
  }
};

// ==================== ANALYTICS ====================

// Get WhatsApp analytics
exports.getAnalytics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const [
      conversationStats,
      messageStats,
      funnelStats
    ] = await Promise.all([
      // Conversation statistics
      WhatsAppConversation.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),

      // Message statistics
      WhatsAppConversation.aggregate([
        { $match: { 'messages.timestamp': { $gte: start, $lte: end } } },
        { $unwind: '$messages' },
        { $match: { 'messages.timestamp': { $gte: start, $lte: end } } },
        {
          $group: {
            _id: {
              direction: '$messages.direction',
              status: '$messages.status'
            },
            count: { $sum: 1 }
          }
        }
      ]),

      // Funnel run statistics
      WhatsAppFunnelRun.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            avgDuration: {
              $avg: {
                $subtract: [
                  { $ifNull: ['$completedAt', new Date()] },
                  '$startedAt'
                ]
              }
            }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      data: {
        conversations: conversationStats,
        messages: messageStats,
        funnelRuns: funnelStats,
        period: { start, end }
      }
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: error.message
    });
  }
};
