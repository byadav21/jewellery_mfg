const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const createUploadDirs = () => {
  const dirs = [
    'uploads/cad',
    'uploads/production',
    'uploads/reference',
    'uploads/delivery',
    'uploads/temp'
  ];

  dirs.forEach(dir => {
    const fullPath = path.join(__dirname, '../../', dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });
};

createUploadDirs();

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = 'uploads/temp';

    if (req.uploadType === 'cad') {
      uploadPath = 'uploads/cad';
    } else if (req.uploadType === 'production') {
      uploadPath = 'uploads/production';
    } else if (req.uploadType === 'reference') {
      uploadPath = 'uploads/reference';
    } else if (req.uploadType === 'delivery') {
      uploadPath = 'uploads/delivery';
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

// File filter
const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedTypes = {
    cad: ['.stl', '.obj', '.step', '.stp', '.iges', '.igs', '.png', '.jpg', '.jpeg', '.gif', '.webp'],
    production: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mov', '.avi', '.mkv'],
    reference: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf'],
    delivery: ['.png', '.jpg', '.jpeg', '.pdf']
  };

  const ext = path.extname(file.originalname).toLowerCase();
  const uploadType = req.uploadType || 'cad';
  const allowed = allowedTypes[uploadType] || allowedTypes.cad;

  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${ext} not allowed for ${uploadType} uploads. Allowed: ${allowed.join(', ')}`), false);
  }
};

// Max file size (500MB)
const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 524288000;

// Create multer instance
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: maxSize
  }
});

// Middleware to set upload type
const setUploadType = (type) => {
  return (req, res, next) => {
    req.uploadType = type;
    next();
  };
};

// CAD file upload
const cadUpload = [setUploadType('cad'), upload.array('files', 10)];

// Production file upload
const productionUpload = [setUploadType('production'), upload.array('files', 20)];

// Reference image upload
const referenceUpload = [setUploadType('reference'), upload.array('images', 10)];

// Delivery proof upload
const deliveryUpload = [setUploadType('delivery'), upload.single('proof')];

// Handle multer errors
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: `File too large. Maximum size is ${maxSize / (1024 * 1024)}MB`
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files uploaded'
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

  next();
};

module.exports = {
  upload,
  cadUpload,
  productionUpload,
  referenceUpload,
  deliveryUpload,
  handleUploadError,
  setUploadType
};
