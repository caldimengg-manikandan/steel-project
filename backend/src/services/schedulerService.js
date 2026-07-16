const cron = require('node-cron');
const mongoose = require('mongoose');
const SystemSettings = require('../models/SystemSettings');
const Project = require('../models/Project');
const DrawingExtraction = require('../models/DrawingExtraction');
const RfiExtraction = require('../models/RfiExtraction');
const ChangeOrder = require('../models/ChangeOrder');
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
        if (!settings || !settings.weeklyProgresss) return;

        const pmEmails = settings.projectManagerEmails || [];
        if (pmEmails.length === 0) {
            console.log('[Scheduler] No project manager emails configured. Skipping project status summary.');
            return;
        }

        const conn = await getTransporter();
        if (!conn) {
            console.log('[Scheduler] SMTP transporter not configured. Skipping project status summary.');
            return;
        }

        // Get all active/non-completed projects owned by this settings creator
        const filter = { status: { $ne: 'Completed' } };
        if (settings.updatedBy) {
            filter.createdByAdminId = settings.updatedBy;
        }
        const projects = await Project.find(filter).sort({ createdAt: -1 }).lean();
        if (projects.length === 0) {
            console.log('[Scheduler] No active projects found. Skipping status report.');
            return;
        }

        const projectIds = projects.map(p => p._id);

        // 1. Aggregate drawing counts per project
        const counts = await DrawingExtraction.aggregate([
            { $match: { projectId: { $in: projectIds } } },
            {
                $group: {
                    _id: '$projectId',
                    totalDrawings: { $sum: 1 },
                    approvalCount: {
                        $sum: {
                            $cond: [
                                {
                                    $or: [
                                        {
                                            $regexMatch: {
                                                input: { $ifNull: ['$extractedFields.revision', ''] },
                                                regex: '^(rev\\s*)?[a-z]',
                                                options: 'i'
                                            }
                                        },
                                        {
                                            $regexMatch: {
                                                input: { $ifNull: ['$extractedFields.remarks', ''] },
                                                regex: 'approved|approval',
                                                options: 'i'
                                            }
                                        },
                                        {
                                            $regexMatch: {
                                                input: { $ifNull: ['$extractedFields.description', ''] },
                                                regex: 'approved|approval',
                                                options: 'i'
                                            }
                                        }
                                    ]
                                }, 1, 0
                            ]
                        }
                    },
                    fabricationCount: {
                        $sum: {
                            $cond: [
                                {
                                    $regexMatch: {
                                        input: { $ifNull: ['$extractedFields.revision', ''] },
                                        regex: '^(rev\\s*)?[0-9]',
                                        options: 'i'
                                    }
                                }, 1, 0
                            ]
                        }
                    },
                    holdCount: {
                        $sum: { $cond: [{ $eq: ['$status', 'on_hold'] }, 1, 0] }
                    },
                    pendingCount: {
                        $sum: { $cond: [{ $in: ['$status', ['queued', 'processing']] }, 1, 0] }
                    },
                    failedCount: {
                        $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                    },
                }
            }
        ]);

        const countMap = {};
        counts.forEach(c => {
            countMap[c._id.toString()] = c;
        });

        // 2. Aggregate RFI Counts per project
        const rfiCounts = await RfiExtraction.aggregate([
            { $match: { projectId: { $in: projectIds } } },
            { $unwind: '$rfis' },
            {
                $group: {
                    _id: '$projectId',
                    openRfiCount: { $sum: { $cond: [{ $eq: ['$rfis.status', 'OPEN'] }, 1, 0] } },
                    closedRfiCount: { $sum: { $cond: [{ $eq: ['$rfis.status', 'CLOSED'] }, 1, 0] } }
                }
            }
        ]);

        const rfiMap = {};
        rfiCounts.forEach(r => {
            rfiMap[r._id.toString()] = r;
        });

        // 3. Aggregate Change Order Counts per project
        const coCounts = await ChangeOrder.aggregate([
            { $match: { projectId: { $in: projectIds } } },
            {
                $group: {
                    _id: '$projectId',
                    totalCO: { $sum: 1 },
                    approvedCO: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
                    workCompletedCO: { $sum: { $cond: [{ $eq: ['$status', 'WORK_COMPLETED'] }, 1, 0] } },
                    pendingCO: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } }
                }
            }
        ]);

        const coMap = {};
        coCounts.forEach(c => {
            coMap[c._id.toString()] = c;
        });

        // Merge project data with aggregated stats
        const projectsData = projects.map(p => {
            const stats = countMap[p._id.toString()] || {};
            const rfiStats = rfiMap[p._id.toString()] || { openRfiCount: 0, closedRfiCount: 0 };
            const coStats = coMap[p._id.toString()] || { totalCO: 0, approvedCO: 0, workCompletedCO: 0, pendingCO: 0 };
            return {
                ...p,
                totalDrawings: stats.totalDrawings || 0,
                fabricationCount: stats.fabricationCount || 0,
                approvalCount: stats.approvalCount || 0,
                holdCount: stats.holdCount || 0,
                pendingCount: stats.pendingCount || 0,
                failedCount: stats.failedCount || 0,
                openRfiCount: rfiStats.openRfiCount,
                closedRfiCount: rfiStats.closedRfiCount,
                totalCO: coStats.totalCO,
                approvedCO: coStats.approvedCO,
                workCompletedCO: coStats.workCompletedCO,
                pendingCO: coStats.pendingCO,
            };
        });

        // Generate the status summary spreadsheet
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
    } catch (err) {
        console.error('[Scheduler] Error during project status summary email job:', err.message);
    }
}

module.exports = { initWeeklyProgressScheduler, sendProjectStatusEmail };
