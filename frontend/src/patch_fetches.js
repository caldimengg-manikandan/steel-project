const fs = require('fs');
const path = require('path');

const dir = 'C:/steel-project(2)/steel-project/frontend/src/services';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));

for (const file of files) {
    const filePath = path.join(dir, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Remove token logic from authHeaders
    content = content.replace(/function authHeaders\(\)[\s\S]*?return \{[\s\S]*?'Authorization': [^\n]*\n([\s\S]*?)\};/gm, function(match, inner) {
        return 'function authHeaders(): Record<string, string> {\n    return {' + inner + '    };';
    });
    
    content = content.replace(/function authMultipartHeaders\(\)[\s\S]*?return \{[\s\S]*?'Authorization': [^\n]*\n([\s\S]*?)\};/gm, function(match, inner) {
        return 'function authMultipartHeaders(): Record<string, string> {\n    return {' + inner + '    };';
    });

    // Replace fetch(..., { with fetch(..., { credentials: 'include',
    content = content.replace(/fetch\(([^,]+),\s*\{/g, 'fetch(, { credentials: \\'include\\',');

    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated ' + file);
}
