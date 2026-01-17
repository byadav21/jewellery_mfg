const path = require('path');
const { Job, ProductionFile, JobStatusLog, AuditLog, SkuMaster, MarketplaceOrderItem, SystemSettings, User, Role } = require('../models');
const notificationService = require('../services/notification.service');

// Helper function to calculate TAT deadline
async function calculateTATDeadline(tatType) {
  const tatHours = await SystemSettings.getSetting(`tat_${tatType}_hours`) || 48;
  const deadline = new Date();
  deadline.setHours(deadline.getHours() + tatHours);
  return deadline;
}

// Helper function to get random Production Coordinator
async function getRandomProductionCoordinator() {
  const adminRole = await Role.findOne({ name: 'admin' });
  if (!adminRole) return null;

  const admins = await User.find({
    roles: adminRole._id,
    isActive: true
  }).select('_id name email');

  if (admins.length === 0) return null;

  // Return random admin for load distribution
  const randomIndex = Math.floor(Math.random() * admins.length);
  return admins[randomIndex];
}

// Assign manufacturer to job
exports.assignManufacturer = async (req, res) => {
  try {
    const { manufacturerId, deadline, notes } = req.body;

    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if components are issued
    if (!['components_issued', 'cad_approved'].includes(job.status)) {
      return res.status(400).json({
        success: false,
        message: 'Components must be issued before assigning manufacturer'
      });
    }

    // Check if job has CAD/STL file before assigning manufacturer
    let hasCadFile = !!(job.cadFilePath || job.hasCadFile);

    // Also check SkuMaster if job has SKU
    if (!hasCadFile && job.sku) {
      const skuMaster = await SkuMaster.findOne({ sku: job.sku.toUpperCase(), isActive: true });
      hasCadFile = !!(skuMaster?.hasCadFile || skuMaster?.cadFile?.filePath);
    }

    if (!hasCadFile) {
      return res.status(400).json({
        success: false,
        message: `Cannot assign manufacturer without CAD/STL file. Job ${job.jobCode} (SKU: ${job.sku || 'N/A'}) has no CAD file.`
      });
    }

    const oldStatus = job.status;
    job.manufacturer = manufacturerId;
    job.manufacturingAssignedAt = new Date();

    // Calculate TAT deadline if not provided
    if (deadline) {
      job.manufacturingDeadline = new Date(deadline);
    } else {
      job.manufacturingDeadline = await calculateTATDeadline('manufacturing');
    }

    job.manufacturingNotes = notes;
    job.status = 'manufacturing_assigned';

    // Auto-assign Production Coordinator if not already assigned
    if (!job.productionCoordinator) {
      const coordinator = await getRandomProductionCoordinator();
      if (coordinator) {
        job.productionCoordinator = coordinator._id;
        job.productionCoordinatorAssignedAt = new Date();
        job.productionCoordinatorDeadline = await calculateTATDeadline('production_coordinator');
      }
    }

    await job.save();

    await JobStatusLog.create({
      job: job._id,
      statusFrom: oldStatus,
      statusTo: 'manufacturing_assigned',
      changedBy: req.userId,
      remarks: 'Manufacturer assigned'
    });

    await notificationService.sendStatusChangeNotification(job, oldStatus, 'manufacturing_assigned', req.userId);

    await AuditLog.log({
      user: req.userId,
      action: 'manufacturing_assign',
      entity: 'job',
      entityId: job._id,
      description: `Manufacturer assigned for job: ${job.jobCode}`,
      newValues: { manufacturerId, deadline, notes },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    const updatedJob = await Job.findById(job._id)
      .populate('manufacturer', 'name email phone');

    res.json({
      success: true,
      message: 'Manufacturer assigned successfully',
      data: updatedJob
    });
  } catch (error) {
    console.error('Assign manufacturer error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign manufacturer'
    });
  }
};

// Accept job (manufacturer)
exports.acceptJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Verify manufacturer
    if (job.manufacturer?.toString() !== req.userId.toString()) {
      const userRoles = req.user.roles.map(r => r.name);
      if (!userRoles.includes('admin') && !userRoles.includes('super_admin')) {
        return res.status(403).json({
          success: false,
          message: 'You are not assigned to this job'
        });
      }
    }

    if (job.status !== 'manufacturing_assigned') {
      return res.status(400).json({
        success: false,
        message: 'Job is not in the correct status to accept'
      });
    }

    const oldStatus = job.status;
    job.status = 'manufacturing_accepted';
    job.manufacturingAcceptedAt = new Date();
    await job.save();

    await JobStatusLog.create({
      job: job._id,
      statusFrom: oldStatus,
      statusTo: 'manufacturing_accepted',
      changedBy: req.userId,
      remarks: 'Job accepted by manufacturer'
    });

    await notificationService.sendStatusChangeNotification(job, oldStatus, 'manufacturing_accepted', req.userId);

    res.json({
      success: true,
      message: 'Job accepted'
    });
  } catch (error) {
    console.error('Accept job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept job'
    });
  }
};

// Start manufacturing
exports.startWork = async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.status !== 'manufacturing_accepted') {
      return res.status(400).json({
        success: false,
        message: 'Job must be accepted first'
      });
    }

    const oldStatus = job.status;
    job.status = 'manufacturing_in_progress';
    await job.save();

    await JobStatusLog.create({
      job: job._id,
      statusFrom: oldStatus,
      statusTo: 'manufacturing_in_progress',
      changedBy: req.userId,
      remarks: 'Manufacturing started'
    });

    await notificationService.sendStatusChangeNotification(job, oldStatus, 'manufacturing_in_progress', req.userId);

    res.json({
      success: true,
      message: 'Manufacturing started'
    });
  } catch (error) {
    console.error('Start work error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start work'
    });
  }
};

// Mark ready for QC
exports.markReadyForQC = async (req, res) => {
  try {
    const { remarks } = req.body;

    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.status !== 'manufacturing_in_progress') {
      return res.status(400).json({
        success: false,
        message: 'Job must be in progress'
      });
    }

    const oldStatus = job.status;
    job.status = 'manufacturing_ready_qc';
    await job.save();

    await JobStatusLog.create({
      job: job._id,
      statusFrom: oldStatus,
      statusTo: 'manufacturing_ready_qc',
      changedBy: req.userId,
      remarks: remarks || 'Ready for QC'
    });

    await notificationService.sendStatusChangeNotification(job, oldStatus, 'manufacturing_ready_qc', req.userId);

    res.json({
      success: true,
      message: 'Marked ready for QC'
    });
  } catch (error) {
    console.error('Mark ready for QC error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status'
    });
  }
};

// Mark ready for delivery
exports.markReadyForDelivery = async (req, res) => {
  try {
    const { remarks } = req.body;

    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    const oldStatus = job.status;
    job.status = 'manufacturing_ready_delivery';
    job.manufacturingCompletedAt = new Date();
    await job.save();

    await JobStatusLog.create({
      job: job._id,
      statusFrom: oldStatus,
      statusTo: 'manufacturing_ready_delivery',
      changedBy: req.userId,
      remarks: remarks || 'Manufacturing complete, ready for delivery'
    });

    await notificationService.sendStatusChangeNotification(job, oldStatus, 'manufacturing_ready_delivery', req.userId);

    res.json({
      success: true,
      message: 'Marked ready for delivery'
    });
  } catch (error) {
    console.error('Mark ready for delivery error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status'
    });
  }
};

// Upload production files
exports.uploadFiles = async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const uploadedFiles = [];
    const stage = req.body.stage || 'final';

    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      let fileType = 'other';

      if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
        fileType = 'image';
      } else if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) {
        fileType = 'video';
      }

      const productionFile = await ProductionFile.create({
        job: job._id,
        uploadedBy: req.userId,
        filePath: `/uploads/production/${file.filename}`,
        fileName: file.originalname,
        fileType,
        mimeType: file.mimetype,
        fileSize: file.size,
        remarks: req.body.remarks,
        stage
      });

      uploadedFiles.push(productionFile);
    }

    res.json({
      success: true,
      message: `${uploadedFiles.length} files uploaded successfully`,
      data: uploadedFiles
    });
  } catch (error) {
    console.error('Upload production files error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload files'
    });
  }
};

// Get production files
exports.getFiles = async (req, res) => {
  try {
    const files = await ProductionFile.find({ job: req.params.jobId })
      .populate('uploadedBy', 'name email')
      .sort({ uploadedAt: -1 });

    res.json({
      success: true,
      data: files
    });
  } catch (error) {
    console.error('Get production files error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch files'
    });
  }
};

// Get my manufacturing jobs (for manufacturers)
exports.getMyJobs = async (req, res) => {
  try {
    const { status } = req.query;

    const query = {
      manufacturer: req.userId
    };

    if (status) {
      query.status = status;
    } else {
      query.status = {
        $in: [
          'manufacturing_assigned',
          'manufacturing_accepted',
          'manufacturing_in_progress',
          'manufacturing_ready_qc',
          'manufacturing_ready_delivery'
        ]
      };
    }

    const jobs = await Job.find(query)
      .populate('order')
      .populate('cadDesigner', 'name')
      .sort({ manufacturingDeadline: 1, priority: -1, createdAt: 1 });

    res.json({
      success: true,
      data: jobs
    });
  } catch (error) {
    console.error('Get my manufacturing jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch jobs'
    });
  }
};

// Get jobs pending manufacturing assignment
exports.getPendingAssignment = async (req, res) => {
  try {
    const jobs = await Job.find({
      status: { $in: ['components_issued', 'cad_approved'] },
      manufacturer: null
    })
      .populate('cadDesigner', 'name email')
      .populate('order')
      .sort({ dueDate: 1, createdAt: 1 });

    res.json({
      success: true,
      data: jobs
    });
  } catch (error) {
    console.error('Get pending assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch jobs'
    });
  }
};
