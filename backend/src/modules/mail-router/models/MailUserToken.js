// backend-cjs/mongoose/models/MailUserToken.js
// -----------------------------------------------------------------------------
// Mongoose Model: MailUserToken
// Stores Microsoft Entra ID MSAL token cache for silent token renewal.
// -----------------------------------------------------------------------------

const mongoose = require('mongoose');

const mailUserTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    msTenantId: {
      type: String,
    },
    msUpn: {
      type: String,
    },
    msTokenCache: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: 'mail_user_tokens',
  }
);

module.exports = mongoose.model('MailUserToken', mailUserTokenSchema);
