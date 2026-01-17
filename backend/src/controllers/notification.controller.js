const { NotificationLog, SystemSettings } = require('../models');

// Get notification logs
exports.getLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      channel,
      status,
      triggerType,
      jobId,
      startDate,
      endDate
    } = req.query;

    const query = {};

    if (channel) query.channel = channel;
    if (status) query.status = status;
    if (triggerType) query.triggerType = triggerType;
    if (jobId) query.job = jobId;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const total = await NotificationLog.countDocuments(query);
    const logs = await NotificationLog.find(query)
      .populate('job', 'jobCode sku')
      .populate('recipientUser', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get notification logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification logs'
    });
  }
};

// Get notification statistics
exports.getStatistics = async (req, res) => {
  try {
    const channelStats = await NotificationLog.aggregate([
      {
        $group: {
          _id: { channel: '$channel', status: '$status' },
          count: { $sum: 1 }
        }
      }
    ]);

    const triggerStats = await NotificationLog.aggregate([
      {
        $group: {
          _id: '$triggerType',
          count: { $sum: 1 }
        }
      }
    ]);

    const todayStats = await NotificationLog.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        byChannel: channelStats,
        byTrigger: triggerStats.reduce((acc, t) => {
          acc[t._id] = t.count;
          return acc;
        }, {}),
        today: todayStats.reduce((acc, s) => {
          acc[s._id] = s.count;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('Get notification statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
};

// Retry failed notification
exports.retryNotification = async (req, res) => {
  try {
    const notification = await NotificationLog.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    if (notification.status !== 'failed') {
      return res.status(400).json({
        success: false,
        message: 'Only failed notifications can be retried'
      });
    }

    // Retry based on channel
    const notificationService = require('../services/notification.service');

    let result;
    if (notification.channel === 'whatsapp') {
      result = await notificationService.sendWhatsApp(
        notification.recipient,
        notification.message,
        notification.job,
        notification.triggerType
      );
    } else if (notification.channel === 'email') {
      result = await notificationService.sendEmail(
        notification.recipient,
        notification.subject,
        notification.message,
        notification.job,
        notification.triggerType
      );
    }

    // Update retry count
    notification.retryCount += 1;
    await notification.save();

    res.json({
      success: result.success,
      message: result.message
    });
  } catch (error) {
    console.error('Retry notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retry notification'
    });
  }
};

// Get failed notifications
exports.getFailedNotifications = async (req, res) => {
  try {
    const notifications = await NotificationLog.find({ status: 'failed' })
      .populate('job', 'jobCode sku')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('Get failed notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
};
