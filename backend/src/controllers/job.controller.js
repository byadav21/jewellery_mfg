const { Job, JobStatusLog, MarketplaceOrderItem, AuditLog, SkuMaster } = require('../models');
const notificationService = require('../services/notification.service');

// Get all jobs
exports.getJobs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      channel,
      priority,
      cadDesigner,
      manufacturer,
      search,
      startDate,
      endDate,
      overdue
    } = req.query;

    const query = {};

    if (status) query.status = status;
    if (channel) query.channel = channel;
    if (priority) query.priority = priority;
    if (cadDesigner) query.cadDesigner = cadDesigner;
    if (manufacturer) query.manufacturer = manufacturer;

    if (search) {
      query.$or = [
        { jobCode: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { productName: { $regex: search, $options: 'i' } }
      ];
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    if (overdue === 'true') {
      query.dueDate = { $lt: new Date() };
      query.status = { $nin: ['delivered', 'cancelled'] };
    }

    // Role-based filtering
    const userRoles = req.user.roles.map(r => r.name);
    if (userRoles.includes('designer') && !userRoles.includes('admin') && !userRoles.includes('super_admin')) {
      query.cadDesigner = req.userId;
    }
    if (userRoles.includes('manufacturer') && !userRoles.includes('admin') && !userRoles.includes('super_admin')) {
      query.manufacturer = req.userId;
    }

    const total = await Job.countDocuments(query);
    const jobs = await Job.find(query)
      .populate('admin', 'name email')
      .populate('cadDesigner', 'name email')
      .populate('manufacturer', 'name email')
      .populate('order')
      .populate('orderItem')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: {
        jobs,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch jobs'
    });
  }
};

// Get single job
exports.getJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('admin', 'name email')
      .populate('cadDesigner', 'name email phone')
      .populate('manufacturer', 'name email phone')
      .populate('order')
      .populate('orderItem');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    res.json({
      success: true,
      data: job
    });
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch job'
    });
  }
};

// Create manual job
exports.createJob = async (req, res) => {
  try {
    const {
      sku,
      productName,
      quantity,
      priority,
      dueDate,
      customerName,
      customerRequest,
      remarks
    } = req.body;

    const job = await Job.create({
      sourceType: 'manual',
      channel: 'manual',
      sku,
      productName,
      quantity,
      priority,
      dueDate,
      customerName,
      customerRequest,
      remarks,
      admin: req.userId,
      status: 'new'
    });

    await AuditLog.log({
      user: req.userId,
      action: 'job_create',
      entity: 'job',
      entityId: job._id,
      description: `Created manual job: ${job.jobCode}`,
      newValues: req.body,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    const populatedJob = await Job.findById(job._id)
      .populate('admin', 'name email');

    res.status(201).json({
      success: true,
      message: 'Job created successfully',
      data: populatedJob
    });
  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create job'
    });
  }
};

// Update job
exports.updateJob = async (req, res) => {
  try {
    const { priority, dueDate, customerRequest, remarks } = req.body;

    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    const oldValues = {
      priority: job.priority,
      dueDate: job.dueDate,
      customerRequest: job.customerRequest,
      remarks: job.remarks
    };

    if (priority) job.priority = priority;
    if (dueDate) job.dueDate = dueDate;
    if (customerRequest !== undefined) job.customerRequest = customerRequest;
    if (remarks !== undefined) job.remarks = remarks;

    await job.save();

    await AuditLog.log({
      user: req.userId,
      action: 'job_update',
      entity: 'job',
      entityId: job._id,
      description: `Updated job: ${job.jobCode}`,
      oldValues,
      newValues: req.body,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    const updatedJob = await Job.findById(job._id)
      .populate('admin', 'name email')
      .populate('cadDesigner', 'name email')
      .populate('manufacturer', 'name email');

    res.json({
      success: true,
      message: 'Job updated successfully',
      data: updatedJob
    });
  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update job'
    });
  }
};

// Update job status
exports.updateStatus = async (req, res) => {
  try {
    const { status, remarks } = req.body;

    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Manufacturing statuses that require CAD file
    const manufacturingStatuses = [
      'manufacturing_assigned',
      'manufacturing_accepted',
      'manufacturing_in_progress',
      'manufacturing_ready_qc',
      'manufacturing_ready_delivery'
    ];

    // Check if changing to a manufacturing status - require CAD file
    if (manufacturingStatuses.includes(status)) {
      let hasCadFile = !!(job.cadFilePath || job.hasCadFile);

      // Also check SkuMaster if job has SKU
      if (!hasCadFile && job.sku) {
        const skuMaster = await SkuMaster.findOne({ sku: job.sku.toUpperCase(), isActive: true });
        hasCadFile = !!(skuMaster?.hasCadFile || skuMaster?.cadFile?.filePath);
      }

      if (!hasCadFile) {
        // Super Admin Bypass
        const isSuperAdmin = req.user?.roles?.some(r => r.name === 'super_admin');
        if (!isSuperAdmin) {
          return res.status(400).json({
            success: false,
            message: `Cannot change to manufacturing status without CAD/STL file. Job ${job.jobCode} (SKU: ${job.sku || 'N/A'}) has no CAD file.`
          });
        }
      }
    }

    const oldStatus = job.status;
    job.status = status;
    await job.save();

    // Create status log
    await JobStatusLog.create({
      job: job._id,
      statusFrom: oldStatus,
      statusTo: status,
      changedBy: req.userId,
      remarks
    });

    // Log status change
    await AuditLog.log({
      user: req.userId,
      action: 'status_change',
      entity: 'job',
      entityId: job._id,
      description: `Status changed: ${oldStatus} -> ${status}`,
      oldValues: { status: oldStatus },
      newValues: { status },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Send notification for status change
    await notificationService.sendStatusChangeNotification(job, oldStatus, status, req.userId);

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: job
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status'
    });
  }
};

// Get job status history
exports.getStatusHistory = async (req, res) => {
  try {
    const history = await JobStatusLog.find({ job: req.params.id })
      .populate('changedBy', 'name email')
      .sort({ changedAt: -1 });

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Get status history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch status history'
    });
  }
};

// Cancel job
exports.cancelJob = async (req, res) => {
  try {
    const { reason } = req.body;

    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.status === 'delivered') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a delivered job'
      });
    }

    const oldStatus = job.status;
    job.status = 'cancelled';
    await job.save();

    await JobStatusLog.create({
      job: job._id,
      statusFrom: oldStatus,
      statusTo: 'cancelled',
      changedBy: req.userId,
      remarks: reason
    });

    res.json({
      success: true,
      message: 'Job cancelled successfully'
    });
  } catch (error) {
    console.error('Cancel job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel job'
    });
  }
};

// Get job statistics
exports.getStatistics = async (req, res) => {
  try {
    const stats = await Job.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const channelStats = await Job.aggregate([
      {
        $group: {
          _id: '$channel',
          count: { $sum: 1 }
        }
      }
    ]);

    const overdueCount = await Job.countDocuments({
      dueDate: { $lt: new Date() },
      status: { $nin: ['delivered', 'cancelled'] }
    });

    const todayCount = await Job.countDocuments({
      createdAt: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0))
      }
    });

    res.json({
      success: true,
      data: {
        byStatus: stats.reduce((acc, s) => {
          acc[s._id] = s.count;
          return acc;
        }, {}),
        byChannel: channelStats.reduce((acc, s) => {
          acc[s._id] = s.count;
          return acc;
        }, {}),
        overdue: overdueCount,
        today: todayCount
      }
    });
  } catch (error) {
    console.error('Get statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
};
