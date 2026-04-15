const path = require('path');
const backendDir = 'c:/Users/vibhu/OneDrive/Desktop/steel-project/backend';
module.paths.push(path.join(backendDir, 'node_modules'));

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(backendDir, '.env') });

const DrawingExtraction = require(path.join(backendDir, 'src/models/DrawingExtraction'));

async function check() {
    try {
        const uri = process.env.MONGO_URI;
        await mongoose.connect(uri);
        console.log('Connected to DB');
        
        const docs = await DrawingExtraction.find({ 
            'projectId': new mongoose.Types.ObjectId('69d9306f3d1e6110e7d119f6'),
            'extractedFields.drawingNumber': '07M1014'
        });
        
        console.log('Found', docs.length, 'docs in target project');
        docs.forEach(d => {
            console.log({
                id: d._id,
                projectIdType: typeof d.projectId,
                projectIdValue: d.projectId,
                isObjectId: d.projectId instanceof mongoose.Types.ObjectId,
                createdAt: d.createdAt
            });
        });

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await mongoose.disconnect();
    }
}

check();
