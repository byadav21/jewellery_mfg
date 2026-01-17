const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const deliveryController = require('../controllers/delivery.controller');
const { verifyToken, adminOrAbove, validate } = require('../middleware');

// Validation rules
const createDeliveryValidation = [
  body('deliveryType')
    .notEmpty()
    .withMessage('Delivery type is required')
    .isIn(['hand', 'courier'])
    .withMessage('Delivery type must be hand or courier'),
  body('trackingNumber')
    .if(body('deliveryType').equals('courier'))
    .notEmpty()
    .withMessage('Tracking number is required for courier delivery'),
  body('courierName')
    .if(body('deliveryType').equals('courier'))
    .notEmpty()
    .withMessage('Courier name is required for courier delivery'),
  body('deliveryPersonName')
    .if(body('deliveryType').equals('hand'))
    .notEmpty()
    .withMessage('Delivery person name is required for hand delivery')
];

// Apply auth middleware
router.use(verifyToken);
router.use(adminOrAbove);

// Routes
router.get('/pending', deliveryController.getPendingDeliveries);
router.get('/delivered', deliveryController.getDeliveredJobs);
router.get('/overdue', deliveryController.getOverdueDeliveries);
router.get('/:jobId', deliveryController.getDeliveryDetails);
router.post('/:jobId', createDeliveryValidation, validate, deliveryController.createDelivery);
router.post('/:jobId/delivered', deliveryController.markDelivered);

module.exports = router;
