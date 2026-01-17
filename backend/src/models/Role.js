const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Role name is required'],
    unique: true,
    enum: ['super_admin', 'admin', 'designer', 'manufacturer'],
    lowercase: true
  },
  displayName: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  permissions: [{
    type: String
  }],
  isSystem: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Define default permissions for each role
roleSchema.statics.getDefaultPermissions = function (roleName) {
  const permissions = {
    super_admin: [
      'users:read', 'users:create', 'users:update', 'users:delete',
      'roles:read', 'roles:assign',
      'settings:read', 'settings:update',
      'jobs:read', 'jobs:create', 'jobs:update', 'jobs:delete',
      'orders:read', 'orders:sync',
      'cad:read', 'cad:assign', 'cad:upload', 'cad:review',
      'components:read', 'components:create', 'components:issue',
      'manufacturing:read', 'manufacturing:assign', 'manufacturing:update',
      'delivery:read', 'delivery:update',
      'notifications:read', 'notifications:configure',
      'dashboard:full', 'reports:all',
      'dockets:read', 'dockets:create', 'dockets:update'
    ],
    admin: [
      'jobs:read', 'jobs:create', 'jobs:update',
      'orders:read',
      'cad:read', 'cad:assign', 'cad:review',
      'components:read', 'components:create', 'components:issue',
      'manufacturing:read', 'manufacturing:assign', 'manufacturing:update',
      'delivery:read', 'delivery:update',
      'notifications:read',
      'dashboard:admin', 'reports:limited',
      'dockets:read', 'dockets:create', 'dockets:update'
    ],
    designer: [
      'jobs:read',
      'cad:read', 'cad:upload', 'cad:update',
      'dashboard:designer'
    ],
    manufacturer: [
      'jobs:read',
      'manufacturing:read', 'manufacturing:update',
      'dashboard:manufacturer',
      'dockets:read'
    ]
  };

  return permissions[roleName] || [];
};

module.exports = mongoose.model('Role', roleSchema);
