const path = require('path');
const { Job, CADFile, JobStatusLog, AuditLog, SkuMaster } = require('../models');
const notificationService = require('../services/notification.service');
const pdfService = require('../services/pdf.service');

// Assign CAD designer to job
exports.assignCAD = async (req, res) => {
  try {
    const { designerId, deadline, notes, customerRequest, priority } = req.body;

    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    const oldStatus = job.status;
    job.cadDesigner = designerId;
    job.cadAssignedAt = new Date();
    job.cadDeadline = deadline ? new Date(deadline) : null;
    job.cadNotes = notes;
    if (customerRequest) job.customerRequest = customerRequest;
    if (priority) job.priority = priority;
    job.status = 'cad_assigned';

    await job.save();

    // Create status log
    await JobStatusLog.create({
      job: job._id,
      statusFrom: oldStatus,
      statusTo: 'cad_assigned',
      changedBy: req.userId,
      remarks: `CAD assigned to designer`
    });

    // Send notification
    await notificationService.sendStatusChangeNotification(job, oldStatus, 'cad_assigned', req.userId);

    await AuditLog.log({
      user: req.userId,
      action: 'cad_upload',
      entity: 'job',
      entityId: job._id,
      description: `CAD assigned for job: ${job.jobCode}`,
      newValues: { designerId, deadline, notes },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    const updatedJob = await Job.findById(job._id)
      .populate('cadDesigner', 'name email phone');

    res.json({
      success: true,
      message: 'CAD designer assigned successfully',
      data: updatedJob
    });
  } catch (error) {
    console.error('Assign CAD error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign CAD designer'
    });
  }
};

// Upload CAD files
exports.uploadFiles = async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if user is assigned or is admin
    const userRoles = req.user.roles.map(r => r.name);
    const isAdmin = userRoles.includes('admin') || userRoles.includes('super_admin');
    const isAssigned = job.cadDesigner?.toString() === req.userId.toString();

    if (!isAdmin && !isAssigned) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this job'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const uploadedFiles = [];

    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      let fileType = 'other';

      if (ext === '.stl' || ext === '.obj' || ext === '.step') {
        fileType = 'stl';
      } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
        fileType = 'image';
      }

      const cadFile = await CADFile.create({
        job: job._id,
        uploadedBy: req.userId,
        filePath: `/uploads/cad/${file.filename}`,
        fileName: file.originalname,
        fileType,
        mimeType: file.mimetype,
        fileSize: file.size,
        comments: req.body.comments
      });

      uploadedFiles.push(cadFile);
    }

    // Check if an STL file was uploaded to auto-approve (if desired)
    const hasStl = uploadedFiles.some(f => f.fileType === 'stl');
    if (hasStl) {
      const oldStatus = job.status;
      job.status = 'cad_approved';
      job.cadCompletedAt = new Date();
      job.hasCadFile = true;
      job.cadFilePath = uploadedFiles.find(f => f.fileType === 'stl').filePath;
      await job.save();

      await JobStatusLog.create({
        job: job._id,
        statusFrom: oldStatus,
        statusTo: 'cad_approved',
        changedBy: req.userId,
        remarks: 'Auto-approved after STL upload'
      });

      // Also update SKU Master if it exists
      if (job.sku) {
        const skuMaster = await SkuMaster.findOne({ sku: job.sku.toUpperCase() });
        if (skuMaster) {
          skuMaster.hasCadFile = true;
          skuMaster.cadFile = {
            fileName: uploadedFiles.find(f => f.fileType === 'stl').fileName,
            filePath: uploadedFiles.find(f => f.fileType === 'stl').filePath,
            uploadedAt: new Date(),
            uploadedBy: req.userId
          };
          await skuMaster.save();
        }
      }

      // Generate PDF Job Sheet
      try {
        const fullJob = await Job.findById(job._id).populate('order');
        await pdfService.generateJobSheet(fullJob);
      } catch (err) {
        console.error('Failed to generate Job Sheet PDF:', err);
      }
    } else if (job.status === 'cad_assigned') {
      job.status = 'cad_in_progress';
      await job.save();

      await JobStatusLog.create({
        job: job._id,
        statusFrom: 'cad_assigned',
        statusTo: 'cad_in_progress',
        changedBy: req.userId,
        remarks: 'CAD files uploaded'
      });
    }

    await AuditLog.log({
      user: req.userId,
      action: 'cad_upload',
      entity: 'cad',
      entityId: job._id,
      description: `Uploaded ${uploadedFiles.length} CAD files for job: ${job.jobCode}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: `${uploadedFiles.length} files uploaded successfully`,
      data: uploadedFiles
    });
  } catch (error) {
    console.error('Upload CAD files error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload files'
    });
  }
};

// Get CAD files for a job
exports.getFiles = async (req, res) => {
  try {
    const files = await CADFile.find({ job: req.params.jobId })
      .populate('uploadedBy', 'name email')
      .populate('approvedBy', 'name email')
      .sort({ version: -1, uploadedAt: -1 });

    res.json({
      success: true,
      data: files
    });
  } catch (error) {
    console.error('Get CAD files error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch files'
    });
  }
};

// Submit CAD for review
exports.submitForReview = async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    const files = await CADFile.find({ job: job._id, isLatest: true });

    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No CAD files uploaded'
      });
    }

    const oldStatus = job.status;
    job.status = 'cad_submitted';
    await job.save();

    await JobStatusLog.create({
      job: job._id,
      statusFrom: oldStatus,
      statusTo: 'cad_submitted',
      changedBy: req.userId,
      remarks: 'CAD submitted for review'
    });

    await notificationService.sendStatusChangeNotification(job, oldStatus, 'cad_submitted', req.userId);

    res.json({
      success: true,
      message: 'CAD submitted for review'
    });
  } catch (error) {
    console.error('Submit CAD for review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit for review'
    });
  }
};

// Approve CAD
exports.approveCAD = async (req, res) => {
  try {
    const { comments } = req.body;
    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Update latest CAD files as approved
    await CADFile.updateMany(
      { job: job._id, isLatest: true },
      {
        isApproved: true,
        approvedBy: req.userId,
        approvedAt: new Date(),
        comments: comments
      }
    );

    const oldStatus = job.status;
    job.status = 'cad_approved';
    job.cadCompletedAt = new Date();
    await job.save();

    await JobStatusLog.create({
      job: job._id,
      statusFrom: oldStatus,
      statusTo: 'cad_approved',
      changedBy: req.userId,
      remarks: comments || 'CAD approved'
    });

    // Generate PDF Job Sheet
    try {
      const fullJob = await Job.findById(job._id).populate('order');
      await pdfService.generateJobSheet(fullJob);
    } catch (err) {
      console.error('Failed to generate Job Sheet PDF:', err);
    }

    await AuditLog.log({
      user: req.userId,
      action: 'cad_approve',
      entity: 'job',
      entityId: job._id,
      description: `CAD approved for job: ${job.jobCode}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    await notificationService.sendStatusChangeNotification(job, oldStatus, 'cad_approved', req.userId);

    res.json({
      success: true,
      message: 'CAD approved successfully'
    });
  } catch (error) {
    console.error('Approve CAD error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve CAD'
    });
  }
};

// Reject CAD
exports.rejectCAD = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Update latest CAD files with rejection
    await CADFile.updateMany(
      { job: job._id, isLatest: true },
      {
        rejectedBy: req.userId,
        rejectedAt: new Date(),
        rejectionReason: reason
      }
    );

    const oldStatus = job.status;
    job.status = 'cad_rejected';
    await job.save();

    await JobStatusLog.create({
      job: job._id,
      statusFrom: oldStatus,
      statusTo: 'cad_rejected',
      changedBy: req.userId,
      remarks: reason
    });

    await AuditLog.log({
      user: req.userId,
      action: 'cad_reject',
      entity: 'job',
      entityId: job._id,
      description: `CAD rejected for job: ${job.jobCode}`,
      newValues: { reason },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    await notificationService.sendStatusChangeNotification(job, oldStatus, 'cad_rejected', req.userId);

    res.json({
      success: true,
      message: 'CAD rejected'
    });
  } catch (error) {
    console.error('Reject CAD error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject CAD'
    });
  }
};

// Get pending CAD reviews
exports.getPendingReviews = async (req, res) => {
  try {
    const jobs = await Job.find({ status: 'cad_submitted' })
      .populate('cadDesigner', 'name email')
      .populate('order')
      .sort({ cadDeadline: 1, createdAt: 1 });

    res.json({
      success: true,
      data: jobs
    });
  } catch (error) {
    console.error('Get pending reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending reviews'
    });
  }
};

// Get my CAD tasks (for designers) or all CAD tasks (for admins)
exports.getMyTasks = async (req, res) => {
  try {
    const {
      status,
      search,
      priority,
      page = 1,
      limit = 10,
      sortField = 'cadDeadline',
      sortDirection = 'asc'
    } = req.query;

    // Check if user is admin/super_admin
    const userRoles = req.user.roles.map(r => r.name);
    const isAdmin = userRoles.includes('admin') || userRoles.includes('super_admin');

    const query = {};

    // Admins see all CAD tasks, designers see only their assigned tasks
    if (!isAdmin) {
      query.cadDesigner = req.userId;
    }

    // Status filter
    if (status && status !== '' && status !== 'all') {
      query.status = status;
    } else {
      query.status = { $in: ['cad_assigned', 'cad_in_progress', 'cad_submitted', 'cad_rejected'] };
    }

    // Priority filter
    if (priority && priority !== '' && priority !== 'all') {
      query.priority = priority;
    }

    // Search filter
    if (search && search.trim() !== '') {
      query.$or = [
        { jobCode: { $regex: search.trim(), $options: 'i' } },
        { productName: { $regex: search.trim(), $options: 'i' } },
        { sku: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    // Build sort object
    const sortObj = {};
    const validSortFields = ['jobCode', 'productName', 'priority', 'status', 'cadAssignedAt', 'cadDeadline', 'createdAt'];
    if (validSortFields.includes(sortField)) {
      sortObj[sortField] = sortDirection === 'asc' ? 1 : -1;
    } else {
      sortObj.cadDeadline = 1; // Default sort by deadline ascending
    }

    // Get total count for pagination
    const total = await Job.countDocuments(query);
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const pages = Math.ceil(total / limitNum);

    const jobs = await Job.find(query)
      .populate('order')
      .populate('cadDesigner', 'name email')
      .sort(sortObj)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    res.json({
      success: true,
      data: {
        tasks: jobs,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages
        }
      }
    });
  } catch (error) {
    console.error('Get my CAD tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tasks'
    });
  }
};

// Bulk update status for multiple jobs
exports.bulkUpdateStatus = async (req, res) => {
  try {
    const { jobIds, status, remarks } = req.body;

    if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Job IDs array is required'
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    // Valid CAD statuses
    const validStatuses = ['cad_assigned', 'cad_in_progress', 'cad_submitted', 'cad_approved', 'cad_rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Valid statuses: ' + validStatuses.join(', ')
      });
    }

    // Check user permissions
    const userRoles = req.user.roles.map(r => r.name);
    const isAdmin = userRoles.includes('admin') || userRoles.includes('super_admin');

    // Designer allowed statuses
    const designerAllowedStatuses = ['cad_in_progress', 'cad_submitted'];

    if (!isAdmin && !designerAllowedStatuses.includes(status)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to set this status'
      });
    }

    const results = {
      success: [],
      failed: []
    };

    for (const jobId of jobIds) {
      try {
        const job = await Job.findById(jobId);

        if (!job) {
          results.failed.push({ jobId, error: 'Job not found' });
          continue;
        }

        // For designers, check if they are assigned to the job
        if (!isAdmin) {
          if (job.cadDesigner?.toString() !== req.userId.toString()) {
            results.failed.push({ jobId, jobCode: job.jobCode, error: 'Not assigned to this job' });
            continue;
          }
        }

        const oldStatus = job.status;
        job.status = status;

        // Update timestamps based on status
        if (status === 'cad_in_progress' && !job.cadStartedAt) {
          job.cadStartedAt = new Date();
        }
        if (status === 'cad_submitted') {
          job.cadSubmittedAt = new Date();
        }
        if (status === 'cad_approved') {
          job.cadCompletedAt = new Date();
        }

        await job.save();

        // Create status log
        await JobStatusLog.create({
          job: job._id,
          statusFrom: oldStatus,
          statusTo: status,
          changedBy: req.userId,
          remarks: remarks || `Bulk status update to ${status}`
        });

        results.success.push({ jobId, jobCode: job.jobCode, oldStatus, newStatus: status });
      } catch (err) {
        results.failed.push({ jobId, error: err.message });
      }
    }

    // Log audit
    await AuditLog.log({
      user: req.userId,
      action: 'bulk_status_update',
      entity: 'job',
      description: `Bulk status update: ${results.success.length} succeeded, ${results.failed.length} failed`,
      newValues: { status, jobIds: results.success.map(r => r.jobCode) },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: `${results.success.length} job(s) updated successfully`,
      data: results
    });
  } catch (error) {
    console.error('Bulk update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update statuses'
    });
  }
};
