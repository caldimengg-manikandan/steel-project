const mongoose = require('mongoose');
require('dotenv').config();
const Admin = require('./src/models/Admin');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const admin = await Admin.findOne({ username: 'admin1' });
    if(admin){
        admin.password_hash = 'Admin1@2026';
        await admin.save();
        console.log('Reset admin1 password to Admin1@2026');
    } else {
        console.log('Admin not found');
    }
    mongoose.connection.close();
}).catch(console.error);
