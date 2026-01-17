const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { verifyToken } = require('../middleware');

// Apply auth middleware
router.use(verifyToken);

// Routes
router.get('/statistics', dashboardController.getStatistics);
router.get('/activities', dashboardController.getRecentActivities);
router.get('/trends', dashboardController.getJobTrends);
router.get('/urgent', dashboardController.getUrgentJobs);

module.exports = router;
