const request = require('supertest');
const app = require('../src/server');
const { User, Role, Job, DeliveryDetails } = require('../src/models');

describe('Delivery Management API', () => {
  let adminRole;
  let adminToken;
  let adminUser;

  beforeEach(async () => {
    adminRole = await Role.create({
      name: 'admin',
      displayName: 'Admin',
      permissions: ['delivery:read', 'delivery:write'],
      isSystem: true
    });

    adminUser = await User.create({
      name: 'Admin',
      email: 'admin@test.com',
      password: 'Password123!',
      roles: [adminRole._id],
      isActive: true
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'Password123!' });

    adminToken = loginRes.body.data.token;
  });

  describe('POST /api/delivery/:jobId - Hand Delivery', () => {
    let job;

    beforeEach(async () => {
      job = await Job.create({
        jobCode: 'JOB-2024-00001',
        status: 'manufacturing_ready_delivery',
        productName: 'Diamond Ring'
      });
    });

    it('should mark job as delivered by hand', async () => {
      const res = await request(app)
        .post(`/api/delivery/${job._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          deliveryType: 'hand',
          deliveredTo: 'John Smith',
          deliveredAt: new Date(),
          remarks: 'Delivered at office'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify job status
      const updatedJob = await Job.findById(job._id);
      expect(updatedJob.status).toBe('delivered');

      // Verify delivery details
      const delivery = await DeliveryDetails.findOne({ job: job._id });
      expect(delivery.deliveryType).toBe('hand');
      expect(delivery.deliveredTo).toBe('John Smith');
    });

    it('should fail without required fields for hand delivery', async () => {
      const res = await request(app)
        .post(`/api/delivery/${job._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          deliveryType: 'hand'
          // Missing deliveredTo
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/delivery/:jobId - Courier Delivery', () => {
    let job;

    beforeEach(async () => {
      job = await Job.create({
        jobCode: 'JOB-2024-00002',
        status: 'manufacturing_ready_delivery',
        productName: 'Gold Necklace'
      });
    });

    it('should mark job as shipped via courier', async () => {
      const res = await request(app)
        .post(`/api/delivery/${job._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          deliveryType: 'courier',
          courierName: 'FedEx',
          trackingNumber: 'FX123456789',
          deliveryAddress: '123 Main St, New York, NY 10001',
          dispatchedAt: new Date()
        });

      expect(res.status).toBe(200);

      // Verify job status
      const updatedJob = await Job.findById(job._id);
      expect(updatedJob.status).toBe('shipped');

      // Verify delivery details
      const delivery = await DeliveryDetails.findOne({ job: job._id });
      expect(delivery.deliveryType).toBe('courier');
      expect(delivery.courierName).toBe('FedEx');
      expect(delivery.trackingNumber).toBe('FX123456789');
    });

    it('should require tracking number for courier delivery', async () => {
      const res = await request(app)
        .post(`/api/delivery/${job._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          deliveryType: 'courier',
          courierName: 'FedEx'
          // Missing trackingNumber
        });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/delivery/:jobId/confirm', () => {
    let job, deliveryDetails;

    beforeEach(async () => {
      job = await Job.create({
        jobCode: 'JOB-2024-00003',
        status: 'shipped'
      });

      deliveryDetails = await DeliveryDetails.create({
        job: job._id,
        deliveryType: 'courier',
        courierName: 'UPS',
        trackingNumber: 'UPS987654321',
        dispatchedAt: new Date()
      });
    });

    it('should confirm delivery', async () => {
      const res = await request(app)
        .put(`/api/delivery/${job._id}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          deliveredAt: new Date(),
          remarks: 'Customer confirmed receipt'
        });

      expect(res.status).toBe(200);

      // Verify job status
      const updatedJob = await Job.findById(job._id);
      expect(updatedJob.status).toBe('delivered');

      // Verify delivery details
      const updatedDelivery = await DeliveryDetails.findById(deliveryDetails._id);
      expect(updatedDelivery.deliveredAt).toBeDefined();
    });
  });

  describe('GET /api/delivery', () => {
    beforeEach(async () => {
      const jobs = await Job.create([
        { jobCode: 'JOB-2024-00010', status: 'shipped', productName: 'Ring 1' },
        { jobCode: 'JOB-2024-00011', status: 'delivered', productName: 'Ring 2' },
        { jobCode: 'JOB-2024-00012', status: 'manufacturing_ready_delivery', productName: 'Necklace' }
      ]);

      await DeliveryDetails.create([
        {
          job: jobs[0]._id,
          deliveryType: 'courier',
          courierName: 'FedEx',
          trackingNumber: 'FX001',
          dispatchedAt: new Date()
        },
        {
          job: jobs[1]._id,
          deliveryType: 'hand',
          deliveredTo: 'Customer A',
          deliveredAt: new Date()
        }
      ]);
    });

    it('should list all deliveries', async () => {
      const res = await request(app)
        .get('/api/delivery')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by status (pending delivery)', async () => {
      const res = await request(app)
        .get('/api/delivery?status=pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // Should include jobs ready for delivery but not yet shipped/delivered
    });

    it('should filter by delivery type', async () => {
      const res = await request(app)
        .get('/api/delivery?deliveryType=courier')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.every(d => d.deliveryType === 'courier')).toBe(true);
    });
  });
});
