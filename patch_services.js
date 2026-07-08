const fs = require('fs');
const path = require('path');

const servicesDir = path.join(__dirname, 'frontend/src/services');
const files = fs.readdirSync(servicesDir).filter(f => f.endsWith('.ts'));

files.forEach(file => {
    const fullPath = path.join(servicesDir, file);
    let content = fs.readFileSync(fullPath, 'utf8');

    // Remove getToken function definition
    content = content.replace(/function getToken\(\): string \{[\s\S]*?\n\}\n/g, '');
    content = content.replace(/\/\/ \?\Auth token helper.*?\n/g, '');

    // Remove const token = getToken(); or const token = stored ? JSON.parse(stored).token : '';
    content = content.replace(/const token = (?:getToken\(\)|stored \? JSON\.parse\(stored\)\.token : '');\s*(\n\s*if \(!token\) \{[\s\S]*?\}\n)?/g, '');
    content = content.replace(/const t = getToken\(\);\s*\n/g, '');
    content = content.replace(/const tok = getToken\(\);\s*\n/g, '');
    
    // Remove token check block completely if any leftover
    content = content.replace(/if \(!token\) \{\s*throw new Error\('No security token found.*?'\);\s*\}/g, '');

    // Remove Authorization header from objects
    content = content.replace(/['"]?Authorization['"]?:\s*`Bearer \$\{token\}`\s*,?\s*/g, '');
    
    // Cleanup empty headers objects
    content = content.replace(/headers:\s*\{\s*\}/g, '');

    // Remove ?token=${tok} from URLs
    content = content.replace(/\?token=\$\{encodeURIComponent\([a-zA-Z]+\)\}/g, '');
    content = content.replace(/\?token=\$\{tok\}/g, '');
    
    // Remove token params from fileApi.ts
    content = content.replace(/params\.append\('token', token\);\n\s*\/\/ The backend `verifyToken` allows req\.query\.token\./g, '');
    content = content.replace(/\/\/ Add token so the server can authorize from query param if needed, OR we can fetch\(\) and blob\(\)\s*\n/g, '');
    content = content.replace(/params\.append\('token', token\);/g, '');

    // Also remove any remaining token declarations like `const token = ...`
    content = content.replace(/const token =[^;]+;\n/g, '');

    // specific fix for adminClientApi.ts (though it said it was already correct, it has a token logic)
    content = content.replace(/['"]?Authorization['"]?:\s*`Bearer \$\{user\?\.token \|\| ''\}`\s*,?\s*/g, '');

    fs.writeFileSync(fullPath, content, 'utf8');
});

console.log('Services patched successfully');
