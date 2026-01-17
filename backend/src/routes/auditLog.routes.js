const express = require('express');
const router = express.Router();
const auditLogController = require('../controllers/auditLog.controller');
const { verifyToken, adminOrAbove, superAdminOnly } = require('../middleware');

// Apply auth middleware
router.use(verifyToken);

// Get all logs (Super Admin only)
router.get('/', superAdminOnly, auditLogController.getLogs);

// Get statistics (Super Admin only)
router.get('/statistics', superAdminOnly, auditLogController.getStatistics);

// Get available action types for filtering
router.get('/action-types', superAdminOnly, auditLogController.getActionTypes);

// Get available entity types for filtering
router.get('/entity-types', superAdminOnly, auditLogController.getEntityTypes);

// Get logs for a specific entity (Admin and above)
router.get('/:entity/:entityId', adminOrAbove, auditLogController.getEntityLogs);

module.exports = router;
