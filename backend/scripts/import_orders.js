#!/usr/bin/env node
/**
 * Import orders from Python script output into MongoDB
 * Run: node scripts/import_orders.js
 */

const { execSync } = require('child_process');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://appuser:AppUserPass456!@localhost:27017/myappdb?authSource=myappdb';

// Define schemas inline (simplified)
const marketplaceOrderSchema = new mongoose.Schema({
  channel: { type: String, required: true },
  externalOrderId: { type: String, required: true },
  accountCode: String,
  buyerName: String,
  buyerEmail: String,
  shippingAddress: {
    name: String,
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    postalCode: String,
    country: String
  },
  status: { type: String, default: 'pending' },
  orderDate: Date,
  promisedDate: Date,
  totalAmount: { type: Number, default: 0 },
  currency: { type: String, default: 'USD' },
  rawPayload: mongoose.Schema.Types.Mixed
}, { timestamps: true });

const marketplaceOrderItemSchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceOrder' },
  sku: String,
  asinOrItemId: String,
  productName: String,
  quantity: { type: Number, default: 1 },
  itemPrice: { type: Number, default: 0 },
  currency: { type: String, default: 'USD' }
}, { timestamps: true });

const jobSchema = new mongoose.Schema({
  jobCode: { type: String, required: true, unique: true },
  sourceType: { type: String, default: 'order' },
  channel: String,
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceOrder' },
  orderItem: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceOrderItem' },
  sku: String,
  productName: String,
  quantity: { type: Number, default: 1 },
  customerName: String,
  dueDate: Date,
  priority: { type: String, default: 'medium' },
  status: { type: String, default: 'new' },
  accountCode: String
}, { timestamps: true });

// Generate job code
function generateJobCode() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `JOB-${year}${month}${day}-${random}`;
}

async function main() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Create models
    const MarketplaceOrder = mongoose.model('MarketplaceOrder', marketplaceOrderSchema);
    const MarketplaceOrderItem = mongoose.model('MarketplaceOrderItem', marketplaceOrderItemSchema);
    const Job = mongoose.model('Job', jobSchema);

    // Run Python script
    console.log('Running Python script...');
    const pythonCmd = process.platform === 'win32' ? 'py -3' : 'python3';
    const scriptPath = path.join(__dirname, 'csp_fetch_orders.py');

    const output = execSync(`${pythonCmd} "${scriptPath}"`, {
      encoding: 'utf8',
      timeout: 120000,
      cwd: __dirname
    });

    // Parse JSON
    const jsonStart = output.indexOf('{');
    const jsonEnd = output.lastIndexOf('}');
    const jsonOutput = output.substring(jsonStart, jsonEnd + 1);
    const result = JSON.parse(jsonOutput);

    if (!result.success) {
      console.error('Python script failed:', result.error);
      process.exit(1);
    }

    console.log(`Found ${result.orders.length} orders from Amazon`);

    let imported = 0;
    let skipped = 0;
    let jobsCreated = 0;

    for (const orderData of result.orders) {
      // Check if order exists
      const existing = await MarketplaceOrder.findOne({
        channel: 'amazon',
        externalOrderId: orderData.externalOrderId
      });

      if (existing) {
        console.log(`  Skipping existing order: ${orderData.externalOrderId}`);
        skipped++;
        continue;
      }

      // Create order
      const order = await MarketplaceOrder.create({
        channel: 'amazon',
        externalOrderId: orderData.externalOrderId,
        accountCode: orderData.accountCode || 'CSP',
        buyerName: orderData.buyerName || 'Amazon Customer',
        buyerEmail: orderData.buyerEmail,
        shippingAddress: orderData.shippingAddress,
        status: orderData.status === 'unshipped' ? 'pending' : orderData.status,
        orderDate: new Date(orderData.orderDate),
        promisedDate: orderData.promisedDate ? new Date(orderData.promisedDate) : null,
        totalAmount: orderData.totalAmount,
        currency: orderData.currency,
        rawPayload: orderData
      });

      console.log(`  Imported order: ${orderData.externalOrderId}`);
      imported++;

      // Create order items and jobs
      for (const item of orderData.items || []) {
        const orderItem = await MarketplaceOrderItem.create({
          order: order._id,
          sku: item.sku,
          asinOrItemId: item.asin,
          productName: item.productName,
          quantity: item.quantity,
          itemPrice: item.itemPrice,
          currency: item.currency
        });

        // Create job with unique jobCode
        await Job.create({
          jobCode: generateJobCode(),
          sourceType: 'order',
          channel: 'amazon',
          order: order._id,
          orderItem: orderItem._id,
          sku: item.sku,
          productName: item.productName,
          quantity: item.quantity,
          customerName: order.buyerName,
          dueDate: order.promisedDate,
          priority: 'medium',
          status: 'new',
          accountCode: orderData.accountCode || 'CSP'
        });

        jobsCreated++;
        console.log(`    Created job for SKU: ${item.sku}`);
      }
    }

    console.log('\n=== Import Summary ===');
    console.log(`Orders imported: ${imported}`);
    console.log(`Orders skipped: ${skipped}`);
    console.log(`Jobs created: ${jobsCreated}`);

    await mongoose.disconnect();
    console.log('\nDone!');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
