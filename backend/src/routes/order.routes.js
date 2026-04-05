const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const orderController = require('../controllers/order.controller');
const jobController = require('../controllers/job.controller');
const { verifyToken, adminOrAbove, superAdminOnly, validate } = require('../middleware');

// Ensure upload directories exist
const uploadDirs = ['uploads/cad', 'uploads/reference', 'uploads/temp'];
uploadDirs.forEach(dir => {
  const fullPath = path.join(__dirname, '../../', dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// Configure multer for manual order uploads
const manualOrderStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = 'uploads/temp';

    // Determine upload path based on field name
    if (file.fieldname.startsWith('cadFile_')) {
      uploadPath = 'uploads/cad';
    } else if (file.fieldname.startsWith('refImage_')) {
      uploadPath = 'uploads/reference';
    }

    const fullPath = path.join(__dirname, '../../', uploadPath);
    cb(null, fullPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

const manualOrderFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  // CAD files - only STL allowed
  if (file.fieldname.startsWith('cadFile_')) {
    if (['.stl'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only STL files are allowed for CAD uploads'), false);
    }
  }
  // Reference images - images only
  else if (file.fieldname.startsWith('refImage_')) {
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, GIF, WEBP) are allowed for reference images'), false);
    }
  }
  else {
    cb(null, true);
  }
};

const manualOrderUpload = multer({
  storage: manualOrderStorage,
  fileFilter: manualOrderFileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max per file
  }
}).any(); // Accept any field name

// Validation rules for JSON body (when no files)
const createManualOrderValidation = [
  body('buyerName')
    .notEmpty()
    .withMessage('Buyer name is required'),
  body('items')
    .isArray({ min: 1 })
    .withMessage('At least one item is required'),
  body('items.*.productName')
    .notEmpty()
    .withMessage('Product name is required for each item'),
  body('items.*.quantity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1')
];

// Apply auth middleware
router.use(verifyToken);

// Customer search endpoint (must be before /:id route)
router.get('/customers/search', adminOrAbove, orderController.searchCustomers);

// CAD status endpoints
router.get('/account-codes', adminOrAbove, orderController.getAccountCodes);
router.post('/refresh-cad-status', adminOrAbove, orderController.refreshCadStatus);

// Routes
router.get('/', adminOrAbove, orderController.getOrders);
router.get('/statistics', adminOrAbove, orderController.getStatistics);
router.get('/:id', adminOrAbove, orderController.getOrder);
router.get('/:id/download-images', jobController.downloadOrderImagesZip);

// Sync routes
router.post('/sync/amazon', adminOrAbove, orderController.syncAmazon);
router.post('/sync/ebay', adminOrAbove, orderController.syncEbay);

// Sync log routes
router.get('/sync/logs', adminOrAbove, orderController.getSyncLogs);
router.get('/sync/logs/statistics', adminOrAbove, orderController.getSyncStatistics);
router.get('/sync/logs/:id', adminOrAbove, orderController.getSyncLog);

// Connection test routes
router.get('/test/amazon', superAdminOnly, orderController.testAmazonConnection);
router.get('/test/ebay', superAdminOnly, orderController.testEbayConnection);

// Manual order creation with file upload support
router.post('/manual', adminOrAbove, (req, res, next) => {
  manualOrderUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 50MB'
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }

    // Convert files array to object keyed by fieldname for easier access
    if (req.files && Array.isArray(req.files)) {
      const filesObj = {};
      req.files.forEach(file => {
        if (!filesObj[file.fieldname]) {
          filesObj[file.fieldname] = [];
        }
        filesObj[file.fieldname].push(file);
      });
      req.files = filesObj;
    }

    next();
  });
}, orderController.createManualOrder);

// Bulk assign users to orders
router.post('/bulk-assign', adminOrAbove, orderController.bulkAssign);

// Assign user to a single order
router.post('/:id/assign', adminOrAbove, orderController.assignUser);

// Bulk update status for selected orders
router.post('/bulk-status', adminOrAbove, orderController.bulkUpdateStatus);

// Bulk download files for selected orders
router.post('/bulk-download', adminOrAbove, orderController.bulkDownload);

// Cron trigger endpoint - can be called via URL to trigger sync
router.post('/sync/trigger', adminOrAbove, orderController.triggerCronSync);

// Fetch product images from Amazon
router.post('/fetch-images', adminOrAbove, orderController.fetchProductImages);

// Update order
router.put('/:id', adminOrAbove, orderController.updateOrder);

// Order image upload
const orderImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../uploads/orders');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `order-${req.params.id}-${uniqueSuffix}${ext}`);
  }
});

const orderImageUpload = multer({
  storage: orderImageStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, GIF, WEBP) are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
}).array('images', 10);

router.post('/:id/images', adminOrAbove, (req, res, next) => {
  orderImageUpload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, orderController.uploadOrderImages);

router.delete('/:id/images/:imageId', adminOrAbove, orderController.deleteOrderImage);

// Delete order (super admin only)
router.delete('/:id', superAdminOnly, orderController.deleteOrder);

module.exports = router;
