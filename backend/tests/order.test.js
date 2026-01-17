const request = require('supertest');
const app = require('../src/server');
const { User, Role, MarketplaceOrder, MarketplaceOrderItem, Job } = require('../src/models');

describe('Order Management API', () => {
  let adminRole;
  let adminToken;

  beforeEach(async () => {
    adminRole = await Role.create({
      name: 'admin',
      displayName: 'Admin',
      permissions: ['orders:read', 'orders:write'],
      isSystem: true
    });

    await User.create({
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

  describe('POST /api/orders/manual', () => {
    it('should create manual order with single item', async () => {
      const res = await request(app)
        .post('/api/orders/manual')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          buyerName: 'John Doe',
          buyerEmail: 'john@example.com',
          buyerPhone: '1234567890',
          items: [
            {
              sku: 'RING-001',
              productName: 'Diamond Engagement Ring',
              quantity: 1,
              itemPrice: 5000
            }
          ],
          promisedDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          remarks: 'Rush order'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.order.channel).toBe('manual');
      expect(res.body.data.jobs.length).toBe(1);
    });

    it('should create manual order with multiple items', async () => {
      const res = await request(app)
        .post('/api/orders/manual')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          buyerName: 'Jane Smith',
          items: [
            { sku: 'RING-002', productName: 'Gold Ring', quantity: 1, itemPrice: 2000 },
            { sku: 'NECK-001', productName: 'Pearl Necklace', quantity: 1, itemPrice: 3000 },
            { sku: 'EARR-001', productName: 'Diamond Earrings', quantity: 2, itemPrice: 1500 }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.data.jobs.length).toBe(3); // One job per item
    });

    it('should auto-create jobs for each order item', async () => {
      const res = await request(app)
        .post('/api/orders/manual')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          buyerName: 'Test Customer',
          items: [
            { sku: 'TEST-001', productName: 'Test Product', quantity: 1 }
          ]
        });

      const jobs = await Job.find({ order: res.body.data.order._id });
      expect(jobs.length).toBe(1);
      expect(jobs[0].status).toBe('new');
      expect(jobs[0].sourceType).toBe('order');
      expect(jobs[0].channel).toBe('manual');
    });
  });

  describe('GET /api/orders', () => {
    beforeEach(async () => {
      // Create test orders
      const order1 = await MarketplaceOrder.create({
        channel: 'amazon',
        externalOrderId: 'AMZ-001',
        buyerName: 'Amazon Customer 1',
        status: 'pending',
        orderDate: new Date()
      });

      const order2 = await MarketplaceOrder.create({
        channel: 'ebay',
        externalOrderId: 'EBAY-001',
        buyerName: 'eBay Customer 1',
        status: 'processing',
        orderDate: new Date()
      });

      const order3 = await MarketplaceOrder.create({
        channel: 'manual',
        buyerName: 'Manual Customer',
        status: 'completed',
        orderDate: new Date()
      });

      // Create order items
      await MarketplaceOrderItem.create([
        { order: order1._id, sku: 'SKU-001', productName: 'Ring 1', quantity: 1 },
        { order: order2._id, sku: 'SKU-002', productName: 'Necklace 1', quantity: 2 },
        { order: order3._id, sku: 'SKU-003', productName: 'Bracelet 1', quantity: 1 }
      ]);
    });

    it('should list all orders', async () => {
      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
    });

    it('should filter by channel', async () => {
      const res = await request(app)
        .get('/api/orders?channel=amazon')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].channel).toBe('amazon');
    });

    it('should filter by status', async () => {
      const res = await request(app)
        .get('/api/orders?status=pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.every(o => o.status === 'pending')).toBe(true);
    });

    it('should paginate results', async () => {
      const res = await request(app)
        .get('/api/orders?page=1&limit=2')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.pagination).toBeDefined();
    });
  });

  describe('GET /api/orders/:id', () => {
    it('should get order details with items', async () => {
      const order = await MarketplaceOrder.create({
        channel: 'amazon',
        externalOrderId: 'AMZ-DETAIL-001',
        buyerName: 'Detail Test Customer',
        status: 'pending'
      });

      await MarketplaceOrderItem.create([
        { order: order._id, sku: 'DET-001', productName: 'Product 1', quantity: 1 },
        { order: order._id, sku: 'DET-002', productName: 'Product 2', quantity: 2 }
      ]);

      const res = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.order.externalOrderId).toBe('AMZ-DETAIL-001');
      expect(res.body.data.items.length).toBe(2);
    });

    it('should include associated jobs', async () => {
      const order = await MarketplaceOrder.create({
        channel: 'manual',
        buyerName: 'Job Test Customer'
      });

      const item = await MarketplaceOrderItem.create({
        order: order._id,
        sku: 'JOB-001',
        productName: 'Job Product',
        quantity: 1
      });

      await Job.create({
        jobCode: 'JOB-2024-00100',
        order: order._id,
        orderItem: item._id,
        status: 'new'
      });

      const res = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.jobs.length).toBe(1);
    });
  });

  describe('PUT /api/orders/:id/status', () => {
    it('should update order status', async () => {
      const order = await MarketplaceOrder.create({
        channel: 'manual',
        buyerName: 'Status Test',
        status: 'pending'
      });

      const res = await request(app)
        .put(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'processing' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('processing');
    });

    it('should fail with invalid status', async () => {
      const order = await MarketplaceOrder.create({
        channel: 'manual',
        buyerName: 'Invalid Status Test',
        status: 'pending'
      });

      const res = await request(app)
        .put(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'invalid_status' });

      expect(res.status).toBe(400);
    });
  });
});
