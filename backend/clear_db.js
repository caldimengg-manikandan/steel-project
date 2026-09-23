const mongoose = require('mongoose');
require('dotenv').config({path: './.env'});

mongoose.connect(process.env.MONGO_URI).then(async () => {
    console.log('Connected to MongoDB');
    const db = mongoose.connection.db;
    
    try {
        await db.collection('uploads.chunks').drop();
        console.log('Successfully dropped uploads.chunks');
    } catch (e) {
        console.log('Could not drop uploads.chunks:', e.message);
    }

    try {
        await db.collection('uploads.files').drop();
        console.log('Successfully dropped uploads.files');
    } catch (e) {
        console.log('Could not drop uploads.files:', e.message);
    }

    // Also let's clean up any drawing extractions or rfi extractions where the fileUrl is missing and gridFsFileId was set?
    // Actually the metadata itself is small (less than 1MB total). The chunks were the problem.

    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
