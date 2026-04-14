const mongoose = require('mongoose');

async function check() {
    try {
        await mongoose.connect('mongodb://localhost:27017/steel_dms');
        const db = mongoose.connection.db;

        const projectId = new mongoose.Types.ObjectId('69bd358ee076089d2d34a4ca');
        const project = await db.collection('projects').findOne({ _id: projectId });
        
        if (!project) {
            console.log('Project not found');
            await mongoose.disconnect();
            return;
        }

        console.log('Project:', project.name, '-', project.projectName);
        console.log('Project transmittalCount:', project.transmittalCount);

        const transmittals = await db.collection('transmittals').find({ projectId }).toArray();
        console.log('\nTransmittals for Project:');
        transmittals.forEach(t => {
            console.log(`- ID: ${t._id}, Number: ${t.transmittalNumber}, New Drawings: ${t.newCount}, Revised: ${t.revisedCount}, Date: ${t.createdAt}`);
        });

        const extractionsCount = await db.collection('drawing_extractions').countDocuments({ projectId });
        console.log('\nTotal drawing extractions for project:', extractionsCount);

        // Check if there are extractions NOT linked to any transmittal
        const unlinkedExtractions = await db.collection('drawing_extractions').countDocuments({ 
            projectId, 
            $or: [
                { targetTransmittalNumber: { $exists: false } },
                { targetTransmittalNumber: null },
                { isTransmitted: false }
            ]
        });
        console.log('Unlinked/Untransmitted extractions:', unlinkedExtractions);

        // Check for other transmittals that might belong to this project but have wrong projectId
        // Maybe check by name or adminId if we know it.
        // But for now let's just see what we have.

        await mongoose.disconnect();
    } catch (error) {
        console.error(error);
    }
}

check();
