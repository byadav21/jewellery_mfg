const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const settingsController = require('../controllers/settings.controller');
const { verifyToken, superAdminOnly, validate } = require('../middleware');

// Apply auth middleware
router.use(verifyToken);
router.use(superAdminOnly);

// Routes
router.get('/', settingsController.getSettings);
router.get('/category/:category', settingsController.getSettingsWithValues);
router.get('/:key', settingsController.getSetting);
router.put('/:key', settingsController.updateSetting);
router.put('/', settingsController.updateSettings);
router.post('/api/:platform', settingsController.saveAPICredentials);

module.exports = router;
