const request = require('supertest');
const app = require('../src/server');
const { User, Role } = require('../src/models');

describe('User Management API', () => {
  let superAdminRole, adminRole, designerRole, manufacturerRole;
  let superAdminToken;

  beforeEach(async () => {
    // Create roles
    superAdminRole = await Role.create({
      name: 'super_admin',
      displayName: 'Super Admin',
      description: 'Full system access',
      permissions: ['all'],
      isSystem: true
    });

    adminRole = await Role.create({
      name: 'admin',
      displayName: 'Admin',
      description: 'Production coordinator',
      permissions: ['jobs:read', 'jobs:write'],
      isSystem: true
    });

    designerRole = await Role.create({
      name: 'designer',
      displayName: 'CAD Designer',
      description: 'CAD design access',
      permissions: ['cad:read', 'cad:write'],
      isSystem: true
    });

    manufacturerRole = await Role.create({
      name: 'manufacturer',
      displayName: 'Manufacturer',
      description: 'Manufacturing access',
      permissions: ['manufacturing:read', 'manufacturing:write'],
      isSystem: true
    });

    // Create super admin user
    await User.create({
      name: 'Super Admin',
      email: 'superadmin@example.com',
      password: 'SuperAdmin123!',
      roles: [superAdminRole._id],
      isActive: true
    });

    // Login as super admin
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'superadmin@example.com',
        password: 'SuperAdmin123!'
      });

    superAdminToken = loginRes.body.data.token;
  });

  describe('GET /api/users', () => {
    it('should list all users for super admin', async () => {
      // Create additional users
      await User.create({
        name: 'Designer User',
        email: 'designer@example.com',
        password: 'Designer123!',
        roles: [designerRole._id],
        isActive: true
      });

      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('should deny access to non-super admin', async () => {
      const designerUser = await User.create({
        name: 'Designer',
        email: 'designer2@example.com',
        password: 'Designer123!',
        roles: [designerRole._id],
        isActive: true
      });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'designer2@example.com',
          password: 'Designer123!'
        });

      const designerToken = loginRes.body.data.token;

      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${designerToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/users', () => {
    it('should create new user with single role', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'New Designer',
          email: 'newdesigner@example.com',
          password: 'NewDesigner123!',
          phone: '1234567890',
          roles: [designerRole._id]
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('email', 'newdesigner@example.com');
      expect(res.body.data.roles).toHaveLength(1);
    });

    it('should create user with dual roles (Admin + Designer)', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Dual Role User',
          email: 'dualrole@example.com',
          password: 'DualRole123!',
          roles: [adminRole._id, designerRole._id]
        });

      expect(res.status).toBe(201);
      expect(res.body.data.roles).toHaveLength(2);
    });

    it('should fail with duplicate email', async () => {
      await User.create({
        name: 'Existing User',
        email: 'existing@example.com',
        password: 'Existing123!',
        roles: [designerRole._id],
        isActive: true
      });

      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Duplicate User',
          email: 'existing@example.com',
          password: 'Duplicate123!',
          roles: [adminRole._id]
        });

      expect(res.status).toBe(400);
    });

    it('should fail without required fields', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Incomplete User'
        });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/users/:id', () => {
    it('should update user details', async () => {
      const user = await User.create({
        name: 'Update User',
        email: 'update@example.com',
        password: 'Update123!',
        roles: [designerRole._id],
        isActive: true
      });

      const res = await request(app)
        .put(`/api/users/${user._id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Updated Name',
          phone: '9876543210'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Name');
      expect(res.body.data.phone).toBe('9876543210');
    });

    it('should update user roles (dual-role assignment)', async () => {
      const user = await User.create({
        name: 'Role Update User',
        email: 'roleupdate@example.com',
        password: 'RoleUpdate123!',
        roles: [designerRole._id],
        isActive: true
      });

      const res = await request(app)
        .put(`/api/users/${user._id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          roles: [adminRole._id, designerRole._id]
        });

      expect(res.status).toBe(200);
      expect(res.body.data.roles).toHaveLength(2);
    });

    it('should deactivate user', async () => {
      const user = await User.create({
        name: 'Deactivate User',
        email: 'deactivate@example.com',
        password: 'Deactivate123!',
        roles: [designerRole._id],
        isActive: true
      });

      const res = await request(app)
        .put(`/api/users/${user._id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          isActive: false
        });

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('should soft delete (deactivate) user', async () => {
      const user = await User.create({
        name: 'Delete User',
        email: 'delete@example.com',
        password: 'Delete123!',
        roles: [designerRole._id],
        isActive: true
      });

      const res = await request(app)
        .delete(`/api/users/${user._id}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);

      // Verify user is deactivated
      const updatedUser = await User.findById(user._id);
      expect(updatedUser.isActive).toBe(false);
    });

    it('should prevent deleting own account', async () => {
      const currentUser = await User.findOne({ email: 'superadmin@example.com' });

      const res = await request(app)
        .delete(`/api/users/${currentUser._id}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(400);
    });
  });

  describe('Dual Role Access', () => {
    it('dual-role user should access both role routes', async () => {
      // Create user with Admin + Designer roles
      const dualRoleUser = await User.create({
        name: 'Dual Role',
        email: 'dual@example.com',
        password: 'Dual123!',
        roles: [adminRole._id, designerRole._id],
        isActive: true
      });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'dual@example.com',
          password: 'Dual123!'
        });

      const dualToken = loginRes.body.data.token;

      // Should access admin routes (jobs)
      const jobsRes = await request(app)
        .get('/api/jobs')
        .set('Authorization', `Bearer ${dualToken}`);

      expect(jobsRes.status).toBe(200);

      // Should access designer routes (CAD)
      const cadRes = await request(app)
        .get('/api/cad/my-tasks')
        .set('Authorization', `Bearer ${dualToken}`);

      expect(cadRes.status).toBe(200);
    });
  });
});
