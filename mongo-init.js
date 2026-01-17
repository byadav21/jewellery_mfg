db = db.getSiblingDB('myappdb');

db.createUser({
  user: 'appuser',
  pwd: 'AppUserPass456!',
  roles: [
    {
      role: 'readWrite',
      db: 'myappdb'
    }
  ]
});

// Create initial roles
db.roles.insertMany([
  { name: 'super_admin', description: 'Full system access, can manage API credentials and all users' },
  { name: 'admin', description: 'Production Coordinator - Can assign tasks, issue components, manage workflow' },
  { name: 'designer', description: 'CAD Designer - Can upload and manage CAD files' },
  { name: 'manufacturer', description: 'Manufacturer - Can update job status and upload production files' }
]);

// Create indexes for better performance
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ phone: 1 });
db.jobs.createIndex({ job_code: 1 }, { unique: true });
db.jobs.createIndex({ status: 1 });
db.jobs.createIndex({ cad_designer_id: 1 });
db.jobs.createIndex({ manufacturer_id: 1 });
db.marketplace_orders.createIndex({ external_order_id: 1 });
db.marketplace_orders.createIndex({ channel: 1, status: 1 });
db.notifications_log.createIndex({ job_id: 1, sent_at: -1 });

print('Database initialized successfully!');
