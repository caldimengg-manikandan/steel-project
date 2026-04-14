const mongoose = require('mongoose');
const fs = require('fs');

async function check() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const db = mongoose.connection.db;
    let out = '';

    out += '=== ALL PROJECTS ===\n';
    const ps = await db.collection('projects').find({}).toArray();
    ps.forEach(p => {
        out += ' "' + p.name + '" | _id: ' + p._id.toString() + ' | count: ' + p.transmittalCount + '\n';
    });

    out += '\n=== ALL TRANSMITTALS ===\n';
    const all = await db.collection('transmittals').find({}).toArray();
    out += 'Total: ' + all.length + '\n';
    all.forEach(t => {
        out += ' TR-' + t.transmittalNumber + ' | projectId: ' + (t.projectId ? t.projectId.toString() : 'null') + ' | new: ' + t.newCount + '\n';
    });

    fs.writeFileSync('check_output.txt', out, 'utf8');
    console.log(out);

    await mongoose.disconnect();
    process.exit(0);
}
check();
