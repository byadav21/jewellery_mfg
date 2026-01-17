const { SkuMaster, AuditLog } = require('../models');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const { Readable } = require('stream');

// Ensure upload directory exists
const SKU_CAD_DIR = path.join(__dirname, '../../uploads/sku-cad');
const SKU_IMAGES_DIR = path.join(__dirname, '../../uploads/sku-images');

[SKU_CAD_DIR, SKU_IMAGES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Get all SKUs with pagination and filters
exports.getAll = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      category,
      hasCadFile,
      isActive = 'all'
    } = req.query;

    const query = {};

    // Active filter
    if (isActive !== 'all') {
      query.isActive = isActive === 'true';
    }

    // Category filter
    if (category && category !== 'all') {
      query.category = category;
    }

    // CAD file filter
    if (hasCadFile === 'true' || hasCadFile === 'false') {
      query.hasCadFile = hasCadFile === 'true';
    }

    // Search filter
    if (search) {
      query.$or = [
        { sku: { $regex: search, $options: 'i' } },
        { productName: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await SkuMaster.countDocuments(query);
    const skus = await SkuMaster.find(query)
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: {
        skus,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get SKUs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch SKUs'
    });
  }
};

// Get single SKU by SKU code
exports.getBySku = async (req, res) => {
  try {
    const { sku } = req.params;

    const skuRecord = await SkuMaster.findOne({ sku: sku.toUpperCase() })
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('cadFile.uploadedBy', 'name email');

    if (!skuRecord) {
      return res.status(404).json({
        success: false,
        message: 'SKU not found'
      });
    }

    res.json({
      success: true,
      data: skuRecord
    });
  } catch (error) {
    console.error('Get SKU error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch SKU'
    });
  }
};

// Create new SKU
exports.create = async (req, res) => {
  try {
    const {
      sku,
      productName,
      description,
      category,
      basePrice,
      weight,
      metalType,
      purity,
      amazonAsin,
      ebayItemId
    } = req.body;

    // Check if SKU already exists
    const existing = await SkuMaster.findOne({ sku: sku.toUpperCase() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'SKU already exists'
      });
    }

    // Build marketplace mappings
    const marketplaceMappings = [];
    if (amazonAsin) {
      marketplaceMappings.push({ channel: 'amazon', externalId: amazonAsin });
    }
    if (ebayItemId) {
      marketplaceMappings.push({ channel: 'ebay', externalId: ebayItemId });
    }

    const skuRecord = await SkuMaster.create({
      sku: sku.toUpperCase(),
      productName,
      description,
      category,
      basePrice: parseFloat(basePrice) || 0,
      weight: parseFloat(weight) || 0,
      metalType,
      purity,
      marketplaceMappings,
      createdBy: req.userId
    });

    await AuditLog.log({
      user: req.userId,
      action: 'create',
      entity: 'sku_master',
      entityId: skuRecord._id,
      description: `Created SKU: ${sku}`,
      newValues: req.body,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(201).json({
      success: true,
      message: 'SKU created successfully',
      data: skuRecord
    });
  } catch (error) {
    console.error('Create SKU error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create SKU'
    });
  }
};

// Update SKU
exports.update = async (req, res) => {
  try {
    const { sku } = req.params;
    const updateData = req.body;

    const skuRecord = await SkuMaster.findOne({ sku: sku.toUpperCase() });
    if (!skuRecord) {
      return res.status(404).json({
        success: false,
        message: 'SKU not found'
      });
    }

    const oldValues = skuRecord.toObject();

    // Update fields
    const allowedFields = ['productName', 'description', 'category', 'basePrice', 'weight', 'metalType', 'purity', 'isActive'];
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        skuRecord[field] = updateData[field];
      }
    });

    // Handle marketplace mappings update
    if (updateData.amazonAsin !== undefined || updateData.ebayItemId !== undefined) {
      const mappings = [];
      if (updateData.amazonAsin) {
        mappings.push({ channel: 'amazon', externalId: updateData.amazonAsin });
      }
      if (updateData.ebayItemId) {
        mappings.push({ channel: 'ebay', externalId: updateData.ebayItemId });
      }
      skuRecord.marketplaceMappings = mappings;
    }

    skuRecord.updatedBy = req.userId;
    await skuRecord.save();

    await AuditLog.log({
      user: req.userId,
      action: 'update',
      entity: 'sku_master',
      entityId: skuRecord._id,
      description: `Updated SKU: ${sku}`,
      oldValues,
      newValues: updateData,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'SKU updated successfully',
      data: skuRecord
    });
  } catch (error) {
    console.error('Update SKU error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update SKU'
    });
  }
};

// Delete SKU (soft delete)
exports.delete = async (req, res) => {
  try {
    const { sku } = req.params;

    const skuRecord = await SkuMaster.findOne({ sku: sku.toUpperCase() });
    if (!skuRecord) {
      return res.status(404).json({
        success: false,
        message: 'SKU not found'
      });
    }

    skuRecord.isActive = false;
    skuRecord.updatedBy = req.userId;
    await skuRecord.save();

    await AuditLog.log({
      user: req.userId,
      action: 'delete',
      entity: 'sku_master',
      entityId: skuRecord._id,
      description: `Deleted SKU: ${sku}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'SKU deleted successfully'
    });
  } catch (error) {
    console.error('Delete SKU error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete SKU'
    });
  }
};

// Upload CAD file for SKU
exports.uploadCadFile = async (req, res) => {
  try {
    const { sku } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    let skuRecord = await SkuMaster.findOne({ sku: sku.toUpperCase() });

    // If SKU doesn't exist, create it from filename
    if (!skuRecord) {
      skuRecord = await SkuMaster.create({
        sku: sku.toUpperCase(),
        productName: sku.toUpperCase(),
        createdBy: req.userId
      });
    }

    // Delete old CAD file if exists
    if (skuRecord.cadFile?.filePath) {
      const oldPath = path.join(__dirname, '../..', skuRecord.cadFile.filePath);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // Move file to SKU CAD directory with SKU name
    const ext = path.extname(req.file.originalname).toLowerCase();
    const newFilename = `${sku.toUpperCase()}${ext}`;
    const newPath = path.join(SKU_CAD_DIR, newFilename);

    fs.renameSync(req.file.path, newPath);

    // Update SKU record
    skuRecord.cadFile = {
      fileName: req.file.originalname,
      filePath: `/uploads/sku-cad/${newFilename}`,
      uploadedAt: new Date(),
      uploadedBy: req.userId,
      fileSize: req.file.size
    };
    skuRecord.hasCadFile = true;
    skuRecord.updatedBy = req.userId;
    await skuRecord.save();

    await AuditLog.log({
      user: req.userId,
      action: 'upload_cad',
      entity: 'sku_master',
      entityId: skuRecord._id,
      description: `Uploaded CAD file for SKU: ${sku}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'CAD file uploaded successfully',
      data: skuRecord
    });
  } catch (error) {
    console.error('Upload CAD file error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload CAD file'
    });
  }
};

// Delete CAD file
exports.deleteCadFile = async (req, res) => {
  try {
    const { sku } = req.params;

    const skuRecord = await SkuMaster.findOne({ sku: sku.toUpperCase() });
    if (!skuRecord) {
      return res.status(404).json({
        success: false,
        message: 'SKU not found'
      });
    }

    if (skuRecord.cadFile?.filePath) {
      const filePath = path.join(__dirname, '../..', skuRecord.cadFile.filePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    skuRecord.cadFile = null;
    skuRecord.hasCadFile = false;
    skuRecord.updatedBy = req.userId;
    await skuRecord.save();

    await AuditLog.log({
      user: req.userId,
      action: 'delete_cad',
      entity: 'sku_master',
      entityId: skuRecord._id,
      description: `Deleted CAD file for SKU: ${sku}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'CAD file deleted successfully'
    });
  } catch (error) {
    console.error('Delete CAD file error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete CAD file'
    });
  }
};

// Upload reference images
exports.uploadImages = async (req, res) => {
  try {
    const { sku } = req.params;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images uploaded'
      });
    }

    const skuRecord = await SkuMaster.findOne({ sku: sku.toUpperCase() });
    if (!skuRecord) {
      return res.status(404).json({
        success: false,
        message: 'SKU not found'
      });
    }

    const uploadedImages = [];
    for (const file of req.files) {
      const ext = path.extname(file.originalname);
      const newFilename = `${sku.toUpperCase()}-${Date.now()}${ext}`;
      const newPath = path.join(SKU_IMAGES_DIR, newFilename);

      fs.renameSync(file.path, newPath);

      uploadedImages.push({
        fileName: file.originalname,
        filePath: `/uploads/sku-images/${newFilename}`,
        isPrimary: skuRecord.images.length === 0 && uploadedImages.length === 0,
        uploadedAt: new Date()
      });
    }

    skuRecord.images.push(...uploadedImages);
    skuRecord.updatedBy = req.userId;
    await skuRecord.save();

    res.json({
      success: true,
      message: 'Images uploaded successfully',
      data: skuRecord
    });
  } catch (error) {
    console.error('Upload images error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload images'
    });
  }
};

// Delete reference image
exports.deleteImage = async (req, res) => {
  try {
    const { sku, imageId } = req.params;

    const skuRecord = await SkuMaster.findOne({ sku: sku.toUpperCase() });
    if (!skuRecord) {
      return res.status(404).json({
        success: false,
        message: 'SKU not found'
      });
    }

    const imageIndex = skuRecord.images.findIndex(img => img._id.toString() === imageId);
    if (imageIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    const image = skuRecord.images[imageIndex];
    const filePath = path.join(__dirname, '../..', image.filePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    skuRecord.images.splice(imageIndex, 1);
    skuRecord.updatedBy = req.userId;
    await skuRecord.save();

    res.json({
      success: true,
      message: 'Image deleted successfully'
    });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete image'
    });
  }
};

// Quick check if SKU exists and has CAD
exports.checkCadStatus = async (req, res) => {
  try {
    const { sku } = req.params;
    const status = await SkuMaster.checkCadStatus(sku);
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Check CAD status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check CAD status'
    });
  }
};

// Search SKUs
exports.search = async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.json({
        success: true,
        data: []
      });
    }

    const skus = await SkuMaster.find({
      isActive: true,
      $or: [
        { sku: { $regex: q, $options: 'i' } },
        { productName: { $regex: q, $options: 'i' } }
      ]
    })
      .select('sku productName category hasCadFile')
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: skus
    });
  } catch (error) {
    console.error('Search SKUs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search SKUs'
    });
  }
};

// Bulk upload SKUs from CSV
exports.bulkUploadCsv = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No CSV file uploaded'
      });
    }

    const { updateExisting = 'false' } = req.body;
    const shouldUpdate = updateExisting === 'true';

    const results = {
      totalRows: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    const rows = [];

    // Parse CSV
    await new Promise((resolve, reject) => {
      const stream = Readable.from(req.file.buffer);
      stream
        .pipe(csv())
        .on('data', (row) => {
          rows.push(row);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    results.totalRows = rows.length;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Account for header row

      try {
        if (!row.sku || row.sku.trim() === '') {
          results.errors.push({ row: rowNum, sku: '', error: 'SKU is required' });
          continue;
        }

        const skuValue = row.sku.trim().toUpperCase();
        const existing = await SkuMaster.findOne({ sku: skuValue });

        if (existing) {
          if (shouldUpdate) {
            // Update existing
            existing.productName = row.product_name || existing.productName;
            existing.description = row.description || existing.description;
            if (row.category && ['ring', 'necklace', 'bracelet', 'earring', 'pendant', 'chain', 'bangle', 'other'].includes(row.category.toLowerCase())) {
              existing.category = row.category.toLowerCase();
            }
            existing.metalType = row.metal_type || existing.metalType;
            existing.purity = row.purity || existing.purity;
            if (row.weight) existing.weight = parseFloat(row.weight) || existing.weight;
            if (row.base_price) existing.basePrice = parseFloat(row.base_price) || existing.basePrice;

            // Update marketplace mappings
            const mappings = [];
            if (row.amazon_asin) {
              mappings.push({ channel: 'amazon', externalId: row.amazon_asin });
            }
            if (row.ebay_item_id) {
              mappings.push({ channel: 'ebay', externalId: row.ebay_item_id });
            }
            if (mappings.length > 0) {
              existing.marketplaceMappings = mappings;
            }

            existing.updatedBy = req.userId;
            await existing.save();
            results.updated++;
          } else {
            results.skipped++;
          }
        } else {
          // Create new
          const marketplaceMappings = [];
          if (row.amazon_asin) {
            marketplaceMappings.push({ channel: 'amazon', externalId: row.amazon_asin });
          }
          if (row.ebay_item_id) {
            marketplaceMappings.push({ channel: 'ebay', externalId: row.ebay_item_id });
          }

          await SkuMaster.create({
            sku: skuValue,
            productName: row.product_name || skuValue,
            description: row.description || '',
            category: row.category?.toLowerCase() || 'other',
            metalType: row.metal_type || '',
            purity: row.purity || '',
            weight: parseFloat(row.weight) || 0,
            basePrice: parseFloat(row.base_price) || 0,
            marketplaceMappings,
            createdBy: req.userId
          });
          results.created++;
        }
      } catch (err) {
        results.errors.push({ row: rowNum, sku: row.sku || '', error: err.message });
      }
    }

    await AuditLog.log({
      user: req.userId,
      action: 'bulk_upload_csv',
      entity: 'sku_master',
      description: `Bulk uploaded SKUs from CSV: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped`,
      metadata: results,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'CSV import completed',
      data: results
    });
  } catch (error) {
    console.error('Bulk upload CSV error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process CSV file'
    });
  }
};

// Bulk upload CAD files from ZIP
exports.bulkUploadCad = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const results = {
      totalFiles: req.files.length,
      matched: 0,
      uploaded: 0,
      created: 0,
      notFound: 0,
      errors: []
    };

    for (const file of req.files) {
      try {
        // Extract SKU from filename (e.g., SKU-001.stl -> SKU-001)
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.stl') {
          results.errors.push({ file: file.originalname, error: 'Only STL files are allowed' });
          continue;
        }

        const skuFromFilename = path.basename(file.originalname, ext).toUpperCase();

        let skuRecord = await SkuMaster.findOne({ sku: skuFromFilename });

        if (!skuRecord) {
          // Create new SKU from filename
          skuRecord = await SkuMaster.create({
            sku: skuFromFilename,
            productName: skuFromFilename,
            createdBy: req.userId
          });
          results.created++;
        } else {
          results.matched++;
        }

        // Delete old CAD file if exists
        if (skuRecord.cadFile?.filePath) {
          const oldPath = path.join(__dirname, '../..', skuRecord.cadFile.filePath);
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        }

        // Move file to SKU CAD directory
        const newFilename = `${skuFromFilename}.stl`;
        const newPath = path.join(SKU_CAD_DIR, newFilename);
        fs.renameSync(file.path, newPath);

        // Update SKU record
        skuRecord.cadFile = {
          fileName: file.originalname,
          filePath: `/uploads/sku-cad/${newFilename}`,
          uploadedAt: new Date(),
          uploadedBy: req.userId,
          fileSize: file.size
        };
        skuRecord.hasCadFile = true;
        skuRecord.updatedBy = req.userId;
        await skuRecord.save();

        results.uploaded++;
      } catch (err) {
        results.errors.push({ file: file.originalname, error: err.message });
      }
    }

    await AuditLog.log({
      user: req.userId,
      action: 'bulk_upload_cad',
      entity: 'sku_master',
      description: `Bulk uploaded CAD files: ${results.uploaded} uploaded, ${results.created} new SKUs created`,
      metadata: results,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'CAD files import completed',
      data: results
    });
  } catch (error) {
    console.error('Bulk upload CAD error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process CAD files'
    });
  }
};

// Export SKUs to CSV
exports.exportCsv = async (req, res) => {
  try {
    const { category, hasCadFile, isActive } = req.query;

    const query = {};
    if (category && category !== 'all') query.category = category;
    if (hasCadFile !== undefined && hasCadFile !== 'all') query.hasCadFile = hasCadFile === 'true';
    if (isActive !== undefined && isActive !== 'all') query.isActive = isActive === 'true';

    const skus = await SkuMaster.find(query).sort({ sku: 1 });

    // Build CSV content
    const headers = ['sku', 'product_name', 'category', 'description', 'metal_type', 'purity', 'weight', 'base_price', 'has_cad', 'amazon_asin', 'ebay_item_id'];
    const rows = skus.map(sku => {
      const amazonMapping = sku.marketplaceMappings.find(m => m.channel === 'amazon');
      const ebayMapping = sku.marketplaceMappings.find(m => m.channel === 'ebay');
      return [
        sku.sku,
        sku.productName,
        sku.category,
        sku.description || '',
        sku.metalType || '',
        sku.purity || '',
        sku.weight || '',
        sku.basePrice || '',
        sku.hasCadFile ? 'Yes' : 'No',
        amazonMapping?.externalId || '',
        ebayMapping?.externalId || ''
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=sku-master-export-${Date.now()}.csv`);
    res.send(csvContent);
  } catch (error) {
    console.error('Export CSV error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export SKUs'
    });
  }
};

// Get statistics
exports.getStatistics = async (req, res) => {
  try {
    const totalSkus = await SkuMaster.countDocuments({ isActive: true });
    const withCad = await SkuMaster.countDocuments({ isActive: true, hasCadFile: true });
    const withoutCad = await SkuMaster.countDocuments({ isActive: true, hasCadFile: false });

    const byCategory = await SkuMaster.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        total: totalSkus,
        withCad,
        withoutCad,
        cadPercentage: totalSkus > 0 ? Math.round((withCad / totalSkus) * 100) : 0,
        byCategory: byCategory.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
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
