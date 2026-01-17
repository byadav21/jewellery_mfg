const request = require('supertest');
const path = require('path');
const fs = require('fs');
const app = require('../src/server');
const { User, Role, Job, CADFile } = require('../src/models');

describe('CAD Workflow API', () => {
  let adminRole, designerRole;
  let adminToken, designerToken;
  let adminUser, designerUser;

  beforeEach(async () => {
    adminRole = await Role.create({
      name: 'admin',
      displayName: 'Admin',
      permissions: ['cad:read', 'cad:write', 'cad:assign', 'cad:review'],
      isSystem: true
    });

    designerRole = await Role.create({
      name: 'designer',
      displayName: 'Designer',
      permissions: ['cad:read', 'cad:write', 'cad:upload'],
      isSystem: true
    });

    adminUser = await User.create({
      name: 'Admin',
      email: 'admin@test.com',
      password: 'Password123!',
      roles: [adminRole._id],
      isActive: true
    });

    designerUser = await User.create({
      name: 'Designer',
      email: 'designer@test.com',
      password: 'Password123!',
      roles: [designerRole._id],
      isActive: true
    });

    const adminLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'Password123!' });
    adminToken = adminLoginRes.body.data.token;

    const designerLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'designer@test.com', password: 'Password123!' });
    designerToken = designerLoginRes.body.data.token;
  });

  describe('PUT /api/cad/:jobId/assign', () => {
    let job;

    beforeEach(async () => {
      job = await Job.create({
        jobCode: 'JOB-2024-00001',
        status: 'new',
        productName: 'Test Ring'
      });
    });

    it('should assign CAD task to designer', async () => {
      const res = await request(app)
        .put(`/api/cad/${job._id}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          designerId: designerUser._id,
          deadline: new Date(Date.now() + 48 * 60 * 60 * 1000),
          notes: 'Please create 3D model with diamond setting',
          priority: 'high'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cad_assigned');
      expect(res.body.data.cadDesigner.toString()).toBe(designerUser._id.toString());
      expect(res.body.data.cadDeadline).toBeDefined();
    });

    it('should fail if designer not found', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .put(`/api/cad/${job._id}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          designerId: fakeId
        });

      expect(res.status).toBe(404);
    });

    it('should not allow designer to assign tasks', async () => {
      const res = await request(app)
        .put(`/api/cad/${job._id}/assign`)
        .set('Authorization', `Bearer ${designerToken}`)
        .send({
          designerId: designerUser._id
        });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/cad/my-tasks', () => {
    beforeEach(async () => {
      // Create jobs assigned to designer
      await Job.create([
        {
          jobCode: 'JOB-2024-00010',
          status: 'cad_assigned',
          cadDesigner: designerUser._id,
          productName: 'Ring 1'
        },
        {
          jobCode: 'JOB-2024-00011',
          status: 'cad_in_progress',
          cadDesigner: designerUser._id,
          productName: 'Ring 2'
        },
        {
          jobCode: 'JOB-2024-00012',
          status: 'new', // Not assigned to this designer
          productName: 'Ring 3'
        }
      ]);
    });

    it('should list only assigned CAD tasks for designer', async () => {
      const res = await request(app)
        .get('/api/cad/my-tasks')
        .set('Authorization', `Bearer ${designerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data.every(j =>
        j.cadDesigner.toString() === designerUser._id.toString()
      )).toBe(true);
    });

    it('should filter by status', async () => {
      const res = await request(app)
        .get('/api/cad/my-tasks?status=cad_assigned')
        .set('Authorization', `Bearer ${designerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].status).toBe('cad_assigned');
    });
  });

  describe('PUT /api/cad/:jobId/start', () => {
    let job;

    beforeEach(async () => {
      job = await Job.create({
        jobCode: 'JOB-2024-00020',
        status: 'cad_assigned',
        cadDesigner: designerUser._id
      });
    });

    it('should start CAD work', async () => {
      const res = await request(app)
        .put(`/api/cad/${job._id}/start`)
        .set('Authorization', `Bearer ${designerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cad_in_progress');
    });

    it('should fail if not assigned to this designer', async () => {
      const otherDesigner = await User.create({
        name: 'Other Designer',
        email: 'other@test.com',
        password: 'Password123!',
        roles: [designerRole._id],
        isActive: true
      });

      const otherLoginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'other@test.com', password: 'Password123!' });

      const res = await request(app)
        .put(`/api/cad/${job._id}/start`)
        .set('Authorization', `Bearer ${otherLoginRes.body.data.token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/cad/:jobId/upload', () => {
    let job;

    beforeEach(async () => {
      job = await Job.create({
        jobCode: 'JOB-2024-00030',
        status: 'cad_in_progress',
        cadDesigner: designerUser._id
      });
    });

    it('should upload CAD file', async () => {
      // Create a temp test file
      const testFilePath = path.join(__dirname, 'test-file.stl');
      fs.writeFileSync(testFilePath, 'STL file content');

      const res = await request(app)
        .post(`/api/cad/${job._id}/upload`)
        .set('Authorization', `Bearer ${designerToken}`)
        .attach('file', testFilePath)
        .field('fileType', 'stl')
        .field('comments', 'Initial design');

      // Clean up test file
      fs.unlinkSync(testFilePath);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('filePath');
      expect(res.body.data.fileType).toBe('stl');
    });

    it('should track file versions', async () => {
      // Upload first version
      await CADFile.create({
        job: job._id,
        uploadedBy: designerUser._id,
        filePath: '/uploads/v1.stl',
        fileType: 'stl',
        version: 1
      });

      // Upload second version
      const testFilePath = path.join(__dirname, 'test-file-v2.stl');
      fs.writeFileSync(testFilePath, 'STL v2 content');

      const res = await request(app)
        .post(`/api/cad/${job._id}/upload`)
        .set('Authorization', `Bearer ${designerToken}`)
        .attach('file', testFilePath)
        .field('fileType', 'stl');

      fs.unlinkSync(testFilePath);

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe(2);
    });
  });

  describe('PUT /api/cad/:jobId/submit', () => {
    let job;

    beforeEach(async () => {
      job = await Job.create({
        jobCode: 'JOB-2024-00040',
        status: 'cad_in_progress',
        cadDesigner: designerUser._id
      });

      // Add CAD file
      await CADFile.create({
        job: job._id,
        uploadedBy: designerUser._id,
        filePath: '/uploads/design.stl',
        fileType: 'stl',
        version: 1
      });
    });

    it('should submit CAD for review', async () => {
      const res = await request(app)
        .put(`/api/cad/${job._id}/submit`)
        .set('Authorization', `Bearer ${designerToken}`)
        .send({
          comments: 'Ready for review'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cad_submitted');
    });

    it('should fail if no CAD files uploaded', async () => {
      const emptyJob = await Job.create({
        jobCode: 'JOB-2024-00041',
        status: 'cad_in_progress',
        cadDesigner: designerUser._id
      });

      const res = await request(app)
        .put(`/api/cad/${emptyJob._id}/submit`)
        .set('Authorization', `Bearer ${designerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('No CAD files');
    });
  });

  describe('GET /api/cad/reviews', () => {
    beforeEach(async () => {
      await Job.create([
        { jobCode: 'JOB-2024-00050', status: 'cad_submitted', productName: 'Ring 1' },
        { jobCode: 'JOB-2024-00051', status: 'cad_submitted', productName: 'Ring 2' },
        { jobCode: 'JOB-2024-00052', status: 'cad_approved', productName: 'Ring 3' }
      ]);
    });

    it('should list pending CAD reviews for admin', async () => {
      const res = await request(app)
        .get('/api/cad/reviews')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data.every(j => j.status === 'cad_submitted')).toBe(true);
    });
  });

  describe('PUT /api/cad/:jobId/approve', () => {
    let job;

    beforeEach(async () => {
      job = await Job.create({
        jobCode: 'JOB-2024-00060',
        status: 'cad_submitted',
        cadDesigner: designerUser._id
      });

      await CADFile.create({
        job: job._id,
        uploadedBy: designerUser._id,
        filePath: '/uploads/design.stl',
        fileType: 'stl',
        version: 1
      });
    });

    it('should approve CAD', async () => {
      const res = await request(app)
        .put(`/api/cad/${job._id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          comments: 'Looks good!'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cad_approved');

      // Verify CAD file marked as approved
      const cadFile = await CADFile.findOne({ job: job._id });
      expect(cadFile.isApproved).toBe(true);
      expect(cadFile.approvedBy.toString()).toBe(adminUser._id.toString());
    });
  });

  describe('PUT /api/cad/:jobId/reject', () => {
    let job;

    beforeEach(async () => {
      job = await Job.create({
        jobCode: 'JOB-2024-00070',
        status: 'cad_submitted',
        cadDesigner: designerUser._id
      });
    });

    it('should reject CAD with reason', async () => {
      const res = await request(app)
        .put(`/api/cad/${job._id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Diamond placement is incorrect'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cad_rejected');
    });

    it('should require rejection reason', async () => {
      const res = await request(app)
        .put(`/api/cad/${job._id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('Dual Role: Admin + Designer', () => {
    let dualRoleUser, dualRoleToken;

    beforeEach(async () => {
      dualRoleUser = await User.create({
        name: 'Admin Designer',
        email: 'dual@test.com',
        password: 'Password123!',
        roles: [adminRole._id, designerRole._id],
        isActive: true
      });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'dual@test.com', password: 'Password123!' });
      dualRoleToken = loginRes.body.data.token;
    });

    it('should allow dual-role user to assign to self', async () => {
      const job = await Job.create({
        jobCode: 'JOB-2024-00080',
        status: 'new'
      });

      const res = await request(app)
        .put(`/api/cad/${job._id}/assign`)
        .set('Authorization', `Bearer ${dualRoleToken}`)
        .send({
          designerId: dualRoleUser._id
        });

      expect(res.status).toBe(200);
      expect(res.body.data.cadDesigner.toString()).toBe(dualRoleUser._id.toString());
    });

    it('should allow dual-role user to upload and approve CAD', async () => {
      const job = await Job.create({
        jobCode: 'JOB-2024-00081',
        status: 'cad_in_progress',
        cadDesigner: dualRoleUser._id
      });

      await CADFile.create({
        job: job._id,
        uploadedBy: dualRoleUser._id,
        filePath: '/uploads/dual-design.stl',
        fileType: 'stl',
        version: 1
      });

      // Submit CAD
      await request(app)
        .put(`/api/cad/${job._id}/submit`)
        .set('Authorization', `Bearer ${dualRoleToken}`);

      // Approve own CAD (as admin)
      const res = await request(app)
        .put(`/api/cad/${job._id}/approve`)
        .set('Authorization', `Bearer ${dualRoleToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cad_approved');
    });
  });
});
