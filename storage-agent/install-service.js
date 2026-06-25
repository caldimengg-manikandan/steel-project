const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
  name: 'Steel DMS Storage Agent',
  description: 'Secure API gateway for accessing E:\\Storage',
  script: path.join(__dirname, 'server.js'),
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ]
});

// Listen for the "install" event, which indicates the
// process is available as a service.
svc.on('install', function() {
  console.log('Service installed successfully!');
  console.log('Starting service...');
  svc.start();
});

// Listen for the "start" event
svc.on('start', function() {
  console.log('Service started successfully! The agent is now running in the background.');
});

// Listen for errors
svc.on('error', function(err) {
  console.error('Service error:', err);
});

// Install the script as a service.
console.log('Installing Steel DMS Storage Agent as a Windows Service...');
svc.install();
