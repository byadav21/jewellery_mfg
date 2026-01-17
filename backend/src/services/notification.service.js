const axios = require('axios');
const nodemailer = require('nodemailer');
const { SystemSettings, NotificationLog, User } = require('../models');
const whatsappService = require('./whatsapp.service');

class NotificationService {
  constructor() {
    this.emailTransporter = null;
  }

  async initEmailTransporter() {
    const smtpHost = await SystemSettings.getSetting('email_smtp_host');
    const smtpPort = await SystemSettings.getSetting('email_smtp_port');
    const smtpUser = await SystemSettings.getSetting('email_smtp_user', true);
    const smtpPass = await SystemSettings.getSetting('email_smtp_password', true);

    if (smtpHost && smtpUser && smtpPass) {
      this.emailTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort || 587,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });
    }
  }

  // WhatsApp notification
  async sendWhatsApp(recipient, message, jobId = null, triggerType = 'manual', options = {}) {
    try {
      const isEnabled = await SystemSettings.getSetting('whatsapp_enabled');
      if (!isEnabled) {
        console.log('WhatsApp notifications disabled');
        return { success: false, message: 'WhatsApp disabled' };
      }

      // Record in NotificationLog
      const notificationLog = await NotificationLog.create({
        job: jobId,
        channel: 'whatsapp',
        recipient,
        message: typeof message === 'string' ? message : JSON.stringify(message),
        triggerType,
        status: 'pending'
      });

      let result;
      if (options.template) {
        // Find template ID from SystemSettings if not provided
        let templateName = options.template;
        if (templateName === 'automatic') {
          // Look up based on trigger type
          const settingKey = `whatsapp_template_${triggerType}`;
          templateName = await SystemSettings.getSetting(settingKey) || options.fallbackTemplate;
        }

        if (templateName) {
          result = await whatsappService.sendTemplateMessage(recipient, templateName, options.params || []);
        } else {
          result = await whatsappService.sendMessageWithFallback(recipient, message);
        }
      } else {
        result = await whatsappService.sendMessageWithFallback(recipient, message);
      }

      if (result.success) {
        notificationLog.status = 'sent';
        notificationLog.sentAt = new Date();
        notificationLog.messageId = result.messageId;
        await notificationLog.save();
        return { success: true, messageId: result.messageId };
      } else {
        notificationLog.status = 'failed';
        notificationLog.errorMessage = result.error;
        await notificationLog.save();
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('WhatsApp notification error:', error.message);
      return { success: false, message: error.message };
    }
  }

  // Email notification
  async sendEmail(recipient, subject, htmlContent, jobId = null, triggerType = 'manual') {
    try {
      const isEnabled = await SystemSettings.getSetting('email_enabled');
      if (!isEnabled) {
        console.log('Email notifications disabled');
        return { success: false, message: 'Email disabled' };
      }

      await this.initEmailTransporter();

      if (!this.emailTransporter) {
        console.log('Email transporter not configured');
        return { success: false, message: 'Email not configured' };
      }

      const fromName = await SystemSettings.getSetting('email_from_name') || 'Jewellery Manufacturing';
      const fromAddress = await SystemSettings.getSetting('email_from_address');

      // Log notification attempt
      const notificationLog = await NotificationLog.create({
        job: jobId,
        channel: 'email',
        recipient,
        subject,
        message: htmlContent,
        triggerType,
        status: 'pending'
      });

      try {
        const result = await this.emailTransporter.sendMail({
          from: `"${fromName}" <${fromAddress}>`,
          to: recipient,
          subject,
          html: htmlContent
        });

        notificationLog.status = 'sent';
        notificationLog.sentAt = new Date();
        notificationLog.providerResponse = result;
        await notificationLog.save();

        return { success: true, message: 'Email sent successfully' };
      } catch (error) {
        notificationLog.status = 'failed';
        notificationLog.errorMessage = error.message;
        await notificationLog.save();

        throw error;
      }
    } catch (error) {
      console.error('Email error:', error.message);
      return { success: false, message: error.message };
    }
  }

  // Send notification to all admins
  async notifyAdmins(message, subject, jobId = null, triggerType = 'manual') {
    try {
      const adminRole = await require('../models/Role').findOne({ name: 'admin' });
      const superAdminRole = await require('../models/Role').findOne({ name: 'super_admin' });

      const admins = await User.find({
        roles: { $in: [adminRole?._id, superAdminRole?._id] },
        isActive: true
      });

      const results = [];

      for (const admin of admins) {
        // Send WhatsApp if phone available
        if (admin.phone) {
          results.push(await this.sendWhatsApp(admin.phone, message, jobId, triggerType));
        }

        // Send email if available
        if (admin.email) {
          results.push(await this.sendEmail(admin.email, subject, message, jobId, triggerType));
        }
      }

      return results;
    } catch (error) {
      console.error('Notify admins error:', error);
      return [];
    }
  }

  // Order import notification
  async sendOrderImportNotification(order, jobCount) {
    const message = `📦 New Order Imported!

Channel: ${order.channel.toUpperCase()}
Order ID: ${order.externalOrderId}
Customer: ${order.buyerName}
Jobs Created: ${jobCount}
Order Date: ${new Date(order.orderDate).toLocaleDateString()}
${order.promisedDate ? `Due Date: ${new Date(order.promisedDate).toLocaleDateString()}` : ''}

Please check the dashboard for details.`;

    const subject = `New ${order.channel.toUpperCase()} Order - ${order.externalOrderId}`;

    await this.notifyAdmins(message, subject, null, 'order_imported');
  }

  // Status change notification
  async sendStatusChangeNotification(job, oldStatus, newStatus, changedBy) {
    const isEnabled = await SystemSettings.getSetting('notification_status_change_enabled');
    if (!isEnabled) return;

    const message = `🔄 Job Status Updated

Job: ${job.jobCode}
SKU: ${job.sku || 'N/A'}
Channel: ${job.channel.toUpperCase()}
Status: ${oldStatus} → ${newStatus}
${job.dueDate ? `Due Date: ${new Date(job.dueDate).toLocaleDateString()}` : ''}

View job details in the dashboard.`;

    const subject = `Job ${job.jobCode} - Status Changed to ${newStatus}`;

    // Notify relevant parties based on new status
    if (newStatus.includes('cad') && job.cadDesigner) {
      const designer = await User.findById(job.cadDesigner);
      if (designer?.phone) {
        await this.sendWhatsApp(designer.phone, message, job._id, 'cad_assigned');
      }
      if (designer?.email) {
        await this.sendEmail(designer.email, subject, message, job._id, 'cad_assigned');
      }
    }

    if (newStatus.includes('manufacturing') && job.manufacturer) {
      const manufacturer = await User.findById(job.manufacturer);
      if (manufacturer?.phone) {
        await this.sendWhatsApp(manufacturer.phone, message, job._id, 'manufacturing_assigned');
      }
      if (manufacturer?.email) {
        await this.sendEmail(manufacturer.email, subject, message, job._id, 'manufacturing_assigned');
      }
    }

    // Always notify admins
    await this.notifyAdmins(message, subject, job._id, 'status_change');
  }

  // TAT breach notification
  async sendTATBreachNotification(job, stage) {
    const message = `⚠️ TAT BREACH ALERT!

Job: ${job.jobCode}
SKU: ${job.sku || 'N/A'}
Channel: ${job.channel.toUpperCase()}
Stage: ${stage}
Current Status: ${job.status}
${job.dueDate ? `Due Date: ${new Date(job.dueDate).toLocaleDateString()}` : ''}

IMMEDIATE ACTION REQUIRED!`;

    const subject = `🚨 TAT Breach - Job ${job.jobCode} - ${stage}`;

    // Notify assigned person
    let assignedUser = null;
    if (stage.includes('CAD') && job.cadDesigner) {
      assignedUser = await User.findById(job.cadDesigner);
    } else if (stage.includes('Manufacturing') && job.manufacturer) {
      assignedUser = await User.findById(job.manufacturer);
    }

    if (assignedUser) {
      if (assignedUser.phone) {
        await this.sendWhatsApp(assignedUser.phone, message, job._id, 'tat_breach');
      }
      if (assignedUser.email) {
        await this.sendEmail(assignedUser.email, subject, message, job._id, 'tat_breach');
      }
    }

    // Always notify admins for TAT breach
    await this.notifyAdmins(message, subject, job._id, 'tat_breach');
  }

  // Delivery notification
  async sendDeliveryNotification(job, deliveryDetails) {
    const isHandDelivery = deliveryDetails.deliveryType === 'hand';

    const message = `✅ Job Delivered!

Job: ${job.jobCode}
SKU: ${job.sku || 'N/A'}
Channel: ${job.channel.toUpperCase()}
Delivery Type: ${isHandDelivery ? 'Hand Delivery' : 'Courier'}
${isHandDelivery
        ? `Delivered By: ${deliveryDetails.deliveryPersonName}`
        : `Courier: ${deliveryDetails.courierName}\nTracking: ${deliveryDetails.trackingNumber}`
      }
Delivered At: ${new Date().toLocaleString()}`;

    const subject = `Delivery Complete - Job ${job.jobCode}`;

    await this.notifyAdmins(message, subject, job._id, 'delivered');
  }
}

module.exports = new NotificationService();
