/**
 * ============================================================
 * Chat Module: DB Migration & Index Creation Script
 * ============================================================
 * Run: node src/chat/scripts/migrateChatIndexes.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const ChatMessage = require('../models/ChatMessage');

async function runMigration() {
    try {
        const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/steel_dms';
        console.log('[Migration] Connecting to MongoDB...');
        await mongoose.connect(mongoUri);
        console.log('[Migration] Connected to MongoDB.');

        console.log('[Migration] Creating indexes for Conversation model...');
        await Conversation.createIndexes();
        console.log('[Migration] Conversation indexes created successfully.');

        console.log('[Migration] Creating indexes for ChatMessage model...');
        await ChatMessage.createIndexes();
        console.log('[Migration] ChatMessage indexes created successfully.');

        console.log('[Migration] Migration complete!');
        process.exit(0);
    } catch (err) {
        console.error('[Migration] Migration failed:', err);
        process.exit(1);
    }
}

if (require.main === module) {
    runMigration();
}

module.exports = runMigration;
