const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const manufacturingController = require('../controllers/manufacturing.controller');
const { verifyToken, adminOrAbove, manufacturerOrAbove, productionUpload, handleUploadError, validate } = require('../middleware');

// Validation rules
const assignManufacturerValidation = [
  body('manufacturerId')
    .notEmpty()
    .withMessage('Manufacturer ID is required')
    .isMongoId()
    .withMessage('Invalid manufacturer ID'),
  body('deadline')
    .optional()
    .isISO8601()
    .withMessage('Invalid deadline format')
];

// Apply auth middleware
router.use(verifyToken);

// Manufacturer routes
router.get('/my-jobs', manufacturerOrAbove, manufacturingController.getMyJobs);
router.post('/:jobId/accept', manufacturerOrAbove, manufacturingController.acceptJob);
router.post('/:jobId/start', manufacturerOrAbove, manufacturingController.startWork);
router.post('/:jobId/ready-qc', manufacturerOrAbove, manufacturingController.markReadyForQC);
router.post('/:jobId/ready-delivery', manufacturerOrAbove, manufacturingController.markReadyForDelivery);

// File operations
router.get('/:jobId/files', manufacturingController.getFiles); // All authenticated users can view files
router.post('/:jobId/upload', manufacturerOrAbove, productionUpload, handleUploadError, manufacturingController.uploadFiles);

// Admin routes
router.get('/pending-assignment', adminOrAbove, manufacturingController.getPendingAssignment);
router.post('/:jobId/assign', adminOrAbove, assignManufacturerValidation, validate, manufacturingController.assignManufacturer);

module.exports = router;
