'use strict';
// services/mail/tokenStore.js — redirector
// The PostgreSQL implementation has been replaced.
// All callers are forwarded to the Mongoose-backed token store.
module.exports = require('../../mongoose/services/tokenStore');
