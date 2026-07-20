const mongoose = require('mongoose');
const RfiExtraction = require('./src/models/RfiExtraction');
const RfiReport = require('./src/models/RfiReport');

mongoose.connect('mongodb+srv://admin:Lalith123@cluster0.o5h4l.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0')
.then(async () => {
    try {
        const exts = await RfiExtraction.find();
        console.log("=== EXTRACTIONS ===");
        console.log(JSON.stringify(exts.map(e => e.rfis).flat().slice(0, 2), null, 2));

        const reps = await RfiReport.find().sort({_id: -1}).limit(1);
        console.log("=== LATEST REPORT ===");
        console.log(JSON.stringify(reps[0].rfiData.slice(0, 2), null, 2));
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
});
