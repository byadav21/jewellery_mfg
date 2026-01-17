const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const roleRoutes = require('./routes/role.routes');
const jobRoutes = require('./routes/job.routes');
const orderRoutes = require('./routes/order.routes');
const cadRoutes = require('./routes/cad.routes');
const manufacturingRoutes = require('./routes/manufacturing.routes');
const deliveryRoutes = require('./routes/delivery.routes');
const notificationRoutes = require('./routes/notification.routes');
const settingsRoutes = require('./routes/settings.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const skuMasterRoutes = require('./routes/skuMaster.routes');
const marketplaceAccountRoutes = require('./routes/marketplaceAccount.routes');
const auditLogRoutes = require('./routes/auditLog.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const docketRoutes = require('./routes/docket.routes');

// Import cron jobs
const { startCronJobs } = require('./cron');

// Import seed function
const { seedDefaultData } = require('./seeds');

// Import token refresh service
const tokenRefreshService = require('./services/tokenRefresh.service');
const whatsappService = require('./services/whatsapp.service');

const app = express();

// CORS configuration - must be before other middleware
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    // Allow localhost on any port and 127.0.0.1
    const allowedPatterns = [
      /^http:\/\/localhost(:\d+)?$/,
      /^http:\/\/127\.0\.0\.1(:\d+)?$/,
      /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/  // Local network IPs
    ];

    const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};
app.use(cors(corsOptions));

// Other Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cad', cadRoutes);
app.use('/api/manufacturing', manufacturingRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sku-master', skuMasterRoutes);
app.use('/api/marketplace-accounts', marketplaceAccountRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/dockets', docketRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Token refresh endpoints
app.get('/api/token-refresh/status', (req, res) => {
  res.json({
    success: true,
    data: tokenRefreshService.getLastResult()
  });
});

app.post('/api/token-refresh/refresh', async (req, res) => {
  try {
    const result = await tokenRefreshService.manualRefresh();
    res.json({
      success: result.success,
      message: result.message,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/token-refresh/logs', (req, res) => {
  const lines = parseInt(req.query.lines) || 100;
  res.json({
    success: true,
    data: tokenRefreshService.getLogs(lines)
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Database connection and server start
const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');

    // Seed default data (roles, super admin)
    await seedDefaultData();

    // Start cron jobs for order sync and TAT monitoring
    startCronJobs();

    // Start token refresh service (runs every hour)
    tokenRefreshService.init('0 * * * *');

    // Initialize WhatsApp service
    await whatsappService.initialize();

    // Initialize Default Settings
    const { SystemSettings } = require('./models');
    await SystemSettings.initializeDefaultSettings();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 API Base URL: http://localhost:${PORT}/api`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

module.exports = app;
