require('dotenv').config();
const mongoose = require('mongoose');
const { getAdminStats } = require('./src/controllers/adminDashboardController');

async function test() {
    await mongoose.connect(process.env.MONGO_URI);
    const req = {
        principal: { adminId: '60d0fe4f5311236168a109ca', role: 'superadmin' }
    };
    const res = {
        json: (data) => {
            console.log("RESPONSE DATA:");
            console.dir(data, { depth: null });
            process.exit(0);
        }
    };
    await getAdminStats(req, res);
}
test();
