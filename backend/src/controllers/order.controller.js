const { MarketplaceOrder, MarketplaceOrderItem, Job, AuditLog, SkuMaster, SyncLog, SystemSettings, User, Role, ProductionFile } = require('../models');
const amazonService = require('../services/amazon.service');
const ebayService = require('../services/ebay.service');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getPythonCommand } = require('../utils/python.utils');

const { addBusinessHours } = require('../utils/date.utils');
const { applyAutoAssignment } = require('../utils/assignment.utils');

// Helper function to calculate TAT deadline
async function calculateTATDeadline(tatType) {
  const tatHours = await SystemSettings.getSetting(`tat_${tatType}_hours`) || 48;
  const deadline = addBusinessHours(new Date(), tatHours);
  return deadline;
}

// Helper function to get Production Coordinator users
async function getProductionCoordinators() {
  const adminRole = await Role.findOne({ name: 'admin' });
  if (!adminRole) return [];

  return User.find({
    roles: adminRole._id,
    isActive: true
  }).select('_id name email');
}

// Get all orders (optimized with batch lookups and DB-level pagination)
exports.getOrders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      channel,
      status,
      search,
      startDate,
      endDate,
      cadStatus,
      accountCode,
      sortField = 'orderDate',
      sortDirection = 'desc'
    } = req.query;

    const query = {};

    // Exclude soft-deleted orders by default
    query.isDeleted = { $ne: true };

    if (channel && channel !== 'all' && channel !== '') query.channel = channel;
    if (status && status !== 'all' && status !== '') query.status = status;
    if (accountCode && accountCode !== 'all' && accountCode !== '') query.accountCode = accountCode;

    // CAD status filter - use stored cadSummary.status (already indexed)
    if (cadStatus && cadStatus !== 'all' && cadStatus !== '') {
      if (cadStatus === 'has_cad') query['cadSummary.status'] = 'all_cad';
      else if (cadStatus === 'no_cad') query['cadSummary.status'] = 'no_cad';
      else if (cadStatus === 'partial') query['cadSummary.status'] = 'partial';
    }

    // Search handling
    if (search && search.trim() !== '') {
      const searchTerm = search.trim();

      // Find orders matching SKU or product name in items collection
      const orderIdsFromItems = await MarketplaceOrderItem.find({
        $or: [
          { sku: { $regex: searchTerm, $options: 'i' } },
          { productName: { $regex: searchTerm, $options: 'i' } }
        ]
      }).distinct('order');

      query.$or = [
        { externalOrderId: { $regex: searchTerm, $options: 'i' } },
        { marketplaceOrderId: { $regex: searchTerm, $options: 'i' } },
        { buyerName: { $regex: searchTerm, $options: 'i' } },
        { buyerEmail: { $regex: searchTerm, $options: 'i' } },
        { customerName: { $regex: searchTerm, $options: 'i' } },
        { orderNumber: { $regex: searchTerm, $options: 'i' } }
      ];

      if (orderIdsFromItems.length > 0) {
        query.$or.push({ _id: { $in: orderIdsFromItems } });
      }
    }

    if (startDate || endDate) {
      query.orderDate = {};
      if (startDate) query.orderDate.$gte = new Date(startDate);
      if (endDate) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        query.orderDate.$lte = endOfDay;
      }
    }

    // Build sort object
    const sortObj = {};
    const validSortFields = ['orderDate', 'externalOrderId', 'buyerName', 'channel', 'status', 'totalAmount', 'createdAt'];
    if (validSortFields.includes(sortField)) {
      sortObj[sortField] = sortDirection === 'asc' ? 1 : -1;
    } else {
      sortObj.orderDate = -1;
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // Get total count and paginated orders in parallel
    const [total, paginatedOrders] = await Promise.all([
      MarketplaceOrder.countDocuments(query),
      MarketplaceOrder.find(query)
        .populate('marketplaceAccount', 'name accountCode')
        .sort(sortObj)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean()
    ]);

    if (paginatedOrders.length === 0) {
      return res.json({
        success: true,
        data: {
          orders: [],
          pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) }
        }
      });
    }

    const orderIds = paginatedOrders.map(o => o._id);

    // Batch fetch items, jobs for only the paginated orders
    const [allItems, allJobs] = await Promise.all([
      MarketplaceOrderItem.find({ order: { $in: orderIds } }).lean(),
      Job.find({ order: { $in: orderIds } })
        .populate('cadDesigner', 'name email')
        .populate('manufacturer', 'name email')
        .populate('admin', 'name email')
        .lean()
    ]);

    // Batch fetch SKU master records for all unique SKUs in items
    const uniqueSkus = [...new Set(allItems.filter(i => i.sku).map(i => i.sku.toUpperCase()))];
    const skuMasterRecords = uniqueSkus.length > 0
      ? await SkuMaster.find({ sku: { $in: uniqueSkus }, isActive: true }).lean()
      : [];
    const skuMasterMap = new Map(skuMasterRecords.map(s => [s.sku, s]));

    // Group items and jobs by order ID
    const itemsByOrder = new Map();
    for (const item of allItems) {
      const orderId = item.order.toString();
      if (!itemsByOrder.has(orderId)) itemsByOrder.set(orderId, []);
      itemsByOrder.get(orderId).push(item);
    }

    const jobsByOrder = new Map();
    for (const job of allJobs) {
      const orderId = job.order.toString();
      if (!jobsByOrder.has(orderId)) jobsByOrder.set(orderId, []);
      jobsByOrder.get(orderId).push(job);
    }

    // Enrich each paginated order
    for (const order of paginatedOrders) {
      const orderId = order._id.toString();
      const items = itemsByOrder.get(orderId) || [];

      // Enrich items with SKU Master CAD status
      for (const item of items) {
        if (item.sku) {
          const skuMaster = skuMasterMap.get(item.sku.toUpperCase());
          if (skuMaster) {
            item.skuMasterRef = skuMaster._id;
            item.hasCadFile = skuMaster.hasCadFile || false;
            item.cadFilePath = skuMaster.cadFile?.filePath || null;
            item.cadFileName = skuMaster.cadFile?.fileName || null;
          } else {
            item.hasCadFile = false;
          }
        }
      }

      order.items = items;

      // Compute CAD summary
      const withCad = items.filter(i => i.hasCadFile).length;
      const itemTotal = items.length;
      order.cadSummary = {
        total: itemTotal,
        withCad,
        withoutCad: itemTotal - withCad,
        status: itemTotal === 0 ? 'unknown' : withCad === itemTotal ? 'all_cad' : withCad === 0 ? 'no_cad' : 'partial'
      };

      // Attach jobs and assignments
      const jobs = jobsByOrder.get(orderId) || [];
      order.jobs = jobs;
      order.jobCount = jobs.length;

      order.assignments = {
        cadDesigner: null,
        manufacturer: null,
        admin: null
      };

      if (jobs.length > 0) {
        const cadDesigner = jobs.find(j => j.cadDesigner)?.cadDesigner;
        const manufacturer = jobs.find(j => j.manufacturer)?.manufacturer;
        const admin = jobs.find(j => j.admin)?.admin;
        if (cadDesigner) order.assignments.cadDesigner = cadDesigner;
        if (manufacturer) order.assignments.manufacturer = manufacturer;
        if (admin) order.assignments.admin = admin;
      }
    }

    res.json({
      success: true,
      data: {
        orders: paginatedOrders,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders'
    });
  }
};

// Get single order with items
exports.getOrder = async (req, res) => {
  try {
    const order = await MarketplaceOrder.findById(req.params.id).lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const items = await MarketplaceOrderItem.find({ order: order._id }).lean();

    // Enrich items with current SKU Master CAD status and product images
    for (const item of items) {
      if (item.sku) {
        const skuMaster = await SkuMaster.findOne({ sku: item.sku.toUpperCase(), isActive: true });
        if (skuMaster) {
          item.skuMasterRef = skuMaster._id;
          item.hasCadFile = skuMaster.hasCadFile || false;
          item.cadFilePath = skuMaster.cadFile?.filePath || null;
          item.cadFileName = skuMaster.cadFile?.fileName || null;
          // Include product images from SKU Master
          item.productImages = skuMaster.images || [];
        } else {
          item.hasCadFile = false;
          item.cadFilePath = null;
          item.cadFileName = null;
          item.productImages = [];
        }
      } else {
        item.productImages = [];
      }
    }

    const jobs = await Job.find({ order: order._id })
      .populate('cadDesigner', 'name email')
      .populate('manufacturer', 'name email')
      .lean();

    // Enrich jobs with CAD file info from SKU Master if not already set on job
    for (const job of jobs) {
      if (!job.cadFilePath && job.sku) {
        const skuMaster = await SkuMaster.findOne({ sku: job.sku.toUpperCase(), isActive: true });
        if (skuMaster && skuMaster.cadFile?.filePath) {
          job.cadFilePath = skuMaster.cadFile.filePath;
          job.hasCadFile = true;
        }
      }
    }

    // Compute CAD summary for the order
    const itemTotal = items.length;
    const withCad = items.filter(item => item.hasCadFile).length;
    order.cadSummary = {
      total: itemTotal,
      withCad: withCad,
      withoutCad: itemTotal - withCad,
      status: itemTotal === 0 ? 'unknown' : withCad === itemTotal ? 'all_cad' : withCad === 0 ? 'no_cad' : 'partial'
    };

    // Compute current job status summary
    if (jobs.length > 0) {
      const jobStatuses = jobs.map(j => j.status);
      const statusCounts = {};
      jobStatuses.forEach(s => { statusCounts[s] = (statusCounts[s] || 0) + 1; });
      order.jobStatusSummary = statusCounts;

      // Get the "most advanced" job status to show current workflow stage
      const statusOrder = [
        'new', 'cad_assigned', 'cad_in_progress', 'cad_submitted', 'cad_approved', 'cad_rejected',
        'components_issued', 'manufacturing_assigned', 'manufacturing_accepted', 'manufacturing_in_progress',
        'manufacturing_ready_qc', 'manufacturing_ready_delivery', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled'
      ];
      let maxStatusIndex = -1;
      let currentStatus = 'new';
      jobs.forEach(job => {
        const idx = statusOrder.indexOf(job.status);
        if (idx > maxStatusIndex) {
          maxStatusIndex = idx;
          currentStatus = job.status;
        }
      });
      order.currentJobStatus = currentStatus;
    }

    // Fetch manufacturing/production files for all related jobs
    const jobIds = jobs.map(j => j._id);
    const productionFiles = jobIds.length > 0
      ? await ProductionFile.find({ job: { $in: jobIds } })
          .populate('uploadedBy', 'name email')
          .sort({ uploadedAt: -1 })
          .lean()
      : [];

    // Group production files by job ID
    const filesByJob = {};
    for (const file of productionFiles) {
      const jid = file.job.toString();
      if (!filesByJob[jid]) filesByJob[jid] = [];
      filesByJob[jid].push(file);
    }

    // Attach files to each job
    for (const job of jobs) {
      job.productionFiles = filesByJob[job._id.toString()] || [];
    }

    res.json({
      success: true,
      data: {
        order,
        items,
        jobs,
        productionFiles
      }
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order'
    });
  }
};

// Sync Amazon orders
exports.syncAmazon = async (req, res) => {
  let syncLog = null;

  try {
    const { fromDate, toDate, importAll } = req.body || {};

    // Calculate date range (default: last 30 days)
    const startDate = fromDate ? new Date(fromDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = toDate ? new Date(toDate) : new Date();

    console.log(`Syncing Amazon orders from ${startDate.toISOString()} to ${endDate.toISOString()} (Import All: ${importAll})`);

    // Create sync log entry
    syncLog = await SyncLog.startSync({
      syncType: 'amazon',
      accountCode: 'CSP',
      triggeredBy: req.userId,
      triggerType: 'manual',
      requestParams: { fromDate: startDate, toDate: endDate, importAll }
    });

    // Try Python script first for CSP account
    let pythonResult = null;
    const scriptPath = path.join(__dirname, '../../scripts/csp_fetch_orders.py');

    if (fs.existsSync(scriptPath)) {
      try {
        console.log('Running CSP Amazon fetch script...');
        console.log('Script path:', scriptPath);
        // Determine Python command
        const pythonCmd = getPythonCommand();
        console.log('Python command:', pythonCmd);

        // Get configurable settings from database
        const maxResultsPerPage = await SystemSettings.getSetting('amazon_max_results_per_page') || 100;
        const fetchAllPages = await SystemSettings.getSetting('amazon_fetch_all_pages');
        const daysBack = await SystemSettings.getSetting('amazon_sync_days_back') || 7;

        // Build command with configurable arguments
        let cmdArgs = `--days-back ${daysBack} --max-results ${maxResultsPerPage}`;
        if (fetchAllPages === true || fetchAllPages === 'true') {
          cmdArgs += ' --fetch-all-pages';
        }
        if (importAll === true || importAll === 'true') {
          cmdArgs += ' --import-all';
        }

        // Pass specific dates if provided
        if (fromDate) {
          cmdArgs += ` --start-date ${new Date(fromDate).toISOString().split('T')[0]}`;
        }
        if (toDate) {
          cmdArgs += ` --end-date ${new Date(toDate).toISOString().split('T')[0]}`;
        }

        console.log('Python args:', cmdArgs);

        const output = execSync(`${pythonCmd} "${scriptPath}" ${cmdArgs}`, {
          encoding: 'utf8',
          timeout: 300000, // 5 minute timeout for large order fetches
          cwd: path.join(__dirname, '../..'),
          windowsHide: true
        });

        console.log('Python script raw output length:', output.length);

        // Find the JSON part (starts with { and ends with })
        const jsonStart = output.indexOf('{');
        const jsonEnd = output.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) {
          throw new Error('No valid JSON found in Python script output');
        }
        const jsonOutput = output.substring(jsonStart, jsonEnd + 1);

        pythonResult = JSON.parse(jsonOutput);
        console.log('Python script result:', pythonResult.success ? 'Success' : 'Failed');
        console.log('Orders found:', pythonResult.orders?.length || 0);

        // Store Amazon API stats in sync log
        if (pythonResult.stats) {
          syncLog.stats.totalRetrieved = pythonResult.stats.total_retrieved || 0;
          syncLog.stats.mfnPending = pythonResult.stats.mfn_pending || 0;
          syncLog.stats.fbaExcluded = pythonResult.stats.fba_excluded || 0;
          syncLog.stats.shippedExcluded = pythonResult.stats.shipped_excluded || 0;
          syncLog.stats.otherExcluded = pythonResult.stats.other_excluded || 0;
        }

        if (pythonResult.success && pythonResult.orders && pythonResult.orders.length > 0) {
          // Import orders from Python script result
          const importResult = await importOrdersFromPython(pythonResult.orders, req.userId);

          // Complete sync log with success
          await syncLog.complete('success', {
            ordersImported: importResult.imported,
            ordersSkipped: importResult.skipped,
            jobsCreated: importResult.jobsCreated,
            errors: importResult.errors
          });

          // Store missing SKUs in sync log
          if (importResult.missingSKUs && importResult.missingSKUs.length > 0) {
            syncLog.missingSKUs = importResult.missingSKUs;
            await syncLog.save();
          }

          await AuditLog.log({
            user: req.userId,
            action: 'order_sync',
            entity: 'order',
            description: `Amazon order sync via Python script: ${importResult.imported} orders imported`,
            metadata: { ...importResult, accountCode: pythonResult.accountCode, syncLogId: syncLog._id },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
          });

          return res.json({
            success: true,
            message: `Synced ${importResult.imported} orders from Amazon (${pythonResult.accountCode})`,
            data: {
              ...importResult,
              syncLogId: syncLog._id,
              stats: pythonResult.stats,
              explanation: getOrderExplanation(pythonResult.stats, importAll)
            }
          });
        } else if (pythonResult.success && (!pythonResult.orders || pythonResult.orders.length === 0)) {
          // No orders found but script succeeded
          await syncLog.complete('success', {
            ordersImported: 0,
            ordersSkipped: 0,
            jobsCreated: 0
          });

          return res.json({
            success: true,
            message: 'No new pending orders found from Amazon',
            data: {
              imported: 0,
              skipped: 0,
              jobsCreated: 0,
              syncLogId: syncLog._id,
              stats: pythonResult.stats,
              explanation: getOrderExplanation(pythonResult.stats, importAll)
            }
          });
        }
      } catch (scriptError) {
        console.error('Python script error:', scriptError.message);
        if (scriptError.stderr) {
          console.error('Python stderr:', scriptError.stderr.toString());
        }

        // Check if it's a timeout error
        if (scriptError.killed || scriptError.message.includes('TIMEOUT')) {
          await syncLog.complete('failed', {}, 'Amazon sync timed out. Large number of orders may cause delays.');
          return res.status(408).json({
            success: false,
            message: 'Amazon sync timed out. Please try again or use the manual cron trigger.',
            error: 'Script execution timeout'
          });
        }

        // For other Python errors, throw to be caught by main error handler
        throw new Error(`Python script failed: ${scriptError.message}`);
      }
    } else {
      console.log('Python script not found at:', scriptPath);
    }

    // Fallback to Node.js Amazon service - only if Python script doesn't exist
    console.log('Falling back to Node.js Amazon service (fetchOrdersFromAllAccounts)...');
    const result = await amazonService.fetchOrdersFromAllAccounts();

    // Update sync log with fallback result
    if (result.success) {
      await syncLog.complete('success', {
        ordersImported: result.imported || 0,
        ordersSkipped: result.skipped || 0,
        jobsCreated: result.jobsCreated || 0
      });
    } else {
      await syncLog.complete('failed', {}, result.message);
    }

    await AuditLog.log({
      user: req.userId,
      action: 'order_sync',
      entity: 'order',
      description: 'Manual Amazon order sync triggered',
      metadata: { ...result, syncLogId: syncLog._id },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: result.success,
      message: result.message,
      data: { ...result, syncLogId: syncLog._id }
    });
  } catch (error) {
    console.error('Amazon sync error:', error);

    // Update sync log with failure
    if (syncLog) {
      await syncLog.complete('failed', {}, error.message, { stack: error.stack });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to sync Amazon orders',
      error: error.message
    });
  }
};

// Helper function to explain order stats
function getOrderExplanation(stats, importAll = false) {
  if (!stats) return null;

  const explanations = [];

  if (stats.total_retrieved > 0) {
    explanations.push(`Found ${stats.total_retrieved} total orders from Amazon in the requested date range.`);
  }

  if (stats.mfn_pending > 0) {
    explanations.push(`${stats.mfn_pending} MFN (Merchant Fulfilled) orders with Pending/Unshipped status - these are imported for manufacturing.`);
  }

  if (stats.fba_excluded > 0) {
    if (importAll) {
      explanations.push(`${stats.fba_excluded} FBA orders imported successfully (Fulfilled by Amazon).`);
    } else {
      explanations.push(`${stats.fba_excluded} FBA orders excluded - these are fulfilled by Amazon and don't need manufacturing.`);
    }
  }

  if (stats.shipped_excluded > 0) {
    if (importAll) {
      explanations.push(`${stats.shipped_excluded} shipped orders imported successfully (Historical sync).`);
    } else {
      explanations.push(`${stats.shipped_excluded} shipped orders excluded - these are already completed.`);
    }
  }

  if (stats.other_excluded > 0) {
    if (importAll) {
      explanations.push(`${stats.other_excluded} orders with other statuses imported.`);
    } else {
      explanations.push(`${stats.other_excluded} orders with other statuses excluded (cancelled, returned, etc.).`);
    }
  }

  if (stats.total_retrieved === 0) {
    explanations.push('No orders found in Amazon for the specified date range.');
  }

  return explanations;
}

// Import orders from Python script output
async function importOrdersFromPython(orders, userId) {
  let imported = 0;
  let skipped = 0;
  let jobsCreated = 0;
  let cadAssignedCount = 0;
  let imagesFetched = 0;
  const errors = [];
  const missingSKUs = []; // Track SKUs not in SKU Master
  const itemsToFetchImages = []; // Track items that need images fetched

  // Fetch roles and users for auto-assignment
  const designerRole = await Role.findOne({ name: 'designer' });
  const designerUsers = designerRole ? await User.find({ roles: designerRole._id, isActive: true }) : [];
  const defaultDesigner = designerUsers.length > 0 ? designerUsers[0] : null;

  for (const orderData of orders) {
    try {
      // Check if order already exists
      const existing = await MarketplaceOrder.findOne({
        channel: 'amazon',
        externalOrderId: orderData.externalOrderId
      });

      if (existing) {
        skipped++;
        continue;
      }

      // Create the order
      const order = await MarketplaceOrder.create({
        channel: 'amazon',
        externalOrderId: orderData.externalOrderId,
        accountCode: orderData.accountCode,
        buyerName: orderData.buyerName,
        buyerEmail: orderData.buyerEmail,
        shippingAddress: orderData.shippingAddress,
        status: orderData.status === 'unshipped' ? 'pending' : orderData.status,
        orderDate: orderData.orderDate ? new Date(orderData.orderDate) : new Date(),
        promisedDate: orderData.promisedDate ? new Date(orderData.promisedDate) : null,
        totalAmount: orderData.totalAmount,
        currency: orderData.currency,
        rawPayload: orderData
      });

      // Create order items and jobs
      for (const itemData of orderData.items || []) {
        const normalizedSku = (itemData.sku || '').toUpperCase().trim();
        const skuStatus = await SkuMaster.checkCadStatus(normalizedSku);

        // Track missing SKUs (not in SKU Master)
        if (!skuStatus.exists && normalizedSku) {
          const existingMissing = missingSKUs.find(s => s.sku === normalizedSku);
          if (!existingMissing) {
            missingSKUs.push({
              sku: normalizedSku,
              productName: itemData.productName,
              asin: itemData.asin
            });
          }
        }

        const orderItem = await MarketplaceOrderItem.create({
          order: order._id,
          sku: normalizedSku,
          asinOrItemId: itemData.asin,
          productName: itemData.productName,
          quantity: itemData.quantity || 1,
          itemPrice: itemData.itemPrice,
          hasCadFile: skuStatus.hasCadFile,
          cadFilePath: skuStatus.cadFilePath
        });

        // Process image from Python script if available
        if (itemData.localImagePath && normalizedSku) {
          // Python already downloaded the image, update SKU Master
          try {
            let skuMaster = await SkuMaster.findOne({ sku: normalizedSku });
            if (skuMaster) {
              // Add image if not already exists
              const existingImage = skuMaster.images?.find(img => img.filePath === itemData.localImagePath);
              if (!existingImage) {
                const fileName = itemData.localImagePath.split('/').pop();
                skuMaster.images = skuMaster.images || [];
                skuMaster.images.push({
                  fileName,
                  filePath: itemData.localImagePath,
                  uploadedAt: new Date(),
                  source: 'amazon'
                });
                await skuMaster.save();
                imagesFetched++;
                console.log(`[Image] Added Python-downloaded image to SKU Master for ${normalizedSku}`);
              }
            } else {
              // Create SKU Master with image
              const fileName = itemData.localImagePath.split('/').pop();
              await SkuMaster.create({
                sku: normalizedSku,
                productName: itemData.productName || `Amazon Product ${itemData.asin}`,
                images: [{
                  fileName,
                  filePath: itemData.localImagePath,
                  uploadedAt: new Date(),
                  source: 'amazon'
                }],
                isActive: true
              });
              imagesFetched++;
              console.log(`[Image] Created SKU Master with Python-downloaded image for ${normalizedSku}`);
            }
          } catch (imgErr) {
            console.error(`[Image] Error saving Python image for ${normalizedSku}:`, imgErr.message);
          }
        } else if (itemData.asin && normalizedSku) {
          // Queue for image fetching via Node.js if Python didn't download
          itemsToFetchImages.push({
            asin: itemData.asin,
            sku: normalizedSku,
            productName: itemData.productName,
            accountCode: orderData.accountCode
          });
        }

        // Create job for this item
        const year = new Date().getFullYear();
        const count = await Job.countDocuments({
          createdAt: { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) }
        });
        const jobCode = `JOB-${year}-${String(count + 1).padStart(5, '0')}`;

        const isCadRequired = !skuStatus.hasCadFile;
        let cadDeadline = null;
        let cadDesigner = null;
        let jobStatus = 'new';

        if (isCadRequired && defaultDesigner) {
          cadDesigner = defaultDesigner._id;
          const cadHours = await SystemSettings.getSetting('tat_cad_hours') || 24;
          cadDeadline = addBusinessHours(new Date(), cadHours);
          jobStatus = 'cad_assigned';
          cadAssignedCount++;
        }

        const job = await Job.create({
          jobCode,
          sourceType: 'order',
          channel: 'amazon',
          accountCode: orderData.accountCode,
          orderItem: orderItem._id,
          order: order._id,
          sku: normalizedSku,
          productName: itemData.productName,
          quantity: itemData.quantity || 1,
          dueDate: order.promisedDate,
          customerName: order.buyerName,
          priority: 'medium',
          status: jobStatus,
          hasCadFile: skuStatus.hasCadFile,
          cadFilePath: skuStatus.cadFilePath,
          cadRequired: isCadRequired,
          cadDesigner,
          cadDeadline,
          cadAssignedAt: cadDesigner ? new Date() : null,
          admin: userId
        });

        // If auto-assigned, send notification
        if (cadDesigner) {
          const notificationService = require('../services/notification.service');
          await notificationService.sendStatusChangeNotification(job, 'none', 'cad_assigned', userId);
        }

        orderItem.isJobCreated = true;
        await orderItem.save();
        jobsCreated++;
      }

      // Update CAD summary
      await exports.updateOrderCadSummary(order._id);
      imported++;
    } catch (err) {
      console.error('Error importing order:', orderData.externalOrderId, err.message);
      errors.push({ orderId: orderData.externalOrderId, error: err.message });
    }
  }

  // Fetch product images for all new items (after order import)
  if (itemsToFetchImages.length > 0) {
    console.log(`[Image Fetch] Fetching product images for ${itemsToFetchImages.length} items...`);

    // Check if auto-fetch images is enabled
    const autoFetchImages = await SystemSettings.getSetting('amazon_auto_fetch_images');

    if (autoFetchImages !== false && autoFetchImages !== 'false') {
      // Group items by SKU to avoid duplicate fetches
      const uniqueSkus = new Map();
      for (const item of itemsToFetchImages) {
        if (!uniqueSkus.has(item.sku)) {
          uniqueSkus.set(item.sku, item);
        }
      }

      for (const [sku, item] of uniqueSkus) {
        try {
          // Check if SKU Master already has images
          const existingSkuMaster = await SkuMaster.findOne({ sku: sku.toUpperCase() });
          if (existingSkuMaster?.images?.length > 0) {
            console.log(`[Image Fetch] SKU ${sku} already has ${existingSkuMaster.images.length} images, skipping`);
            continue;
          }

          // Get credentials for this account
          const credentials = amazonService.getCredentialsFromEnv(item.accountCode || 'CSP');
          if (!credentials.refreshToken) {
            console.log(`[Image Fetch] No credentials for account ${item.accountCode}, skipping image fetch`);
            continue;
          }

          // Fetch and download images from Amazon
          console.log(`[Image Fetch] Attempting to fetch images for ASIN ${item.asin}, SKU ${sku}`);
          const imageResult = await amazonService.downloadProductImages(
            item.asin,
            sku,
            credentials,
            item.accountCode
          );

          console.log(`[Image Fetch] Result for ${sku}:`, JSON.stringify({
            success: imageResult.success,
            message: imageResult.message,
            imageCount: imageResult.images?.length || 0
          }));

          if (imageResult.success && imageResult.images?.length > 0) {
            // Re-query SKU Master as it might have been created during order import
            const currentSkuMaster = await SkuMaster.findOne({ sku: sku.toUpperCase() });

            const newImages = imageResult.images.map(img => ({
              fileName: img.fileName,
              filePath: img.filePath,
              uploadedAt: new Date(),
              source: 'amazon'
            }));

            if (currentSkuMaster) {
              // Update existing SKU Master with images
              currentSkuMaster.images = [...(currentSkuMaster.images || []), ...newImages];
              await currentSkuMaster.save();
              imagesFetched += imageResult.images.length;
              console.log(`[Image Fetch] Added ${imageResult.images.length} images to SKU Master for ${sku}`);
            } else {
              // Create SKU Master entry if it doesn't exist (with images)
              try {
                await SkuMaster.create({
                  sku: sku.toUpperCase(),
                  productName: item.productName || `Amazon Product ${item.asin}`,
                  images: newImages,
                  isActive: true
                });
                imagesFetched += imageResult.images.length;
                console.log(`[Image Fetch] Created SKU Master for ${sku} with ${imageResult.images.length} images`);
              } catch (skuErr) {
                // SKU Master might have been created in parallel, try to update instead
                if (skuErr.code === 11000) {
                  const existingSku = await SkuMaster.findOne({ sku: sku.toUpperCase() });
                  if (existingSku && (!existingSku.images || existingSku.images.length === 0)) {
                    existingSku.images = newImages;
                    await existingSku.save();
                    imagesFetched += imageResult.images.length;
                    console.log(`[Image Fetch] Updated existing SKU Master for ${sku} with ${imageResult.images.length} images`);
                  }
                } else {
                  throw skuErr;
                }
              }
            }
          }
        } catch (imgErr) {
          console.error(`[Image Fetch] Error fetching images for ASIN ${item.asin}:`, imgErr.message);
        }
      }
    } else {
      console.log('[Image Fetch] Auto-fetch images is disabled in settings');
    }
  }

  // Send batch notification to Admin
  if (imported > 0) {
    try {
      const notificationService = require('../services/notification.service');
      const summaryMessage = `📈 Sync Summary [${new Date().toLocaleString()}]

Total Sync: ${orders.length}
Imported: ${imported}
Skipped (Existing): ${skipped}
Jobs Created: ${jobsCreated}
Auto-Assigned to CAD: ${cadAssignedCount}
Images Fetched: ${imagesFetched}
Missing SKUs: ${missingSKUs.length}

Check the dashboard for details.`;

      await notificationService.notifyAdmins(summaryMessage, `Marketplace Sync Summary - ${imported} Orders`, null, 'sync_summary');
    } catch (notifyErr) {
      console.error('Failed to send batch notification:', notifyErr);
    }
  }

  return {
    imported,
    skipped,
    jobsCreated,
    cadAssignedCount,
    imagesFetched,
    errors: errors.length,
    total: orders.length,
    missingSKUs // Return SKUs not found in SKU Master
  };
}

// Sync eBay orders
exports.syncEbay = async (req, res) => {
  let syncLog = null;
  try {
    const { fromDate, toDate, accountCode, importAll } = req.body || {};

    // Calculate date range - use user-provided dates (from date picker)
    const startDate = fromDate ? new Date(fromDate) : null;
    const endDate = toDate ? new Date(toDate) : null;

    console.log(`Syncing eBay orders from ${startDate?.toISOString() || 'default'} to ${endDate?.toISOString() || 'default'} (Account: ${accountCode || 'All'}, ImportAll: ${!!importAll})`);

    // Create sync log entry
    syncLog = await SyncLog.startSync({
      syncType: 'ebay',
      accountCode: accountCode || 'ALL',
      triggeredBy: req.userId,
      triggerType: 'manual',
      requestParams: { fromDate: startDate, toDate: endDate, importAll: !!importAll }
    });

    let result;
    if (accountCode && accountCode !== 'all') {
      // Sync specific account
      const MarketplaceAccount = require('../models/MarketplaceAccount');
      const account = await MarketplaceAccount.findOne({ accountCode, channel: 'ebay' });
      if (!account) {
        // Check if the account exists but for a different channel (e.g., Amazon)
        const otherAccount = await MarketplaceAccount.findOne({ accountCode });
        if (otherAccount) {
          return res.status(400).json({
            success: false,
            message: `Account "${accountCode}" is configured for ${otherAccount.channel}, not eBay. Please select "All Activated Accounts" or configure eBay credentials for this account.`
          });
        }
        return res.status(404).json({
          success: false,
          message: `eBay account with code "${accountCode}" not found. Please configure it in Settings or select "All Activated Accounts".`
        });
      }
      let credentials = await account.getDecryptedCredentials();

      // If DB credentials are empty (auto-created account), try env credentials
      if (!credentials || !credentials.appId || !credentials.certId) {
        // Try matching env account: CSP_EBAY -> CSP, or direct match
        const envCode = accountCode.replace(/_EBAY$/, '');
        const envCreds = ebayService.getCredentialsFromEnv(envCode);
        if (envCreds.appId && envCreds.certId && envCreds.refreshToken) {
          credentials = envCreds;
        }
      }

      result = await ebayService.fetchOrdersForAccount(account, credentials, startDate, endDate, importAll);
    } else {
      // Sync all eBay accounts (multi-account like Amazon)
      result = await ebayService.fetchOrdersFromAllAccounts(startDate, endDate, importAll);
    }

    // Update sync log
    if (result.success) {
      await syncLog.complete('success', {
        ordersImported: result.stats?.ordersImported || 0,
        ordersSkipped: result.stats?.ordersSkipped || 0,
        jobsCreated: result.stats?.jobsCreated || 0,
        errors: result.stats?.errors || 0
      });
    } else {
      await syncLog.complete('failed', {}, result.message);
    }

    await AuditLog.log({
      user: req.userId,
      action: 'order_sync',
      entity: 'order',
      description: `Manual eBay order sync triggered (${accountCode || 'All'})`,
      metadata: { ...result, accountCode, syncLogId: syncLog._id },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: result.success,
      message: result.message,
      data: { ...result, syncLogId: syncLog._id }
    });
  } catch (error) {
    console.error('eBay sync error:', error);
    if (syncLog) {
      await syncLog.complete('failed', {}, error.message);
    }

    // Return troubleshooting info for token errors
    const responseData = {
      success: false,
      message: 'Failed to sync eBay orders',
      error: error.message
    };
    if (error.troubleshooting) {
      responseData.troubleshooting = error.troubleshooting;
    }
    res.status(500).json(responseData);
  }
};

// Test Amazon connection
exports.testAmazonConnection = async (req, res) => {
  try {
    const result = await amazonService.testConnection();
    res.json(result);
  } catch (error) {
    console.error('Amazon connection test error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Test eBay connection
exports.testEbayConnection = async (req, res) => {
  try {
    const result = await ebayService.testConnection();
    res.json(result);
  } catch (error) {
    console.error('eBay connection test error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Create manual order (supports multipart form data with file uploads)
exports.createManualOrder = async (req, res) => {
  try {
    let buyerName, buyerEmail, buyerPhone, shippingAddress, promisedDate, items;

    // Check if items is a string (from multipart form data) and needs parsing
    const isMultipart = typeof req.body.items === 'string' || (req.files && Object.keys(req.files).length > 0);

    if (isMultipart) {
      // Parse form data fields
      buyerName = req.body.buyerName;
      buyerEmail = req.body.buyerEmail || '';
      buyerPhone = req.body.buyerPhone || '';

      // Parse shippingAddress if it's a string
      if (typeof req.body.shippingAddress === 'string') {
        try {
          shippingAddress = JSON.parse(req.body.shippingAddress);
        } catch (e) {
          shippingAddress = {};
        }
      } else {
        shippingAddress = req.body.shippingAddress || {};
      }

      promisedDate = req.body.promisedDate || null;

      // Parse items if it's a string
      if (typeof req.body.items === 'string') {
        try {
          items = JSON.parse(req.body.items);
        } catch (e) {
          items = [];
        }
      } else {
        items = req.body.items || [];
      }
    } else {
      // Regular JSON body
      buyerName = req.body.buyerName;
      buyerEmail = req.body.buyerEmail;
      buyerPhone = req.body.buyerPhone;
      shippingAddress = req.body.shippingAddress;
      promisedDate = req.body.promisedDate;
      items = req.body.items;
    }

    // Validate buyer name
    if (!buyerName || buyerName.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Buyer name is required'
      });
    }

    // Validate items
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one item is required'
      });
    }

    // Generate external order ID for manual orders
    const count = await MarketplaceOrder.countDocuments({ channel: 'manual' });
    const externalOrderId = `MANUAL-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

    const order = await MarketplaceOrder.create({
      channel: 'manual',
      externalOrderId,
      buyerName,
      buyerEmail,
      buyerPhone,
      shippingAddress,
      status: 'pending',
      orderDate: new Date(),
      promisedDate: promisedDate ? new Date(promisedDate) : null
    });

    const createdItems = [];
    const createdJobs = [];

    // Process uploaded files
    const uploadedFiles = req.files || {};

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Generate SKU if not provided (required field in model)
      const itemSku = item.sku && item.sku.trim() !== ''
        ? item.sku
        : `MAN-${Date.now()}-${String(i + 1).padStart(3, '0')}`;

      // Handle CAD file for this item
      let cadFilePath = null;
      const cadFileKey = `cadFile_${i}`;
      if (uploadedFiles[cadFileKey] && uploadedFiles[cadFileKey][0]) {
        const cadFile = uploadedFiles[cadFileKey][0];
        // Move to CAD folder
        const newCadPath = path.join(__dirname, '../../uploads/cad', cadFile.filename);
        if (cadFile.path !== newCadPath) {
          fs.renameSync(cadFile.path, newCadPath);
        }
        cadFilePath = `/uploads/cad/${cadFile.filename}`;
      }

      // Handle reference images for this item
      const referenceImages = [];
      // Look for reference images with pattern refImage_<itemIndex>_<imageIndex>
      Object.keys(uploadedFiles).forEach(key => {
        if (key.startsWith(`refImage_${i}_`)) {
          const imgFiles = uploadedFiles[key];
          if (imgFiles && imgFiles[0]) {
            const imgFile = imgFiles[0];
            // Move to reference folder
            const newImgPath = path.join(__dirname, '../../uploads/reference', imgFile.filename);
            if (imgFile.path !== newImgPath) {
              try {
                fs.renameSync(imgFile.path, newImgPath);
              } catch (e) {
                // File might already be in the right place
              }
            }
            referenceImages.push(`/uploads/reference/${imgFile.filename}`);
          }
        }
      });

      const orderItem = await MarketplaceOrderItem.create({
        order: order._id,
        sku: itemSku,
        productName: item.productName || 'Manual Item',
        quantity: item.quantity || 1,
        itemPrice: item.itemPrice || 0
      });

      const job = await Job.create({
        sourceType: 'order',
        channel: 'manual',
        orderItem: orderItem._id,
        order: order._id,
        sku: itemSku,
        productName: item.productName || 'Manual Item',
        quantity: item.quantity || 1,
        dueDate: promisedDate ? new Date(promisedDate) : null,
        customerName: buyerName,
        customerRequest: item.customerRequest || '',
        priority: item.priority || 'medium',
        status: 'new',
        admin: req.userId,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        cadFilePath: cadFilePath || undefined,
        cadRequired: item.cadRequired === 'yes'
      });

      orderItem.isJobCreated = true;
      await orderItem.save();

      createdItems.push(orderItem);
      createdJobs.push(job);
    }

    await AuditLog.log({
      user: req.userId,
      action: 'job_create',
      entity: 'order',
      entityId: order._id,
      description: `Created manual order: ${externalOrderId}`,
      newValues: { buyerName, itemCount: items.length },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(201).json({
      success: true,
      message: 'Manual order created successfully',
      data: {
        order,
        items: createdItems,
        jobs: createdJobs
      }
    });
  } catch (error) {
    console.error('Create manual order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create manual order'
    });
  }
};

// Get order statistics
exports.getStatistics = async (req, res) => {
  try {
    const channelStats = await MarketplaceOrder.aggregate([
      {
        $group: {
          _id: '$channel',
          count: { $sum: 1 }
        }
      }
    ]);

    const statusStats = await MarketplaceOrder.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const todayOrders = await MarketplaceOrder.countDocuments({
      createdAt: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0))
      }
    });

    const weekOrders = await MarketplaceOrder.countDocuments({
      createdAt: {
        $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      }
    });

    res.json({
      success: true,
      data: {
        byChannel: channelStats.reduce((acc, s) => {
          acc[s._id] = s.count;
          return acc;
        }, {}),
        byStatus: statusStats.reduce((acc, s) => {
          acc[s._id] = s.count;
          return acc;
        }, {}),
        today: todayOrders,
        thisWeek: weekOrders
      }
    });
  } catch (error) {
    console.error('Get order statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
};

// Search existing customers from previous orders
exports.searchCustomers = async (req, res) => {
  try {
    const { search } = req.query;

    if (!search || search.length < 2) {
      return res.json({
        success: true,
        data: []
      });
    }

    // Search for unique customers from existing orders
    const customers = await MarketplaceOrder.aggregate([
      {
        $match: {
          $or: [
            { buyerName: { $regex: search, $options: 'i' } },
            { buyerEmail: { $regex: search, $options: 'i' } },
            { buyerPhone: { $regex: search, $options: 'i' } }
          ]
        }
      },
      {
        $group: {
          _id: {
            buyerName: '$buyerName',
            buyerEmail: '$buyerEmail'
          },
          buyerName: { $first: '$buyerName' },
          buyerEmail: { $first: '$buyerEmail' },
          buyerPhone: { $first: '$buyerPhone' },
          shippingAddress: { $first: '$shippingAddress' },
          lastOrderId: { $last: '$_id' },
          lastOrderDate: { $last: '$orderDate' },
          orderCount: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: '$lastOrderId',
          buyerName: 1,
          buyerEmail: 1,
          buyerPhone: 1,
          shippingAddress: 1,
          lastOrderDate: 1,
          orderCount: 1
        }
      },
      { $sort: { lastOrderDate: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      success: true,
      data: customers
    });
  } catch (error) {
    console.error('Search customers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search customers'
    });
  }
};

// Update CAD summary for an order based on its items
exports.updateOrderCadSummary = async (orderId) => {
  try {
    const items = await MarketplaceOrderItem.find({ order: orderId });
    const total = items.length;
    let withCad = 0;
    let withoutCad = 0;

    for (const item of items) {
      // Check SKU master for CAD file
      const skuStatus = await SkuMaster.checkCadStatus(item.sku);

      // Update item's CAD status
      item.hasCadFile = skuStatus.hasCadFile;
      item.cadFilePath = skuStatus.cadFilePath;
      await item.save();

      if (skuStatus.hasCadFile) {
        withCad++;
      } else {
        withoutCad++;
      }
    }

    // Determine CAD summary status
    let status = 'unknown';
    if (total > 0) {
      if (withCad === total) {
        status = 'all_cad';
      } else if (withoutCad === total) {
        status = 'no_cad';
      } else {
        status = 'partial';
      }
    }

    // Update order CAD summary
    await MarketplaceOrder.findByIdAndUpdate(orderId, {
      cadSummary: { total, withCad, withoutCad, status }
    });

    return { total, withCad, withoutCad, status };
  } catch (error) {
    console.error('Update CAD summary error:', error);
    throw error;
  }
};

// Refresh CAD status for all orders (or specific order)
exports.refreshCadStatus = async (req, res) => {
  try {
    const { orderId } = req.query;

    if (orderId) {
      // Refresh single order
      const result = await exports.updateOrderCadSummary(orderId);
      res.json({
        success: true,
        message: 'CAD status refreshed',
        data: result
      });
    } else {
      // Refresh all orders
      const orders = await MarketplaceOrder.find({});
      let updated = 0;

      for (const order of orders) {
        await exports.updateOrderCadSummary(order._id);
        updated++;
      }

      res.json({
        success: true,
        message: `CAD status refreshed for ${updated} orders`
      });
    }
  } catch (error) {
    console.error('Refresh CAD status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh CAD status'
    });
  }
};

// Get available account codes for filter
exports.getAccountCodes = async (req, res) => {
  try {
    const accounts = await MarketplaceOrder.distinct('accountCode');
    res.json({
      success: true,
      data: accounts.filter(a => a) // Filter out null/undefined
    });
  } catch (error) {
    console.error('Get account codes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch account codes'
    });
  }
};

// Bulk assign users to orders (creates/updates jobs)
exports.bulkAssign = async (req, res) => {
  try {
    const { orderIds, assignType, userId } = req.body;

    // Validate inputs
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No orders selected'
      });
    }

    if (!assignType || !['cadDesigner', 'manufacturer', 'admin'].includes(assignType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment type'
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    let jobsUpdated = 0;
    let jobsCreated = 0;

    // Process each order
    for (const orderId of orderIds) {
      const order = await MarketplaceOrder.findById(orderId);
      if (!order) continue;

      // Get items for this order
      const items = await MarketplaceOrderItem.find({ order: orderId });

      for (const item of items) {
        // Find existing job for this order item
        let job = await Job.findOne({ orderItem: item._id });

        if (job) {
          // Update existing job
          job[assignType] = userId;

          // Update status if assigning CAD designer to new job
          if (assignType === 'cadDesigner' && job.status === 'new') {
            job.status = 'cad_assigned';
          }
          // Update status if assigning manufacturer
          if (assignType === 'manufacturer' && ['cad_approved', 'components_issued'].includes(job.status)) {
            // Check CAD file for manufacturer assignment
            const skuStatus = await SkuMaster.checkCadStatus(item.sku);
            const hasCadFile = skuStatus.hasCadFile || !!job.cadFilePath;
            const isSuperAdmin = req.user?.roles?.some(r => r.name === 'super_admin');

            if (!hasCadFile && !isSuperAdmin) {
              console.log(`  Skipping manufacturer assign for ${item.sku} - No CAD`);
              continue;
            }
            job.status = 'manufacturing_assigned';
          }

          await job.save();
          jobsUpdated++;
        } else {
          // Create new job if one doesn't exist
          // Generate jobCode manually since pre-save hook runs after validation
          const year = new Date().getFullYear();
          const count = await Job.countDocuments({
            createdAt: {
              $gte: new Date(year, 0, 1),
              $lt: new Date(year + 1, 0, 1)
            }
          });
          const jobCode = `JOB-${year}-${String(count + 1).padStart(5, '0')}`;

          const newJob = await Job.create({
            jobCode,
            sourceType: 'order',
            channel: order.channel,
            accountCode: order.accountCode,
            orderItem: item._id,
            order: order._id,
            sku: item.sku,
            productName: item.productName,
            quantity: item.quantity,
            customerName: order.buyerName,
            priority: 'medium',
            status: assignType === 'cadDesigner' ? 'cad_assigned' : 'new',
            admin: req.userId,
            [assignType]: userId
          });

          // Mark item as having a job
          item.isJobCreated = true;
          await item.save();

          jobsCreated++;
        }
      }
    }

    // Log the bulk action
    await AuditLog.log({
      user: req.userId,
      action: 'bulk_assign',
      entity: 'order',
      description: `Bulk assigned ${assignType} to ${orderIds.length} orders`,
      newValues: { orderIds, assignType, userId, jobsUpdated, jobsCreated },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: `Successfully assigned user to ${orderIds.length} orders (${jobsCreated} jobs created, ${jobsUpdated} jobs updated)`,
      data: {
        ordersProcessed: orderIds.length,
        jobsCreated,
        jobsUpdated
      }
    });
  } catch (error) {
    console.error('Bulk assign error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk assign orders'
    });
  }
};

// Assign user to a single order
exports.assignUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignType, userId } = req.body;

    // Validate inputs
    if (!assignType || !['cadDesigner', 'manufacturer', 'admin'].includes(assignType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment type. Must be cadDesigner, manufacturer, or admin'
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const order = await MarketplaceOrder.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Get items for this order
    const items = await MarketplaceOrderItem.find({ order: id });

    // If assigning manufacturer, check if all items have CAD files
    if (assignType === 'manufacturer') {
      let missingCadItems = [];

      for (const item of items) {
        let hasCadFile = false;

        // Check SkuMaster for CAD files
        if (item.sku) {
          const skuMaster = await SkuMaster.findOne({ sku: item.sku.toUpperCase(), isActive: true });
          hasCadFile = !!(skuMaster?.hasCadFile || skuMaster?.cadFile?.filePath);
        }

        // Also check if job exists and has cadFilePath
        if (!hasCadFile) {
          const existingJob = await Job.findOne({ orderItem: item._id });
          hasCadFile = !!(existingJob?.cadFilePath || existingJob?.hasCadFile);
        }

        if (!hasCadFile) {
          missingCadItems.push(item.sku || item.productName || 'Unknown Item');
        }
      }

      if (missingCadItems.length > 0) {
        const isSuperAdmin = req.user?.roles?.some(r => r.name === 'super_admin');
        if (!isSuperAdmin) {
          return res.status(400).json({
            success: false,
            message: `Cannot assign manufacturer without CAD/STL file. Missing CAD for: ${missingCadItems.join(', ')}`
          });
        }
      }
    }

    let jobsUpdated = 0;
    let jobsCreated = 0;

    // Calculate TAT deadline based on assignment type
    let tatDeadline = null;
    if (assignType === 'cadDesigner') {
      tatDeadline = await calculateTATDeadline('cad');
    } else if (assignType === 'manufacturer') {
      tatDeadline = await calculateTATDeadline('manufacturing');
    }

    for (const item of items) {
      // Find existing job for this order item
      let job = await Job.findOne({ orderItem: item._id });

      if (job) {
        // Update existing job
        job[assignType] = userId;

        // Update status if assigning CAD designer to new job
        if (assignType === 'cadDesigner' && job.status === 'new') {
          job.status = 'cad_assigned';
          job.cadAssignedAt = new Date();
          job.cadDeadline = tatDeadline; // Set TAT deadline
        }
        // Update status if assigning manufacturer
        if (assignType === 'manufacturer' && ['cad_approved', 'components_issued'].includes(job.status)) {
          job.status = 'manufacturing_assigned';
          job.manufacturingAssignedAt = new Date();
          job.manufacturingDeadline = tatDeadline; // Set TAT deadline
        }

        await job.save();
        jobsUpdated++;
      } else {
        // Create new job if one doesn't exist
        const year = new Date().getFullYear();
        const count = await Job.countDocuments({
          createdAt: {
            $gte: new Date(year, 0, 1),
            $lt: new Date(year + 1, 0, 1)
          }
        });
        const jobCode = `JOB-${year}-${String(count + 1).padStart(5, '0')}`;

        await Job.create({
          jobCode,
          sourceType: 'order',
          channel: order.channel,
          accountCode: order.accountCode,
          orderItem: item._id,
          order: order._id,
          sku: item.sku,
          productName: item.productName,
          quantity: item.quantity,
          customerName: order.buyerName,
          priority: 'medium',
          status: assignType === 'cadDesigner' ? 'cad_assigned' : 'new',
          admin: req.userId,
          [assignType]: userId,
          ...(assignType === 'cadDesigner' ? { cadAssignedAt: new Date(), cadDeadline: tatDeadline } : {}),
          ...(assignType === 'manufacturer' ? { manufacturingAssignedAt: new Date(), manufacturingDeadline: tatDeadline } : {})
        });

        // Mark item as having a job
        item.isJobCreated = true;
        await item.save();

        jobsCreated++;
      }
    }

    // Fetch updated assignment info
    const jobs = await Job.find({ order: id })
      .populate('cadDesigner', 'name email')
      .populate('manufacturer', 'name email')
      .populate('admin', 'name email')
      .lean();

    const assignments = {
      cadDesigner: null,
      manufacturer: null,
      admin: null
    };

    if (jobs.length > 0) {
      const cadDesigners = jobs.filter(j => j.cadDesigner).map(j => j.cadDesigner);
      const manufacturers = jobs.filter(j => j.manufacturer).map(j => j.manufacturer);
      const admins = jobs.filter(j => j.admin).map(j => j.admin);

      if (cadDesigners.length > 0) assignments.cadDesigner = cadDesigners[0];
      if (manufacturers.length > 0) assignments.manufacturer = manufacturers[0];
      if (admins.length > 0) assignments.admin = admins[0];
    }

    // Log the action (don't fail the operation if audit logging fails)
    try {
      await AuditLog.log({
        user: req.userId,
        action: 'assign_user',
        entity: 'order',
        entityId: id,
        description: `Assigned ${assignType} to order ${order.externalOrderId}`,
        newValues: { assignType, userId, jobsUpdated, jobsCreated },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
    } catch (logError) {
      console.error('Audit log error (non-fatal):', logError);
    }

    res.json({
      success: true,
      message: `Successfully assigned ${assignType}`,
      data: {
        orderId: id,
        assignments,
        jobsCreated,
        jobsUpdated
      }
    });
  } catch (error) {
    console.error('Assign user error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to assign user to order'
    });
  }
};

// Update order
exports.updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const order = await MarketplaceOrder.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Store old values for audit
    const oldValues = {
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      status: order.status,
      totalAmount: order.totalAmount,
      shippingAddress: order.shippingAddress,
      notes: order.notes
    };

    // Update allowed fields
    if (updateData.buyerName) order.buyerName = updateData.buyerName;
    if (updateData.buyerEmail) order.buyerEmail = updateData.buyerEmail;
    if (updateData.status) order.status = updateData.status;
    if (updateData.totalAmount !== undefined) order.totalAmount = updateData.totalAmount;
    if (updateData.currency) order.currency = updateData.currency;
    if (updateData.notes !== undefined) order.notes = updateData.notes;
    if (updateData.shippingAddress) {
      order.shippingAddress = {
        ...order.shippingAddress,
        ...updateData.shippingAddress
      };
    }

    await order.save();

    // Audit log
    await AuditLog.log({
      user: req.userId,
      action: 'update',
      entity: 'order',
      entityId: order._id,
      description: `Updated order ${order.externalOrderId || order._id}`,
      oldValues,
      newValues: updateData,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Order updated successfully',
      data: order
    });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order'
    });
  }
};

// Upload order images
exports.uploadOrderImages = async (req, res) => {
  try {
    const { id } = req.params;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images uploaded'
      });
    }

    const order = await MarketplaceOrder.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Initialize images array if not exists
    if (!order.images) {
      order.images = [];
    }

    // Add new images
    const newImages = files.map((file, index) => ({
      fileName: file.originalname,
      filePath: `/uploads/orders/${file.filename}`,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedAt: new Date(),
      uploadedBy: req.userId
    }));

    order.images.push(...newImages);
    await order.save();

    // Audit log
    await AuditLog.log({
      user: req.userId,
      action: 'upload',
      entity: 'order',
      entityId: order._id,
      description: `Uploaded ${files.length} image(s) to order ${order.externalOrderId || order._id}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: `${files.length} image(s) uploaded successfully`,
      data: { images: newImages }
    });
  } catch (error) {
    console.error('Upload order images error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload images'
    });
  }
};

// Delete order (super admin only) - supports soft and hard delete
exports.deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteType = 'soft' } = req.query;

    const order = await MarketplaceOrder.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Get associated items and jobs for counting
    const items = await MarketplaceOrderItem.find({ order: id });
    const jobs = await Job.find({ order: id });

    if (deleteType === 'hard') {
      // HARD DELETE - Permanently remove everything

      // Delete associated jobs and their files
      for (const job of jobs) {
        // Delete job-related files if any
        if (job.cadFilePath) {
          const cadPath = path.join(__dirname, '../../', job.cadFilePath);
          if (fs.existsSync(cadPath)) {
            fs.unlinkSync(cadPath);
          }
        }
        await Job.findByIdAndDelete(job._id);
      }

      // Delete order items
      await MarketplaceOrderItem.deleteMany({ order: id });

      // Delete order images if any
      if (order.images && order.images.length > 0) {
        for (const img of order.images) {
          const imgPath = path.join(__dirname, '../../', img.filePath);
          if (fs.existsSync(imgPath)) {
            fs.unlinkSync(imgPath);
          }
        }
      }

      // Permanently delete the order
      await MarketplaceOrder.findByIdAndDelete(id);

      // Audit log
      await AuditLog.log({
        user: req.userId,
        action: 'hard_delete',
        entity: 'order',
        entityId: id,
        description: `Permanently deleted order ${order.externalOrderId || order.marketplaceOrderId || id} and ${jobs.length} jobs, ${items.length} items`,
        oldValues: {
          order: order.toObject(),
          itemCount: items.length,
          jobCount: jobs.length
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.json({
        success: true,
        message: `Order permanently deleted. Removed ${jobs.length} jobs and ${items.length} items.`
      });
    } else {
      // SOFT DELETE - Mark as deleted but keep data

      // Mark order as deleted
      order.isDeleted = true;
      order.deletedAt = new Date();
      order.deletedBy = req.userId;
      await order.save();

      // Mark associated jobs as cancelled
      await Job.updateMany(
        { order: id },
        {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: 'Order soft deleted by admin'
        }
      );

      // Audit log
      await AuditLog.log({
        user: req.userId,
        action: 'soft_delete',
        entity: 'order',
        entityId: id,
        description: `Soft deleted order ${order.externalOrderId || order.marketplaceOrderId || id} (moved to trash)`,
        oldValues: { isDeleted: false },
        newValues: { isDeleted: true, deletedAt: order.deletedAt },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.json({
        success: true,
        message: `Order moved to trash. ${jobs.length} job(s) cancelled.`
      });
    }
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete order'
    });
  }
};

// Delete order image
exports.deleteOrderImage = async (req, res) => {
  try {
    const { id, imageId } = req.params;

    const order = await MarketplaceOrder.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const imageIndex = order.images?.findIndex(img => img._id.toString() === imageId);
    if (imageIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    const deletedImage = order.images[imageIndex];

    // Delete file from disk
    const filePath = path.join(__dirname, '../../', deletedImage.filePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Remove from array
    order.images.splice(imageIndex, 1);
    await order.save();

    // Audit log
    await AuditLog.log({
      user: req.userId,
      action: 'delete',
      entity: 'order',
      entityId: order._id,
      description: `Deleted image from order ${order.externalOrderId || order._id}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Image deleted successfully'
    });
  } catch (error) {
    console.error('Delete order image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete image'
    });
  }
};

// Fetch product images from Amazon or eBay
exports.fetchProductImages = async (req, res) => {
  try {
    const { asin, sku, accountCode, channel, itemId } = req.body;

    // Validate input - need either ASIN (Amazon) or itemId (eBay)
    if (!asin && !itemId) {
      return res.status(400).json({
        success: false,
        message: 'ASIN (for Amazon) or itemId (for eBay) is required'
      });
    }

    // Determine channel from input or try to detect
    let useChannel = channel;
    if (!useChannel) {
      // If itemId provided but no asin, assume eBay
      if (itemId && !asin) {
        useChannel = 'ebay';
      } else {
        // Default to Amazon for ASIN
        useChannel = 'amazon';
      }
    }

    let result;
    let source;

    if (useChannel === 'ebay') {
      // eBay image fetch
      const legacyItemId = itemId || asin; // itemId is primary, asin might contain legacy ID
      console.log(`Fetching eBay product images for item ${legacyItemId}`);

      result = await ebayService.downloadProductImages(legacyItemId, sku || legacyItemId);
      source = 'ebay';

    } else {
      // Amazon image fetch (default)
      let credentials = null;
      let useAccountCode = accountCode || 'CSP'; // Default to CSP account

      // If SKU provided, try to find the order and get its account code
      if (sku && !accountCode) {
        const orderItem = await MarketplaceOrderItem.findOne({
          $or: [
            { sku: sku },
            { sku: sku.toUpperCase() },
            { asinOrItemId: asin }
          ]
        }).populate('order');

        if (orderItem?.order?.accountCode) {
          useAccountCode = orderItem.order.accountCode;
        }
      }

      // Get credentials from .env based on account code
      credentials = amazonService.getCredentialsFromEnv(useAccountCode);

      // Check if we have valid credentials
      if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
        // Try CSP as fallback
        credentials = amazonService.getCredentialsFromEnv('CSP');
        useAccountCode = 'CSP';

        if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
          return res.status(400).json({
            success: false,
            message: 'Amazon credentials not configured. Please configure CSP_AMAZON credentials in .env file.'
          });
        }
      }

      console.log(`Fetching Amazon product images for ASIN ${asin} using account: ${useAccountCode}`);

      // Download images from Amazon with proper credentials
      result = await amazonService.downloadProductImages(asin, sku || asin, credentials, useAccountCode);
      source = 'amazon';
    }

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message || 'Failed to fetch images'
      });
    }

    // If SKU provided, update SKU Master with images
    if (sku && result.images && result.images.length > 0) {
      const skuMaster = await SkuMaster.findOne({ sku: sku.toUpperCase() });
      if (skuMaster) {
        // Add images to SKU Master
        const newImages = result.images.map(img => ({
          fileName: img.fileName,
          filePath: img.filePath,
          uploadedAt: new Date(),
          source: source
        }));

        skuMaster.images = [...(skuMaster.images || []), ...newImages];
        await skuMaster.save();
      }
    }

    const identifier = source === 'ebay' ? (itemId || asin) : asin;
    await AuditLog.log({
      user: req.userId,
      action: 'fetch_images',
      entity: 'product',
      description: `Fetched ${result.downloadedCount} product images for ${source.toUpperCase()} ${identifier}`,
      metadata: { asin, itemId, sku, imageCount: result.downloadedCount, source },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: `Downloaded ${result.downloadedCount} images from ${source.toUpperCase()}`,
      data: result
    });

  } catch (error) {
    console.error('Fetch product images error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product images'
    });
  }
};

// Bulk download files for selected orders
exports.bulkDownload = async (req, res) => {
  const archiver = require('archiver');

  try {
    const { orderIds } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No orders selected'
      });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });

    // Handle archive errors
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Failed to create archive: ' + err.message
        });
      }
    });

    // Handle warnings (like stat failures)
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('Archive warning (file not found):', err);
      } else {
        console.warn('Archive warning:', err);
      }
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=orders_${new Date().toISOString().split('T')[0]}.zip`);

    archive.pipe(res);

    // Process each order
    for (const orderId of orderIds) {
      const order = await MarketplaceOrder.findById(orderId).lean();
      if (!order) continue;

      const orderFolder = `order_${order.externalOrderId || order._id}`;

      // Get order items with CAD files
      const items = await MarketplaceOrderItem.find({ order: orderId }).lean();

      for (const item of items) {
        if (item.sku) {
          const skuMaster = await SkuMaster.findOne({ sku: item.sku.toUpperCase(), isActive: true });
          if (skuMaster && skuMaster.cadFile?.filePath) {
            const cadFilePath = path.join(__dirname, '../../', skuMaster.cadFile.filePath);
            if (fs.existsSync(cadFilePath)) {
              archive.file(cadFilePath, {
                name: `${orderFolder}/cad/${item.sku}_${skuMaster.cadFile.fileName || 'cad.stl'}`
              });
            }
          }

          // Add product images from SKU Master
          if (skuMaster && skuMaster.images && skuMaster.images.length > 0) {
            skuMaster.images.forEach((img, idx) => {
              const imgPath = path.join(__dirname, '../../', img.filePath);
              if (fs.existsSync(imgPath)) {
                archive.file(imgPath, {
                  name: `${orderFolder}/images/${item.sku}_${idx + 1}_${img.fileName || 'image.jpg'}`
                });
              }
            });
          }
        }
      }

      // Add order images if any
      if (order.images && order.images.length > 0) {
        order.images.forEach((img, idx) => {
          const imgPath = path.join(__dirname, '../../', img.filePath);
          if (fs.existsSync(imgPath)) {
            archive.file(imgPath, {
              name: `${orderFolder}/order_images/${img.fileName || `image_${idx + 1}.jpg`}`
            });
          }
        });
      }

      // Add job reference images
      const jobs = await Job.find({ order: orderId }).lean();
      for (const job of jobs) {
        if (job.referenceImages && job.referenceImages.length > 0) {
          job.referenceImages.forEach((img, idx) => {
            const imgPath = path.join(__dirname, '../../', img);
            if (fs.existsSync(imgPath)) {
              archive.file(imgPath, {
                name: `${orderFolder}/reference/${job.sku || 'unknown'}_ref_${idx + 1}${path.extname(img)}`
              });
            }
          });
        }

        // Add job CAD files
        if (job.cadFilePath) {
          const cadPath = path.join(__dirname, '../../', job.cadFilePath);
          if (fs.existsSync(cadPath)) {
            archive.file(cadPath, {
              name: `${orderFolder}/cad/${job.sku || 'unknown'}_job_cad${path.extname(job.cadFilePath)}`
            });
          }
        }
      }

      // Create order summary text file
      const orderSummary = `Order: ${order.externalOrderId}
Channel: ${order.channel}
Customer: ${order.buyerName}
Email: ${order.buyerEmail || 'N/A'}
Order Date: ${order.orderDate ? new Date(order.orderDate).toLocaleString() : 'N/A'}
Status: ${order.status}
Total: ${order.totalAmount} ${order.currency}

Items:
${items.map((item, idx) => `${idx + 1}. SKU: ${item.sku || 'N/A'} - ${item.productName} (Qty: ${item.quantity})`).join('\n')}

Shipping Address:
${order.shippingAddress?.name || ''}
${order.shippingAddress?.addressLine1 || ''}
${order.shippingAddress?.addressLine2 || ''}
${order.shippingAddress?.city || ''}, ${order.shippingAddress?.state || ''} ${order.shippingAddress?.postalCode || ''}
${order.shippingAddress?.country || ''}
`;

      archive.append(orderSummary, { name: `${orderFolder}/order_summary.txt` });
    }

    await archive.finalize();

  } catch (error) {
    console.error('Bulk download error:', error);
    // Only send error response if headers haven't been sent yet
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to download files: ' + error.message
      });
    }
  }
};

// Get sync logs
exports.getSyncLogs = async (req, res) => {
  try {
    const { syncType, limit = 20, page = 1 } = req.query;
    const limitNum = parseInt(limit);
    const pageNum = parseInt(page);
    const skip = (pageNum - 1) * limitNum;

    const query = syncType ? { syncType } : {};

    const [logs, total] = await Promise.all([
      SyncLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('triggeredBy', 'name email'),
      SyncLog.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get sync logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sync logs'
    });
  }
};

// Get single sync log
exports.getSyncLog = async (req, res) => {
  try {
    const { id } = req.params;

    const log = await SyncLog.findById(id)
      .populate('triggeredBy', 'name email');

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Sync log not found'
      });
    }

    res.json({
      success: true,
      data: log
    });
  } catch (error) {
    console.error('Get sync log error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sync log'
    });
  }
};

// Get sync statistics
exports.getSyncStatistics = async (req, res) => {
  try {
    const { days = 7 } = req.query;

    const statistics = await SyncLog.getStatistics(parseInt(days));

    // Get last successful sync for each type
    const lastSuccessful = await SyncLog.aggregate([
      { $match: { status: 'success' } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$syncType',
          lastSync: { $first: '$createdAt' },
          lastSyncId: { $first: '$_id' },
          ordersImported: { $first: '$stats.ordersImported' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        statistics,
        lastSuccessful: lastSuccessful.reduce((acc, item) => {
          acc[item._id] = {
            lastSync: item.lastSync,
            syncId: item.lastSyncId,
            ordersImported: item.ordersImported
          };
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('Get sync statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sync statistics'
    });
  }
};

// Bulk update status for multiple orders
exports.bulkUpdateStatus = async (req, res) => {
  try {
    const { orderIds, status, notes } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order IDs are required'
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    const validStatuses = ['pending', 'processing', 'shipped', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const results = {
      success: [],
      failed: []
    };

    for (const orderId of orderIds) {
      try {
        const order = await MarketplaceOrder.findById(orderId);
        if (!order) {
          results.failed.push({ orderId, error: 'Order not found' });
          continue;
        }

        const oldStatus = order.status;
        order.status = status;
        if (notes) {
          order.notes = (order.notes || '') + `\n[${new Date().toISOString()}] Status changed from ${oldStatus} to ${status}: ${notes}`;
        }
        await order.save();

        results.success.push({
          orderId,
          externalOrderId: order.externalOrderId,
          oldStatus,
          newStatus: status
        });
      } catch (err) {
        results.failed.push({ orderId, error: err.message });
      }
    }

    // Log the bulk action
    await AuditLog.log({
      user: req.userId,
      action: 'bulk_status_update',
      entity: 'order',
      description: `Bulk status update to "${status}": ${results.success.length} succeeded, ${results.failed.length} failed`,
      metadata: { status, orderIds, results },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: `Updated ${results.success.length} order(s) to "${status}"`,
      data: results
    });
  } catch (error) {
    console.error('Bulk update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order statuses'
    });
  }
};

// Trigger cron sync via URL (manual trigger)
exports.triggerCronSync = async (req, res) => {
  try {
    const { syncType = 'all' } = req.body;

    console.log(`[Cron Trigger] Manual sync triggered via URL for: ${syncType}`);

    const results = {
      amazon: null,
      ebay: null
    };

    // Create sync log for URL-triggered sync
    let syncLog = null;

    if (syncType === 'all' || syncType === 'amazon') {
      syncLog = await SyncLog.startSync({
        syncType: 'amazon',
        accountCode: 'CSP',
        triggeredBy: req.userId,
        triggerType: 'url_trigger',
        requestParams: { source: 'cron_url_trigger' }
      });

      try {
        // Run the Amazon sync
        const scriptPath = path.join(__dirname, '../../scripts/csp_fetch_orders.py');
        if (fs.existsSync(scriptPath)) {
          console.log('[Cron Trigger] Running Python script for Amazon sync...');
          const output = execSync(`python "${scriptPath}"`, {
            encoding: 'utf-8',
            timeout: 300000,
            cwd: path.join(__dirname, '../../scripts')
          });

          const jsonStart = output.indexOf('{');
          const jsonEnd = output.lastIndexOf('}');
          if (jsonStart !== -1 && jsonEnd !== -1) {
            const pythonResult = JSON.parse(output.substring(jsonStart, jsonEnd + 1));

            if (pythonResult.success && pythonResult.orders && pythonResult.orders.length > 0) {
              const importResult = await importOrdersFromPython(pythonResult.orders, req.userId);
              results.amazon = {
                success: true,
                imported: importResult.imported,
                skipped: importResult.skipped,
                stats: pythonResult.stats
              };

              await syncLog.complete('success', {
                ordersImported: importResult.imported,
                ordersSkipped: importResult.skipped,
                jobsCreated: importResult.jobsCreated
              });
            } else {
              results.amazon = {
                success: true,
                imported: 0,
                message: 'No pending orders found',
                stats: pythonResult.stats
              };
              await syncLog.complete('success', { ordersImported: 0 });
            }
          }
        } else {
          // Fallback to Node.js service
          const amazonResult = await amazonService.fetchOrdersFromAllAccounts();
          results.amazon = amazonResult;
          await syncLog.complete(amazonResult.success ? 'success' : 'failed', {
            ordersImported: amazonResult.imported || 0
          });
        }
      } catch (err) {
        console.error('[Cron Trigger] Amazon sync error:', err.message);
        results.amazon = { success: false, error: err.message };
        if (syncLog) await syncLog.complete('failed', {}, err.message);
      }
    }

    if (syncType === 'all' || syncType === 'ebay') {
      try {
        const ebayResult = await ebayService.fetchOrders();
        results.ebay = ebayResult;
      } catch (err) {
        console.error('[Cron Trigger] eBay sync error:', err.message);
        results.ebay = { success: false, error: err.message };
      }
    }

    await AuditLog.log({
      user: req.userId,
      action: 'order_sync',
      entity: 'order',
      description: `Manual sync triggered via URL for: ${syncType}`,
      metadata: { syncType, results },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: `Sync triggered successfully for: ${syncType}`,
      data: results
    });
  } catch (error) {
    console.error('Trigger cron sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger sync: ' + error.message
    });
  }
};

// Helper function for cron trigger (reference to existing function)
async function importOrdersFromPython(orders, userId) {
  let imported = 0;
  let skipped = 0;
  let jobsCreated = 0;
  const errors = [];
  const missingSKUs = [];

  for (const orderData of orders) {
    try {
      // Check if order already exists
      const existingOrder = await MarketplaceOrder.findOne({
        externalOrderId: orderData.externalOrderId,
        channel: orderData.channel
      });

      if (existingOrder) {
        skipped++;
        continue;
      }

      // Create order
      const order = new MarketplaceOrder({
        channel: orderData.channel,
        externalOrderId: orderData.externalOrderId,
        accountCode: orderData.accountCode,
        buyerName: orderData.buyerName || 'Amazon Customer',
        buyerEmail: orderData.buyerEmail,
        shippingAddress: orderData.shippingAddress,
        status: 'pending',
        orderDate: orderData.orderDate,
        promisedDate: orderData.promisedDate,
        totalAmount: orderData.totalAmount,
        currency: orderData.currency || 'USD',
        rawPayload: orderData
      });

      await order.save();

      // Create order items
      if (orderData.items && orderData.items.length > 0) {
        for (const item of orderData.items) {
          const orderItem = new MarketplaceOrderItem({
            order: order._id,
            sku: item.sku,
            asin: item.asin,
            productName: item.productName,
            quantity: item.quantity || 1,
            itemPrice: item.itemPrice,
            currency: item.currency || orderData.currency || 'USD'
          });
          await orderItem.save();

          // Check SKU master
          const skuMaster = await SkuMaster.findOne({ sku: item.sku });
          if (!skuMaster) {
            missingSKUs.push({
              sku: item.sku,
              productName: item.productName,
              asin: item.asin
            });
          }
        }
      }

      imported++;
    } catch (err) {
      console.error('Error importing order:', orderData.externalOrderId, err.message);
      errors.push({ orderId: orderData.externalOrderId, error: err.message });
    }
  }

  return { imported, skipped, jobsCreated, errors: errors.length, missingSKUs };
}
