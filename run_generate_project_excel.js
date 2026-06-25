const { generateProjectExcel } = require('./backend/src/services/excelService');
const fs = require('fs');
(async () => {
  // Mock data
  const rows = [
    { extractedFields: { revision: 'A', drawingNumber: 'D-001', drawingTitle: 'Title 1' } },
    { extractedFields: { revision: '1', drawingNumber: 'D-002', drawingTitle: 'Title 2' } },
    { extractedFields: { revision: 'B', drawingNumber: 'D-003', drawingTitle: 'Title 3' } },
  ];
  const projectDetails = { projectName: 'Test Project', clientName: 'Test Client' };
  const result = await generateProjectExcel(rows, projectDetails, null);
  fs.writeFileSync('test_project.xlsx', result.buffer);
  console.log('Excel generated:', result.filename);
})();
