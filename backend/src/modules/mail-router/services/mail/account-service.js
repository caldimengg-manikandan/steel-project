'use strict';
// services/mail/account-service.js — redirector
// The PostgreSQL implementation has been replaced.
// All callers are forwarded to the Mongoose-backed service.
module.exports = require('../../mongoose/services/accountService');
