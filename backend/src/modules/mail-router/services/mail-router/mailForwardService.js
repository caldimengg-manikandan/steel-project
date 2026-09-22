"use strict";
// src/features/mail-router/services/mailForwardService.ts
// Business logic for forwarding an email to one or more employees.
Object.defineProperty(exports, "__esModule", { value: true });
exports.forwardEmail = forwardEmail;
exports.getEmployeeList = getEmployeeList;
const db_1 = require("../../db");
const forwardingRepo_1 = require("../../repositories/mail/forwardingRepo");
const emailRepo_1 = require("../../repositories/mail/emailRepo");
/**
 * Forward an imported email to a list of employee IDs.
 *
 * Validates:
 *   - The email exists
 *   - Each recipient exists and has the EMPLOYEE role
 *   - At least one valid recipient is provided
 *
 * Idempotent: forwarding the same email to the same employee twice is a no-op.
 */
async function forwardEmail(emailId, forwardedByUserId, recipientIds, note) {
    if (!recipientIds || recipientIds.length === 0) {
        throw new Error('At least one recipient must be selected.');
    }
    // Verify the email exists
    const email = await (0, emailRepo_1.getEmailById)(emailId);
    if (!email) {
        throw new Error(`Email ${emailId} not found.`);
    }
    // Verify all recipients are employees
    const { rows: recipientRows } = await (0, db_1.query)(`SELECT id, role FROM mail_router_user_refs WHERE id = ANY($1::uuid[])`, [recipientIds]);
    const validIds = new Set(recipientRows.filter((r) => r.role === 'EMPLOYEE').map((r) => r.id));
    const invalidIds = recipientIds.filter((id) => !validIds.has(id));
    if (invalidIds.length > 0) {
        throw new Error(`The following recipient IDs are invalid or not employees: ${invalidIds.join(', ')}`);
    }
    return (0, forwardingRepo_1.createForwarding)(emailId, forwardedByUserId, recipientIds, note);
}
/**
 * Get the list of employees available for the PM's selector.
 * This is a thin wrapper around the repo to keep the API route clean.
 */
async function getEmployeeList() {
    return (0, forwardingRepo_1.listEmployees)();
}
