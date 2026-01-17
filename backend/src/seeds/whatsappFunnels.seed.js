/**
 * Sample WhatsApp Funnel Configurations
 *
 * This file contains sample funnel configurations that can be seeded into the database.
 * Run: node src/seeds/whatsappFunnels.seed.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Sample Funnel 1: TAT Breach Notification with Customer Feedback
const tatBreachFunnel = {
  name: 'TAT Breach - Customer Notification',
  description: 'Notifies customers when their order is delayed and collects feedback',
  category: 'tat_breach',
  isActive: true,
  triggers: [
    {
      type: 'tat_breach',
      conditions: {
        // Triggers for any stage breach
      },
      isActive: true
    }
  ],
  steps: [
    {
      stepId: 'notify_delay',
      name: 'Send Delay Notification',
      order: 1,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'Hello {{customerName}},\n\nWe wanted to inform you about your order {{jobCode}}.\n\nUnfortunately, there has been a delay in the {{stage}} stage. We sincerely apologize for any inconvenience caused.\n\nYour order is our priority and our team is working to complete it as soon as possible.\n\nWould you like us to provide more details about the delay?'
          }
        },
        {
          type: 'send_interactive',
          interactive: {
            type: 'button',
            buttons: [
              { id: 'yes_details', title: 'Yes, tell me more', nextStepId: 'provide_details' },
              { id: 'no_thanks', title: 'No, thanks', nextStepId: 'acknowledge_response' },
              { id: 'contact_support', title: 'Contact Support', nextStepId: 'transfer_agent' }
            ]
          }
        },
        {
          type: 'wait_for_response',
          waitConfig: {
            timeoutMinutes: 1440, // 24 hours
            timeoutStepId: 'no_response_followup',
            expectedResponses: [
              { buttonId: 'yes_details', nextStepId: 'provide_details' },
              { buttonId: 'no_thanks', nextStepId: 'acknowledge_response' },
              { buttonId: 'contact_support', nextStepId: 'transfer_agent' },
              { pattern: '(?i)(yes|detail|more|why)', nextStepId: 'provide_details' },
              { pattern: '(?i)(no|ok|fine|thanks)', nextStepId: 'acknowledge_response' },
              { pattern: '(?i)(speak|talk|call|agent|human|support)', nextStepId: 'transfer_agent' }
            ]
          }
        }
      ]
    },
    {
      stepId: 'provide_details',
      name: 'Provide Delay Details',
      order: 2,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'Thank you for your patience.\n\n📋 Order Details:\n• Order: {{jobCode}}\n• Product: {{productDescription}}\n• Stage: {{stage}}\n• Expected Delay: Approximately 24-48 hours\n\nOur team is working diligently to ensure quality is not compromised. We will notify you once your order progresses to the next stage.\n\nIs there anything else you would like to know?'
          }
        },
        {
          type: 'wait_for_response',
          waitConfig: {
            timeoutMinutes: 1440,
            timeoutStepId: 'end_conversation',
            expectedResponses: [
              { pattern: '(?i)(yes|question|more)', nextStepId: 'transfer_agent' },
              { pattern: '(?i)(no|ok|fine|thanks|thank)', nextStepId: 'end_conversation' }
            ]
          }
        }
      ]
    },
    {
      stepId: 'acknowledge_response',
      name: 'Acknowledge No Details Needed',
      order: 3,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'Thank you for your understanding! 🙏\n\nWe will keep you updated on your order progress. If you have any questions later, feel free to message us anytime.\n\nHave a great day!'
          }
        },
        {
          type: 'add_tag',
          tag: 'acknowledged_delay'
        },
        {
          type: 'end_funnel'
        }
      ]
    },
    {
      stepId: 'transfer_agent',
      name: 'Transfer to Human Agent',
      order: 4,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'I understand you would like to speak with our support team. Let me connect you with a customer service representative.\n\nPlease hold on, someone will assist you shortly. Our support hours are 9 AM - 6 PM IST.'
          }
        },
        {
          type: 'assign_agent'
        },
        {
          type: 'add_tag',
          tag: 'needs_human_support'
        },
        {
          type: 'webhook',
          webhook: {
            url: '{{webhookBaseUrl}}/api/notifications/agent-alert',
            method: 'POST',
            payload: {
              type: 'whatsapp_transfer',
              phoneNumber: '{{phoneNumber}}',
              jobCode: '{{jobCode}}',
              reason: 'Customer requested support'
            }
          }
        }
      ]
    },
    {
      stepId: 'no_response_followup',
      name: 'No Response Follow-up',
      order: 5,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'Hi {{customerName}},\n\nWe noticed you might have been busy. Just a reminder about your order {{jobCode}} - we are working on it and will update you soon.\n\nIf you have any questions, feel free to reply to this message.'
          }
        },
        {
          type: 'add_tag',
          tag: 'no_response'
        },
        {
          type: 'end_funnel'
        }
      ]
    },
    {
      stepId: 'end_conversation',
      name: 'End Conversation',
      order: 6,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'Thank you for your patience and understanding! We appreciate your business.\n\nYour order is important to us. Have a wonderful day! 😊'
          }
        },
        {
          type: 'add_tag',
          tag: 'conversation_completed'
        },
        {
          type: 'end_funnel'
        }
      ]
    }
  ],
  settings: {
    allowMultipleRuns: false,
    maxRetries: 3,
    retryDelayMinutes: 5
  }
};

// Sample Funnel 2: Order Status Update
const orderStatusFunnel = {
  name: 'Order Status Update',
  description: 'Sends order status updates to customers at each stage',
  category: 'order_status',
  isActive: true,
  triggers: [
    {
      type: 'order_status',
      conditions: {
        newStatus: ['manufacturing_in_progress', 'manufacturing_ready_delivery', 'shipped', 'delivered']
      },
      isActive: true
    }
  ],
  steps: [
    {
      stepId: 'status_update',
      name: 'Send Status Update',
      order: 1,
      actions: [
        {
          type: 'condition',
          condition: {
            rules: [
              { field: 'status', operator: 'equals', value: 'manufacturing_in_progress', nextStepId: 'manufacturing_started' },
              { field: 'status', operator: 'equals', value: 'manufacturing_ready_delivery', nextStepId: 'ready_for_delivery' },
              { field: 'status', operator: 'equals', value: 'shipped', nextStepId: 'shipped_notification' },
              { field: 'status', operator: 'equals', value: 'delivered', nextStepId: 'delivered_notification' }
            ],
            defaultStepId: 'generic_update'
          }
        }
      ]
    },
    {
      stepId: 'manufacturing_started',
      name: 'Manufacturing Started',
      order: 2,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: '🏭 Great news, {{customerName}}!\n\nYour order {{jobCode}} has entered the manufacturing stage. Our skilled craftsmen are now working on your custom piece.\n\nEstimated completion: 3-5 business days\n\nWe will update you once it is ready!'
          }
        },
        {
          type: 'end_funnel'
        }
      ]
    },
    {
      stepId: 'ready_for_delivery',
      name: 'Ready for Delivery',
      order: 3,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: '✨ Exciting news, {{customerName}}!\n\nYour order {{jobCode}} is ready and will be dispatched soon!\n\n📦 Product: {{productDescription}}\n\nWould you like to:\n1️⃣ Confirm delivery address\n2️⃣ Schedule a specific delivery date\n3️⃣ Opt for store pickup'
          }
        },
        {
          type: 'wait_for_response',
          waitConfig: {
            timeoutMinutes: 720, // 12 hours
            timeoutStepId: 'default_delivery',
            expectedResponses: [
              { pattern: '(?i)(1|confirm|address|yes)', nextStepId: 'confirm_address' },
              { pattern: '(?i)(2|schedule|date)', nextStepId: 'schedule_delivery' },
              { pattern: '(?i)(3|pickup|store)', nextStepId: 'store_pickup' }
            ]
          }
        }
      ]
    },
    {
      stepId: 'shipped_notification',
      name: 'Shipped Notification',
      order: 4,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: '🚚 Your order is on its way!\n\nOrder: {{jobCode}}\nTracking: {{trackingNumber}}\nCarrier: {{carrier}}\n\nExpected delivery: {{expectedDeliveryDate}}\n\nTrack your shipment: {{trackingUrl}}'
          }
        },
        {
          type: 'end_funnel'
        }
      ]
    },
    {
      stepId: 'delivered_notification',
      name: 'Delivered - Request Feedback',
      order: 5,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: '🎉 Your order has been delivered!\n\nThank you for shopping with us, {{customerName}}!\n\nWe would love to hear about your experience. Could you rate your order?'
          }
        },
        {
          type: 'send_interactive',
          interactive: {
            type: 'button',
            buttons: [
              { id: 'rating_5', title: '⭐⭐⭐⭐⭐ Excellent', nextStepId: 'positive_feedback' },
              { id: 'rating_3', title: '⭐⭐⭐ Average', nextStepId: 'neutral_feedback' },
              { id: 'rating_1', title: '⭐ Poor', nextStepId: 'negative_feedback' }
            ]
          }
        },
        {
          type: 'wait_for_response',
          waitConfig: {
            timeoutMinutes: 4320, // 3 days
            timeoutStepId: 'feedback_reminder',
            expectedResponses: [
              { buttonId: 'rating_5', nextStepId: 'positive_feedback' },
              { buttonId: 'rating_3', nextStepId: 'neutral_feedback' },
              { buttonId: 'rating_1', nextStepId: 'negative_feedback' }
            ]
          }
        }
      ]
    },
    {
      stepId: 'positive_feedback',
      name: 'Positive Feedback Response',
      order: 6,
      actions: [
        {
          type: 'set_variable',
          variableKey: 'feedbackRating',
          variableValue: '5'
        },
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'Thank you so much for the wonderful feedback! 🙏\n\nWe are thrilled that you loved your order. Your satisfaction is our greatest reward!\n\nWould you consider leaving a review on our website? It helps other customers make informed decisions.\n\n{{reviewUrl}}'
          }
        },
        {
          type: 'add_tag',
          tag: 'satisfied_customer'
        },
        {
          type: 'end_funnel'
        }
      ]
    },
    {
      stepId: 'negative_feedback',
      name: 'Negative Feedback Response',
      order: 7,
      actions: [
        {
          type: 'set_variable',
          variableKey: 'feedbackRating',
          variableValue: '1'
        },
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'We are truly sorry to hear that your experience was not up to your expectations. 😔\n\nYour feedback is very important to us. Could you please share what went wrong? We would like to make it right.\n\nA member of our team will reach out to you shortly to address your concerns.'
          }
        },
        {
          type: 'add_tag',
          tag: 'needs_followup'
        },
        {
          type: 'assign_agent'
        },
        {
          type: 'webhook',
          webhook: {
            url: '{{webhookBaseUrl}}/api/notifications/negative-feedback',
            method: 'POST',
            payload: {
              type: 'negative_feedback',
              phoneNumber: '{{phoneNumber}}',
              jobCode: '{{jobCode}}',
              rating: '1'
            }
          }
        }
      ]
    },
    {
      stepId: 'generic_update',
      name: 'Generic Status Update',
      order: 8,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'Hi {{customerName}},\n\nYour order {{jobCode}} has been updated.\nCurrent Status: {{status}}\n\nThank you for your patience!'
          }
        },
        {
          type: 'end_funnel'
        }
      ]
    },
    {
      stepId: 'default_delivery',
      name: 'Default Delivery',
      order: 9,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'We will proceed with delivery to your registered address. You will receive tracking details once shipped.'
          }
        },
        {
          type: 'end_funnel'
        }
      ]
    },
    {
      stepId: 'confirm_address',
      name: 'Confirm Address',
      order: 10,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: '📍 Your registered delivery address is:\n\n{{deliveryAddress}}\n\nIs this correct? Reply YES to confirm or send us the updated address.'
          }
        },
        {
          type: 'wait_for_response',
          waitConfig: {
            timeoutMinutes: 720,
            timeoutStepId: 'default_delivery',
            expectedResponses: [
              { pattern: '(?i)(yes|correct|confirm)', nextStepId: 'address_confirmed' }
            ]
          }
        }
      ]
    },
    {
      stepId: 'address_confirmed',
      name: 'Address Confirmed',
      order: 11,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: '✅ Great! Your order will be delivered to the confirmed address. We will send you tracking details once shipped.'
          }
        },
        {
          type: 'end_funnel'
        }
      ]
    },
    {
      stepId: 'schedule_delivery',
      name: 'Schedule Delivery',
      order: 12,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'Please share your preferred delivery date (format: DD/MM/YYYY).\n\nNote: Delivery is available Monday to Saturday, 10 AM - 6 PM.'
          }
        },
        {
          type: 'wait_for_response',
          waitConfig: {
            timeoutMinutes: 720,
            timeoutStepId: 'default_delivery'
          }
        },
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'Thank you! We have noted your preferred date. Our team will confirm the delivery schedule shortly.'
          }
        },
        {
          type: 'add_tag',
          tag: 'scheduled_delivery'
        },
        {
          type: 'end_funnel'
        }
      ]
    },
    {
      stepId: 'store_pickup',
      name: 'Store Pickup',
      order: 13,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: '🏪 Store Pickup Selected\n\nYou can collect your order from:\n\n📍 [Store Address]\n⏰ Mon-Sat: 10 AM - 7 PM\n\nPlease bring a valid ID and this order number: {{jobCode}}\n\nWe will notify you when your order is ready for pickup.'
          }
        },
        {
          type: 'add_tag',
          tag: 'store_pickup'
        },
        {
          type: 'end_funnel'
        }
      ]
    },
    {
      stepId: 'neutral_feedback',
      name: 'Neutral Feedback Response',
      order: 14,
      actions: [
        {
          type: 'set_variable',
          variableKey: 'feedbackRating',
          variableValue: '3'
        },
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'Thank you for your feedback!\n\nWe always strive to improve. Could you share what we could do better? Your suggestions help us serve you better next time.'
          }
        },
        {
          type: 'wait_for_response',
          waitConfig: {
            timeoutMinutes: 1440,
            timeoutStepId: 'end_neutral'
          }
        },
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'Thank you for taking the time to share your thoughts. We will work on improving based on your feedback. Have a great day!'
          }
        },
        {
          type: 'end_funnel'
        }
      ]
    },
    {
      stepId: 'end_neutral',
      name: 'End Neutral',
      order: 15,
      actions: [
        {
          type: 'add_tag',
          tag: 'neutral_feedback'
        },
        {
          type: 'end_funnel'
        }
      ]
    },
    {
      stepId: 'feedback_reminder',
      name: 'Feedback Reminder',
      order: 16,
      actions: [
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: 'Hi {{customerName}}! We hope you are enjoying your purchase.\n\nIf you have a moment, we would love to hear your feedback. Your opinion matters to us! 😊'
          }
        },
        {
          type: 'add_tag',
          tag: 'feedback_pending'
        },
        {
          type: 'end_funnel'
        }
      ]
    }
  ],
  settings: {
    allowMultipleRuns: true,
    maxRetries: 2,
    retryDelayMinutes: 10
  }
};

// Sample Funnel 3: Welcome Message
const welcomeFunnel = {
  name: 'Welcome New Customer',
  description: 'Sends welcome message when a new order is placed',
  category: 'onboarding',
  isActive: true,
  triggers: [
    {
      type: 'order_created',
      isActive: true
    }
  ],
  steps: [
    {
      stepId: 'welcome',
      name: 'Send Welcome',
      order: 1,
      actions: [
        {
          type: 'delay',
          delayMinutes: 5 // Wait 5 minutes after order
        },
        {
          type: 'send_message',
          message: {
            type: 'text',
            text: '🌟 Welcome to [Company Name]!\n\nThank you for your order, {{customerName}}!\n\n📋 Order Number: {{jobCode}}\n📦 Product: {{productDescription}}\n\nWe have received your order and will keep you updated on its progress.\n\nIf you have any questions, feel free to message us here!'
          }
        },
        {
          type: 'add_tag',
          tag: 'new_customer'
        },
        {
          type: 'end_funnel'
        }
      ]
    }
  ],
  settings: {
    allowMultipleRuns: false,
    maxRetries: 2,
    retryDelayMinutes: 5
  }
};

// Seed function
const seedWhatsAppFunnels = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const WhatsAppFunnel = require('../models/WhatsAppFunnel');

    // Check if funnels already exist
    const existingCount = await WhatsAppFunnel.countDocuments();
    if (existingCount > 0) {
      console.log(`${existingCount} funnels already exist. Skipping seed.`);
      console.log('To re-seed, first delete existing funnels.');
      process.exit(0);
    }

    // Insert sample funnels
    const funnels = [tatBreachFunnel, orderStatusFunnel, welcomeFunnel];

    for (const funnel of funnels) {
      const created = await WhatsAppFunnel.create(funnel);
      console.log(`✅ Created funnel: ${created.name}`);
    }

    console.log('\n🎉 WhatsApp funnels seeded successfully!');
    console.log('\nFunnels created:');
    console.log('1. TAT Breach - Customer Notification');
    console.log('2. Order Status Update');
    console.log('3. Welcome New Customer');

  } catch (error) {
    console.error('Error seeding funnels:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

// Export for use in other files
module.exports = {
  tatBreachFunnel,
  orderStatusFunnel,
  welcomeFunnel,
  seedWhatsAppFunnels
};

// Run if called directly
if (require.main === module) {
  seedWhatsAppFunnels();
}
