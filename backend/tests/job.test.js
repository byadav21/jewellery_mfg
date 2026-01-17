const request = require('supertest');
const app = require('../src/server');
const { User, Role, Job, MarketplaceOrder, MarketplaceOrderItem } = require('../src/models');

describe('Job Management API', () => {
  let superAdminRole, adminRole, designerRole, manufacturerRole;
  let superAdminToken, adminToken, designerToken, manufacturerToken;
  let adminUser, designerUser, manufacturerUser;

  beforeEach(async () => {
    // Create roles
    superAdminRole = await Role.create({
      name: 'super_admin',
      displayName: 'Super Admin',
      permissions: ['all'],
      isSystem: true
    });

    adminRole = await Role.create({
      name: 'admin',
      displayName: 'Admin',
      permissions: ['jobs:read', 'jobs:write', 'jobs:assign'],
      isSystem: true
    });

    designerRole = await Role.create({
      name: 'designer',
      displayName: 'Designer',
      permissions: ['cad:read', 'cad:write'],
      isSystem: true
    });

    manufacturerRole = await Role.create({
      name: 'manufacturer',
      displayName: 'Manufacturer',
      permissions: ['manufacturing:read', 'manufacturing:write'],
      isSystem: true
    });

    // Create users
    const superAdmin = await User.create({
      name: 'Super Admin',
      email: 'super@test.com',
      password: 'Password123!',
      roles: [superAdminRole._id],
      isActive: true
    });

    adminUser = await User.create({
      name: 'Admin User',
      email: 'admin@test.com',
      password: 'Password123!',
      roles: [adminRole._id],
      isActive: true
    });

    designerUser = await User.create({
      name: 'Designer User',
      email: 'designer@test.com',
      password: 'Password123!',
      roles: [designerRole._id],
      isActive: true
    });

    manufacturerUser = await User.create({
      name: 'Manufacturer User',
      email: 'manufacturer@test.com',
      password: 'Password123!',
      roles: [manufacturerRole._id],
      isActive: true
    });

    // Get tokens
    const superLoginRes = await request(app).post('/api/auth/login').send({ email: 'super@test.com', password: 'Password123!' });
    superAdminToken = superLoginRes.body.data.token;

    const adminLoginRes = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'Password123!' });
    adminToken = adminLoginRes.body.data.token;

    const designerLoginRes = await request(app).post('/api/auth/login').send({ email: 'designer@test.com', password: 'Password123!' });
    designerToken = designerLoginRes.body.data.token;

    const manufacturerLoginRes = await request(app).post('/api/auth/login').send({ email: 'manufacturer@test.com', password: 'Password123!' });
    manufacturerToken = manufacturerLoginRes.body.data.token;
  });

  describe('POST /api/jobs', () => {
    it('should create manual job', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productName: 'Diamond Ring',
          sku: 'DR-001',
          quantity: 1,
          priority: 'high',
          customerName: 'John Doe',
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('jobCode');
      expect(res.body.data.sourceType).toBe('manual');
      expect(res.body.data.status).toBe('new');
    });

    it('should auto-generate job code', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productName: 'Gold Necklace',
          sku: 'GN-001',
          quantity: 1
        });

      expect(res.body.data.jobCode).toMatch(/^JOB-\d{4}-\d{5}$/);
    });
  });

  describe('GET /api/jobs', () => {
    beforeEach(async () => {
      // Create test jobs
      await Job.create({
        jobCode: 'JOB-2024-00001',
        sourceType: 'manual',
        productName: 'Ring 1',
        sku: 'R1',
        status: 'new',
        admin: adminUser._id
      });

      await Job.create({
        jobCode: 'JOB-2024-00002',
        sourceType: 'order',
        channel: 'amazon',
        productName: 'Ring 2',
        sku: 'R2',
        status: 'cad_assigned',
        cadDesigner: designerUser._id
      });

      await Job.create({
        jobCode: 'JOB-2024-00003',
        sourceType: 'manual',
        productName: 'Necklace 1',
        sku: 'N1',
        status: 'manufacturing_assigned',
        manufacturer: manufacturerUser._id
      });
    });

    it('should list all jobs for admin', async () => {
      const res = await request(app)
        .get('/api/jobs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
    });

    it('should filter jobs by status', async () => {
      const res = await request(app)
        .get('/api/jobs?status=new')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].status).toBe('new');
    });

    it('should filter jobs by channel', async () => {
      const res = await request(app)
        .get('/api/jobs?channel=amazon')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].channel).toBe('amazon');
    });

    it('designer should only see assigned CAD jobs', async () => {
      const res = await request(app)
        .get('/api/cad/my-tasks')
        .set('Authorization', `Bearer ${designerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].cadDesigner.toString()).toBe(designerUser._id.toString());
    });

    it('manufacturer should only see assigned manufacturing jobs', async () => {
      const res = await request(app)
        .get('/api/manufacturing')
        .set('Authorization', `Bearer ${manufacturerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });
  });

  describe('PUT /api/jobs/:id/assign-cad', () => {
    let job;

    beforeEach(async () => {
      job = await Job.create({
        jobCode: 'JOB-2024-00010',
        sourceType: 'manual',
        productName: 'Test Ring',
        status: 'new'
      });
    });

    it('should assign CAD designer', async () => {
      const res = await request(app)
        .put(`/api/jobs/${job._id}/assign-cad`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          designerId: designerUser._id,
          deadline: new Date(Date.now() + 48 * 60 * 60 * 1000),
          notes: 'Please use 3D CAD'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cad_assigned');
      expect(res.body.data.cadDesigner.toString()).toBe(designerUser._id.toString());
    });

    it('should fail to assign non-designer role', async () => {
      const res = await request(app)
        .put(`/api/jobs/${job._id}/assign-cad`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          designerId: manufacturerUser._id
        });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/jobs/:id/assign-manufacturing', () => {
    let job;

    beforeEach(async () => {
      job = await Job.create({
        jobCode: 'JOB-2024-00020',
        sourceType: 'manual',
        productName: 'Test Necklace',
        status: 'cad_approved'
      });
    });

    it('should assign manufacturer', async () => {
      const res = await request(app)
        .put(`/api/jobs/${job._id}/assign-manufacturing`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          manufacturerId: manufacturerUser._id,
          deadline: new Date(Date.now() + 72 * 60 * 60 * 1000),
          notes: 'High priority'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('manufacturing_assigned');
    });

    it('should fail if CAD not approved', async () => {
      const newJob = await Job.create({
        jobCode: 'JOB-2024-00021',
        status: 'cad_in_progress'
      });

      const res = await request(app)
        .put(`/api/jobs/${newJob._id}/assign-manufacturing`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          manufacturerId: manufacturerUser._id
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Job Status Flow', () => {
    it('should follow correct status flow: CAD workflow', async () => {
      // Create job
      const job = await Job.create({
        jobCode: 'JOB-2024-00030',
        status: 'new'
      });

      // Assign CAD
      await request(app)
        .put(`/api/jobs/${job._id}/assign-cad`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ designerId: designerUser._id });

      let updatedJob = await Job.findById(job._id);
      expect(updatedJob.status).toBe('cad_assigned');

      // Designer starts work
      await request(app)
        .put(`/api/cad/${job._id}/start`)
        .set('Authorization', `Bearer ${designerToken}`);

      updatedJob = await Job.findById(job._id);
      expect(updatedJob.status).toBe('cad_in_progress');

      // Designer submits CAD
      await request(app)
        .put(`/api/cad/${job._id}/submit`)
        .set('Authorization', `Bearer ${designerToken}`);

      updatedJob = await Job.findById(job._id);
      expect(updatedJob.status).toBe('cad_submitted');

      // Admin approves CAD
      await request(app)
        .put(`/api/cad/${job._id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      updatedJob = await Job.findById(job._id);
      expect(updatedJob.status).toBe('cad_approved');
    });

    it('should follow correct status flow: Manufacturing workflow', async () => {
      const job = await Job.create({
        jobCode: 'JOB-2024-00040',
        status: 'components_issued',
        manufacturer: manufacturerUser._id
      });

      // Assign manufacturing
      await request(app)
        .put(`/api/jobs/${job._id}/assign-manufacturing`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ manufacturerId: manufacturerUser._id });

      // Manufacturer accepts
      await request(app)
        .put(`/api/manufacturing/${job._id}/accept`)
        .set('Authorization', `Bearer ${manufacturerToken}`);

      let updatedJob = await Job.findById(job._id);
      expect(updatedJob.status).toBe('manufacturing_accepted');

      // Manufacturer starts
      await request(app)
        .put(`/api/manufacturing/${job._id}/start`)
        .set('Authorization', `Bearer ${manufacturerToken}`);

      updatedJob = await Job.findById(job._id);
      expect(updatedJob.status).toBe('manufacturing_in_progress');

      // Manufacturer completes
      await request(app)
        .put(`/api/manufacturing/${job._id}/complete`)
        .set('Authorization', `Bearer ${manufacturerToken}`);

      updatedJob = await Job.findById(job._id);
      expect(updatedJob.status).toBe('manufacturing_ready_qc');
    });
  });
});
