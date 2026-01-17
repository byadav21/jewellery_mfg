const { AuditLog, User } = require('../models');

// Get all audit logs with filters
exports.getLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      action,
      entity,
      entityId,
      userId,
      search,
      startDate,
      endDate
    } = req.query;

    const query = {};

    if (action) query.action = action;
    if (entity) query.entity = entity;
    if (entityId) query.entityId = entityId;
    if (userId) query.user = userId;

    if (search) {
      query.$or = [
        { description: { $regex: search, $options: 'i' } },
        { action: { $regex: search, $options: 'i' } }
      ];
    }

    if (startDate || endDate) {
      query.performedAt = {};
      if (startDate) query.performedAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.performedAt.$lte = end;
      }
    }

    const total = await AuditLog.countDocuments(query);
    const logs = await AuditLog.find(query)
      .populate('user', 'name email')
      .sort({ performedAt: -1 })
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
    console.error('Get audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit logs'
    });
  }
};

// Get logs for a specific entity (e.g., order history)
exports.getEntityLogs = async (req, res) => {
  try {
    const { entity, entityId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const query = { entity, entityId };

    const total = await AuditLog.countDocuments(query);
    const logs = await AuditLog.find(query)
      .populate('user', 'name email')
      .sort({ performedAt: -1 })
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
    console.error('Get entity logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch entity logs'
    });
  }
};

// Get log statistics
exports.getStatistics = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Count by action type
    const actionStats = await AuditLog.aggregate([
      { $match: { performedAt: { $gte: startDate } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Count by entity type
    const entityStats = await AuditLog.aggregate([
      { $match: { performedAt: { $gte: startDate } } },
      { $group: { _id: '$entity', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Count by user
    const userStats = await AuditLog.aggregate([
      { $match: { performedAt: { $gte: startDate } } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // Populate user names
    const userIds = userStats.map(s => s._id).filter(id => id);
    const users = await User.find({ _id: { $in: userIds } }).select('name email');
    const userMap = users.reduce((acc, u) => { acc[u._id.toString()] = u; return acc; }, {});

    const userStatsWithNames = userStats.map(s => ({
      ...s,
      user: s._id ? userMap[s._id.toString()] : null
    }));

    // Daily activity for the period
    const dailyActivity = await AuditLog.aggregate([
      { $match: { performedAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$performedAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Total counts
    const totalLogs = await AuditLog.countDocuments({ performedAt: { $gte: startDate } });
    const totalToday = await AuditLog.countDocuments({
      performedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    });

    res.json({
      success: true,
      data: {
        byAction: actionStats.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
        byEntity: entityStats.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
        byUser: userStatsWithNames,
        dailyActivity,
        total: totalLogs,
        today: totalToday
      }
    });
  } catch (error) {
    console.error('Get audit statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
};

// Get available action types for filtering
exports.getActionTypes = async (req, res) => {
  try {
    const actions = await AuditLog.distinct('action');
    res.json({
      success: true,
      data: actions
    });
  } catch (error) {
    console.error('Get action types error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch action types'
    });
  }
};

// Get available entity types for filtering
exports.getEntityTypes = async (req, res) => {
  try {
    const entities = await AuditLog.distinct('entity');
    res.json({
      success: true,
      data: entities.filter(e => e)
    });
  } catch (error) {
    console.error('Get entity types error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch entity types'
    });
  }
};
