const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

async function migrate() {
    try {
        await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
        console.log('Connected to DB');
        const result = await mongoose.connection.collection('projects').updateMany({ status: 'active' }, { $set: { status: 'in_progress' } });
        console.log(`Updated ${result.modifiedCount} projects`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
migrate();
