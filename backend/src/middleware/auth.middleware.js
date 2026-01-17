const jwt = require('jsonwebtoken');
const { User, AuditLog } = require('../models');

// Verify JWT token
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId)
      .populate('roles')
      .select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found.'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact administrator.'
      });
    }

    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Authentication error.'
    });
  }
};

// Check if user has required role(s)
const requireRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.roles) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. No roles assigned.'
      });
    }

    const userRoles = req.user.roles.map(role => role.name);
    const hasRole = allowedRoles.some(role => userRoles.includes(role));

    if (!hasRole) {
      // Log unauthorized access attempt
      AuditLog.log({
        user: req.userId,
        action: 'login_failed',
        description: `Unauthorized access attempt to route requiring roles: ${allowedRoles.join(', ')}`,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
    }

    next();
  };
};

// Check specific permission
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user || !req.user.roles) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.'
      });
    }

    const userPermissions = req.user.roles.flatMap(role => role.permissions || []);
    const hasPermission = userPermissions.includes(permission);

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Missing permission: ${permission}`
      });
    }

    next();
  };
};

// Super Admin only
const superAdminOnly = requireRoles('super_admin');

// Admin or Super Admin
const adminOrAbove = requireRoles('super_admin', 'admin');

// Designer or above (Admin, Super Admin)
const designerOrAbove = requireRoles('super_admin', 'admin', 'designer');

// Manufacturer or above
const manufacturerOrAbove = requireRoles('super_admin', 'admin', 'manufacturer');

// Any authenticated user
const authenticated = verifyToken;

module.exports = {
  verifyToken,
  requireRoles,
  requirePermission,
  superAdminOnly,
  adminOrAbove,
  designerOrAbove,
  manufacturerOrAbove,
  authenticated
};
