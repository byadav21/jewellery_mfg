const { User, Role, AuditLog } = require('../models');

// Get all users
exports.getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, role, isActive } = req.query;

    const query = {};

    // Search by name or email
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by active status
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Filter by role
    if (role) {
      const roleDoc = await Role.findOne({ name: role });
      if (roleDoc) {
        query.roles = roleDoc._id;
      }
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .populate('roles')
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
};

// Get single user
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('roles')
      .select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user'
    });
  }
};

// Create user
exports.createUser = async (req, res) => {
  try {
    const { name, email, phone, password, roles } = req.body;

    // Check if email exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      });
    }

    // Get role IDs
    let roleIds = [];
    if (roles && roles.length > 0) {
      const roleDocs = await Role.find({ name: { $in: roles } });
      roleIds = roleDocs.map(r => r._id);
    }

    const user = await User.create({
      name,
      email,
      phone,
      password,
      roles: roleIds
    });

    // Log user creation
    await AuditLog.log({
      user: req.userId,
      action: 'user_create',
      entity: 'user',
      entityId: user._id,
      description: `Created user: ${user.email}`,
      newValues: { name, email, phone, roles },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    const userResponse = await User.findById(user._id)
      .populate('roles')
      .select('-password');

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: userResponse
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create user'
    });
  }
};

// Update user
exports.updateUser = async (req, res) => {
  try {
    const { name, phone, isActive } = req.body;

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const oldValues = {
      name: user.name,
      phone: user.phone,
      isActive: user.isActive
    };

    // Update fields
    if (name) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (isActive !== undefined) user.isActive = isActive;

    await user.save();

    // Log update
    await AuditLog.log({
      user: req.userId,
      action: 'user_update',
      entity: 'user',
      entityId: user._id,
      description: `Updated user: ${user.email}`,
      oldValues,
      newValues: { name, phone, isActive },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    const updatedUser = await User.findById(user._id)
      .populate('roles')
      .select('-password');

    res.json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
};

// Assign roles to user (Super Admin only)
exports.assignRoles = async (req, res) => {
  try {
    const { roles } = req.body;
    const userId = req.params.id;

    const user = await User.findById(userId).populate('roles');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const oldRoles = user.roles.map(r => r.name);

    // Get new role IDs
    const roleDocs = await Role.find({ name: { $in: roles } });
    const newRoleIds = roleDocs.map(r => r._id);

    user.roles = newRoleIds;
    await user.save();

    // Log role assignment
    await AuditLog.log({
      user: req.userId,
      action: 'role_assign',
      entity: 'user',
      entityId: user._id,
      description: `Roles changed for user: ${user.email}`,
      oldValues: { roles: oldRoles },
      newValues: { roles },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    const updatedUser = await User.findById(user._id)
      .populate('roles')
      .select('-password');

    res.json({
      success: true,
      message: 'Roles assigned successfully',
      data: updatedUser
    });
  } catch (error) {
    console.error('Assign roles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign roles'
    });
  }
};

// Activate user
exports.activateUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: true },
      { new: true }
    ).populate('roles').select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await AuditLog.log({
      user: req.userId,
      action: 'user_activate',
      entity: 'user',
      entityId: user._id,
      description: `Activated user: ${user.email}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'User activated successfully',
      data: user
    });
  } catch (error) {
    console.error('Activate user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to activate user'
    });
  }
};

// Deactivate user
exports.deactivateUser = async (req, res) => {
  try {
    // Prevent self-deactivation
    if (req.params.id === req.userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate your own account'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    ).populate('roles').select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await AuditLog.log({
      user: req.userId,
      action: 'user_deactivate',
      entity: 'user',
      entityId: user._id,
      description: `Deactivated user: ${user.email}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'User deactivated successfully',
      data: user
    });
  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate user'
    });
  }
};

// Delete user (Super Admin only)
exports.deleteUser = async (req, res) => {
  try {
    // Prevent self-deletion
    if (req.params.id === req.userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await User.findByIdAndDelete(req.params.id);

    await AuditLog.log({
      user: req.userId,
      action: 'user_delete',
      entity: 'user',
      entityId: req.params.id,
      description: `Deleted user: ${user.email}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
};

// Get users by role
exports.getUsersByRole = async (req, res) => {
  try {
    const { roleName } = req.params;

    const role = await Role.findOne({ name: roleName });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    const users = await User.find({
      roles: role._id,
      isActive: true
    })
      .populate('roles')
      .select('name email phone')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('Get users by role error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
};

// Reset user password (Super Admin only)
exports.resetPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.password = newPassword;
    user.passwordChangedAt = new Date();
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    await AuditLog.log({
      user: req.userId,
      action: 'password_reset',
      entity: 'user',
      entityId: user._id,
      description: `Password reset for user: ${user.email}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
};
