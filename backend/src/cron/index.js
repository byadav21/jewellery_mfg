const cron = require('node-cron');
const { Job, SystemSettings, WhatsAppFunnel, WhatsAppFunnelRun } = require('../models');
const amazonService = require('../services/amazon.service');
const ebayService = require('../services/ebay.service');
const notificationService = require('../services/notification.service');
const whatsAppFunnelEngine = require('../services/whatsappFunnelEngine.service');
const slaService = require('../services/sla.service');

// Dynamic cron job management
let orderSyncJob = null;
let currentCronExpression = null;

// Helper function to trigger WhatsApp funnel for TAT breach
const triggerWhatsAppTATFunnel = async (job, stage, tatHours) => {
  try {
    // Check if WhatsApp TAT notifications are enabled
    const whatsappTATEnabled = await SystemSettings.getSetting('whatsapp_tat_breach_enabled');
    if (!whatsappTATEnabled) {
      return;
    }

    // Get customer phone from job
    const customerPhone = job.customerPhone || job.contactPhone;
    if (!customerPhone) {
      console.log(`  📱 No phone number for job ${job.jobCode}, skipping WhatsApp`);
      return;
    }

    // Find active TAT breach funnel
    const tatFunnel = await WhatsAppFunnel.findOne({
      isActive: true,
      'triggers.type': 'tat_breach',
      $or: [
        { 'triggers.conditions.stage': stage },
        { 'triggers.conditions.stage': { $exists: false } }
      ]
    });

    if (!tatFunnel) {
      console.log(`  📱 No active WhatsApp funnel for TAT breach (${stage})`);
      return;
    }

    // Check if funnel already running for this job
    const existingRun = await WhatsAppFunnelRun.findOne({
      funnel: tatFunnel._id,
      phoneNumber: customerPhone,
      'relatedEntities.jobId': job._id,
      status: { $in: ['running', 'waiting'] }
    });

    if (existingRun) {
      console.log(`  📱 WhatsApp funnel already running for job ${job.jobCode}`);
      return;
    }

    // Trigger the funnel
    const result = await whatsAppFunnelEngine.startFunnel(tatFunnel._id, customerPhone, {
      type: 'tat_breach',
      event: {
        stage,
        tatHours,
        jobId: job._id,
        jobCode: job.jobCode,
        customerName: job.customerName,
        productDescription: job.productDescription
      }
    });

    if (result.success) {
      console.log(`  📱 WhatsApp TAT funnel triggered for ${job.jobCode} -> ${customerPhone}`);

      // Update the funnel run with job reference
      await WhatsAppFunnelRun.findByIdAndUpdate(result.runId, {
        'relatedEntities.jobId': job._id,
        'relatedEntities.tatBreachId': `${job.jobCode}-${stage}`
      });
    } else {
      console.log(`  📱 Failed to trigger WhatsApp funnel: ${result.error}`);
    }
  } catch (error) {
    console.error(`  Error triggering WhatsApp TAT funnel for ${job.jobCode}:`, error.message);
  }
};

// Helper function to process WhatsApp funnel timeouts
const processWhatsAppTimeouts = async () => {
  try {
    const timedOutRuns = await WhatsAppFunnelRun.findTimedOutRuns();

    for (const run of timedOutRuns) {
      console.log(`  📱 Processing timeout for funnel run ${run._id}`);
      await whatsAppFunnelEngine.handleTimeout(run._id);
    }

    if (timedOutRuns.length > 0) {
      console.log(`  📱 Processed ${timedOutRuns.length} WhatsApp funnel timeouts`);
    }
  } catch (error) {
    console.error('  Error processing WhatsApp timeouts:', error.message);
  }
};

// Function to run the actual sync
const runOrderSync = async () => {
  console.log('🔄 Running order sync job...');

  try {
    // Amazon sync
    const amazonSyncEnabled = await SystemSettings.getSetting('amazon_sync_enabled');
    if (amazonSyncEnabled === true || amazonSyncEnabled === 'true') {
      console.log('  📦 Syncing Amazon orders...');
      const daysBack = await SystemSettings.getSetting('amazon_sync_days_back') || 7;
      const amazonResult = await amazonService.fetchOrdersWithDaysBack(parseInt(daysBack));
      console.log(`  Amazon: ${amazonResult.message}`);
    }

    // eBay sync
    const ebayEnabled = await SystemSettings.getSetting('ebay_sync_enabled');
    if (ebayEnabled === true || ebayEnabled === 'true') {
      console.log('  📦 Syncing eBay orders...');
      const ebayResult = await ebayService.fetchOrders();
      console.log(`  eBay: ${ebayResult.message}`);
    }
  } catch (error) {
    console.error('Order sync error:', error);
  }
};

// Convert interval (minutes) to cron expression
const intervalToCron = (intervalMinutes, specificTime) => {
  // If a specific time is set, use it for daily sync
  if (specificTime) {
    const [hours, minutes] = specificTime.split(':');
    return `${minutes} ${hours} * * *`; // Run at specific time daily
  }

  // Convert minutes to cron expression
  const interval = parseInt(intervalMinutes) || 30;

  if (interval >= 1440) {
    // Daily - run at midnight
    return '0 0 * * *';
  } else if (interval >= 60) {
    // Hourly intervals
    const hours = Math.floor(interval / 60);
    return `0 */${hours} * * *`;
  } else {
    // Minute intervals
    return `*/${interval} * * * *`;
  }
};

// Initialize or update the order sync cron job based on settings
const initializeOrderSyncJob = async () => {
  try {
    const syncEnabled = await SystemSettings.getSetting('amazon_sync_enabled');
    const syncInterval = await SystemSettings.getSetting('amazon_sync_interval') || 30;
    const syncTime = await SystemSettings.getSetting('amazon_sync_time') || '';

    const cronExpression = intervalToCron(syncInterval, syncTime);

    // Only recreate job if expression changed or job doesn't exist
    if (cronExpression !== currentCronExpression || !orderSyncJob) {
      // Stop existing job if any
      if (orderSyncJob) {
        orderSyncJob.stop();
        console.log('  ⏹️ Stopped previous order sync job');
      }

      // Create new job
      orderSyncJob = cron.schedule(cronExpression, runOrderSync, { scheduled: false });
      currentCronExpression = cronExpression;

      console.log(`  📅 Order sync cron expression: ${cronExpression}`);
    }

    // Start or stop based on enabled setting
    if (syncEnabled === true || syncEnabled === 'true') {
      orderSyncJob.start();
      console.log(`  ✓ Order sync job started (${cronExpression})`);
    } else {
      orderSyncJob.stop();
      console.log('  ⏸️ Order sync job disabled');
    }
  } catch (error) {
    console.error('Error initializing order sync job:', error);
  }
};

// Function to refresh cron settings (can be called when settings change)
const refreshCronSettings = async () => {
  console.log('🔄 Refreshing cron settings...');
  await initializeOrderSyncJob();
};

// TAT breach monitoring job (every 30 minutes)
const tatMonitorJob = cron.schedule('*/30 * * * *', async () => {
  console.log('⏰ Running TAT breach monitoring...');

  try {
    const isEnabled = await SystemSettings.getSetting('notification_tat_breach_enabled');
    if (!isEnabled) {
      console.log('  TAT breach notifications disabled');
      return;
    }

    // Get TAT thresholds
    const cadTATHours = await SystemSettings.getSetting('tat_cad_hours') || 48;
    const manufacturingTATHours = await SystemSettings.getSetting('tat_manufacturing_hours') || 72;
    const deliveryTATHours = await SystemSettings.getSetting('tat_delivery_hours') || 24;

    // Check CAD TAT breaches
    const now = new Date();
    const cadBreachedJobs = await Job.find({
      status: { $in: ['cad_assigned', 'cad_in_progress'] },
      $or: [
        { cadDeadline: { $lt: now } },
        {
          cadDeadline: { $exists: false },
          cadAssignedAt: { $lt: new Date(Date.now() - cadTATHours * 60 * 60 * 1000) }
        }
      ],
      'tatBreaches.stage': { $ne: 'CAD' }
    }).populate('cadDesigner', 'name email phone');

    for (const job of cadBreachedJobs) {
      console.log(`  ⚠️ CAD TAT breach: ${job.jobCode}`);

      // Record breach
      job.tatBreaches.push({
        stage: 'CAD',
        breachedAt: new Date(),
        notificationSent: true
      });
      await job.save();

      // Send notification
      await notificationService.sendTATBreachNotification(job, 'CAD Design');

      // Trigger WhatsApp funnel for TAT breach
      await triggerWhatsAppTATFunnel(job, 'CAD', cadTATHours);
    }

    // Check Manufacturing TAT breaches
    const mfgBreachTime = new Date(Date.now() - manufacturingTATHours * 60 * 60 * 1000);
    const mfgBreachedJobs = await Job.find({
      status: { $in: ['manufacturing_assigned', 'manufacturing_accepted', 'manufacturing_in_progress'] },
      manufacturingAssignedAt: { $lt: mfgBreachTime },
      'tatBreaches.stage': { $ne: 'Manufacturing' }
    }).populate('manufacturer', 'name email phone');

    for (const job of mfgBreachedJobs) {
      console.log(`  ⚠️ Manufacturing TAT breach: ${job.jobCode}`);

      job.tatBreaches.push({
        stage: 'Manufacturing',
        breachedAt: new Date(),
        notificationSent: true
      });
      await job.save();

      await notificationService.sendTATBreachNotification(job, 'Manufacturing');

      // Trigger WhatsApp funnel for TAT breach
      await triggerWhatsAppTATFunnel(job, 'Manufacturing', manufacturingTATHours);
    }

    // Check Delivery TAT breaches (jobs ready but not delivered)
    const deliveryBreachTime = new Date(Date.now() - deliveryTATHours * 60 * 60 * 1000);
    const deliveryBreachedJobs = await Job.find({
      status: { $in: ['manufacturing_ready_delivery', 'ready_for_pickup', 'shipped'] },
      manufacturingCompletedAt: { $lt: deliveryBreachTime },
      'tatBreaches.stage': { $ne: 'Delivery' }
    });

    for (const job of deliveryBreachedJobs) {
      console.log(`  ⚠️ Delivery TAT breach: ${job.jobCode}`);

      job.tatBreaches.push({
        stage: 'Delivery',
        breachedAt: new Date(),
        notificationSent: true
      });
      await job.save();

      await notificationService.sendTATBreachNotification(job, 'Delivery');

      // Trigger WhatsApp funnel for TAT breach
      await triggerWhatsAppTATFunnel(job, 'Delivery', deliveryTATHours);
    }

    // Check overall due date breaches
    const overdueJobs = await Job.find({
      status: { $nin: ['delivered', 'cancelled'] },
      dueDate: { $lt: new Date() },
      'tatBreaches.stage': { $ne: 'Due Date' }
    });

    for (const job of overdueJobs) {
      console.log(`  ⚠️ Due date breach: ${job.jobCode}`);

      job.tatBreaches.push({
        stage: 'Due Date',
        breachedAt: new Date(),
        notificationSent: true
      });
      await job.save();

      await notificationService.sendTATBreachNotification(job, 'Due Date Exceeded');

      // Trigger WhatsApp funnel for TAT breach
      await triggerWhatsAppTATFunnel(job, 'Due Date', 0);
    }

    // Process WhatsApp funnel timeouts
    await processWhatsAppTimeouts();

    console.log('  TAT monitoring complete');
  } catch (error) {
    console.error('TAT monitoring error:', error);
  }
}, {
  scheduled: false
});

// Daily summary job (every day at 9 AM)
const dailySummaryJob = cron.schedule('0 9 * * *', async () => {
  console.log('📊 Generating daily summary...');

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Get statistics
    const newOrdersYesterday = await Job.countDocuments({
      createdAt: { $gte: yesterday, $lt: today }
    });

    const completedYesterday = await Job.countDocuments({
      status: 'delivered',
      updatedAt: { $gte: yesterday, $lt: today }
    });

    const pendingJobs = await Job.countDocuments({
      status: { $nin: ['delivered', 'cancelled'] }
    });

    const overdueJobs = await Job.countDocuments({
      status: { $nin: ['delivered', 'cancelled'] },
      dueDate: { $lt: new Date() }
    });

    const message = `📊 Daily Summary - ${today.toLocaleDateString()}

📦 New Jobs Yesterday: ${newOrdersYesterday}
✅ Completed Yesterday: ${completedYesterday}
⏳ Pending Jobs: ${pendingJobs}
⚠️ Overdue Jobs: ${overdueJobs}

Have a productive day!`;

    const subject = `Daily Summary - ${today.toLocaleDateString()}`;

    await notificationService.notifyAdmins(message, subject, null, 'manual');

    console.log('  Daily summary sent');
  } catch (error) {
    console.error('Daily summary error:', error);
  }
}, {
  scheduled: false
});

// Start all cron jobs
const startCronJobs = async () => {
  console.log('⚙️ Starting cron jobs...');

  // Initialize order sync with dynamic settings from database
  await initializeOrderSyncJob();

  tatMonitorJob.start();
  console.log('  ✓ TAT monitoring job started (every 30 minutes)');

  // Start SLA Monitoring service
  slaService.startMonitoring();

  dailySummaryJob.start();
  console.log('  ✓ Daily summary job started (9 AM daily)');
};

// Stop all cron jobs
const stopCronJobs = () => {
  if (orderSyncJob) orderSyncJob.stop();
  tatMonitorJob.stop();
  dailySummaryJob.stop();
  console.log('⏹️ All cron jobs stopped');
};

// Manual trigger for order sync (used by API endpoint)
const triggerOrderSync = async () => {
  console.log('🔄 Manual order sync triggered...');
  await runOrderSync();
};

module.exports = {
  startCronJobs,
  stopCronJobs,
  refreshCronSettings,
  triggerOrderSync,
  tatMonitorJob,
  dailySummaryJob
};
