const express = require('express');
const router = express.Router();
const roleController = require('../controllers/role.controller');
const { verifyToken, adminOrAbove } = require('../middleware');

// Apply auth middleware to all routes
router.use(verifyToken);
router.use(adminOrAbove);

// Routes
router.get('/', roleController.getRoles);
router.get('/name/:name', roleController.getRoleByName);
router.get('/:id', roleController.getRole);

module.exports = router;
