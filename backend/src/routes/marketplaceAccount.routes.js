const express = require('express');
const router = express.Router();
const marketplaceAccountController = require('../controllers/marketplaceAccount.controller');
const { verifyToken, superAdminOnly, adminOrAbove } = require('../middleware');

// Apply auth middleware
router.use(verifyToken);

// Get marketplace IDs (reference data)
router.get('/marketplace-ids', adminOrAbove, marketplaceAccountController.getMarketplaceIds);

// Sync all accounts
router.post('/sync-all', superAdminOnly, marketplaceAccountController.syncAll);

// CRUD routes
router.get('/', adminOrAbove, marketplaceAccountController.getAll);
router.post('/', superAdminOnly, marketplaceAccountController.create);
router.get('/:id', adminOrAbove, marketplaceAccountController.getById);
router.put('/:id', superAdminOnly, marketplaceAccountController.update);
router.delete('/:id', superAdminOnly, marketplaceAccountController.delete);

// Account actions
router.post('/:id/test', superAdminOnly, marketplaceAccountController.testConnection);
router.post('/:id/sync', adminOrAbove, marketplaceAccountController.syncAccount);
router.get('/:id/sync-history', adminOrAbove, marketplaceAccountController.getSyncHistory);
router.get('/:id/order-count', adminOrAbove, marketplaceAccountController.getOrderCount);

module.exports = router;
