const axios = require('axios');
const crypto = require('crypto');
const { WhatsAppConfig, WhatsAppConversation, WhatsAppFunnel, WhatsAppFunnelRun, AuditLog } = require('../models');

class WhatsAppService {
  constructor() {
    this.config = null;
    this.apiClient = null;
  }

  // Initialize service with config from database
  async initialize() {
    try {
      this.config = await WhatsAppConfig.findOne({ isActive: true });
      if (!this.config) {
        console.log('[WhatsApp] No active configuration found');
        return false;
      }

      // Setup API client based on provider
      this.setupApiClient();
      console.log(`[WhatsApp] Service initialized with provider: ${this.config.provider}`);
      return true;
    } catch (error) {
      console.error('[WhatsApp] Initialization error:', error);
      return false;
    }
  }

  // Setup API client based on provider
  setupApiClient() {
    const { provider, credentials } = this.config;

    switch (provider) {
      case 'meta':
        this.apiClient = axios.create({
          baseURL: 'https://graph.facebook.com/v18.0',
          headers: {
            'Authorization': `Bearer ${credentials.accessToken}`,
            'Content-Type': 'application/json'
          }
        });
        break;

      case 'twilio':
        this.apiClient = axios.create({
          baseURL: `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}`,
          auth: {
            username: credentials.accountSid,
            password: credentials.authToken
          }
        });
        break;

      default:
        // Generic API setup
        this.apiClient = axios.create({
          baseURL: credentials.baseUrl || 'https://api.whatsapp.com',
          headers: {
            'Authorization': `Bearer ${credentials.apiKey}`,
            'Content-Type': 'application/json'
          }
        });
    }
  }

  // Format phone number
  formatPhoneNumber(phone, countryCode = null) {
    // Remove all non-numeric characters
    let cleaned = phone.replace(/\D/g, '');

    // Add country code if not present
    const defaultCode = countryCode || this.config?.settings?.defaultCountryCode || '+91';
    const codeNum = defaultCode.replace('+', '');

    if (!cleaned.startsWith(codeNum)) {
      // Remove leading 0 if present
      if (cleaned.startsWith('0')) {
        cleaned = cleaned.substring(1);
      }
      cleaned = codeNum + cleaned;
    }

    return cleaned;
  }

  // ============================================
  // MESSAGE SENDING METHODS
  // ============================================

  // Send text message
  async sendTextMessage(phoneNumber, text, conversationId = null) {
    const formattedPhone = this.formatPhoneNumber(phoneNumber);

    try {
      let response;
      let messageId;

      if (this.config.provider === 'meta') {
        response = await this.apiClient.post(`/${this.config.credentials.phoneNumberId}/messages`, {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedPhone,
          type: 'text',
          text: { body: text }
        });
        messageId = response.data.messages?.[0]?.id;
      } else if (this.config.provider === 'twilio') {
        response = await this.sendTwilioMessage(formattedPhone, text);
        messageId = response.sid;
      }

      // Track message in conversation
      if (conversationId || phoneNumber) {
        await this.trackOutboundMessage(formattedPhone, {
          messageId,
          type: 'text',
          content: { text },
          status: 'sent'
        }, conversationId);
      }

      return { success: true, messageId, response: response?.data };
    } catch (error) {
      console.error('[WhatsApp] Send text error:', error.response?.data || error.message);
      return { success: false, error: error.response?.data || error.message };
    }
  }

  // Send template message (for initiating conversations outside 24-hour window)
  async sendTemplateMessage(phoneNumber, templateName, templateParams = [], language = 'en') {
    const formattedPhone = this.formatPhoneNumber(phoneNumber);

    try {
      let response;
      let messageId;

      if (this.config.provider === 'meta') {
        const components = [];

        // Add body parameters if provided
        if (templateParams.length > 0) {
          components.push({
            type: 'body',
            parameters: templateParams.map(param => ({
              type: 'text',
              text: String(param)
            }))
          });
        }

        response = await this.apiClient.post(`/${this.config.credentials.phoneNumberId}/messages`, {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedPhone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: language },
            components: components.length > 0 ? components : undefined
          }
        });
        messageId = response.data.messages?.[0]?.id;
      }

      // Track message
      await this.trackOutboundMessage(formattedPhone, {
        messageId,
        type: 'template',
        content: { templateName, templateParams },
        status: 'sent'
      });

      return { success: true, messageId, response: response?.data };
    } catch (error) {
      console.error('[WhatsApp] Send template error:', error.response?.data || error.message);
      return { success: false, error: error.response?.data || error.message };
    }
  }

  // Send interactive message (buttons or list)
  async sendInteractiveMessage(phoneNumber, interactiveData) {
    const formattedPhone = this.formatPhoneNumber(phoneNumber);

    try {
      let response;
      let messageId;

      if (this.config.provider === 'meta') {
        const payload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedPhone,
          type: 'interactive',
          interactive: interactiveData
        };

        response = await this.apiClient.post(`/${this.config.credentials.phoneNumberId}/messages`, payload);
        messageId = response.data.messages?.[0]?.id;
      }

      // Track message
      await this.trackOutboundMessage(formattedPhone, {
        messageId,
        type: 'interactive',
        content: interactiveData,
        status: 'sent'
      });

      return { success: true, messageId, response: response?.data };
    } catch (error) {
      console.error('[WhatsApp] Send interactive error:', error.response?.data || error.message);
      return { success: false, error: error.response?.data || error.message };
    }
  }

  // Send button message
  async sendButtonMessage(phoneNumber, bodyText, buttons, headerText = null, footerText = null) {
    const interactive = {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.slice(0, 3).map((btn, idx) => ({
          type: 'reply',
          reply: {
            id: btn.id || `btn_${idx}`,
            title: btn.title.substring(0, 20) // Max 20 chars
          }
        }))
      }
    };

    if (headerText) {
      interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) {
      interactive.footer = { text: footerText };
    }

    return this.sendInteractiveMessage(phoneNumber, interactive);
  }

  // Send list message
  async sendListMessage(phoneNumber, bodyText, buttonText, sections, headerText = null, footerText = null) {
    const interactive = {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonText.substring(0, 20),
        sections: sections.map(section => ({
          title: section.title,
          rows: section.rows.slice(0, 10).map(row => ({
            id: row.id,
            title: row.title.substring(0, 24),
            description: row.description?.substring(0, 72)
          }))
        }))
      }
    };

    if (headerText) {
      interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) {
      interactive.footer = { text: footerText };
    }

    return this.sendInteractiveMessage(phoneNumber, interactive);
  }

  // Send media message
  async sendMediaMessage(phoneNumber, mediaType, mediaUrl, caption = null) {
    const formattedPhone = this.formatPhoneNumber(phoneNumber);

    try {
      let response;
      let messageId;

      if (this.config.provider === 'meta') {
        const mediaPayload = {
          link: mediaUrl
        };
        if (caption && ['image', 'video', 'document'].includes(mediaType)) {
          mediaPayload.caption = caption;
        }

        response = await this.apiClient.post(`/${this.config.credentials.phoneNumberId}/messages`, {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedPhone,
          type: mediaType,
          [mediaType]: mediaPayload
        });
        messageId = response.data.messages?.[0]?.id;
      }

      // Track message
      await this.trackOutboundMessage(formattedPhone, {
        messageId,
        type: mediaType,
        content: { mediaUrl, caption },
        status: 'sent'
      });

      return { success: true, messageId, response: response?.data };
    } catch (error) {
      console.error('[WhatsApp] Send media error:', error.response?.data || error.message);
      return { success: false, error: error.response?.data || error.message };
    }
  }

  // ============================================
  // MESSAGE TRACKING
  // ============================================

  // Track outbound message
  async trackOutboundMessage(phoneNumber, messageData, conversationId = null) {
    try {
      let conversation;
      if (conversationId) {
        conversation = await WhatsAppConversation.findById(conversationId);
      }
      if (!conversation) {
        conversation = await WhatsAppConversation.findOrCreateByPhone(phoneNumber);
      }

      await conversation.addMessage({
        messageId: messageData.messageId || `out_${Date.now()}`,
        direction: 'outbound',
        type: messageData.type,
        content: messageData.content,
        status: messageData.status || 'sent',
        sentAt: new Date()
      });

      return conversation;
    } catch (error) {
      console.error('[WhatsApp] Track outbound error:', error);
    }
  }

  // Track inbound message
  async trackInboundMessage(phoneNumber, messageData, contactInfo = {}) {
    try {
      const conversation = await WhatsAppConversation.findOrCreateByPhone(phoneNumber, contactInfo);

      await conversation.addMessage({
        messageId: messageData.messageId || `in_${Date.now()}`,
        direction: 'inbound',
        type: messageData.type,
        content: messageData.content,
        status: 'delivered'
      });

      return conversation;
    } catch (error) {
      console.error('[WhatsApp] Track inbound error:', error);
    }
  }

  // ============================================
  // WEBHOOK PROCESSING
  // ============================================

  // Verify webhook (for Meta)
  verifyWebhook(mode, token, challenge) {
    const verifyToken = this.config?.credentials?.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === verifyToken) {
      return challenge;
    }
    return null;
  }

  // Validate webhook signature (for Meta)
  validateSignature(payload, signature) {
    if (!this.config?.credentials?.appSecret) return true; // Skip if not configured

    const expectedSignature = crypto
      .createHmac('sha256', this.config.credentials.appSecret)
      .update(payload)
      .digest('hex');

    return `sha256=${expectedSignature}` === signature;
  }

  // Process incoming webhook
  async processWebhook(webhookData) {
    try {
      const { provider } = this.config;

      if (provider === 'meta') {
        return this.processMetaWebhook(webhookData);
      } else if (provider === 'twilio') {
        return this.processTwilioWebhook(webhookData);
      }

      return { processed: false, reason: 'Unknown provider' };
    } catch (error) {
      console.error('[WhatsApp] Webhook processing error:', error);
      return { processed: false, error: error.message };
    }
  }

  // Process Meta (Facebook) webhook
  async processMetaWebhook(data) {
    const results = [];

    if (!data.entry) return { processed: false, reason: 'No entry in webhook' };

    for (const entry of data.entry) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value;

        // Process status updates
        if (value.statuses) {
          for (const status of value.statuses) {
            await this.handleStatusUpdate(status);
            results.push({ type: 'status', id: status.id, status: status.status });
          }
        }

        // Process incoming messages
        if (value.messages) {
          for (const message of value.messages) {
            const contact = value.contacts?.find(c => c.wa_id === message.from);
            const result = await this.handleIncomingMessage(message, contact);
            results.push({ type: 'message', id: message.id, result });
          }
        }
      }
    }

    return { processed: true, results };
  }

  // Handle incoming message
  async handleIncomingMessage(message, contact) {
    const phoneNumber = message.from;
    const contactInfo = contact ? {
      name: contact.profile?.name,
      phoneNumber: contact.wa_id
    } : {};

    // Parse message content based on type
    let messageContent = {};
    switch (message.type) {
      case 'text':
        messageContent = { text: message.text?.body };
        break;
      case 'image':
        messageContent = {
          mediaId: message.image?.id,
          mimeType: message.image?.mime_type,
          caption: message.image?.caption
        };
        break;
      case 'document':
        messageContent = {
          mediaId: message.document?.id,
          mimeType: message.document?.mime_type,
          fileName: message.document?.filename,
          caption: message.document?.caption
        };
        break;
      case 'audio':
        messageContent = {
          mediaId: message.audio?.id,
          mimeType: message.audio?.mime_type
        };
        break;
      case 'video':
        messageContent = {
          mediaId: message.video?.id,
          mimeType: message.video?.mime_type,
          caption: message.video?.caption
        };
        break;
      case 'location':
        messageContent = {
          latitude: message.location?.latitude,
          longitude: message.location?.longitude,
          name: message.location?.name,
          address: message.location?.address
        };
        break;
      case 'interactive':
        if (message.interactive?.type === 'button_reply') {
          messageContent = {
            buttonId: message.interactive.button_reply?.id,
            buttonText: message.interactive.button_reply?.title
          };
        } else if (message.interactive?.type === 'list_reply') {
          messageContent = {
            listId: message.interactive.list_reply?.id,
            listTitle: message.interactive.list_reply?.title,
            listDescription: message.interactive.list_reply?.description
          };
        }
        break;
      case 'button':
        messageContent = {
          buttonText: message.button?.text,
          buttonPayload: message.button?.payload
        };
        break;
      default:
        messageContent = { raw: message };
    }

    // Track the message
    const conversation = await this.trackInboundMessage(phoneNumber, {
      messageId: message.id,
      type: message.type,
      content: messageContent
    }, contactInfo);

    // Check for active funnel runs waiting for response
    await this.processInboundForFunnels(phoneNumber, message.type, messageContent, conversation);

    // Check for keyword triggers
    if (message.type === 'text' && messageContent.text) {
      await this.checkKeywordTriggers(phoneNumber, messageContent.text, conversation);
    }

    return { conversationId: conversation._id, messageType: message.type };
  }

  // Handle status update
  async handleStatusUpdate(status) {
    try {
      const conversation = await WhatsAppConversation.findOne({
        'messages.messageId': status.id
      });

      if (conversation) {
        await conversation.updateMessageStatus(status.id, status.status, new Date(parseInt(status.timestamp) * 1000));
      }
    } catch (error) {
      console.error('[WhatsApp] Status update error:', error);
    }
  }

  // ============================================
  // FUNNEL INTEGRATION
  // ============================================

  // Process inbound message for active funnels
  async processInboundForFunnels(phoneNumber, messageType, content, conversation) {
    try {
      // Find active funnel runs waiting for response
      const waitingRuns = await WhatsAppFunnelRun.findWaitingForResponse(phoneNumber);

      for (const run of waitingRuns) {
        await this.processFunnelResponse(run, messageType, content);
      }
    } catch (error) {
      console.error('[WhatsApp] Funnel processing error:', error);
    }
  }

  // Check keyword triggers
  async checkKeywordTriggers(phoneNumber, text, conversation) {
    try {
      const funnels = await WhatsAppFunnel.findByTrigger('keyword', { messageText: text });

      for (const funnel of funnels) {
        // Check if funnel is already running for this contact
        const existingRun = await WhatsAppFunnelRun.findOne({
          funnel: funnel._id,
          phoneNumber,
          status: { $in: ['running', 'waiting'] }
        });

        if (!existingRun) {
          await this.startFunnel(funnel._id, phoneNumber, {
            triggerType: 'keyword',
            keyword: text,
            conversationId: conversation._id
          });
        }
      }
    } catch (error) {
      console.error('[WhatsApp] Keyword trigger error:', error);
    }
  }

  // Process funnel response
  async processFunnelResponse(run, messageType, content) {
    // This will be handled by the funnel engine
    const FunnelEngine = require('./whatsappFunnelEngine.service');
    await FunnelEngine.processResponse(run, messageType, content);
  }

  // Start a funnel for a phone number
  async startFunnel(funnelId, phoneNumber, triggerData = {}) {
    const FunnelEngine = require('./whatsappFunnelEngine.service');
    return FunnelEngine.startFunnel(funnelId, phoneNumber, triggerData);
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  // Get conversation by phone
  async getConversation(phoneNumber) {
    const formattedPhone = this.formatPhoneNumber(phoneNumber);
    return WhatsAppConversation.findOne({ phoneNumber: formattedPhone });
  }

  // Get or create conversation
  async getOrCreateConversation(phoneNumber, contactData = {}) {
    const formattedPhone = this.formatPhoneNumber(phoneNumber);
    return WhatsAppConversation.findOrCreateByPhone(formattedPhone, contactData);
  }

  // Check if within 24-hour window
  async canSendFreeformMessage(phoneNumber) {
    const conversation = await this.getConversation(phoneNumber);
    if (!conversation) return false;
    return conversation.canSendFreeformMessage;
  }

  // Send message with template fallback
  async sendMessageWithFallback(phoneNumber, text, templateName, templateParams = []) {
    // Check if we can send freeform message
    const canSendFreeform = await this.canSendFreeformMessage(phoneNumber);

    if (canSendFreeform) {
      return this.sendTextMessage(phoneNumber, text);
    } else {
      // Use template message
      return this.sendTemplateMessage(phoneNumber, templateName, templateParams);
    }
  }

  // Interpolate variables in text
  interpolateVariables(text, variables, contact = {}) {
    if (!text) return text;

    let result = text;

    // Replace contact variables
    result = result.replace(/\{\{contact\.(\w+)\}\}/g, (match, key) => {
      return contact[key] || match;
    });

    // Replace custom variables
    result = result.replace(/\{\{variables\.(\w+)\}\}/g, (match, key) => {
      return variables?.[key] || match;
    });

    // Replace date/time
    result = result.replace(/\{\{now\}\}/g, new Date().toLocaleDateString());
    result = result.replace(/\{\{time\}\}/g, new Date().toLocaleTimeString());

    return result;
  }

  // Get media URL from media ID (Meta specific)
  async getMediaUrl(mediaId) {
    if (this.config.provider !== 'meta') return null;

    try {
      const response = await this.apiClient.get(`/${mediaId}`);
      return response.data.url;
    } catch (error) {
      console.error('[WhatsApp] Get media URL error:', error);
      return null;
    }
  }

  // Download media
  async downloadMedia(mediaUrl) {
    try {
      const response = await axios.get(mediaUrl, {
        headers: {
          'Authorization': `Bearer ${this.config.credentials.accessToken}`
        },
        responseType: 'arraybuffer'
      });
      return response.data;
    } catch (error) {
      console.error('[WhatsApp] Download media error:', error);
      return null;
    }
  }

  // Test connection to WhatsApp API
  async testConnection() {
    if (!this.config) {
      throw new Error('WhatsApp service not initialized');
    }

    try {
      if (this.config.provider === 'meta') {
        // Get phone number details from Meta
        const response = await this.apiClient.get(`/${this.config.credentials.phoneNumberId}`);
        return {
          provider: 'meta',
          phoneNumber: response.data.display_phone_number,
          phoneNumberId: response.data.id,
          verifiedName: response.data.verified_name,
          qualityRating: response.data.quality_rating
        };
      } else if (this.config.provider === 'twilio') {
        // Test Twilio connection
        const response = await this.apiClient.get('.json');
        return {
          provider: 'twilio',
          accountSid: response.data.sid,
          friendlyName: response.data.friendly_name,
          status: response.data.status
        };
      }

      return { provider: this.config.provider, status: 'connected' };
    } catch (error) {
      console.error('[WhatsApp] Connection test error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || error.message);
    }
  }

  // Get message templates from WhatsApp Business API
  async getTemplates() {
    if (!this.config) {
      throw new Error('WhatsApp service not initialized');
    }

    try {
      if (this.config.provider === 'meta') {
        const response = await this.apiClient.get(`/${this.config.credentials.businessAccountId}/message_templates`);
        return response.data.data.map(template => ({
          name: template.name,
          status: template.status,
          category: template.category,
          language: template.language,
          components: template.components
        }));
      }

      // Return locally configured templates for other providers
      return this.config.templates || [];
    } catch (error) {
      console.error('[WhatsApp] Get templates error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || error.message);
    }
  }

  // Send Twilio message helper
  async sendTwilioMessage(to, body) {
    const formData = new URLSearchParams();
    formData.append('To', `whatsapp:+${to}`);
    formData.append('From', `whatsapp:${this.config.credentials.fromNumber}`);
    formData.append('Body', body);

    const response = await this.apiClient.post('/Messages.json', formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    return response.data;
  }

  // Process Twilio webhook
  async processTwilioWebhook(data) {
    const phoneNumber = data.From?.replace('whatsapp:+', '');
    const messageBody = data.Body;
    const messageSid = data.MessageSid;
    const status = data.SmsStatus || data.MessageStatus;

    // Handle status update
    if (status && messageSid) {
      await this.handleStatusUpdate({ id: messageSid, status });
    }

    // Handle incoming message
    if (messageBody && phoneNumber) {
      await this.handleIncomingMessage({
        id: messageSid,
        from: phoneNumber,
        type: 'text',
        text: { body: messageBody }
      }, { profile: { name: data.ProfileName }, wa_id: phoneNumber });
    }

    return { processed: true };
  }
}

// Create singleton instance
const whatsAppService = new WhatsAppService();

module.exports = whatsAppService;
