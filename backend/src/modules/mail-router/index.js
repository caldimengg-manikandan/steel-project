// backend-cjs/index.js
// -----------------------------------------------------------------------------
// Main entry point for the Mail Router & Employee Inbox CommonJS Express module.
// Fully powered by MongoDB Atlas and Mongoose.
// -----------------------------------------------------------------------------

const { mailRouter } = require('./routes/mailRouter');
const { getMailProvider } = require('./services/mail/provider-factory');

// Native Mongoose Services
const { runMailSync } = require('./mongoose/services/mailSyncService');
const { forwardEmail, getEmployeeList } = require('./mongoose/services/mailForwardService');
const accountService = require('./mongoose/services/accountService');
const tokenStore = require('./mongoose/services/tokenStore');

// Native Mongoose Repositories
const emailRepo = require('./mongoose/repositories/emailRepo');
const attachmentRepo = require('./mongoose/repositories/attachmentRepo');
const syncJobRepo = require('./mongoose/repositories/syncJobRepo');
const forwardingRepo = require('./mongoose/repositories/forwardingRepo');

// Native Mongoose Models
const MailAccount = require('./mongoose/models/MailAccount');
const Email = require('./mongoose/models/Email');
const Attachment = require('./mongoose/models/Attachment');
const SyncJob = require('./mongoose/models/SyncJob');
const MailUserToken = require('./mongoose/models/MailUserToken');
const EmailForward = require('./mongoose/models/EmailForward');

module.exports = {
  mailRouter,
  getMailProvider,
  runMailSync,
  forwardEmail,
  getEmployeeList,
  accountService,
  tokenStore,
  emailRepo,
  attachmentRepo,
  syncJobRepo,
  forwardingRepo,
  models: {
    MailAccount,
    Email,
    Attachment,
    SyncJob,
    MailUserToken,
    EmailForward,
  },
};
