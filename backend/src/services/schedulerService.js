const cron = require('node-cron');
const SystemSettings = require('../models/SystemSettings');
const Project = require('../models/Project');
const WeeklyProgress = require('../models/WeeklyProgress');
const { buildWeeklyReportWorkbook } = require('../controllers/weeklyProgressController');
const { getTransporter } = require('./emailService');

let activeCronJob = null;

async function initWeeklyProgressScheduler() {
    try {
        if (activeCronJob) {
            activeCronJob.stop();
            activeCronJob = null;
            console.log('[Scheduler] Stopped existing weekly progress cron job.');
        }

        const settings = await SystemSettings.findOne();
        if (!settings || !settings.weeklyProgresss) {
            console.log('[Scheduler] Weekly progress summary scheduler is disabled.');
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
        console.log(`[Scheduler] Starting weekly progress scheduler: "${cronExpression}" (Day: ${day}, Time: ${timeStr})`);

        activeCronJob = cron.schedule(cronExpression, async () => {
            console.log('[Scheduler] Running weekly progress email report job...');
            await sendWeeklyProgressEmails();
        });
    } catch (err) {
        console.error('[Scheduler] Error initializing weekly progress scheduler:', err.message);
    }
}

async function sendWeeklyProgressEmails() {
    try {
        const settings = await SystemSettings.findOne();
        if (!settings || !settings.weeklyProgresss) return;

        const pmEmails = settings.projectManagerEmails || [];
        if (pmEmails.length === 0) {
            console.log('[Scheduler] No project manager emails configured. Skipping weekly progress report.');
            return;
        }

        const conn = await getTransporter();
        if (!conn) {
            console.log('[Scheduler] SMTP transporter not configured. Skipping weekly progress report.');
            return;
        }

        // Get all active projects
        const projects = await Project.find({ status: { $ne: 'Completed' } });
        if (projects.length === 0) {
            console.log('[Scheduler] No active projects found. Skipping weekly progress report.');
            return;
        }

        const attachments = [];
        for (const proj of projects) {
            // Find the most recent weekly progress report for this project
            const latestReport = await WeeklyProgress.findOne({ projectId: proj._id }).sort({ weekStartDate: -1 });
            let reportToUse = latestReport;
            
            if (!reportToUse) {
                // Generate an empty one if no reports exist yet
                reportToUse = {
                    summaryData: {
                        date: new Date().toLocaleDateString(),
                        projectName: proj.name || '',
                        clientName: proj.clientName || '',
                        clientAddress: proj.location || '',
                        clientProjectManager: proj.contactPerson ? proj.contactPerson.name : ''
                    },
                    sowData: [],
                    scheduleData: [],
                    transmittalData: [],
                    rfiData: [],
                    cdrfiData: []
                };
            }

            try {
                const workbook = await buildWeeklyReportWorkbook(proj._id.toString(), reportToUse);
                const buffer = await workbook.xlsx.writeBuffer();
                const safeProjName = proj.name ? proj.name.replace(/[^a-zA-Z0-9]/g, '_') : 'Project';
                const filename = `Weekly_Progress_${safeProjName}_${reportToUse.weekStartDate || new Date().toISOString().split('T')[0]}.xlsx`;
                
                attachments.push({
                    filename,
                    content: buffer
                });
            } catch (err) {
                console.error(`[Scheduler] Failed to generate Excel for project ${proj.name}:`, err.message);
            }
        }

        if (attachments.length === 0) {
            console.log('[Scheduler] No Excel reports were generated successfully. Skipping email.');
            return;
        }

        const { transporter, from } = conn;
        const html = `
            <h3>Weekly Project Progress Reports</h3>
            <p>Please find attached the latest project status excel files for all active projects as of ${new Date().toLocaleDateString('en-IN')}.</p>
            <br/>
            <p>Best regards,<br/>Steel Project DMS</p>
        `;

        await transporter.sendMail({
            from,
            to: pmEmails.join(', '),
            subject: `📊 Weekly Project Progress Summary — ${new Date().toLocaleDateString('en-IN')}`,
            html,
            attachments
        });

        console.log(`[Scheduler] Weekly progress report email successfully sent to: ${pmEmails.join(', ')} with ${attachments.length} attachments.`);
    } catch (err) {
        console.error('[Scheduler] Error during weekly progress email job:', err.message);
    }
}

module.exports = { initWeeklyProgressScheduler, sendWeeklyProgressEmails };
