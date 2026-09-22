// backend-cjs/mongoose/services/mailForwardService.js
// -----------------------------------------------------------------------------
// Business logic for forwarding an email to one or more employees in MongoDB.
// -----------------------------------------------------------------------------

const { createForwarding, listEmployees } = require('../repositories/forwardingRepo');
const { getEmailById } = require('../repositories/emailRepo');

/**
 * Forward an imported email to a list of employee IDs.
 */
async function forwardEmail(emailId, arg2, arg3, note) {
  let forwardedByUserId;
  let recipientIds;

  if (Array.isArray(arg2)) {
    recipientIds = arg2;
    forwardedByUserId = arg3;
  } else if (Array.isArray(arg3)) {
    forwardedByUserId = arg2;
    recipientIds = arg3;
  } else {
    throw new Error('At least one recipient must be selected.');
  }

  if (!recipientIds || recipientIds.length === 0) {
    throw new Error('At least one recipient must be selected.');
  }

  // Verify email exists
  const email = await getEmailById(emailId);
  if (!email) {
    throw new Error(`Email ${emailId} not found.`);
  }

  return createForwarding(emailId, forwardedByUserId, recipientIds, note);
}

/**
 * Get the list of employees available for the PM's selector.
 */
async function getEmployeeList() {
  return listEmployees();
}

module.exports = {
  forwardEmail,
  getEmployeeList,
};
