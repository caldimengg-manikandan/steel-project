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

    const settings = await SystemSettings.findOne();
    if (!settings || !settings.emailEnabled || !settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
        return null;
    }

    return {
        transporter: nodemailer.createTransport({
            host: settings.smtpHost,
            port: settings.smtpPort || 587,
            secure: settings.smtpPort === 465,
            auth: { user: settings.smtpUser, pass: settings.smtpPass }
        }),
        from: `"${settings.smtpFromName || 'Steel Project'}" <${settings.smtpUser}>`,
        settings
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

module.exports = { sendErrorLogNotification, sendErrorLogUpdateSummary, getTransporter };
