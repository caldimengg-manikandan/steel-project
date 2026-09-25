require('dotenv').config();
const mongoose = require('mongoose');
const Transmittal = require('./src/models/Transmittal');
const DrawingLog = require('./src/models/DrawingLog');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    try {
        const transmittals = await Transmittal.find({});
        for (let t of transmittals) {
            console.log('Fixing Transmittal ' + t.transmittalNumber);
            const uniqueDrawings = [];
            const seen = new Set();
            for (let d of t.drawings) {
                const id = d.extractionId.toString();
                if (!seen.has(id)) {
                    seen.add(id);
                    uniqueDrawings.push(d);
                }
            }
            if (uniqueDrawings.length !== t.drawings.length) {
                console.log('  Reduced from ' + t.drawings.length + ' to ' + uniqueDrawings.length);
                t.drawings = uniqueDrawings;
                
                // Recalculate counts
                let newC = 0, revC = 0, unC = 0;
                for (let d of uniqueDrawings) {
                    if (d.changeType === 'new') newC++;
                    else if (d.changeType === 'revised') revC++;
                    else unC++;
                }
                t.newCount = newC;
                t.revisedCount = revC;
                t.unchangedCount = unC;
                
                await t.save();
            }
        }
        
        console.log('Done fixing transmittals.');
    } catch(e) { console.error(e); }
    process.exit(0);
});
