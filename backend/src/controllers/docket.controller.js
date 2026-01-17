const { Docket, Job, AuditLog, User } = require('../models');

/**
 * Create a new batch docket
 */
exports.createDocket = async (req, res) => {
    try {
        const { jobIds, manufacturerId, notes, metadata } = req.body;

        if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'At least one job is required for a docket'
            });
        }

        if (!manufacturerId) {
            return res.status(400).json({
                success: false,
                message: 'Manufacturer is required'
            });
        }

        // Check if manufacturer exists
        const manufacturer = await User.findById(manufacturerId);
        if (!manufacturer) {
            return res.status(404).json({
                success: false,
                message: 'Manufacturer not found'
            });
        }

        // Generate docket number
        const docketNumber = await Docket.generateNextNumber();

        // Create the docket
        const docket = await Docket.create({
            docketNumber,
            jobs: jobIds,
            manufacturer: manufacturerId,
            notes,
            metadata,
            createdBy: req.userId,
            status: 'draft'
        });

        // Update all jobs with the docket ID
        await Job.updateMany(
            { _id: { $in: jobIds } },
            { docket: docket._id }
        );

        // Populate for response
        const populatedDocket = await Docket.findById(docket._id)
            .populate('manufacturer', 'name email phone')
            .populate('createdBy', 'name email');

        await AuditLog.log({
            user: req.userId,
            action: 'create',
            entity: 'docket',
            entityId: docket._id,
            description: `Created docket ${docketNumber} with ${jobIds.length} jobs`,
            metadata: { jobIds, docketNumber },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        res.status(201).json({
            success: true,
            message: 'Docket created successfully',
            data: populatedDocket
        });

    } catch (error) {
        console.error('Create docket error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create docket'
        });
    }
};

/**
 * Get all dockets with filtering and pagination
 */
exports.getDockets = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            manufacturer,
            status,
            search,
            startDate,
            endDate
        } = req.query;

        const query = {};

        if (manufacturer) query.manufacturer = manufacturer;
        if (status) query.status = status;

        if (search) {
            query.docketNumber = { $regex: search, $options: 'i' };
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const endOfDay = new Date(endDate);
                endOfDay.setHours(23, 59, 59, 999);
                query.createdAt.$lte = endOfDay;
            }
        }

        const total = await Docket.countDocuments(query);
        const dockets = await Docket.find(query)
            .populate('manufacturer', 'name email')
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        res.json({
            success: true,
            data: {
                dockets,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(total / limit)
                }
            }
        });

    } catch (error) {
        console.error('Get dockets error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dockets'
        });
    }
};

/**
 * Get single docket by ID
 */
exports.getDocket = async (req, res) => {
    try {
        const docket = await Docket.findById(req.params.id)
            .populate('manufacturer', 'name email phone')
            .populate('createdBy', 'name email')
            .populate({
                path: 'jobs',
                populate: [
                    { path: 'order', select: 'externalOrderId buyerName' },
                    { path: 'orderItem', select: 'sku productName quantity' }
                ]
            });

        if (!docket) {
            return res.status(404).json({
                success: false,
                message: 'Docket not found'
            });
        }

        res.json({
            success: true,
            data: docket
        });

    } catch (error) {
        console.error('Get docket error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch docket details'
        });
    }
};

/**
 * Update docket status
 */
exports.updateStatus = async (req, res) => {
    try {
        const { status, notes } = req.body;
        const { id } = req.params;

        const docket = await Docket.findById(id);
        if (!docket) {
            return res.status(404).json({
                success: false,
                message: 'Docket not found'
            });
        }

        const oldStatus = docket.status;
        docket.status = status;

        if (notes) {
            docket.notes = (docket.notes || '') + `\n[${new Date().toLocaleString()}] ${status.toUpperCase()}: ${notes}`;
        }

        // Set timestamps based on status
        if (status === 'dispatched') docket.dispatchedAt = new Date();
        if (status === 'received') docket.receivedAt = new Date();
        if (status === 'completed') docket.completedAt = new Date();

        await docket.save();

        await AuditLog.log({
            user: req.userId,
            action: 'update_status',
            entity: 'docket',
            entityId: docket._id,
            description: `Updated docket ${docket.docketNumber} status from ${oldStatus} to ${status}`,
            metadata: { oldStatus, newStatus: status },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        res.json({
            success: true,
            message: `Docket status updated to ${status}`,
            data: docket
        });

    } catch (error) {
        console.error('Update docket status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update docket status'
        });
    }
};
