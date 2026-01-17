const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const skuMasterController = require('../controllers/skuMaster.controller');
const { verifyToken, adminOrAbove } = require('../middleware');

// Ensure upload directories exist
const TEMP_DIR = path.join(__dirname, '../../uploads/temp');
const SKU_CAD_DIR = path.join(__dirname, '../../uploads/sku-cad');
const SKU_IMAGES_DIR = path.join(__dirname, '../../uploads/sku-images');

[TEMP_DIR, SKU_CAD_DIR, SKU_IMAGES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure multer for CAD file uploads
const cadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `cad-${uniqueSuffix}${ext}`);
  }
});

const cadFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (['.stl'].includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only STL files are allowed for CAD uploads'), false);
  }
};

const cadUpload = multer({
  storage: cadStorage,
  fileFilter: cadFileFilter,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// Configure multer for image uploads
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `img-${uniqueSuffix}${ext}`);
  }
});

const imageFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPG, PNG, GIF, WEBP) are allowed'), false);
  }
};

const imageUpload = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Configure multer for CSV uploads
const csvStorage = multer.memoryStorage();
const csvUpload = multer({
  storage: csvStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Apply auth middleware
router.use(verifyToken);

// Statistics
router.get('/statistics', adminOrAbove, skuMasterController.getStatistics);

// Search (before :sku route)
router.get('/search', adminOrAbove, skuMasterController.search);

// Quick CAD check
router.get('/check/:sku', adminOrAbove, skuMasterController.checkCadStatus);

// Export CSV
router.get('/export', adminOrAbove, skuMasterController.exportCsv);

// Bulk operations
router.post('/bulk/upload-csv', adminOrAbove, csvUpload.single('file'), skuMasterController.bulkUploadCsv);
router.post('/bulk/upload-cad', adminOrAbove, cadUpload.array('files', 100), skuMasterController.bulkUploadCad);

// CRUD routes
router.get('/', adminOrAbove, skuMasterController.getAll);
router.post('/', adminOrAbove, skuMasterController.create);
router.get('/:sku', adminOrAbove, skuMasterController.getBySku);
router.put('/:sku', adminOrAbove, skuMasterController.update);
router.delete('/:sku', adminOrAbove, skuMasterController.delete);

// File management routes
router.post('/:sku/cad', adminOrAbove, cadUpload.single('file'), skuMasterController.uploadCadFile);
router.delete('/:sku/cad', adminOrAbove, skuMasterController.deleteCadFile);
router.post('/:sku/images', adminOrAbove, imageUpload.array('images', 10), skuMasterController.uploadImages);
router.delete('/:sku/images/:imageId', adminOrAbove, skuMasterController.deleteImage);

module.exports = router;
