const { Job, DeliveryDetails, JobStatusLog, AuditLog } = require('../models');
const notificationService = require('../services/notification.service');

// Create/Update delivery details
exports.createDelivery = async (req, res) => {
  try {
    const {
      deliveryType,
      deliveryPersonName,
      handDeliveryDateTime,
      courierName,
      trackingNumber,
      dispatchedAt,
      deliveredTo,
      deliveryAddress,
      remarks
    } = req.body;

    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if delivery details already exist
    let deliveryDetails = await DeliveryDetails.findOne({ job: job._id });

    const isNew = !deliveryDetails;

    if (isNew) {
      deliveryDetails = new DeliveryDetails({ job: job._id });
    }

    deliveryDetails.deliveryType = deliveryType;
    deliveryDetails.deliveredTo = deliveredTo;
    deliveryDetails.deliveryAddress = deliveryAddress;
    deliveryDetails.remarks = remarks;

    if (deliveryType === 'hand') {
      deliveryDetails.deliveryPersonName = deliveryPersonName;
      deliveryDetails.handDeliveryDateTime = handDeliveryDateTime ? new Date(handDeliveryDateTime) : null;
    } else {
      deliveryDetails.courierName = courierName;
      deliveryDetails.trackingNumber = trackingNumber;
      deliveryDetails.dispatchedAt = dispatchedAt ? new Date(dispatchedAt) : new Date();
    }

    deliveryDetails.createdBy = isNew ? req.userId : deliveryDetails.createdBy;
    deliveryDetails.updatedBy = req.userId;

    await deliveryDetails.save();

    // Update job status
    const oldStatus = job.status;
    if (deliveryType === 'courier' && trackingNumber) {
      job.status = 'shipped';
    } else {
      job.status = 'ready_for_pickup';
    }
    await job.save();

    await JobStatusLog.create({
      job: job._id,
      statusFrom: oldStatus,
      statusTo: job.status,
      changedBy: req.userId,
      remarks: deliveryType === 'courier'
        ? `Shipped via ${courierName}, Tracking: ${trackingNumber}`
        : `Ready for hand delivery by ${deliveryPersonName}`
    });

    await notificationService.sendStatusChangeNotification(job, oldStatus, job.status, req.userId);

    await AuditLog.log({
      user: req.userId,
      action: 'delivery_update',
      entity: 'job',
      entityId: job._id,
      description: `Delivery details ${isNew ? 'created' : 'updated'} for job: ${job.jobCode}`,
      newValues: req.body,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: `Delivery details ${isNew ? 'created' : 'updated'} successfully`,
      data: deliveryDetails
    });
  } catch (error) {
    console.error('Create delivery error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save delivery details'
    });
  }
};

// Mark as delivered
exports.markDelivered = async (req, res) => {
  try {
    const { deliveredAt, remarks, proofOfDelivery } = req.body;

    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    const deliveryDetails = await DeliveryDetails.findOne({ job: job._id });

    if (!deliveryDetails) {
      return res.status(400).json({
        success: false,
        message: 'Delivery details not found. Please create delivery first.'
      });
    }

    deliveryDetails.deliveredAt = deliveredAt ? new Date(deliveredAt) : new Date();
    if (remarks) deliveryDetails.remarks = remarks;
    if (proofOfDelivery) deliveryDetails.proofOfDelivery = proofOfDelivery;
    deliveryDetails.updatedBy = req.userId;

    await deliveryDetails.save();

    const oldStatus = job.status;
    job.status = 'delivered';
    await job.save();

    await JobStatusLog.create({
      job: job._id,
      statusFrom: oldStatus,
      statusTo: 'delivered',
      changedBy: req.userId,
      remarks: remarks || 'Delivered successfully'
    });

    await notificationService.sendDeliveryNotification(job, deliveryDetails);

    await AuditLog.log({
      user: req.userId,
      action: 'delivery_update',
      entity: 'job',
      entityId: job._id,
      description: `Job ${job.jobCode} marked as delivered`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Job marked as delivered'
    });
  } catch (error) {
    console.error('Mark delivered error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark as delivered'
    });
  }
};

// Get delivery details for a job
exports.getDeliveryDetails = async (req, res) => {
  try {
    const deliveryDetails = await DeliveryDetails.findOne({ job: req.params.jobId })
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!deliveryDetails) {
      return res.status(404).json({
        success: false,
        message: 'Delivery details not found'
      });
    }

    res.json({
      success: true,
      data: deliveryDetails
    });
  } catch (error) {
    console.error('Get delivery details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery details'
    });
  }
};

// Get pending deliveries
exports.getPendingDeliveries = async (req, res) => {
  try {
    const jobs = await Job.find({
      status: { $in: ['manufacturing_ready_delivery', 'ready_for_pickup', 'shipped'] }
    })
      .populate('order')
      .populate('manufacturer', 'name')
      .sort({ dueDate: 1, createdAt: 1 });

    // Get delivery details for each job
    const jobIds = jobs.map(j => j._id);
    const deliveryDetails = await DeliveryDetails.find({ job: { $in: jobIds } });
    const deliveryMap = deliveryDetails.reduce((acc, d) => {
      acc[d.job.toString()] = d;
      return acc;
    }, {});

    const result = jobs.map(job => ({
      ...job.toObject(),
      deliveryDetails: deliveryMap[job._id.toString()] || null
    }));

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get pending deliveries error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending deliveries'
    });
  }
};

// Get delivered jobs
exports.getDeliveredJobs = async (req, res) => {
  try {
    const { page = 1, limit = 10, startDate, endDate, deliveryType } = req.query;

    const query = { status: 'delivered' };

    if (startDate || endDate) {
      query.updatedAt = {};
      if (startDate) query.updatedAt.$gte = new Date(startDate);
      if (endDate) query.updatedAt.$lte = new Date(endDate);
    }

    const total = await Job.countDocuments(query);
    const jobs = await Job.find(query)
      .populate('order')
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Get delivery details
    const jobIds = jobs.map(j => j._id);
    const deliveryDetails = await DeliveryDetails.find({
      job: { $in: jobIds },
      ...(deliveryType ? { deliveryType } : {})
    });
    const deliveryMap = deliveryDetails.reduce((acc, d) => {
      acc[d.job.toString()] = d;
      return acc;
    }, {});

    const result = jobs
      .map(job => ({
        ...job.toObject(),
        deliveryDetails: deliveryMap[job._id.toString()] || null
      }))
      .filter(job => !deliveryType || job.deliveryDetails);

    res.json({
      success: true,
      data: {
        jobs: result,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get delivered jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch delivered jobs'
    });
  }
};

// Get overdue deliveries
exports.getOverdueDeliveries = async (req, res) => {
  try {
    const jobs = await Job.find({
      status: { $nin: ['delivered', 'cancelled'] },
      dueDate: { $lt: new Date() }
    })
      .populate('order')
      .populate('cadDesigner', 'name')
      .populate('manufacturer', 'name')
      .sort({ dueDate: 1 });

    res.json({
      success: true,
      data: jobs
    });
  } catch (error) {
    console.error('Get overdue deliveries error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch overdue deliveries'
    });
  }
};
