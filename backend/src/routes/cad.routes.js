const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const cadController = require('../controllers/cad.controller');
const { verifyToken, adminOrAbove, designerOrAbove, cadUpload, handleUploadError, validate } = require('../middleware');

// Validation rules
const assignCADValidation = [
  body('designerId')
    .notEmpty()
    .withMessage('Designer ID is required')
    .isMongoId()
    .withMessage('Invalid designer ID'),
  body('deadline')
    .optional()
    .isISO8601()
    .withMessage('Invalid deadline format')
];

const rejectCADValidation = [
  body('reason')
    .notEmpty()
    .withMessage('Rejection reason is required')
];

// Apply auth middleware
router.use(verifyToken);

// Designer routes
router.get('/my-tasks', designerOrAbove, cadController.getMyTasks);
router.post('/bulk-status', designerOrAbove, cadController.bulkUpdateStatus);

// Admin routes
router.get('/pending-reviews', adminOrAbove, cadController.getPendingReviews);
router.post('/:jobId/assign', adminOrAbove, assignCADValidation, validate, cadController.assignCAD);
router.post('/:jobId/approve', adminOrAbove, cadController.approveCAD);
router.post('/:jobId/reject', adminOrAbove, rejectCADValidation, validate, cadController.rejectCAD);

// File operations (designer or admin)
router.get('/:jobId/files', designerOrAbove, cadController.getFiles);
router.post('/:jobId/upload', designerOrAbove, cadUpload, handleUploadError, cadController.uploadFiles);
router.post('/:jobId/submit', designerOrAbove, cadController.submitForReview);

module.exports = router;
