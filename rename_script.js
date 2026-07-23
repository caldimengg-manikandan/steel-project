const fs = require('fs');
const path = require('path');

const renames = [
    { old: 'backend/src/models/WeeklyProgress.js', new: 'backend/src/models/WeeklyProgress.js' },
    { old: 'backend/src/controllers/weeklyProgressController.js', new: 'backend/src/controllers/weeklyProgressController.js' },
    { old: 'backend/src/routes/weeklyProgressRoutes.js', new: 'backend/src/routes/weeklyProgressRoutes.js' },
    { old: 'frontend/src/components/WeeklyProgressPanel.tsx', new: 'frontend/src/components/WeeklyProgressPanel.tsx' },
    { old: 'frontend/src/pages/admin/AdminWeeklyProgress.tsx', new: 'frontend/src/pages/admin/AdminWeeklyProgress.tsx' },
    { old: 'frontend/src/services/weeklyProgressApi.ts', new: 'frontend/src/services/weeklyProgressApi.ts' }
];

for (const r of renames) {
    if (fs.existsSync(r.old)) {
        fs.renameSync(r.old, r.new);
        console.log(`Renamed ${r.old} to ${r.new}`);
    } else {
        console.log(`${r.old} not found.`);
    }
}

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory() && !file.includes('node_modules') && !file.includes('.git') && !file.includes('dist')) {
      results = results.concat(walk(file));
    } else {
      if (file.match(/\.(js|jsx|ts|tsx)$/)) {
        results.push(file);
      }
    }
  });
  return results;
}

const allFiles = walk('.');

const replacements = [
    { search: /WeeklyProgressPanel/g, replace: 'WeeklyProgressPanel' },
    { search: /AdminWeeklyProgress/g, replace: 'AdminWeeklyProgress' },
    { search: /weeklyProgressApi/g, replace: 'weeklyProgressApi' },
    { search: /WeeklyProgress/g, replace: 'WeeklyProgress' },
    { search: /weeklyProgressController/g, replace: 'weeklyProgressController' },
    { search: /weeklyProgressRoutes/g, replace: 'weeklyProgressRoutes' },
    { search: /weeklyProgress/g, replace: 'weeklyProgress' },
    { search: /weekly-progress/g, replace: 'weekly-progress' },
    { search: /weeklyProgresss/g, replace: 'weeklyProgress' }
];

for (const file of allFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;
    
    for (const r of replacements) {
        content = content.replace(r.search, r.replace);
    }
    
    if (content !== original) {
        fs.writeFileSync(file, content);
        console.log(`Updated content in ${file}`);
    }
}
