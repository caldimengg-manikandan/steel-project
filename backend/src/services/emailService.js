/**
 * emailService.js
 * Reusable nodemailer helper. Uses SMTP settings stored in SystemSettings.
 */

const SystemSettings = require('../models/SystemSettings');

/**
 * Get a configured nodemailer transporter from DB settings.
 * Returns null if email is disabled or not configured.
 */
async function getTransporter() {
    let nodemailer;
    try {
        nodemailer = require('nodemailer');
    } catch (e) {
        console.warn('[Email] nodemailer not installed.');
        return null;
    }

    const { SMTP_SERVER, SMTP_PORT, EMAIL_USER, EMAIL_PASS, SMTP_FROM_NAME } = process.env;

    // Check if required .env variables exist
    if (!SMTP_SERVER || !EMAIL_USER || !EMAIL_PASS) {
        console.warn('[Email] SMTP settings not fully configured in .env');
        return null;
    }

    const port = Number(SMTP_PORT) || 587;

    return {
        transporter: nodemailer.createTransport({
            host: SMTP_SERVER,
            port: port,
            secure: port === 465,
            auth: { user: EMAIL_USER, pass: EMAIL_PASS }
        }),
        from: `"${SMTP_FROM_NAME || 'Steel Project'}" <${EMAIL_USER}>`,
        settings: await SystemSettings.findOne() // Keep returning settings in case other functions need the recipient lists
    };
}

/**
 * Get all recipient emails
 */
async function getRecipients() {
    const settings = await SystemSettings.findOne();
    if (!settings) return [];

    const allRaw = [
        ...(settings.superAdminEmails || []),
        ...(settings.projectManagerEmails || []),
        ...(settings.teamLeadEmails || [])
    ];

    // Some inputs might be comma-separated strings. Split them up.
    const allEmails = allRaw
        .flatMap(str => (typeof str === 'string' ? str.split(/[\s,;]+/) : []))
        .map(e => e.trim())
        .filter(e => e && e.includes('@'));

    // Remove duplicates
    return [...new Set(allEmails)];
}

/**
 * Send an Error Log notification email.
 * @param {Object} logEntry - The new error log entry that was added
 * @param {string} addedByRole - 'superAdmin' | 'projectManager' | 'teamLead'
 * @param {string} addedByName - Display name of the person who added the log
 */
async function sendErrorLogNotification(logEntry, addedByRole, addedByName) {
    try {
        const conn = await getTransporter();
        if (!conn) {
            console.log('[Email] Email not configured or disabled — skipping notification.');
            return;
        }

        const recipients = await getRecipients();
        if (recipients.length === 0) {
            console.log('[Email] No recipients found — skipping notification.');
            return;
        }

        const { transporter, from } = conn;

        const roleLabel = {
            superAdmin: 'Super Admin',
            projectManager: 'Project Manager',
            teamLead: 'Team Lead'
        }[addedByRole] || addedByRole;

        const severityColor = {
            'High': '#dc2626',
            'Medium': '#f59e0b',
            'Low': '#16a34a'
        }[logEntry.severity] || '#6b7280';

        const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 20px;">
  <div style="max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    
    <!-- Header -->
    <div style="background: #1e3a5f; padding: 24px 32px;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px;">🚨 New Error Log Entry Added</h1>
      <p style="color: #93c5fd; margin: 6px 0 0; font-size: 14px;">
        Added by <strong>${addedByName || roleLabel}</strong> (${roleLabel}) on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
      </p>
    </div>

    <!-- Body -->
    <div style="padding: 28px 32px;">
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr style="background: #f8fafc;">
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; width: 40%; border: 1px solid #e5e7eb;">Date</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.date || '—'}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">Project / Job Name</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.projectName || '—'}</td>
        </tr>
        <tr style="background: #f8fafc;">
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">Client / Fabricator</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.clientName || '—'}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">Error Category</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.errorCategory || '—'}</td>
        </tr>
        <tr style="background: #f8fafc;">
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">Error Description</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.errorDescription || '—'}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">Impact</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.impact || '—'}</td>
        </tr>
        <tr style="background: #f8fafc;">
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">Severity</td>
          <td style="padding: 10px 14px; border: 1px solid #e5e7eb;">
            <span style="background: ${severityColor}; color: white; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">
              ${logEntry.severity || '—'}
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">PM</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.pm || '—'}</td>
        </tr>
        <tr style="background: #f8fafc;">
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">Modeler</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.modeler || '—'}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">Detailer</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.detailer || '—'}</td>
        </tr>
        <tr style="background: #f8fafc;">
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">Checker</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.checker || '—'}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">Root Cause</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.rootCause || '—'}</td>
        </tr>
        <tr style="background: #f8fafc;">
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">Corrective Action</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.correctiveAction || '—'}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">Status</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.status || '—'}</td>
        </tr>
        <tr style="background: #f8fafc;">
          <td style="padding: 10px 14px; font-weight: 600; color: #374151; border: 1px solid #e5e7eb;">Remarks</td>
          <td style="padding: 10px 14px; color: #111827; border: 1px solid #e5e7eb;">${logEntry.remarks || '—'}</td>
        </tr>
      </table>
    </div>

    <!-- Footer -->
    <div style="background: #f8fafc; padding: 16px 32px; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0; font-size: 12px; color: #9ca3af;">
        This is an automated notification from the Steel Project DMS. Please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`;

        await transporter.sendMail({
            from,
            to: recipients.join(', '),
            subject: `🚨 [Error Log] New entry added — ${logEntry.projectName || 'Unknown Project'} (${logEntry.severity || 'Unknown'} severity)`,
            html
        });

        console.log(`[Email] Error log notification sent to: ${recipients.join(', ')}`);
    } catch (err) {
        // Never crash the main request due to email failure
        console.error('[Email] Failed to send error log notification:', err.message);
    }
}

/**
 * Send a generic Error Log update notification email.
 */
async function sendErrorLogUpdateSummary(addedByRole, addedByName, newEntries = [], editedEntries = [], struckOutEntries = []) {
    try {
        const conn = await getTransporter();
        if (!conn) return;

        const recipients = await getRecipients();
        if (recipients.length === 0) return;

        const { transporter, from } = conn;

        const roleLabel = {
            superAdmin: 'Super Admin',
            projectManager: 'Project Manager',
            teamLead: 'Team Lead'
        }[addedByRole] || addedByRole;

        let addedDataHtml = '';
        if (newEntries && newEntries.length > 0) {
            addedDataHtml = newEntries.map((logEntry, i) => {
                const severityColor = {
                    'High': '#dc2626',
                    'Medium': '#f59e0b',
                    'Low': '#16a34a'
                }[logEntry.severity] || '#6b7280';
                
                return `
                <div style="margin-top: 24px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">
                  <div style="background: #f8fafc; padding: 12px 16px; font-weight: bold; border-bottom: 1px solid #e5e7eb; color: #1e3a5f;">
                    New Entry #${i + 1}
                  </div>
                  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; width: 40%; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Date</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.date || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Project / Job Name</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.projectName || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Client / Fabricator</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.clientName || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Error Category</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.errorCategory || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Error Description</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.errorDescription || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Impact</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.impact || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Severity</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">
                        <span style="background: ${severityColor}; color: white; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">
                          ${logEntry.severity || '—'}
                        </span>
                      </td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">PM</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.pm || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Modeler</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.modeler || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Detailer</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.detailer || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Checker</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.checker || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Root Cause</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.rootCause || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Corrective Action</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.correctiveAction || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Status</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.status || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Remarks</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.remarks || '—'}</td>
                    </tr>
                  </table>
                </div>
                `;
            }).join('');
        }

        let editedDataHtml = '';
        if (editedEntries && editedEntries.length > 0) {
            editedDataHtml = editedEntries.map((logEntry, i) => {
                const severityColor = {
                    'High': '#dc2626',
                    'Medium': '#f59e0b',
                    'Low': '#16a34a'
                }[logEntry.severity] || '#6b7280';
                
                return `
                <div style="margin-top: 24px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">
                  <div style="background: #fff8e6; padding: 12px 16px; font-weight: bold; border-bottom: 1px solid #e5e7eb; color: #b45309;">
                    Edited Entry #${i + 1}
                  </div>
                  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; width: 40%; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Date</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.date || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Project / Job Name</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.projectName || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Client / Fabricator</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.clientName || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Error Category</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.errorCategory || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Error Description</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.errorDescription || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Impact</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.impact || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Severity</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">
                        <span style="background: ${severityColor}; color: white; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">
                          ${logEntry.severity || '—'}
                        </span>
                      </td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">PM</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.pm || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Modeler</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.modeler || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Detailer</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.detailer || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Checker</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.checker || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Root Cause</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.rootCause || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Corrective Action</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.correctiveAction || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Status</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.status || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Remarks</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.remarks || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Striked Out</td>
                      <td style="padding: 10px 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${logEntry.strikedOut ? 'Yes' : 'No'}</td>
                    </tr>
                  </table>
                </div>
                `;
            }).join('');
        }

        let struckOutDataHtml = '';
        if (struckOutEntries && struckOutEntries.length > 0) {
            struckOutDataHtml = struckOutEntries.map((logEntry, i) => {
                const severityColor = {
                    'High': '#dc2626',
                    'Medium': '#f59e0b',
                    'Low': '#16a34a'
                }[logEntry.severity] || '#6b7280';
                
                return `
                <div style="margin-top: 24px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; opacity: 0.85;">
                  <div style="background: #fef2f2; padding: 12px 16px; font-weight: bold; border-bottom: 1px solid #e5e7eb; color: #991b1b;">
                    ❌ Entry Struck Out #${i + 1}
                  </div>
                  <div style="padding: 10px 16px; background: #fff; font-size: 14px; color: #4b5563; font-style: italic;">
                    The following content was struck out by ${addedByName || roleLabel}:
                  </div>
                  <table style="width: 100%; border-collapse: collapse; font-size: 14px; text-decoration: line-through; color: #6b7280;">
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; width: 40%; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Date</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.date || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Project / Job Name</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.projectName || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Client / Fabricator</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.clientName || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Error Category</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.errorCategory || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Error Description</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.errorDescription || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Impact</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.impact || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Severity</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.severity || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">PM</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.pm || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Modeler</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.modeler || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Detailer</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.detailer || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Checker</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.checker || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Root Cause</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.rootCause || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Corrective Action</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.correctiveAction || '—'}</td>
                    </tr>
                    <tr style="background: #f8fafc;">
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Status</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.status || '—'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">Remarks</td>
                      <td style="padding: 10px 14px; border-bottom: 1px solid #e5e7eb;">${logEntry.remarks || '—'}</td>
                    </tr>
                  </table>
                </div>
                `;
            }).join('');
        }

        const hasUpdates = (newEntries && newEntries.length > 0) || (editedEntries && editedEntries.length > 0) || (struckOutEntries && struckOutEntries.length > 0);

        const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 20px;">
  <div style="max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <div style="background: #1e3a5f; padding: 24px 32px;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px;">🚨 Error Log Updated</h1>
      <p style="color: #93c5fd; margin: 6px 0 0; font-size: 14px;">
        The Error Log was updated by <strong>${addedByName || roleLabel}</strong> (${roleLabel}) on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
      </p>
    </div>
    <div style="padding: 28px 32px;">
      <p style="color: #374151; font-size: 15px;">Changes have been made to the global error log. ${hasUpdates ? 'Below is a summary of the updates:' : 'Please log in to the system to review the updates.'}</p>
      ${addedDataHtml}
      ${editedDataHtml}
      ${struckOutDataHtml}
    </div>
  </div>
</body>
</html>`;

        await transporter.sendMail({
            from,
            to: recipients.join(', '),
            subject: `🚨 [Error Log] Updates made by ${addedByName || roleLabel}`,
            html
        });

        console.log(`[Email] Error log update notification sent to: ${recipients.join(', ')}`);
    } catch (err) {
        console.error('[Email] Failed to send error log update notification:', err.message);
    }
}

/**
 * Resolve recipient emails strictly for the specific team assigned to a project (PM, APM, Team Lead).
 * Ensures NO other team or unrelated project manager receives the notification.
 */
async function getProjectTeamRecipients(project) {
    if (!project) return [];

    const Project = require('../models/Project');
    const Team = require('../models/Team');
    const User = require('../models/User');

    let fullProject = project;
    if (typeof project === 'string' || !project.caldimProjectManager) {
        const pDoc = await Project.findById(project._id || project).lean();
        if (pDoc) fullProject = pDoc;
    }

    const userIds = new Set();

    // 1. Direct project team role IDs
    if (fullProject.caldimProjectManager) userIds.add(fullProject.caldimProjectManager.toString());
    if (fullProject.caldimAssistantProjectManager) userIds.add(fullProject.caldimAssistantProjectManager.toString());
    if (fullProject.caldimTeamLead) userIds.add(fullProject.caldimTeamLead.toString());

    // 2. Linked Team
    let team = null;
    if (fullProject.teamId) {
        team = await Team.findById(fullProject.teamId).lean();
    } else if (fullProject.teamName) {
        team = await Team.findOne({ name: fullProject.teamName }).lean();
    }

    if (team) {
        if (team.project_manager) userIds.add(team.project_manager.toString());
        if (team.assistant_project_manager) userIds.add(team.assistant_project_manager.toString());
        if (Array.isArray(team.lead)) {
            team.lead.forEach(id => {
                if (id) userIds.add(id.toString());
            });
        }
    }

    // 3. Fallback: if no direct team assignments yet, check assigned users who are PM, APM, or Team Lead
    if (userIds.size === 0 && Array.isArray(fullProject.assignments) && fullProject.assignments.length > 0) {
        const assignedIds = fullProject.assignments.map(a => a.userId).filter(Boolean);
        const assignedUsers = await User.find({
            _id: { $in: assignedIds },
            role: { $in: ['project_manager', 'assistant_project_manager', 'team_lead', 'assistant_team_lead'] }
        }).select('_id').lean();
        assignedUsers.forEach(u => userIds.add(u._id.toString()));

        // Also check if any assigned user belongs to a Team
        if (assignedIds.length > 0) {
            const memberTeams = await Team.find({
                $or: [
                    { project_manager: { $in: assignedIds } },
                    { assistant_project_manager: { $in: assignedIds } },
                    { lead: { $in: assignedIds } },
                    { members: { $in: assignedIds } }
                ]
            }).lean();
            for (const t of memberTeams) {
                if (t.project_manager) userIds.add(t.project_manager.toString());
                if (t.assistant_project_manager) userIds.add(t.assistant_project_manager.toString());
                if (Array.isArray(t.lead)) {
                    t.lead.forEach(id => { if (id) userIds.add(id.toString()); });
                }
            }
        }
    }

    if (userIds.size === 0) {
        return [];
    }

    const users = await User.find({
        _id: { $in: Array.from(userIds) },
        status: { $ne: 'inactive' }
    }).select('email displayName username role').lean();

    const recipients = users
        .map(u => ({
            id: u._id.toString(),
            email: u.email?.trim()?.toLowerCase(),
            name: u.displayName || u.username,
            role: u.role
        }))
        .filter(u => u.email && u.email.includes('@'));

    // Unique by email
    const uniqueMap = new Map();
    for (const r of recipients) {
        if (!uniqueMap.has(r.email)) {
            uniqueMap.set(r.email, r);
        }
    }

    return Array.from(uniqueMap.values());
}

/**
 * Send an automated email notification when a folder or project is deleted.
 * Alerts strictly the assigned Team Lead, Assistant Project Manager, and Project Manager for that team.
 *
 * @param {Object} params
 * @param {Object|string} params.project - Project model or lean object
 * @param {string} params.deletedItemPath - Name or relative path of the deleted item/folder
 * @param {Object} params.deletedBy - Information on who performed the deletion { username, displayName, email, role }
 * @param {boolean} [params.isProjectDeletion=false] - True if entire project was deleted
 */
async function sendFolderDeletionAlert({ project, deletedItemPath, deletedBy, isProjectDeletion = false }) {
    try {
        const Project = require('../models/Project');
        let fullProject = project;
        if (typeof project === 'string' || !project.caldimProjectManager) {
            const pDoc = await Project.findById(project._id || project).lean();
            if (pDoc) fullProject = pDoc;
        }

        if (!fullProject) {
            console.log('[Email] Deletion alert skipped — project not found.');
            return;
        }

        const recipients = await getProjectTeamRecipients(fullProject);
        if (recipients.length === 0) {
            console.log(`[Email] No team leads/PMs found for project "${fullProject.name}" — skipping deletion alert.`);
            return;
        }

        // SAFETY GUARD: Do not send live emails in local dev before push
        if (process.env.ENABLE_DELETION_EMAIL !== 'true' && process.env.NODE_ENV !== 'production') {
            console.log(`[Email] [DEV SAFETY - EMAIL SUPPRESSED] Deletion alert for "${fullProject.name}". Recipients would be: ${recipients.map(r => r.email).join(', ')}`);
            return;
        }

        const conn = await getTransporter();
        if (!conn) {
            console.warn('[Email] SMTP transporter not configured — cannot send deletion alert.');
            return;
        }

        const { transporter, from } = conn;

        const roleLabels = {
            superadmin: 'Super Admin',
            admin: 'Admin',
            project_manager: 'Project Manager',
            assistant_project_manager: 'Assistant Project Manager',
            team_lead: 'Team Lead',
            assistant_team_lead: 'Assistant Team Lead',
            team_member: 'Team Member',
            user: 'User'
        };

        const actorName = deletedBy?.displayName || deletedBy?.username || 'System User';
        const actorEmail = deletedBy?.email || 'N/A';
        const actorRole = roleLabels[deletedBy?.role] || deletedBy?.role || 'User';

        const projectName = fullProject.name || 'Unnamed Project';
        const clientName = fullProject.clientName || 'N/A';
        const teamName = fullProject.teamName || 'Assigned Team';

        const cleanItemPath = (deletedItemPath || '').replace(/\\/g, '/');
        const formattedDate = new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'full',
            timeStyle: 'medium'
        });

        const actionTitle = isProjectDeletion ? 'Project Deleted' : 'Folder Deleted from Project';
        const subjectPrefix = isProjectDeletion ? '🚨 [Project Deleted]' : '⚠️ [Folder Deleted]';
        const subject = `${subjectPrefix} Project "${projectName}" - deleted by ${actorName}`;

        const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${actionTitle}</title>
</head>
<body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #1e293b;">
  <div style="max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 14px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
    
    <!-- Top Header Banner -->
    <div style="background: ${isProjectDeletion ? '#b91c1c' : '#ea580c'}; padding: 24px 32px; color: #ffffff;">
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 24px; margin-right: 10px;">${isProjectDeletion ? '🚨' : '⚠️'}</span>
        <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em;">${actionTitle}</h1>
      </div>
      <p style="margin: 0; font-size: 14px; opacity: 0.95; line-height: 1.5;">
        ${isProjectDeletion 
            ? `The project <strong>${projectName}</strong> was deleted from the system.` 
            : `A folder/directory was deleted from project <strong>${projectName}</strong>.`}
      </p>
    </div>

    <!-- Main Content -->
    <div style="padding: 28px 32px;">
      
      <!-- Key Info Summary Box -->
      <div style="background-color: #fff7ed; border-left: 4px solid #f97316; padding: 14px 18px; border-radius: 6px; margin-bottom: 24px;">
        <p style="margin: 0; font-size: 14px; color: #9a3412; line-height: 1.5;">
          <strong>Security & Audit Notice:</strong> This notification is automatically sent to the assigned <strong>Project Manager</strong>, <strong>Assistant Project Manager</strong>, and <strong>Team Lead</strong> for this project team.
        </p>
      </div>

      <!-- Details Table -->
      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px;">
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 0; font-weight: 600; color: #64748b; width: 35%;">Project Name</td>
          <td style="padding: 10px 0; font-weight: 700; color: #0f172a;">${projectName}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 0; font-weight: 600; color: #64748b;">Client Name</td>
          <td style="padding: 10px 0; color: #1e293b;">${clientName}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 0; font-weight: 600; color: #64748b;">Assigned Team</td>
          <td style="padding: 10px 0; color: #1e293b;">
            <span style="display: inline-block; background-color: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 4px; font-weight: 600; font-size: 12px;">
              ${teamName}
            </span>
          </td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 0; font-weight: 600; color: #64748b;">${isProjectDeletion ? 'Deleted Target' : 'Deleted Folder / Item'}</td>
          <td style="padding: 10px 0;">
            <code style="background: #fee2e2; color: #991b1b; padding: 4px 8px; border-radius: 4px; font-family: monospace; font-size: 13px; font-weight: 600; word-break: break-all;">
              ${cleanItemPath}
            </code>
          </td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 0; font-weight: 600; color: #64748b;">Deleted By (Login User)</td>
          <td style="padding: 10px 0; color: #1e293b;">
            <strong>${actorName}</strong> 
            <span style="color: #64748b; font-size: 13px;">(${actorRole})</span>
          </td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 0; font-weight: 600; color: #64748b;">User Email</td>
          <td style="padding: 10px 0; color: #475569;">${actorEmail}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-weight: 600; color: #64748b;">Timestamp (IST)</td>
          <td style="padding: 10px 0; color: #1e293b;">${formattedDate}</td>
        </tr>
      </table>

      <!-- Notified Team Members -->
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 18px; margin-bottom: 16px;">
        <div style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">
          Team Recipients Notified (${recipients.length})
        </div>
        <div style="font-size: 13px; color: #334155; line-height: 1.6;">
          ${recipients.map(r => `<div>• <strong>${r.name}</strong> <span style="color: #64748b;">(${roleLabels[r.role] || r.role})</span> &lt;${r.email}&gt;</div>`).join('')}
        </div>
      </div>

    </div>

    <!-- Footer -->
    <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 32px; font-size: 12px; color: #94a3b8; text-align: center;">
      Steel DMS • Caldim Engineering • Automated System Alert
    </div>
  </div>
</body>
</html>`;

        const recipientEmails = recipients.map(r => r.email);

        await transporter.sendMail({
            from,
            to: recipientEmails.join(', '),
            subject,
            html
        });

        console.log(`[Email] Deletion alert sent to ${recipientEmails.length} team member(s) (${recipientEmails.join(', ')}) for project "${projectName}".`);
    } catch (err) {
        console.error('[Email] Failed to send deletion alert email:', err.message);
    }
}

module.exports = {
    sendErrorLogNotification,
    sendErrorLogUpdateSummary,
    getTransporter,
    getProjectTeamRecipients,
    sendFolderDeletionAlert
};

