const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const userController = require('../controllers/user.controller');
const { verifyToken, superAdminOnly, adminOrAbove, validate } = require('../middleware');

// Validation rules
const createUserValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email')
    .normalizeEmail(),
  body('phone')
    .optional()
    .trim()
    .isLength({ max: 20 })
    .withMessage('Phone number cannot exceed 20 characters'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
  body('roles')
    .optional()
    .isArray()
    .withMessage('Roles must be an array')
];

const updateUserValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('phone')
    .optional()
    .trim()
    .isLength({ max: 20 })
    .withMessage('Phone number cannot exceed 20 characters'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean')
];

const assignRolesValidation = [
  body('roles')
    .isArray({ min: 1 })
    .withMessage('At least one role must be specified')
];

const resetPasswordValidation = [
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
];

// Apply auth middleware to all routes
router.use(verifyToken);

// Routes
router.get('/', adminOrAbove, userController.getUsers);
router.get('/role/:roleName', adminOrAbove, userController.getUsersByRole);
router.get('/:id', adminOrAbove, userController.getUser);
router.post('/', superAdminOnly, createUserValidation, validate, userController.createUser);
router.put('/:id', superAdminOnly, updateUserValidation, validate, userController.updateUser);
router.put('/:id/roles', superAdminOnly, assignRolesValidation, validate, userController.assignRoles);
router.put('/:id/activate', superAdminOnly, userController.activateUser);
router.put('/:id/deactivate', superAdminOnly, userController.deactivateUser);
router.put('/:id/reset-password', superAdminOnly, resetPasswordValidation, validate, userController.resetPassword);
router.delete('/:id', superAdminOnly, userController.deleteUser);

module.exports = router;
