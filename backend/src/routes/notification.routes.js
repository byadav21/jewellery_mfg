const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { verifyToken, adminOrAbove } = require('../middleware');

// Apply auth middleware
router.use(verifyToken);
router.use(adminOrAbove);

// Routes
router.get('/logs', notificationController.getLogs);
router.get('/statistics', notificationController.getStatistics);
router.get('/failed', notificationController.getFailedNotifications);
router.post('/:id/retry', notificationController.retryNotification);

module.exports = router;
