const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsapp.controller');
const { verifyToken, requireRoles, adminOrAbove: adminOrAboveMiddleware } = require('../middleware/auth.middleware');

// Middleware shorthand
const authenticate = verifyToken;
const adminOnly = requireRoles('super_admin', 'admin');
const adminOrAbove = adminOrAboveMiddleware;

// ==================== WEBHOOK ROUTES (PUBLIC) ====================
// These routes are public - WhatsApp needs to access them

// Webhook verification (GET) - Meta sends this to verify endpoint
router.get('/webhook', whatsappController.verifyWebhook);

// Webhook receiver (POST) - Meta sends incoming messages/status updates here
router.post('/webhook', whatsappController.receiveWebhook);

// ==================== CONFIG ROUTES (ADMIN) ====================
// Configuration management - admin only

router.get('/config', authenticate, adminOnly, whatsappController.getConfig);
router.post('/config', authenticate, adminOnly, whatsappController.saveConfig);
router.post('/config/test', authenticate, adminOnly, whatsappController.testConnection);

// ==================== CONVERSATION ROUTES ====================
// Conversation management - manager and above

router.get('/conversations', authenticate, adminOrAbove, whatsappController.getConversations);
router.get('/conversations/:id', authenticate, adminOrAbove, whatsappController.getConversation);
router.put('/conversations/:id', authenticate, adminOrAbove, whatsappController.updateConversation);
router.post('/conversations/:id/send', authenticate, adminOrAbove, whatsappController.sendMessage);

// Send message to new phone number
router.post('/send', authenticate, adminOrAbove, whatsappController.sendMessageToPhone);

// ==================== FUNNEL ROUTES ====================
// Funnel management - admin only for create/update/delete

router.get('/funnels', authenticate, adminOrAbove, whatsappController.getFunnels);
router.get('/funnels/:id', authenticate, adminOrAbove, whatsappController.getFunnel);
router.post('/funnels', authenticate, adminOnly, whatsappController.createFunnel);
router.put('/funnels/:id', authenticate, adminOnly, whatsappController.updateFunnel);
router.delete('/funnels/:id', authenticate, adminOnly, whatsappController.deleteFunnel);
router.post('/funnels/:id/trigger', authenticate, adminOrAbove, whatsappController.triggerFunnel);

// ==================== FUNNEL RUN ROUTES ====================
// Funnel run monitoring

router.get('/runs', authenticate, adminOrAbove, whatsappController.getFunnelRuns);
router.get('/runs/:id', authenticate, adminOrAbove, whatsappController.getFunnelRun);
router.post('/runs/:id/cancel', authenticate, adminOrAbove, whatsappController.cancelFunnelRun);

// ==================== TEMPLATE ROUTES ====================
// WhatsApp message templates

router.get('/templates', authenticate, adminOrAbove, whatsappController.getTemplates);

// ==================== ANALYTICS ROUTES ====================
// WhatsApp analytics and statistics

router.get('/analytics', authenticate, adminOrAbove, whatsappController.getAnalytics);

module.exports = router;
