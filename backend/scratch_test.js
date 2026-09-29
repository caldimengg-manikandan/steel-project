const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/caldim', { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        const Transmittal = require('./src/models/Transmittal');
        const Project = require('./src/models/Project');
        const DrawingExtraction = require('./src/models/DrawingExtraction');
        
        const latestTr = await Transmittal.findOne().sort({ createdAt: -1 }).lean();
        if (!latestTr) {
            console.log('No transmittal found');
            process.exit(0);
        }
        
        console.log('Transmittal Project ID:', latestTr.projectId);
        const project = await Project.findById(latestTr.projectId).lean();
        
        let validSowNames = [];
        if (project) {
            (project.scopeOfWork || []).forEach(sow => validSowNames.push(sow.name.trim().toUpperCase()));
            (project.additionalScopeOfWork || []).forEach(sow => validSowNames.push(sow.name.trim().toUpperCase()));
        }
        console.log('Valid SOW Names:', validSowNames);
        
        const extIds = (latestTr.drawings || []).map(d => d.extractionId).filter(Boolean);
        const extractions = await DrawingExtraction.find({ _id: { $in: extIds } }).select('fileUrl storageGatewayPath _id folderName').lean();
        
        extractions.forEach(ext => {
            const fullPath = ext.storageGatewayPath || ext.fileUrl || '';
            console.log('Ext fullPath:', fullPath);
            let subFolder = '';
            
            if (fullPath) {
                const parts = fullPath.replace(/\\/g, '/').split('/');
                for (let i = 0; i < parts.length - 1; i++) {
                    const upperPart = parts[i].trim().toUpperCase();
                    let isMatch = false;
                    if (validSowNames.length > 0) {
                        isMatch = validSowNames.some(sow => upperPart.includes(sow));
                    } else {
                        isMatch = /sow/i.test(upperPart);
                    }
                    if (isMatch) subFolder = upperPart;
                }
            }
            console.log('Resulting subFolder:', subFolder);
        });
        
        process.exit(0);
    });
