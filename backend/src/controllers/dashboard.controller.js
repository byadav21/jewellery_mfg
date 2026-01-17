const { Job, MarketplaceOrder, User, NotificationLog } = require('../models');

// Get dashboard statistics
exports.getStatistics = async (req, res) => {
  try {
    const userRoles = req.user.roles.map(r => r.name);

    // Common statistics
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const statistics = {};

    // Job statistics
    const jobStats = await Job.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    statistics.jobsByStatus = jobStats.reduce((acc, s) => {
      acc[s._id] = s.count;
      return acc;
    }, {});

    // Total jobs
    statistics.totalJobs = await Job.countDocuments();

    // Today's jobs
    statistics.todayJobs = await Job.countDocuments({
      createdAt: { $gte: today }
    });

    // Overdue jobs
    statistics.overdueJobs = await Job.countDocuments({
      dueDate: { $lt: new Date() },
      status: { $nin: ['delivered', 'cancelled'] }
    });

    // Jobs by channel
    const channelStats = await Job.aggregate([
      {
        $group: {
          _id: '$channel',
          count: { $sum: 1 }
        }
      }
    ]);

    statistics.jobsByChannel = channelStats.reduce((acc, s) => {
      acc[s._id] = s.count;
      return acc;
    }, {});

    // Role-specific statistics
    if (userRoles.includes('super_admin') || userRoles.includes('admin')) {
      // Order statistics
      statistics.totalOrders = await MarketplaceOrder.countDocuments();
      statistics.todayOrders = await MarketplaceOrder.countDocuments({
        createdAt: { $gte: today }
      });

      // User statistics
      statistics.totalUsers = await User.countDocuments({ isActive: true });

      // Failed notifications today
      statistics.failedNotifications = await NotificationLog.countDocuments({
        status: 'failed',
        createdAt: { $gte: today }
      });

      // Pending CAD reviews
      statistics.pendingCADReviews = await Job.countDocuments({
        status: 'cad_submitted'
      });

      // Pending manufacturing assignment
      statistics.pendingManufacturing = await Job.countDocuments({
        status: { $in: ['components_issued', 'cad_approved'] },
        manufacturer: null
      });

      // Ready for delivery
      statistics.readyForDelivery = await Job.countDocuments({
        status: { $in: ['manufacturing_ready_delivery', 'ready_for_pickup'] }
      });
    }

    // Designer-specific statistics
    if (userRoles.includes('designer')) {
      statistics.myCADTasks = await Job.countDocuments({
        cadDesigner: req.userId,
        status: { $in: ['cad_assigned', 'cad_in_progress', 'cad_rejected'] }
      });

      statistics.myPendingCAD = await Job.countDocuments({
        cadDesigner: req.userId,
        status: 'cad_assigned'
      });
    }

    // Manufacturer-specific statistics
    if (userRoles.includes('manufacturer')) {
      statistics.myManufacturingJobs = await Job.countDocuments({
        manufacturer: req.userId,
        status: { $in: ['manufacturing_assigned', 'manufacturing_accepted', 'manufacturing_in_progress'] }
      });

      statistics.myPendingAcceptance = await Job.countDocuments({
        manufacturer: req.userId,
        status: 'manufacturing_assigned'
      });
    }

    res.json({
      success: true,
      data: statistics
    });
  } catch (error) {
    console.error('Get dashboard statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
};

// Get recent activities
exports.getRecentActivities = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    // Get recent job status changes
    const recentJobs = await Job.find()
      .select('jobCode status channel sku updatedAt')
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit));

    // Get recent orders
    const recentOrders = await MarketplaceOrder.find()
      .select('externalOrderId channel buyerName createdAt')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: {
        jobs: recentJobs,
        orders: recentOrders
      }
    });
  } catch (error) {
    console.error('Get recent activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activities'
    });
  }
};

// Get job trends (last 7 days)
exports.getJobTrends = async (req, res) => {
  try {
    const days = 7;
    const trends = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const created = await Job.countDocuments({
        createdAt: { $gte: date, $lt: nextDate }
      });

      const completed = await Job.countDocuments({
        status: 'delivered',
        updatedAt: { $gte: date, $lt: nextDate }
      });

      trends.push({
        date: date.toISOString().split('T')[0],
        created,
        completed
      });
    }

    res.json({
      success: true,
      data: trends
    });
  } catch (error) {
    console.error('Get job trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trends'
    });
  }
};

// Get urgent jobs
exports.getUrgentJobs = async (req, res) => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const urgentJobs = await Job.find({
      status: { $nin: ['delivered', 'cancelled'] },
      $or: [
        { priority: 'urgent' },
        { dueDate: { $lt: tomorrow } }
      ]
    })
      .populate('cadDesigner', 'name')
      .populate('manufacturer', 'name')
      .sort({ dueDate: 1, priority: -1 })
      .limit(20);

    res.json({
      success: true,
      data: urgentJobs
    });
  } catch (error) {
    console.error('Get urgent jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch urgent jobs'
    });
  }
};
