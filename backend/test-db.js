require('dotenv').config();
const mongoose = require('mongoose');

async function test() {
    await mongoose.connect(process.env.MONGO_URI);
    const count = await mongoose.connection.collection('projects').countDocuments();
    console.log("ACTUAL LOCAL DB COUNT:", count);
    process.exit(0);
}
test();
