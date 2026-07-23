
const fs = require('fs');
let content = fs.readFileSync('frontend/src/components/WeeklyProgressPanel.tsx', 'utf8');

content = content.replace(/<input type="date" className="form-input" style={{ border: 'none', background: 'transparent', padding: 4 }}/g, '<input type=\"date\" className=\"form-input\" style={{ padding: 4 }}');
content = content.replace(/<input type="date" className="form-input" style={{ border: 'none', background: 'transparent', padding: 4, width: '100%' }}/g, '<input type=\"date\" className=\"form-input\" style={{ padding: 4, width: \'100%\' }}');

fs.writeFileSync('frontend/src/components/WeeklyProgressPanel.tsx', content);
console.log('UI styles updated in WeeklyProgressPanel.tsx');

