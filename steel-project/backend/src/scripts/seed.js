/**
 * ============================================================
 * DB Seeder — creates default admin accounts on first run
 * ============================================================
 * Run: node src/scripts/seed.js
 * Only creates if doesn't already exist.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Project = require('../models/Project');

const SEED_ADMINS = [
    {
        username: 'admin1',
        email: 'admin1@steeldetailing.com',
        password_hash: 'Admin1@2026',
        displayName: 'Admin One',
    },
    {
        username: 'admin2',
        email: 'admin2@steeldetailing.com',
        password_hash: 'Admin2@2026',
        displayName: 'Admin Two',
    },
];

async function seed() {
    await connectDB();

    console.log('\n── Seeding Admins ──────────────────────────────');
    const adminDocs = [];

    for (const a of SEED_ADMINS) {
        const exists = await Admin.findOne({ username: a.username });
        if (exists) {
            console.log(`  ↺ Updating password for existing admin: ${a.username}`);
            exists.password_hash = a.password_hash; // pre-save hook will hash it
            await exists.save();
            adminDocs.push(exists);
        } else {
            const doc = await Admin.create(a);
            console.log(`  + Created admin: ${doc.username} (id: ${doc._id})`);
            adminDocs.push(doc);
        }
    }

    console.log('\n── Seeding Users ───────────────────────────────');
    const [admin1, admin2] = adminDocs;

    // Admin1's users
    const admin1Users = [
        { username: 'theja', email: 'theja@firm1.com', password_hash: 'pass@1234', adminId: admin1._id },
        { username: 'hari', email: 'hari@firm1.com', password_hash: 'pass@1234', adminId: admin1._id },
        { username: 'raj', email: 'raj@firm1.com', password_hash: 'pass@1234', adminId: admin1._id },
    ];

    // Admin2's users
    const admin2Users = [
        { username: 'jas', email: 'jas@firm2.com', password_hash: 'pass@1234', adminId: admin2._id },
        { username: 'kumar', email: 'kumar@firm2.com', password_hash: 'pass@1234', adminId: admin2._id },
        { username: 'leo', email: 'leo@firm2.com', password_hash: 'pass@1234', adminId: admin2._id },
    ];

    const userDocs = {};
    for (const u of [...admin1Users, ...admin2Users]) {
        const exists = await User.findOne({ username: u.username, adminId: u.adminId });
        if (exists) {
            console.log(`  ↺ Updating password for existing user: ${u.username}`);
            exists.password_hash = u.password_hash; // pre-save hook will hash it
            await exists.save();
            userDocs[u.username] = exists;
        } else {
            const doc = await User.create(u);
            console.log(`  + Created user: ${doc.username} under admin: ${u.adminId}`);
            userDocs[u.username] = doc;
        }
    }

    console.log('\n── Seeding Projects ────────────────────────────');
    const projects = [
        {
            name: 'SteelFrame Tower A', clientName: 'Infra Corp Ltd.',
            createdByAdminId: admin1._id,
            assignments: [
                { userId: userDocs['theja']?._id, username: 'theja', permission: 'editor' },
                { userId: userDocs['hari']?._id, username: 'hari', permission: 'viewer' },
            ],
        },
        {
            name: 'Bridge Fabrication – NH44', clientName: 'NHAI Projects',
            createdByAdminId: admin1._id,
            assignments: [
                { userId: userDocs['raj']?._id, username: 'raj', permission: 'admin' },
            ],
        },
        {
            name: 'Industrial Shed – Phase II', clientName: 'Bharat Manufacturing',
            createdByAdminId: admin2._id,
            assignments: [
                { userId: userDocs['jas']?._id, username: 'jas', permission: 'editor' },
            ],
        },
        {
            name: 'Warehouse Complex – WH7', clientName: 'Logistics India Pvt.',
            createdByAdminId: admin2._id,
            assignments: [
                { userId: userDocs['kumar']?._id, username: 'kumar', permission: 'viewer' },
                { userId: userDocs['leo']?._id, username: 'leo', permission: 'editor' },
            ],
        },
    ];

    for (const p of projects) {
        const exists = await Project.findOne({ name: p.name, createdByAdminId: p.createdByAdminId });
        if (exists) {
            console.log(`  ✓ Project "${p.name}" already exists`);
        } else {
            await Project.create(p);
            console.log(`  + Created project: "${p.name}" under admin: ${p.createdByAdminId}`);
        }
    }

    console.log('\n── Seed complete ───────────────────────────────\n');
    console.log('Demo credentials:');
    console.log('  Admin1: admin1 / Admin1@2026');
    console.log('  Admin2: admin2 / Admin2@2026');
    console.log('  Users:  theja, hari, raj, jas, kumar, leo  /  pass@1234\n');

    await mongoose.disconnect();
}

seed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
});
