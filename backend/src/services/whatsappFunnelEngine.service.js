const axios = require('axios');
const { WhatsAppFunnel, WhatsAppFunnelRun, WhatsAppConversation } = require('../models');
const whatsAppService = require('./whatsapp.service');

class WhatsAppFunnelEngine {
  // Start a new funnel run
  async startFunnel(funnelId, phoneNumber, triggerData = {}) {
    try {
      const funnel = await WhatsAppFunnel.findById(funnelId);
      if (!funnel || !funnel.isActive) {
        console.log(`[FunnelEngine] Funnel ${funnelId} not found or inactive`);
        return { success: false, error: 'Funnel not found or inactive' };
      }

      // Get or create conversation
      const conversation = await whatsAppService.getOrCreateConversation(phoneNumber);

      // Check cooldown
      if (funnel.settings.cooldownMinutes > 0) {
        const recentRun = await WhatsAppFunnelRun.findOne({
          funnel: funnelId,
          phoneNumber,
          startedAt: { $gt: new Date(Date.now() - funnel.settings.cooldownMinutes * 60 * 1000) }
        });
        if (recentRun) {
          console.log(`[FunnelEngine] Cooldown active for funnel ${funnel.name}`);
          return { success: false, error: 'Cooldown period active' };
        }
      }

      // Check max runs per contact
      if (funnel.settings.maxRunsPerContact > 0) {
        const runCount = await WhatsAppFunnelRun.countDocuments({
          funnel: funnelId,
          phoneNumber,
          status: 'completed'
        });
        if (runCount >= funnel.settings.maxRunsPerContact) {
          console.log(`[FunnelEngine] Max runs reached for contact`);
          return { success: false, error: 'Max runs per contact reached' };
        }
      }

      // Create new funnel run
      const run = new WhatsAppFunnelRun({
        funnel: funnelId,
        conversation: conversation._id,
        phoneNumber,
        triggeredBy: {
          type: triggerData.triggerType || 'manual',
          event: triggerData,
          userId: triggerData.userId
        },
        status: 'running',
        currentStepId: funnel.entryStepId || funnel.getEntryStep()?.stepId,
        variables: {
          ...funnel.globalVariables,
          ...triggerData.variables
        },
        relatedEntities: {
          jobId: triggerData.jobId,
          orderId: triggerData.orderId,
          tatBreachId: triggerData.tatBreachId
        }
      });

      await run.save();

      // Update funnel stats
      funnel.stats.totalRuns++;
      funnel.stats.activeRuns++;
      await funnel.save();

      // Update conversation state
      conversation.currentFunnel = {
        funnelId: funnel._id,
        currentStepId: run.currentStepId,
        startedAt: new Date(),
        variables: run.variables,
        waitingForResponse: false
      };
      await conversation.save();

      console.log(`[FunnelEngine] Started funnel "${funnel.name}" for ${phoneNumber}`);

      // Execute first step
      await this.executeStep(run);

      return { success: true, runId: run._id };
    } catch (error) {
      console.error('[FunnelEngine] Start funnel error:', error);
      return { success: false, error: error.message };
    }
  }

  // Execute current step
  async executeStep(run) {
    try {
      const funnel = await WhatsAppFunnel.findById(run.funnel);
      if (!funnel) {
        return this.failRun(run, 'Funnel not found');
      }

      const step = funnel.getStepById(run.currentStepId);
      if (!step) {
        return this.completeRun(run);
      }

      console.log(`[FunnelEngine] Executing step "${step.name}" for ${run.phoneNumber}`);

      // Execute each action in the step
      for (let i = run.currentActionIndex; i < step.actions.length; i++) {
        const action = step.actions[i];
        run.currentActionIndex = i;

        const result = await this.executeAction(run, step, action, i);

        // Add to history
        await run.addHistoryEntry({
          stepId: step.stepId,
          stepName: step.name,
          actionType: action.type,
          actionIndex: i,
          status: result.success ? 'success' : 'failed',
          input: result.input,
          output: result.output,
          error: result.error
        });

        if (!result.success) {
          run.errorCount++;
          run.lastError = {
            message: result.error,
            stepId: step.stepId,
            actionIndex: i,
            occurredAt: new Date()
          };
          await run.save();

          // Continue or fail based on error handling
          if (result.critical) {
            return this.failRun(run, result.error);
          }
        }

        // Check if we need to wait
        if (result.waitForResponse) {
          return; // Run state already set in action handler
        }

        // Check if we need to go to a specific step
        if (result.nextStepId) {
          run.currentStepId = result.nextStepId;
          run.currentActionIndex = 0;
          await run.save();
          return this.executeStep(run);
        }

        // Check if funnel should end
        if (result.endFunnel) {
          return this.completeRun(run);
        }
      }

      // Move to next step
      const nextStepId = step.nextStepId;
      if (nextStepId) {
        run.currentStepId = nextStepId;
        run.currentActionIndex = 0;
        await run.save();

        // Add small delay to prevent rate limiting
        await this.delay(500);

        return this.executeStep(run);
      } else {
        // No more steps, complete the funnel
        return this.completeRun(run);
      }
    } catch (error) {
      console.error('[FunnelEngine] Execute step error:', error);
      return this.failRun(run, error.message);
    }
  }

  // Execute a single action
  async executeAction(run, step, action, actionIndex) {
    const conversation = await WhatsAppConversation.findById(run.conversation);
    const contact = conversation?.contact || {};

    try {
      switch (action.type) {
        case 'send_message':
          return await this.actionSendMessage(run, action, contact);

        case 'send_media':
          return await this.actionSendMedia(run, action, contact);

        case 'send_interactive':
          return await this.actionSendInteractive(run, action, contact);

        case 'wait_for_response':
          return await this.actionWaitForResponse(run, action);

        case 'condition':
          return await this.actionCondition(run, action);

        case 'delay':
          return await this.actionDelay(run, action);

        case 'set_variable':
          return await this.actionSetVariable(run, action);

        case 'api_call':
          return await this.actionApiCall(run, action, contact);

        case 'assign_agent':
          return await this.actionAssignAgent(run, action);

        case 'add_tag':
          return await this.actionAddTag(run, action);

        case 'remove_tag':
          return await this.actionRemoveTag(run, action);

        case 'goto_step':
          return { success: true, nextStepId: action.gotoStepId };

        case 'end_funnel':
          return { success: true, endFunnel: true };

        case 'trigger_funnel':
          return await this.actionTriggerFunnel(run, action);

        case 'webhook':
          return await this.actionWebhook(run, action, contact);

        case 'update_contact':
          return await this.actionUpdateContact(run, action);

        default:
          console.warn(`[FunnelEngine] Unknown action type: ${action.type}`);
          return { success: true };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // ACTION HANDLERS
  // ============================================

  async actionSendMessage(run, action, contact) {
    const { message } = action;
    let text = message.text;

    // Interpolate variables
    if (message.useVariables !== false) {
      text = whatsAppService.interpolateVariables(text, run.variables, contact);
    }

    let result;
    if (message.type === 'template') {
      const params = (message.templateParams || []).map(p =>
        whatsAppService.interpolateVariables(p, run.variables, contact)
      );
      result = await whatsAppService.sendTemplateMessage(run.phoneNumber, message.templateName, params);
    } else {
      result = await whatsAppService.sendTextMessage(run.phoneNumber, text);
    }

    return {
      success: result.success,
      input: { text, type: message.type },
      output: result,
      error: result.error
    };
  }

  async actionSendMedia(run, action, contact) {
    const { message } = action;
    let caption = message.caption;

    if (message.useVariables !== false && caption) {
      caption = whatsAppService.interpolateVariables(caption, run.variables, contact);
    }

    const result = await whatsAppService.sendMediaMessage(
      run.phoneNumber,
      message.type,
      message.mediaUrl,
      caption
    );

    return {
      success: result.success,
      input: { mediaType: message.type, mediaUrl: message.mediaUrl },
      output: result,
      error: result.error
    };
  }

  async actionSendInteractive(run, action, contact) {
    const { interactive } = action;
    let result;

    if (interactive.type === 'button') {
      const bodyText = whatsAppService.interpolateVariables(interactive.body, run.variables, contact);
      result = await whatsAppService.sendButtonMessage(
        run.phoneNumber,
        bodyText,
        interactive.buttons,
        interactive.header,
        interactive.footer
      );
    } else if (interactive.type === 'list') {
      const bodyText = whatsAppService.interpolateVariables(interactive.body, run.variables, contact);
      result = await whatsAppService.sendListMessage(
        run.phoneNumber,
        bodyText,
        'Select Option',
        interactive.sections,
        interactive.header,
        interactive.footer
      );
    }

    return {
      success: result?.success,
      input: { interactiveType: interactive.type },
      output: result,
      error: result?.error
    };
  }

  async actionWaitForResponse(run, action) {
    const { waitConfig } = action;

    // Set the run to waiting state
    await run.setWaiting(
      'response',
      waitConfig.timeoutMinutes || 60,
      waitConfig.timeoutStepId,
      waitConfig.expectedResponses
    );

    // Update conversation state
    const conversation = await WhatsAppConversation.findById(run.conversation);
    if (conversation) {
      conversation.currentFunnel.waitingForResponse = true;
      conversation.currentFunnel.responseTimeout = run.waitingFor.timeoutAt;
      await conversation.save();
    }

    console.log(`[FunnelEngine] Run ${run._id} waiting for response`);

    return {
      success: true,
      waitForResponse: true,
      input: { timeoutMinutes: waitConfig.timeoutMinutes }
    };
  }

  async actionCondition(run, action) {
    const { condition } = action;

    for (const rule of condition.rules) {
      const fieldValue = this.getFieldValue(run, rule.field);
      const matches = this.evaluateCondition(fieldValue, rule.operator, rule.value);

      if (matches) {
        return { success: true, nextStepId: rule.nextStepId };
      }
    }

    // No rule matched, use default
    return { success: true, nextStepId: condition.defaultNextStepId };
  }

  async actionDelay(run, action) {
    const { delay } = action;
    const multipliers = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 };
    const delayMs = delay.duration * (multipliers[delay.unit] || 60000);

    // For short delays, wait inline
    if (delayMs <= 5000) {
      await this.delay(delayMs);
      return { success: true };
    }

    // For longer delays, set waiting state
    await run.setWaiting('delay', delayMs / 60000);

    return {
      success: true,
      waitForResponse: true, // Technically waiting for timeout
      input: { delay: delay.duration, unit: delay.unit }
    };
  }

  async actionSetVariable(run, action) {
    const { variable } = action;
    let value = variable.value;

    if (variable.source === 'response') {
      value = run.variables.lastResponse || value;
    } else if (variable.source === 'expression') {
      // Simple expression evaluation
      value = this.evaluateExpression(value, run.variables);
    }

    await run.setVariable(variable.key, value);

    return { success: true, input: { key: variable.key }, output: { value } };
  }

  async actionApiCall(run, action, contact) {
    const { apiCall } = action;

    try {
      // Interpolate URL and body
      const url = whatsAppService.interpolateVariables(apiCall.url, run.variables, contact);
      let body = apiCall.body;
      if (typeof body === 'string') {
        body = whatsAppService.interpolateVariables(body, run.variables, contact);
        try { body = JSON.parse(body); } catch (e) { }
      }

      const response = await axios({
        method: apiCall.method || 'POST',
        url,
        headers: apiCall.headers,
        data: body,
        timeout: 30000
      });

      // Save response to variable
      if (apiCall.saveResponseAs) {
        await run.setVariable(apiCall.saveResponseAs, response.data);
      }

      return {
        success: true,
        nextStepId: apiCall.successStepId,
        input: { url, method: apiCall.method },
        output: { status: response.status, data: response.data }
      };
    } catch (error) {
      return {
        success: false,
        nextStepId: apiCall.failureStepId,
        error: error.message,
        input: { url: apiCall.url }
      };
    }
  }

  async actionAssignAgent(run, action) {
    const conversation = await WhatsAppConversation.findById(run.conversation);
    if (conversation) {
      conversation.assignedTo = action.assignAgent.userId;
      await conversation.save();

      // TODO: Send notification to agent
    }

    return { success: true, output: { assignedTo: action.assignAgent.userId } };
  }

  async actionAddTag(run, action) {
    const conversation = await WhatsAppConversation.findById(run.conversation);
    if (conversation) {
      const newTags = action.tags.filter(t => !conversation.tags.includes(t));
      conversation.tags.push(...newTags);
      await conversation.save();
    }

    return { success: true, output: { tagsAdded: action.tags } };
  }

  async actionRemoveTag(run, action) {
    const conversation = await WhatsAppConversation.findById(run.conversation);
    if (conversation) {
      conversation.tags = conversation.tags.filter(t => !action.tags.includes(t));
      await conversation.save();
    }

    return { success: true, output: { tagsRemoved: action.tags } };
  }

  async actionTriggerFunnel(run, action) {
    const result = await this.startFunnel(action.triggerFunnelId, run.phoneNumber, {
      parentRunId: run._id,
      variables: run.variables
    });

    return { success: result.success, output: result };
  }

  async actionWebhook(run, action, contact) {
    const { webhook } = action;

    try {
      const payload = {
        event: 'funnel_step',
        runId: run._id,
        funnelId: run.funnel,
        phoneNumber: run.phoneNumber,
        timestamp: new Date().toISOString()
      };

      if (webhook.includeConversation) {
        const conversation = await WhatsAppConversation.findById(run.conversation);
        payload.conversation = conversation;
      }

      if (webhook.includeVariables) {
        payload.variables = run.variables;
      }

      await axios.post(webhook.url, payload, {
        headers: webhook.headers,
        timeout: 10000
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async actionUpdateContact(run, action) {
    const conversation = await WhatsAppConversation.findById(run.conversation);
    if (conversation && action.updates) {
      Object.assign(conversation.contact, action.updates);
      await conversation.save();
    }

    return { success: true };
  }

  // ============================================
  // RESPONSE PROCESSING
  // ============================================

  async processResponse(run, messageType, content) {
    try {
      if (run.status !== 'waiting' || run.waitingFor?.type !== 'response') {
        return;
      }

      const { waitingFor } = run;
      let matchedResponse = null;
      let responseText = content.text || content.buttonText || content.listTitle || '';

      // Save response to variable
      run.variables.lastResponse = responseText;
      run.variables.lastResponseType = messageType;
      run.variables.lastResponseContent = content;

      // Check expected responses
      for (const expected of waitingFor.expectedPatterns || []) {
        let matches = false;

        if (expected.buttonId && content.buttonId === expected.buttonId) {
          matches = true;
        } else if (expected.listRowId && content.listId === expected.listRowId) {
          matches = true;
        } else if (expected.exactMatch && responseText.toLowerCase() === expected.exactMatch.toLowerCase()) {
          matches = true;
        } else if (expected.pattern) {
          const regex = new RegExp(expected.pattern, 'i');
          matches = regex.test(responseText);
        }

        if (matches) {
          matchedResponse = expected;
          break;
        }
      }

      // Update run state
      run.status = 'running';
      run.waitingFor = null;

      // Set variable from response if configured
      if (matchedResponse?.setVariable) {
        run.variables[matchedResponse.setVariable.key] = matchedResponse.setVariable.value || responseText;
      }

      // Move to next step
      const funnel = await WhatsAppFunnel.findById(run.funnel);
      const currentStep = funnel.getStepById(run.currentStepId);
      const currentAction = currentStep?.actions[run.currentActionIndex];

      let nextStepId = null;
      if (matchedResponse?.nextStepId) {
        nextStepId = matchedResponse.nextStepId;
      } else if (currentAction?.waitConfig?.defaultNextStepId) {
        nextStepId = currentAction.waitConfig.defaultNextStepId;
      } else {
        // Continue with next action in current step
        run.currentActionIndex++;
      }

      if (nextStepId) {
        run.currentStepId = nextStepId;
        run.currentActionIndex = 0;
      }

      await run.save();

      // Update conversation
      const conversation = await WhatsAppConversation.findById(run.conversation);
      if (conversation) {
        conversation.currentFunnel.waitingForResponse = false;
        conversation.currentFunnel.currentStepId = run.currentStepId;
        await conversation.save();
      }

      // Continue execution
      await this.executeStep(run);
    } catch (error) {
      console.error('[FunnelEngine] Process response error:', error);
    }
  }

  // Process timeout for waiting runs
  async processTimeouts() {
    try {
      const timedOutRuns = await WhatsAppFunnelRun.findTimedOutRuns();

      for (const run of timedOutRuns) {
        console.log(`[FunnelEngine] Processing timeout for run ${run._id}`);

        if (run.waitingFor?.timeoutStepId) {
          run.currentStepId = run.waitingFor.timeoutStepId;
          run.currentActionIndex = 0;
          run.status = 'running';
          run.waitingFor = null;
          await run.save();

          await this.executeStep(run);
        } else {
          await this.completeRun(run, 'completed');
        }
      }
    } catch (error) {
      console.error('[FunnelEngine] Process timeouts error:', error);
    }
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  async completeRun(run, status = 'completed') {
    await run.complete(status);

    // Update funnel stats
    const funnel = await WhatsAppFunnel.findById(run.funnel);
    if (funnel) {
      funnel.stats.activeRuns = Math.max(0, funnel.stats.activeRuns - 1);
      funnel.stats.completedRuns++;
      await funnel.save();
    }

    // Clear conversation funnel state
    const conversation = await WhatsAppConversation.findById(run.conversation);
    if (conversation) {
      conversation.currentFunnel = null;
      await conversation.save();
    }

    console.log(`[FunnelEngine] Run ${run._id} completed with status: ${status}`);
  }

  async failRun(run, error) {
    run.status = 'failed';
    run.lastError = { message: error, occurredAt: new Date() };
    await run.save();

    const funnel = await WhatsAppFunnel.findById(run.funnel);
    if (funnel) {
      funnel.stats.activeRuns = Math.max(0, funnel.stats.activeRuns - 1);
      funnel.stats.droppedRuns++;
      await funnel.save();
    }

    console.error(`[FunnelEngine] Run ${run._id} failed: ${error}`);
  }

  getFieldValue(run, field) {
    if (field.startsWith('variables.')) {
      return run.getVariable(field.replace('variables.', ''));
    }
    if (field.startsWith('contact.')) {
      // Would need to load conversation for contact data
      return undefined;
    }
    return run[field];
  }

  evaluateCondition(value, operator, compareValue) {
    switch (operator) {
      case 'equals': return value === compareValue;
      case 'not_equals': return value !== compareValue;
      case 'contains': return String(value).toLowerCase().includes(String(compareValue).toLowerCase());
      case 'not_contains': return !String(value).toLowerCase().includes(String(compareValue).toLowerCase());
      case 'greater_than': return Number(value) > Number(compareValue);
      case 'less_than': return Number(value) < Number(compareValue);
      case 'is_empty': return !value || value === '';
      case 'is_not_empty': return value && value !== '';
      case 'matches_regex': return new RegExp(compareValue, 'i').test(String(value));
      case 'in_list': return Array.isArray(compareValue) && compareValue.includes(value);
      default: return false;
    }
  }

  evaluateExpression(expression, variables) {
    // Simple variable replacement - be careful with eval in production!
    // For production, use a safe expression evaluator library
    let result = expression;
    for (const [key, val] of Object.entries(variables || {})) {
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), val);
    }
    return result;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Create singleton instance
const funnelEngine = new WhatsAppFunnelEngine();

module.exports = funnelEngine;
