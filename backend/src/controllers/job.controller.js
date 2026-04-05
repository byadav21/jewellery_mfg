const { Job, JobStatusLog, MarketplaceOrder, MarketplaceOrderItem, AuditLog, SkuMaster, ProductionFile } = require('../models');
const notificationService = require('../services/notification.service');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

// Status -> allowed sub-statuses mapping
const STATUS_SUB_STATUS_MAP = {
  new: ['Pending Review', 'Awaiting Assignment'],
  cad_assigned: ['Awaiting Designer', 'Design Brief Sent'],
  cad_in_progress: ['Sketching', 'Modeling', 'Rendering', 'Revision'],
  cad_submitted: ['Pending Review', 'Under Review'],
  cad_approved: ['Approved', 'Ready for Manufacturing'],
  cad_rejected: ['Needs Revision', 'Major Changes', 'Minor Changes'],
  components_issued: ['Materials Prepared', 'Waiting Components', 'Components Ready'],
  manufacturing_assigned: ['Awaiting Acceptance', 'Notified'],
  manufacturing_accepted: ['Planning', 'Preparing Materials'],
  manufacturing_in_progress: ['Casting', 'Setting', 'Polishing', 'Engraving', 'Assembly', 'Custom Work'],
  manufacturing_ready_qc: ['QC Pending', 'QC In Progress', 'QC Passed', 'QC Failed - Rework'],
  manufacturing_ready_delivery: ['Final Inspection', 'Packaging', 'Ready to Ship'],
  ready_for_pickup: ['Awaiting Pickup', 'Pickup Scheduled'],
  shipped: ['In Transit', 'Out for Delivery'],
  delivered: ['Delivered', 'Confirmed'],
  cancelled: ['Customer Request', 'Quality Issue', 'Other']
};

// Export for use in routes
exports.STATUS_SUB_STATUS_MAP = STATUS_SUB_STATUS_MAP;

// Get sub-status options for a status
exports.getSubStatusOptions = async (req, res) => {
  res.json({
    success: true,
    data: STATUS_SUB_STATUS_MAP
  });
};

// Update sub-status
exports.updateSubStatus = async (req, res) => {
  try {
    const { subStatus, remarks } = req.body;
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (!subStatus) {
      return res.status(400).json({ success: false, message: 'Sub-status is required' });
    }

    // Validate sub-status belongs to current status
    const allowedSubStatuses = STATUS_SUB_STATUS_MAP[job.status] || [];
    if (allowedSubStatuses.length > 0 && !allowedSubStatuses.includes(subStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid sub-status "${subStatus}" for status "${job.status}". Allowed: ${allowedSubStatuses.join(', ')}`
      });
    }

    const oldSubStatus = job.subStatus;
    job.subStatus = subStatus;
    job.subStatusHistory.push({
      subStatus,
      changedBy: req.userId,
      changedAt: new Date(),
      remarks
    });
    await job.save();

    await AuditLog.log({
      user: req.userId,
      action: 'status_change',
      entity: 'job',
      entityId: job._id,
      description: `Sub-status changed: ${oldSubStatus || 'none'} -> ${subStatus} (status: ${job.status})`,
      oldValues: { subStatus: oldSubStatus },
      newValues: { subStatus },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Sub-status updated successfully',
      data: job
    });
  } catch (error) {
    console.error('Update sub-status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update sub-status' });
  }
};

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
        { productName: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } }
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
      .populate('orderItem')
      .lean();

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Enrich with SkuMaster CAD file info if job has SKU
    if (job.sku) {
      const skuMaster = await SkuMaster.findOne({ sku: job.sku.toUpperCase(), isActive: true }).lean();
      if (skuMaster) {
        job.skuMasterRef = skuMaster._id;
        // If job doesn't have CAD file but SkuMaster does, populate from SkuMaster
        if (!job.hasCadFile && skuMaster.hasCadFile) {
          job.hasCadFile = true;
          job.cadFilePath = skuMaster.cadFile?.filePath || null;
          job.cadFileName = skuMaster.cadFile?.fileName || null;
        }
        // Always provide SkuMaster CAD info for reference
        job.skuMasterCad = {
          hasCadFile: skuMaster.hasCadFile || false,
          cadFilePath: skuMaster.cadFile?.filePath || null,
          cadFileName: skuMaster.cadFile?.fileName || null
        };
        // Provide product images from SkuMaster
        if (skuMaster.images && skuMaster.images.length > 0) {
          job.skuMasterImages = skuMaster.images;
        }
      }
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

    // Check if changing to cad_submitted - require STL/CAD file upload
    if (status === 'cad_submitted') {
      let hasCadFile = !!(job.cadFilePath || job.hasCadFile);

      if (!hasCadFile && job.sku) {
        const skuMaster = await SkuMaster.findOne({ sku: job.sku.toUpperCase(), isActive: true });
        hasCadFile = !!(skuMaster?.hasCadFile || skuMaster?.cadFile?.filePath);
      }

      if (!hasCadFile) {
        const isSuperAdmin = req.user?.roles?.some(r => r.name === 'super_admin');
        if (!isSuperAdmin) {
          return res.status(400).json({
            success: false,
            message: `Please upload the STL/CAD file before submitting job ${job.jobCode} (SKU: ${job.sku || 'N/A'}). Status cannot be changed to "CAD Submitted" without a file.`
          });
        }
      }
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
    // Reset sub-status when main status changes
    job.subStatus = null;
    await job.save();

    // Propagate job status to parent Order's status
    if (job.order) {
      const processingStatuses = [
        'cad_assigned', 'cad_in_progress', 'cad_submitted', 'cad_approved', 'cad_rejected',
        'components_issued', 'manufacturing_assigned', 'manufacturing_accepted',
        'manufacturing_in_progress', 'manufacturing_ready_qc', 'manufacturing_ready_delivery'
      ];
      if (processingStatuses.includes(status)) {
        await MarketplaceOrder.findByIdAndUpdate(job.order, { status: 'processing' });
      } else if (status === 'delivered') {
        // Only mark order delivered if all its jobs are delivered
        const allJobs = await Job.find({ order: job.order });
        const allDelivered = allJobs.every(j => j.status === 'delivered');
        if (allDelivered) {
          await MarketplaceOrder.findByIdAndUpdate(job.order, { status: 'delivered' });
        }
      } else if (status === 'cancelled') {
        const allJobs = await Job.find({ order: job.order });
        const allCancelled = allJobs.every(j => j.status === 'cancelled');
        if (allCancelled) {
          await MarketplaceOrder.findByIdAndUpdate(job.order, { status: 'cancelled' });
        }
      }
    }

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

// Download product images as ZIP (for a job's SKU)
exports.downloadProductImagesZip = async (req, res) => {
  try {
    const { type } = req.query; // 'product', 'manufacturing', 'all'
    const job = await Job.findById(req.params.id).lean();

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const archive = archiver('zip', { zlib: { level: 5 } });
    const zipName = `${job.sku || job.jobCode || 'files'}_${type || 'all'}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    archive.pipe(res);

    const uploadsDir = path.join(__dirname, '../../uploads');

    // Add product images from SkuMaster
    if (type === 'product' || type === 'all' || !type) {
      if (job.sku) {
        const skuMaster = await SkuMaster.findOne({ sku: job.sku.toUpperCase(), isActive: true }).lean();
        if (skuMaster && skuMaster.images) {
          for (const img of skuMaster.images) {
            const filePath = path.join(uploadsDir, '..', img.filePath);
            if (fs.existsSync(filePath)) {
              archive.file(filePath, { name: `product-images/${img.fileName || path.basename(filePath)}` });
            }
          }
        }
        // Also add CAD file
        if (skuMaster && skuMaster.cadFile && skuMaster.cadFile.filePath) {
          const cadPath = path.join(uploadsDir, '..', skuMaster.cadFile.filePath);
          if (fs.existsSync(cadPath)) {
            archive.file(cadPath, { name: `cad/${skuMaster.cadFile.fileName || path.basename(cadPath)}` });
          }
        }
      }
    }

    // Add manufacturing/production files
    if (type === 'manufacturing' || type === 'all' || !type) {
      const prodFiles = await ProductionFile.find({ job: job._id }).lean();
      for (const file of prodFiles) {
        const filePath = path.join(uploadsDir, '..', file.filePath);
        if (fs.existsSync(filePath)) {
          const folder = file.stage === 'final' ? 'final-product' : file.stage === 'qc' ? 'qc' : 'in-progress';
          archive.file(filePath, { name: `manufacturing/${folder}/${file.fileName || path.basename(filePath)}` });
        }
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error('Download ZIP error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to create ZIP' });
    }
  }
};

// Download product images as ZIP for an order (all jobs)
exports.downloadOrderImagesZip = async (req, res) => {
  try {
    const jobs = await Job.find({ order: req.params.id }).lean();

    if (!jobs.length) {
      return res.status(404).json({ success: false, message: 'No jobs found for this order' });
    }

    const archive = archiver('zip', { zlib: { level: 5 } });
    const zipName = `order_${req.params.id.slice(-8)}_all_files.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    archive.pipe(res);

    const uploadsDir = path.join(__dirname, '../../uploads');
    const addedSkus = new Set();

    for (const job of jobs) {
      const jobFolder = job.sku || job.jobCode || job._id.toString().slice(-6);

      // Product images (deduplicate by SKU)
      if (job.sku && !addedSkus.has(job.sku.toUpperCase())) {
        addedSkus.add(job.sku.toUpperCase());
        const skuMaster = await SkuMaster.findOne({ sku: job.sku.toUpperCase(), isActive: true }).lean();
        if (skuMaster && skuMaster.images) {
          for (const img of skuMaster.images) {
            const filePath = path.join(uploadsDir, '..', img.filePath);
            if (fs.existsSync(filePath)) {
              archive.file(filePath, { name: `${jobFolder}/product-images/${img.fileName || path.basename(filePath)}` });
            }
          }
        }
        if (skuMaster && skuMaster.cadFile && skuMaster.cadFile.filePath) {
          const cadPath = path.join(uploadsDir, '..', skuMaster.cadFile.filePath);
          if (fs.existsSync(cadPath)) {
            archive.file(cadPath, { name: `${jobFolder}/cad/${skuMaster.cadFile.fileName || path.basename(cadPath)}` });
          }
        }
      }

      // Manufacturing files
      const prodFiles = await ProductionFile.find({ job: job._id }).lean();
      for (const file of prodFiles) {
        const filePath = path.join(uploadsDir, '..', file.filePath);
        if (fs.existsSync(filePath)) {
          const folder = file.stage === 'final' ? 'final-product' : file.stage === 'qc' ? 'qc' : 'in-progress';
          archive.file(filePath, { name: `${jobFolder}/manufacturing/${folder}/${file.fileName || path.basename(filePath)}` });
        }
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error('Download order ZIP error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to create ZIP' });
    }
  }
};
