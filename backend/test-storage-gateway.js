/**
 * Quick test for storageGateway path sanitization.
 * Run: node test-storage-gateway.js
 */
const sg = require('./src/utils/storageGateway');

console.log('Storage Root:', sg.STORAGE_ROOT);
console.log('Enabled:', sg.isEnabled());
console.log('');

const tests = [
    // Traversal attacks — should all be BLOCKED
    '../../../etc/passwd',
    '..\\..\\Windows\\System32',
    '/etc/shadow',
    'C:\\Windows\\System32',
    'project/../../../secret',
    '....//....//etc/passwd',

    // Valid paths — should resolve safely under STORAGE_ROOT
    'valid/path/file.pdf',
    'ProjectA/drawings/sheet1.pdf',
    'ProjectA',
    '',
];

console.log('=== Path Sanitization Tests ===\n');

tests.forEach(t => {
    try {
        const r = sg.sanitizePath(t);
        const safe = r.startsWith(sg.STORAGE_ROOT);
        console.log(safe ? '[SAFE]   ' : '[UNSAFE] ', JSON.stringify(t), '=>', r);
    } catch (e) {
        console.log('[BLOCKED]', JSON.stringify(t), '=>', e.message);
    }
});

console.log('\n=== Validation Check ===\n');
const check = sg.validateRoot();
console.log('validateRoot:', JSON.stringify(check));
