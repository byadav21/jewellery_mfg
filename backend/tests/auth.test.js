const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/server');
const { User, Role } = require('../src/models');

describe('Authentication API', () => {
  let superAdminRole;

  beforeEach(async () => {
    // Create super admin role
    superAdminRole = await Role.create({
      name: 'super_admin',
      displayName: 'Super Admin',
      description: 'Full system access',
      permissions: ['all'],
      isSystem: true
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      // Create test user
      await User.create({
        name: 'Test Admin',
        email: 'test@example.com',
        password: 'Password123!',
        roles: [superAdminRole._id],
        isActive: true
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Password123!'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data.user).toHaveProperty('email', 'test@example.com');
    });

    it('should fail with invalid email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'Password123!'
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('should fail with invalid password', async () => {
      await User.create({
        name: 'Test User',
        email: 'test@example.com',
        password: 'Password123!',
        roles: [superAdminRole._id],
        isActive: true
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword!'
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should fail for inactive user', async () => {
      await User.create({
        name: 'Inactive User',
        email: 'inactive@example.com',
        password: 'Password123!',
        roles: [superAdminRole._id],
        isActive: false
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'inactive@example.com',
          password: 'Password123!'
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('deactivated');
    });

    it('should lock account after multiple failed attempts', async () => {
      await User.create({
        name: 'Test User',
        email: 'locktest@example.com',
        password: 'Password123!',
        roles: [superAdminRole._id],
        isActive: true
      });

      // Attempt 5 failed logins
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({
            email: 'locktest@example.com',
            password: 'WrongPassword!'
          });
      }

      // Next attempt should be locked
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'locktest@example.com',
          password: 'Password123!'
        });

      expect(res.status).toBe(423);
      expect(res.body.message).toContain('locked');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user with valid token', async () => {
      const user = await User.create({
        name: 'Test User',
        email: 'me@example.com',
        password: 'Password123!',
        roles: [superAdminRole._id],
        isActive: true
      });

      // Login to get token
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'me@example.com',
          password: 'Password123!'
        });

      const token = loginRes.body.data.token;

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('email', 'me@example.com');
    });

    it('should fail without token', async () => {
      const res = await request(app)
        .get('/api/auth/me');

      expect(res.status).toBe(401);
    });

    it('should fail with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/change-password', () => {
    it('should change password with correct current password', async () => {
      await User.create({
        name: 'Test User',
        email: 'change@example.com',
        password: 'OldPassword123!',
        roles: [superAdminRole._id],
        isActive: true
      });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'change@example.com',
          password: 'OldPassword123!'
        });

      const token = loginRes.body.data.token;

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'OldPassword123!',
          newPassword: 'NewPassword456!'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify new password works
      const newLoginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'change@example.com',
          password: 'NewPassword456!'
        });

      expect(newLoginRes.status).toBe(200);
    });

    it('should fail with incorrect current password', async () => {
      await User.create({
        name: 'Test User',
        email: 'fail@example.com',
        password: 'Password123!',
        roles: [superAdminRole._id],
        isActive: true
      });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'fail@example.com',
          password: 'Password123!'
        });

      const token = loginRes.body.data.token;

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'WrongPassword!',
          newPassword: 'NewPassword456!'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('incorrect');
    });
  });
});
