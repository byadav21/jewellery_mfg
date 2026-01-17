const { Role } = require('../models');

// Get all roles
exports.getRoles = async (req, res) => {
  try {
    const roles = await Role.find().sort({ name: 1 });

    res.json({
      success: true,
      data: roles
    });
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch roles'
    });
  }
};

// Get single role
exports.getRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    res.json({
      success: true,
      data: role
    });
  } catch (error) {
    console.error('Get role error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch role'
    });
  }
};

// Get role by name
exports.getRoleByName = async (req, res) => {
  try {
    const role = await Role.findOne({ name: req.params.name });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    res.json({
      success: true,
      data: role
    });
  } catch (error) {
    console.error('Get role by name error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch role'
    });
  }
};
