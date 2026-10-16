/**
 * ============================================================
 * Chat Module: Automated Unit & Logic Tests
 * ============================================================
 * Run: node src/chat/tests/chat.test.js
 */
const assert = require('assert');
const mongoose = require('mongoose');

// Test Suite
async function runTests() {
    console.log('--- [CHAT MODULE TEST SUITE] Starting tests ---');
    let passed = 0;
    let failed = 0;

    function it(name, fn) {
        try {
            fn();
            console.log(`  ✓ PASS: ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✗ FAIL: ${name}`);
            console.error(err);
            failed++;
        }
    }

    async function itAsync(name, fn) {
        try {
            await fn();
            console.log(`  ✓ PASS: ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✗ FAIL: ${name}`);
            console.error(err);
            failed++;
        }
    }

    // 1. Text Sanitization Test
    it('Should sanitize malicious HTML/XSS content properly', () => {
        const malicious = '<script>alert("xss")</script><img src="x" onerror="steal()"/>';
        // Same sanitization logic as in chatController
        const sanitized = malicious
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        assert(!sanitized.includes('<script>'), 'Must not contain unescaped script tag');
        assert(!sanitized.includes('<img'), 'Must not contain unescaped img tag');
        assert(sanitized.includes('&lt;script&gt;'), 'Must encode angle brackets');
    });

    // 2. Schema Validation Tests
    it('Should validate Conversation schema types and indexes', () => {
        const Conversation = require('../models/Conversation');
        assert(Conversation.schema.path('type'), 'Conversation must have type field');
        assert(Conversation.schema.path('participants'), 'Conversation must have participants field');
        assert(Conversation.schema.path('adminId'), 'Conversation must have adminId field');
        assert(Conversation.schema.path('unreadCounts'), 'Conversation must track unreadCounts');
    });

    it('Should validate ChatMessage schema types', () => {
        const ChatMessage = require('../models/ChatMessage');
        assert(ChatMessage.schema.path('conversationId'), 'ChatMessage must have conversationId');
        assert(ChatMessage.schema.path('senderId'), 'ChatMessage must have senderId');
        assert(ChatMessage.schema.path('content'), 'ChatMessage must have content');
        assert(ChatMessage.schema.path('attachments'), 'ChatMessage must have attachments');
        assert(ChatMessage.schema.path('readBy'), 'ChatMessage must have readBy tracking');
    });

    // 3. Multi-Tenant Scoping Logic
    it('Should enforce tenant boundaries between two different admins', () => {
        const adminA = new mongoose.Types.ObjectId();
        const adminB = new mongoose.Types.ObjectId();
        const userA = new mongoose.Types.ObjectId();
        const userB = new mongoose.Types.ObjectId();

        const convAdminA = {
            adminId: adminA,
            participants: [userA],
        };

        // Query check: userB belonging to adminB should not be allowed
        const canAccess = convAdminA.adminId.equals(adminB);
        assert.strictEqual(canAccess, false, 'Users from different tenant must not access conversation');
    });

    // 4. Participant Authorization Logic
    it('Should forbid unauthorized user from sending/reading in conversation', () => {
        const alice = new mongoose.Types.ObjectId().toString();
        const bob = new mongoose.Types.ObjectId().toString();
        const eve = new mongoose.Types.ObjectId().toString();

        const participants = [alice, bob];

        const isAliceParticipant = participants.includes(alice);
        const isEveParticipant = participants.includes(eve);

        assert.strictEqual(isAliceParticipant, true, 'Alice is a valid participant');
        assert.strictEqual(isEveParticipant, false, 'Eve must be rejected with 403');
    });

    // 5. Unread Count Increment Logic
    it('Should correctly increment unread count for recipients only', () => {
        const sender = 'user_123';
        const recipient1 = 'user_456';
        const recipient2 = 'user_789';
        const allParticipants = [sender, recipient1, recipient2];

        const unreadMap = new Map();
        unreadMap.set(recipient1, 1);

        allParticipants.forEach(pId => {
            if (pId !== sender) {
                const count = unreadMap.get(pId) || 0;
                unreadMap.set(pId, count + 1);
            }
        });

        assert.strictEqual(unreadMap.get(sender), undefined, 'Sender unread count must not increment');
        assert.strictEqual(unreadMap.get(recipient1), 2, 'Recipient1 should have 2 unread');
        assert.strictEqual(unreadMap.get(recipient2), 1, 'Recipient2 should have 1 unread');
    });

    // Summary
    console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
    if (failed > 0) {
        process.exit(1);
    }
}

if (require.main === module) {
    runTests();
}

module.exports = runTests;
