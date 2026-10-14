const cron = require('node-cron');
const mongoose = require('mongoose');
const SystemSettings = require('../models/SystemSettings');
const { getProjectStatusReportData } = require('./projectStatsService');
const { generateProjectStatusExcel } = require('./excelService');
const { getTransporter } = require('./emailService');

let activeCronJob = null;

async function initWeeklyProgressScheduler() {
    try {
        if (activeCronJob) {
            activeCronJob.stop();
            activeCronJob = null;
            console.log('[Scheduler] Stopped existing project status summary cron job.');
        }

        const settings = await SystemSettings.findOne();
        if (!settings || !settings.weeklyProgresss) {
            console.log('[Scheduler] Weekly summary progress scheduler is disabled.');
            return;
        }

        const day = settings.weeklyProgressDay !== undefined ? settings.weeklyProgressDay : 4;
        const timeStr = settings.weeklyProgressTime || '11:45';
        const [hour, minute] = timeStr.split(':').map(Number);

        if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            console.error(`[Scheduler] Invalid weeklyProgressTime configuration: "${timeStr}". Defaulting to 11:45.`);
            return;
        }

        // Cron expression: minute hour * * day_of_week
        const cronExpression = `${minute} ${hour} * * ${day}`;
        console.log(`[Scheduler] Starting project status summary scheduler: "${cronExpression}" (Day: ${day}, Time: ${timeStr})`);

        activeCronJob = cron.schedule(cronExpression, async () => {
            console.log('[Scheduler] Running project status summary email report job...');
            await sendProjectStatusEmail();
        });
    } catch (err) {
        console.error('[Scheduler] Error initializing project status scheduler:', err.message);
    }
}

async function sendProjectStatusEmail() {
    try {
        const settings = await SystemSettings.findOne();
        if (!settings || !settings.weeklyProgresss) {
            return { success: false, reason: 'Weekly status report is disabled in settings.' };
        }

        const pmEmails = (settings.projectManagerEmails || [])
            .flatMap(str => (typeof str === 'string' ? str.split(/[\s,;]+/) : []))
            .map(e => e.trim())
            .filter(e => e && e.includes('@'));

        if (pmEmails.length === 0) {
            console.log('[Scheduler] No project manager emails configured. Skipping project status summary.');
            return { success: false, reason: 'No project manager emails configured' };
        }

        const conn = await getTransporter();
        if (!conn) {
            console.log('[Scheduler] SMTP transporter not configured. Skipping project status summary.');
            return { success: false, reason: 'SMTP transporter not configured' };
        }

        // Fetch project status data identically to the Project Status module download
        const filter = {};
        if (settings.updatedBy) {
            filter.createdByAdminId = settings.updatedBy;
        }

        let projectsData = await getProjectStatusReportData(filter);
        // Fallback to all projects if no projects found under updatedBy
        if ((!projectsData || projectsData.length === 0) && filter.createdByAdminId) {
            projectsData = await getProjectStatusReportData({});
        }

        if (!projectsData || projectsData.length === 0) {
            console.log('[Scheduler] No projects found. Skipping status report.');
            return { success: false, reason: 'No projects found' };
        }

        // Generate the status summary spreadsheet using the exact same function as project status module
        const { buffer, filename } = await generateProjectStatusExcel(projectsData);

        const { transporter, from } = conn;
        const html = `
            <h3>Weekly Project Status Summary Report</h3>
            <p>Please find attached the consolidated Project Status report spreadsheet for all active projects as of ${new Date().toLocaleDateString('en-IN')}.</p>
            <br/>
            <p>Best regards,<br/>Steel Project DMS</p>
        `;

        await transporter.sendMail({
            from,
            to: pmEmails.join(', '),
            subject: `📊 Project Status Summary Report — ${new Date().toLocaleDateString('en-IN')}`,
            html,
            attachments: [{
                filename,
                content: buffer
            }]
        });

        console.log(`[Scheduler] Project status summary email successfully sent to: ${pmEmails.join(', ')}.`);
        return { success: true, count: projectsData.length, recipients: pmEmails };
    } catch (err) {
        console.error('[Scheduler] Error during project status summary email job:', err.message);
        throw err;
    }
}

module.exports = { initWeeklyProgressScheduler, sendProjectStatusEmail };

