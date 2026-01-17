const { Job, User, SystemSettings } = require('../models');
const notificationService = require('./notification.service');
const cron = require('node-cron');

class SLAService {
    constructor() {
        this.isMonitoring = false;
    }

    /**
     * Start the SLA monitoring cron job
     */
    startMonitoring() {
        if (this.isMonitoring) return;

        console.log('[SLA] Starting SLA monitoring service...');

        // Run every 15 minutes
        cron.schedule('*/15 * * * *', () => {
            this.checkForBreaches();
        });

        this.isMonitoring = true;
    }

    /**
     * Check all active jobs for TAT breaches
     */
    async checkForBreaches() {
        try {
            const now = new Date();

            // 1. Check CAD stage breaches
            const pendingCadJobs = await Job.find({
                status: { $in: ['cad_assigned', 'cad_in_progress'] },
                cadDeadline: { $lt: now },
                cadRequired: true,
                // Only if not already logged as breached for this stage
                'tatBreaches.stage': { $ne: 'CAD' }
            }).populate('cadDesigner manufacturer');

            for (const job of pendingCadJobs) {
                await this.handleBreach(job, 'CAD');
            }

            // 2. Check Manufacturing stage breaches
            const pendingMfgJobs = await Job.find({
                status: { $in: ['manufacturing_assigned', 'manufacturing_accepted', 'manufacturing_in_progress'] },
                manufacturingDeadline: { $lt: now },
                'tatBreaches.stage': { $ne: 'Manufacturing' }
            }).populate('cadDesigner manufacturer');

            for (const job of pendingMfgJobs) {
                await this.handleBreach(job, 'Manufacturing');
            }

        } catch (error) {
            console.error('[SLA] Breach check error:', error);
        }
    }

    /**
     * Handle a detected breach
     */
    async handleBreach(job, stage) {
        try {
            console.log(`[SLA] Detected breach for Job ${job.jobCode} at stage ${stage}`);

            // Add breach record to job
            job.tatBreaches.push({
                stage,
                breachedAt: new Date(),
                notificationSent: true
            });

            await job.save();

            // Trigger notification
            await notificationService.sendTATBreachNotification(job, stage);

        } catch (error) {
            console.error(`[SLA] Error handling breach for ${job.jobCode}:`, error);
        }
    }
}

module.exports = new SLAService();
