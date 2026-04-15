const path = require('path');
const backendDir = 'c:/Users/vibhu/OneDrive/Desktop/steel-project/backend';
module.paths.push(path.join(backendDir, 'node_modules'));

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(backendDir, '.env') });

const DrawingExtraction = require(path.join(backendDir, 'src/models/DrawingExtraction'));

async function cleanup() {
    try {
        const uri = process.env.MONGO_URI;
        await mongoose.connect(uri);
        console.log('Connected to DB');
        
        // Find ALL duplicates for '07M1014' in project '69d9306f3d1e6110e7d119f6'
        const docs = await DrawingExtraction.find({ 
            'projectId': new mongoose.Types.ObjectId('69d9306f3d1e6110e7d119f6'),
            'extractedFields.drawingNumber': '07M1014'
        }).sort({ createdAt: -1 }); // Keep newest
        
        if (docs.length > 1) {
            const newest = docs[0];
            const toDelete = docs.slice(1).map(d => d._id);
            const res = await DrawingExtraction.deleteMany({ _id: { $in: toDelete } });
            console.log(`Successfully deleted ${res.deletedCount} old duplicates of 07M1014. Kept ID: ${newest._id}`);
        } else {
            console.log('No duplicates found for 07M1014');
        }

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await mongoose.disconnect();
    }
}

cleanup();