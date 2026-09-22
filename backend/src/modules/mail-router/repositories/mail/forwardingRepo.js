"use strict";
// src/features/mail-router/infra/db/forwardingRepo.ts
// All SQL relating to mail_forwardings and forwarding_recipients lives here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createForwarding = createForwarding;
exports.listMailboxItems = listMailboxItems;
exports.getMailboxItem = getMailboxItem;
exports.markAsRead = markAsRead;
exports.countUnread = countUnread;
exports.listEmployees = listEmployees;
const db_1 = require("../../db");
// ── Forwarding creation ───────────────────────────────────────────────────────
/**
 * Create a forwarding record and its recipient rows in a single transaction.
 * The UNIQUE constraint on (forwarding_id, recipient_id) prevents duplicate
 * delivery if this is called twice with the same arguments.
 *
 * @param emailId       Internal UUID of the imported email
 * @param forwardedBy   User ID of the PM performing the forward
 * @param recipientIds  Array of employee user IDs
 * @param note          Optional PM note to recipients
 */
async function createForwarding(emailId, forwardedBy, recipientIds, note) {
    const client = await (0, db_1.getClient)();
    try {
        await client.query('BEGIN');
        // Insert the forwarding record
        const { rows: fwRows } = await client.query(`INSERT INTO mail_forwardings (email_id, forwarded_by, note)
       VALUES ($1, $2, $3)
       RETURNING *`, [emailId, forwardedBy, note ?? null]);
        const fwRow = fwRows[0];
        const forwardingId = fwRow.id;
        // Insert recipient rows (idempotent via ON CONFLICT DO NOTHING)
        const recipientRows = [];
        for (const recipientId of recipientIds) {
            const { rows: rRows } = await client.query(`INSERT INTO forwarding_recipients (forwarding_id, recipient_id)
         VALUES ($1, $2)
         ON CONFLICT (forwarding_id, recipient_id) DO NOTHING
         RETURNING *`, [forwardingId, recipientId]);
            if (rRows[0]) {
                recipientRows.push({
                    id: rRows[0].id,
                    forwardingId: rRows[0].forwarding_id,
                    recipientId: rRows[0].recipient_id,
                    readAt: rRows[0].read_at
                        ? rRows[0].read_at.toISOString()
                        : null,
                    createdAt: rRows[0].created_at.toISOString(),
                });
            }
        }
        await client.query('COMMIT');
        return {
            forwarding: {
                id: forwardingId,
                emailId: fwRow.email_id,
                forwardedBy: fwRow.forwarded_by,
                forwardedAt: fwRow.forwarded_at.toISOString(),
                note: fwRow.note,
            },
            recipients: recipientRows,
        };
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
// ── Employee mailbox queries ──────────────────────────────────────────────────
/**
 * List all emails forwarded to a specific employee.
 * Uses the employee_mailbox view. Always filtered by recipient_id = employeeId.
 */
async function listMailboxItems(employeeId, limit = 50, offset = 0) {
    const { rows } = await (0, db_1.query)(`SELECT *
       FROM employee_mailbox
      WHERE recipient_id = $1
      ORDER BY forwarded_at DESC
      LIMIT $2 OFFSET $3`, [employeeId, limit, offset]);
    return rows.map(mapMailboxRow);
}
/**
 * Get a single forwarded email detail for an employee.
 * ALWAYS filters by recipient_id — cannot be used without the employee ID.
 */
async function getMailboxItem(employeeId, emailId) {
    const { rows } = await (0, db_1.query)(`SELECT *
       FROM employee_mailbox
      WHERE recipient_id = $1
        AND email_id     = $2
      LIMIT 1`, [employeeId, emailId]);
    return rows[0] ? mapMailboxRow(rows[0]) : null;
}
/** Mark an email as read for a specific employee. */
async function markAsRead(employeeId, emailId) {
    await (0, db_1.query)(`UPDATE forwarding_recipients fr
        SET read_at = now()
       FROM mail_forwardings mf
      WHERE mf.id        = fr.forwarding_id
        AND mf.email_id  = $1
        AND fr.recipient_id = $2
        AND fr.read_at IS NULL`, [emailId, employeeId]);
}
/** Count unread emails for an employee (for badge display). */
async function countUnread(employeeId) {
    const { rows } = await (0, db_1.query)(`SELECT COUNT(*) AS count
       FROM forwarding_recipients
      WHERE recipient_id = $1 AND read_at IS NULL`, [employeeId]);
    return parseInt(rows[0]?.count ?? '0', 10);
}
// ── User list (for employee selector) ────────────────────────────────────────
/** List all users with the EMPLOYEE role (for the PM's employee selector). */
async function listEmployees() {
    const { rows } = await (0, db_1.query)(`SELECT id, email, display_name, role
       FROM mail_router_user_refs
      WHERE role = 'EMPLOYEE'
      ORDER BY display_name ASC`);
    return rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        role: 'EMPLOYEE',
    }));
}
// ── Mapping helper ────────────────────────────────────────────────────────────
function mapMailboxRow(row) {
    return {
        recipientRowId: row.recipient_row_id,
        emailId: row.email_id,
        provider: row.provider || 'MICROSOFT',
        providerMessageId: row.provider_message_id || row.graph_message_id,
        subject: row.subject,
        fromName: row.from_name,
        fromAddress: row.from_address,
        receivedAt: row.received_at.toISOString(),
        bodyPreview: row.body_preview,
        bodyHtml: row.body_html,
        bodyText: row.body_text,
        links: Array.isArray(row.links) ? row.links : [],
        hasAttachments: row.has_attachments,
        readAt: row.read_at ? row.read_at.toISOString() : null,
        forwardedAt: row.forwarded_at.toISOString(),
        pmNote: row.pm_note,
    };
}
