/**
 * Manual Order Sync Trigger
 * Usage: node scripts/fetch_now.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { startCronJobs, triggerOrderSync } = require('../src/cron/index');

async function runNow() {
    try {
        console.log('--- Order Sync Manual Trigger ---');
        console.log('Time:', new Date().toLocaleString());

        // Connect to DB as services need it
        const MONGODB_URI = process.env.MONGODB_URI;
        if (!MONGODB_URI) {
            console.error('Error: MONGODB_URI not found in .env');
            process.exit(1);
        }

        console.log('Connecting to database...');
        await mongoose.connect(MONGODB_URI);
        console.log('Connected.');

        console.log('Triggering sync...');
        await triggerOrderSync();

        console.log('--- Sync Complete ---');
        process.exit(0);
    } catch (error) {
        console.error('Failed to run sync:', error);
        process.exit(1);
    }
}

runNow();
