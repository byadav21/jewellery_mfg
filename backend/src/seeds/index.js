const { User, Role, SystemSettings } = require('../models');

const seedDefaultData = async () => {
  try {
    console.log('🌱 Checking and seeding default data...');

    // Seed roles
    await seedRoles();

    // Seed default super admin
    await seedSuperAdmin();

    // Seed default settings
    await seedDefaultSettings();

    console.log('✅ Default data seeding complete');
  } catch (error) {
    console.error('❌ Error seeding default data:', error);
  }
};

const seedRoles = async () => {
  const roles = [
    {
      name: 'super_admin',
      displayName: 'Super Admin',
      description: 'Full system access with all permissions',
      permissions: Role.getDefaultPermissions('super_admin'),
      isSystem: true
    },
    {
      name: 'admin',
      displayName: 'Admin (Production Coordinator)',
      description: 'Production workflow management',
      permissions: Role.getDefaultPermissions('admin'),
      isSystem: true
    },
    {
      name: 'designer',
      displayName: 'CAD Designer',
      description: 'CAD design and file uploads',
      permissions: Role.getDefaultPermissions('designer'),
      isSystem: true
    },
    {
      name: 'manufacturer',
      displayName: 'Manufacturer',
      description: 'Manufacturing job execution',
      permissions: Role.getDefaultPermissions('manufacturer'),
      isSystem: true
    }
  ];

  for (const roleData of roles) {
    const existingRole = await Role.findOne({ name: roleData.name });
    if (!existingRole) {
      await Role.create(roleData);
      console.log(`  ✓ Created role: ${roleData.displayName}`);
    } else {
      // Update permissions and displayName for existing roles to ensure they have the latest
      existingRole.permissions = Role.getDefaultPermissions(roleData.name);
      existingRole.displayName = roleData.displayName;
      existingRole.description = roleData.description;
      existingRole.isSystem = roleData.isSystem;
      await existingRole.save();
      console.log(`  ✓ Updated permissions for role: ${roleData.displayName}`);
    }
  }
};

const seedSuperAdmin = async () => {
  const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@jewellery.com';
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@123';

  const existingAdmin = await User.findOne({ email });

  if (!existingAdmin) {
    const superAdminRole = await Role.findOne({ name: 'super_admin' });

    if (superAdminRole) {
      await User.create({
        name: 'Super Admin',
        email,
        password,
        phone: '',
        roles: [superAdminRole._id],
        isActive: true
      });

      console.log(`  ✓ Created Super Admin: ${email}`);
      console.log(`  ⚠️  Default password: ${password} (Please change after first login)`);
    }
  }
};

const seedDefaultSettings = async () => {
  const defaultSettings = [
    // General settings
    { key: 'app_name', value: 'Jewellery Manufacturing Tool', category: 'general', description: 'Application name' },
    { key: 'app_timezone', value: 'UTC', category: 'general', description: 'Application timezone' },

    // TAT settings (in hours)
    { key: 'tat_cad_hours', value: '48', valueType: 'number', category: 'tat', description: 'CAD completion TAT in hours' },
    { key: 'tat_manufacturing_hours', value: '72', valueType: 'number', category: 'tat', description: 'Manufacturing completion TAT in hours' },
    { key: 'tat_production_coordinator_hours', value: '24', valueType: 'number', category: 'tat', description: 'Production Coordinator response TAT in hours' },
    { key: 'tat_delivery_hours', value: '24', valueType: 'number', category: 'tat', description: 'Delivery TAT in hours' },
    { key: 'tat_check_interval', value: '30', valueType: 'number', category: 'tat', description: 'TAT check interval in minutes' },

    // Amazon settings
    { key: 'amazon_enabled', value: 'true', valueType: 'boolean', category: 'amazon', description: 'Enable Amazon integration' },
    { key: 'amazon_sync_interval', value: '5', valueType: 'number', category: 'amazon', description: 'Amazon sync interval in minutes' },
    { key: 'amazon_marketplace_id', value: 'ATVPDKIKX0DER', category: 'amazon', description: 'Amazon marketplace ID' },
    { key: 'amazon_max_results_per_page', value: '100', valueType: 'number', category: 'amazon', description: 'Maximum orders to fetch per API page (1-100)' },
    { key: 'amazon_fetch_all_pages', value: 'true', valueType: 'boolean', category: 'amazon', description: 'Fetch all pages of orders (true) or only first page (false)' },
    { key: 'amazon_sync_days_back', value: '30', valueType: 'number', category: 'amazon', description: 'Number of days to look back for orders' },

    // eBay settings
    { key: 'ebay_enabled', value: 'false', valueType: 'boolean', category: 'ebay', description: 'Enable eBay integration' },
    { key: 'ebay_sync_interval', value: '5', valueType: 'number', category: 'ebay', description: 'eBay sync interval in minutes' },

    // Notification settings
    { key: 'notification_tat_breach_enabled', value: 'true', valueType: 'boolean', category: 'notification', description: 'Enable TAT breach notifications' },
    { key: 'notification_order_import_enabled', value: 'true', valueType: 'boolean', category: 'notification', description: 'Enable order import notifications' },
    { key: 'notification_status_change_enabled', value: 'true', valueType: 'boolean', category: 'notification', description: 'Enable status change notifications' },

    // WhatsApp settings
    { key: 'whatsapp_enabled', value: 'false', valueType: 'boolean', category: 'whatsapp', description: 'Enable WhatsApp notifications' },
    { key: 'whatsapp_api_url', value: '', category: 'whatsapp', description: 'WhatsApp API URL' },
    { key: 'whatsapp_tat_breach_enabled', value: 'false', valueType: 'boolean', category: 'whatsapp', description: 'Enable WhatsApp TAT breach notifications' },
    { key: 'whatsapp_order_updates_enabled', value: 'false', valueType: 'boolean', category: 'whatsapp', description: 'Enable WhatsApp order status updates' },
    { key: 'whatsapp_webhook_verify_token', value: '', category: 'whatsapp', description: 'WhatsApp webhook verify token' },

    // Email settings
    { key: 'email_enabled', value: 'false', valueType: 'boolean', category: 'email', description: 'Enable email notifications' },
    { key: 'email_smtp_host', value: '', category: 'email', description: 'SMTP host' },
    { key: 'email_smtp_port', value: '587', valueType: 'number', category: 'email', description: 'SMTP port' },
    { key: 'email_from_name', value: 'Jewellery Manufacturing', category: 'email', description: 'From name for emails' },
    { key: 'email_from_address', value: '', category: 'email', description: 'From email address' }
  ];

  for (const setting of defaultSettings) {
    const existing = await SystemSettings.findOne({ key: setting.key });
    if (!existing) {
      await SystemSettings.create(setting);
      console.log(`  ✓ Created setting: ${setting.key}`);
    }
  }
};

module.exports = { seedDefaultData };
