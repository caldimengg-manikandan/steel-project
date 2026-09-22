// backend-cjs/mongoose/services/mailForwardService.js
// -----------------------------------------------------------------------------
// Business logic for forwarding an email to one or more employees in MongoDB.
// -----------------------------------------------------------------------------

const { createForwarding, listEmployees } = require('../repositories/forwardingRepo');
const { getEmailById } = require('../repositories/emailRepo');

/**
 * Forward an imported email to a list of employee IDs.
 */
async function forwardEmail(emailId, forwardedByUserId, recipientIds, note) {
  if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
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
