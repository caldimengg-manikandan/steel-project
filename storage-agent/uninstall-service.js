const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
  name: 'Steel DMS Storage Agent',
  script: path.join(__dirname, 'server.js')
});

// Listen for the "uninstall" event so we know when it's done.
svc.on('uninstall', function() {
  console.log('Uninstall complete.');
  console.log('The service exists: ', svc.exists);
});

// Uninstall the service.
console.log('Uninstalling Steel DMS Storage Agent from Windows Services...');
svc.uninstall();
