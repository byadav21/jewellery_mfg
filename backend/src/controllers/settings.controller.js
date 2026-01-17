const { SystemSettings, AuditLog } = require('../models');

// Get all settings
exports.getSettings = async (req, res) => {
  try {
    const { category } = req.query;

    const query = category ? { category } : {};
    const settings = await SystemSettings.find(query)
      .select('-value') // Don't expose values by default
      .sort({ category: 1, key: 1 });

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings'
    });
  }
};

// Get setting by key
exports.getSetting = async (req, res) => {
  try {
    const setting = await SystemSettings.findOne({ key: req.params.key });

    if (!setting) {
      return res.status(404).json({
        success: false,
        message: 'Setting not found'
      });
    }

    // Log access to sensitive settings
    if (setting.valueType === 'encrypted') {
      await AuditLog.log({
        user: req.userId,
        action: 'api_credentials_view',
        entity: 'settings',
        description: `Viewed setting: ${setting.key}`,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
    }

    res.json({
      success: true,
      data: {
        ...setting.toObject(),
        value: setting.valueType === 'encrypted' ? '********' : setting.value
      }
    });
  } catch (error) {
    console.error('Get setting error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch setting'
    });
  }
};

// Update setting
exports.updateSetting = async (req, res) => {
  try {
    const { value, encrypt } = req.body;
    const { key } = req.params;

    const setting = await SystemSettings.findOne({ key });

    if (!setting) {
      return res.status(404).json({
        success: false,
        message: 'Setting not found'
      });
    }

    if (!setting.isEditable) {
      return res.status(400).json({
        success: false,
        message: 'This setting is not editable'
      });
    }

    const oldValue = setting.valueType === 'encrypted' ? '********' : setting.value;

    await SystemSettings.setSetting(key, value, {
      category: setting.category,
      description: setting.description,
      valueType: setting.valueType,
      encrypt: encrypt || setting.valueType === 'encrypted',
      userId: req.userId
    });

    await AuditLog.log({
      user: req.userId,
      action: 'settings_update',
      entity: 'settings',
      description: `Updated setting: ${key}`,
      oldValues: { value: oldValue },
      newValues: { value: encrypt || setting.valueType === 'encrypted' ? '********' : value },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Setting updated successfully'
    });
  } catch (error) {
    console.error('Update setting error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update setting'
    });
  }
};

// Update multiple settings (bulk)
exports.updateSettings = async (req, res) => {
  try {
    const { settings } = req.body;

    if (!Array.isArray(settings)) {
      return res.status(400).json({
        success: false,
        message: 'Settings must be an array'
      });
    }

    const results = [];

    for (const item of settings) {
      const { key, value, encrypt } = item;

      const setting = await SystemSettings.findOne({ key });

      if (!setting || !setting.isEditable) {
        results.push({ key, success: false, message: 'Not found or not editable' });
        continue;
      }

      await SystemSettings.setSetting(key, value, {
        category: setting.category,
        description: setting.description,
        valueType: setting.valueType,
        encrypt: encrypt || setting.valueType === 'encrypted',
        userId: req.userId
      });

      results.push({ key, success: true });
    }

    await AuditLog.log({
      user: req.userId,
      action: 'settings_update',
      entity: 'settings',
      description: `Bulk updated ${results.filter(r => r.success).length} settings`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Settings updated',
      data: results
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update settings'
    });
  }
};

// Get settings by category with values (for Super Admin)
exports.getSettingsWithValues = async (req, res) => {
  try {
    const { category } = req.params;

    const settings = await SystemSettings.find({ category }).sort({ key: 1 });

    // Decrypt encrypted values for super admin
    const result = settings.map(s => {
      if (s.valueType === 'encrypted') {
        return {
          ...s.toObject(),
          value: s.decryptValue()
        };
      }
      return s;
    });

    await AuditLog.log({
      user: req.userId,
      action: 'api_credentials_view',
      entity: 'settings',
      description: `Viewed ${category} settings with values`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get settings with values error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings'
    });
  }
};

// Save API credentials (Amazon/eBay/WhatsApp)
exports.saveAPICredentials = async (req, res) => {
  try {
    const { platform } = req.params;
    const credentials = req.body;

    const validPlatforms = ['amazon', 'ebay', 'whatsapp', 'email'];
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid platform'
      });
    }

    for (const [key, value] of Object.entries(credentials)) {
      const settingKey = `${platform}_${key}`;
      const isSecret = ['token', 'secret', 'password', 'key', 'refresh'].some(s =>
        key.toLowerCase().includes(s)
      );

      await SystemSettings.setSetting(settingKey, value, {
        category: platform,
        encrypt: isSecret,
        userId: req.userId
      });
    }

    await AuditLog.log({
      user: req.userId,
      action: 'api_credentials_update',
      entity: 'settings',
      description: `Updated ${platform} API credentials`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: `${platform} credentials saved successfully`
    });
  } catch (error) {
    console.error('Save API credentials error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save credentials'
    });
  }
};
