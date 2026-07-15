const fs = require('fs');
let content = fs.readFileSync('frontend/src/components/WeeklyProgressPanel.tsx', 'utf8');
content = content.replace(/className="form-input"/g, 'className="form-control"');
fs.writeFileSync('frontend/src/components/WeeklyProgressPanel.tsx', content);
console.log('Replaced form-input with form-control');
