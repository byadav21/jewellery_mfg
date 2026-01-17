const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const jobController = require('../controllers/job.controller');
const { verifyToken, adminOrAbove, validate } = require('../middleware');

// Validation rules
const createJobValidation = [
  body('productName')
    .notEmpty()
    .withMessage('Product name is required'),
  body('quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'urgent'])
    .withMessage('Invalid priority'),
  body('dueDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format')
];

const updateJobValidation = [
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'urgent'])
    .withMessage('Invalid priority'),
  body('dueDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format')
];

const updateStatusValidation = [
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn([
      'new', 'cad_assigned', 'cad_in_progress', 'cad_submitted',
      'cad_approved', 'cad_rejected', 'components_issued',
      'manufacturing_assigned', 'manufacturing_accepted',
      'manufacturing_in_progress', 'manufacturing_ready_qc',
      'manufacturing_ready_delivery', 'ready_for_pickup',
      'shipped', 'delivered', 'cancelled'
    ])
    .withMessage('Invalid status')
];

// Apply auth middleware to all routes
router.use(verifyToken);

// Routes
router.get('/', jobController.getJobs);
router.get('/statistics', adminOrAbove, jobController.getStatistics);
router.get('/:id', jobController.getJob);
router.get('/:id/history', jobController.getStatusHistory);
router.post('/', adminOrAbove, createJobValidation, validate, jobController.createJob);
router.put('/:id', adminOrAbove, updateJobValidation, validate, jobController.updateJob);
router.put('/:id/status', updateStatusValidation, validate, jobController.updateStatus);
router.put('/:id/cancel', adminOrAbove, jobController.cancelJob);

module.exports = router;
