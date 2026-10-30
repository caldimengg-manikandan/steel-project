/**
 * ============================================================
 * Admin Projects Controller
 * ============================================================
 * ALL operations scoped to req.principal.adminId.
 *
 * Routes:
 *   GET    /api/admin/projects                           — list own projects
 *   POST   /api/admin/projects                           — create project
 *   GET    /api/admin/projects/:projectId                — get one project
 *   PATCH  /api/admin/projects/:projectId                — update project
 *   DELETE /api/admin/projects/:projectId                — delete project
 *   POST   /api/admin/projects/:projectId/assignments    — assign user
 *   DELETE /api/admin/projects/:projectId/assignments/:userId — remove assignment
 *   POST   /api/admin/projects/:projectId/reserve-transmittal — reserve transmittal number
 */
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const Project = require('../models/Project');
const User = require('../models/User');
const Team = require('../models/Team');
const Drawing = require('../models/Drawing');
const DrawingExtraction = require('../models/DrawingExtraction');
const RfiExtraction = require('../models/RfiExtraction');
const CdrfiExtraction = require('../models/CdrfiExtraction');
const ChangeOrder = require('../models/ChangeOrder');
const { generateProjectStatusExcel } = require('../services/excelService');
const { attachProjectStats, getProjectStatusReportData } = require('../services/projectStatsService');
const { getExternalProjects } = require('../services/externalProjectService');
const { buildProjectQueryForUser } = require('../utils/projectAccessFilter');
const storageGateway = require('../utils/storageGateway');
const { runExtractionPipeline } = require('../services/extractionService');
const { calculateSowProgress } = require('../utils/sowCalculator');

/**
 * GET /api/admin/projects
 * List all projects owned by the logged-in admin.
 */
async function listProjects(req, res) {
    const { status, search } = req.query;

    const accessFilter = await buildProjectQueryForUser(req.principal);
    const filter = { ...accessFilter };

    if (status) filter.status = status;
    if (search) {
        const searchCondition = {
            $or: [
                { name: { $regex: search, $options: 'i' } },
                { clientName: { $regex: search, $options: 'i' } },
            ]
        };
        if (filter.$or) {
            filter.$and = [{ $or: filter.$or }, searchCondition];
            delete filter.$or;
        } else {
            filter.$or = searchCondition.$or;
        }
    }

    const projects = await Project
        .find(filter)
        .sort({ createdAt: -1 });

    const projectsWithStats = await attachProjectStats(projects);
    res.json({ count: projectsWithStats.length, projects: projectsWithStats });
}

/**
 * POST /api/admin/projects
 * 
 * Creates project under this admin.
 * createdByAdminId is always injected server-side.
 */
async function createProject(req, res) {
    const adminId = req.principal.adminId;
    const {
        name, clientName, clientId, contactPerson, clientContactPersons,
        caldimProjectManager, caldimProjectManagerName, caldimAssistantProjectManager, caldimAssistantProjectManagerName,
        caldimTeamLead, caldimTeamLeadName, teamId, teamName,
        description, status,
        approximateDrawingsCount, location, sequences, scopeOfWork,
        connectionDesignVendor, connectionDesignContact, connectionDesignEmail,
        year, startingTransmittalNumber, trackingMode, creationDate,
        projectStartDate, financialYear, projectCode, division, projectManager
    } = req.body;

    const today = new Date();
    let finalSequences = sequences || [];
    if (!Array.isArray(finalSequences) || finalSequences.length === 0) {
        if (Array.isArray(scopeOfWork)) {
            finalSequences = scopeOfWork.flatMap(sow => sow.sequences || []);
        }
    }
    finalSequences = finalSequences.map(seq => ({
        ...seq,
        approvalDate: seq.approvalDate || today
    }));

    const processedScopeOfWork = (scopeOfWork || []).map(sow => ({
        ...sow,
        approvalDate: sow.approvalDate ? new Date(sow.approvalDate) : today,
        fabricationDate: sow.fabricationDate ? new Date(sow.fabricationDate) : null,
        deadline: sow.deadline ? new Date(sow.deadline) : null,
        sequences: Array.isArray(sow.sequences) ? sow.sequences.map(seq => ({
            ...seq,
            approvalDate: seq.approvalDate ? new Date(seq.approvalDate) : today,
            fabricationDate: seq.fabricationDate ? new Date(seq.fabricationDate) : null
        })) : []
    }));

    if (!name || (!clientName && !clientId)) {
        return res.status(400).json({ error: 'name and either clientName or clientId are required.' });
    }

    // Ensure absolutely NO residual data from any previously deleted project with the same name exists
    try {
        const safeCleanName = name.trim();
        const nameRegex = new RegExp(`^${safeCleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const pathRegex = new RegExp(`^Projects/${safeCleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`, 'i');
        const altPathRegex = new RegExp(`^Projects/${safeCleanName.replace(/ /g, '_').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`, 'i');

        const Transmittal = require('../models/Transmittal');
        const DrawingLog = require('../models/DrawingLog');
        const WeeklyProgress = require('../models/WeeklyProgress');
        const DeletedStoragePath = require('../models/DeletedStoragePath');

        await Promise.all([
            Drawing.deleteMany({ projectName: nameRegex }),
            DrawingExtraction.deleteMany({ $or: [{ storageGatewayPath: pathRegex }, { storageGatewayPath: altPathRegex }] }),
            RfiExtraction.deleteMany({ $or: [{ storageGatewayPath: pathRegex }, { storageGatewayPath: altPathRegex }] }),
            CdrfiExtraction.deleteMany({ $or: [{ storageGatewayPath: pathRegex }, { storageGatewayPath: altPathRegex }] }),
            ChangeOrder.deleteMany({ projectName: nameRegex }),
            Transmittal.deleteMany({ projectName: nameRegex }),
            DrawingLog.deleteMany({ projectName: nameRegex }),
            WeeklyProgress.deleteMany({ projectName: nameRegex }),
            DeletedStoragePath.deleteMany({
                $or: [
                    { path: `Projects/${safeCleanName}` },
                    { path: `Projects/${safeCleanName.replace(/ /g, '_')}` },
                    { path: { $regex: pathRegex } },
                    { path: { $regex: altPathRegex } }
                ]
            })
        ]);
    } catch (cleanupErr) {
        console.warn('[CreateProject] Pre-clean residual data warning:', cleanupErr.message);
    }

    const projectYear = year ? Number(year) : new Date().getFullYear();
    const startNum = (projectYear <= 2026 && startingTransmittalNumber) ? Number(startingTransmittalNumber) : 1;
    // Pre-seed transmittalCount so first reserve = startNum
    const initialTransmittalCount = startNum - 1;

    const effectiveCreationDate = creationDate || (projectYear <= 2025 ? `${projectYear}-01-01` : null);

    const effectiveContactPerson = contactPerson || (Array.isArray(clientContactPersons) && clientContactPersons.length > 0 ? clientContactPersons[0] : null);

    // Auto-resolve hierarchy if created by APM or Team Lead
    const creatorId = req.principal.id;
    let effectivePm = caldimProjectManager || null;
    let effectivePmName = caldimProjectManagerName || projectManager || '';
    let effectiveApm = caldimAssistantProjectManager || null;
    let effectiveApmName = caldimAssistantProjectManagerName || '';
    let effectiveTl = caldimTeamLead || null;
    let effectiveTlName = caldimTeamLeadName || '';
    let effectiveTeamId = teamId || null;
    let effectiveTeamName = teamName || '';

    const creatorUser = await User.findById(creatorId);
    if (creatorUser) {
        // If PM is not set, resolve from creator's designated PM
        if (!effectivePm && creatorUser.project_manager) {
            effectivePm = creatorUser.project_manager;
            const pmUser = await User.findById(effectivePm);
            if (pmUser) effectivePmName = pmUser.displayName || pmUser.username;
        }

        // If creator is APM, set APM to creator
        if (req.principal.role === 'assistant_project_manager') {
            if (!effectiveApm) {
                effectiveApm = creatorId;
                effectiveApmName = creatorUser.displayName || creatorUser.username;
            }
        } else if (req.principal.role === 'team_lead' || req.principal.role === 'assistant_team_lead') {
            // If creator is Team Lead, set TL to creator
            if (!effectiveTl) {
                effectiveTl = creatorId;
                effectiveTlName = creatorUser.displayName || creatorUser.username;
            }
            if (!effectiveApm && creatorUser.assistant_project_manager) {
                effectiveApm = creatorUser.assistant_project_manager;
                const apmUser = await User.findById(effectiveApm);
                if (apmUser) effectiveApmName = apmUser.displayName || apmUser.username;
            }
        }

        // Auto-resolve APM / TL from team under PM if not already selected
        if (effectivePm && !effectiveApm && !effectiveTl) {
            const pmTeams = await Team.find({ project_manager: effectivePm }).populate('assistant_project_manager').populate('lead');
            if (pmTeams.length > 0) {
                let foundApms = [];
                let foundTls = [];
                pmTeams.forEach(t => {
                    if (t.assistant_project_manager) {
                        foundApms.push(t.assistant_project_manager);
                    }
                    if (Array.isArray(t.lead)) {
                        foundTls.push(...t.lead);
                    }
                });
                if (foundApms.length === 1) {
                    const apm = foundApms[0];
                    effectiveApm = apm._id || apm;
                    effectiveApmName = apm.displayName || apm.username || '';
                    if (!effectiveTeamId && pmTeams[0]) {
                        effectiveTeamId = pmTeams[0]._id;
                        effectiveTeamName = pmTeams[0].name;
                    }
                } else if (foundApms.length === 0 && foundTls.length === 1) {
                    const tl = foundTls[0];
                    effectiveTl = tl._id || tl;
                    effectiveTlName = tl.displayName || tl.username || '';
                    if (!effectiveTeamId && pmTeams[0]) {
                        effectiveTeamId = pmTeams[0]._id;
                        effectiveTeamName = pmTeams[0].name;
                    }
                }
            }
        }

        // Auto-resolve team if not specified
        if (!effectiveTeamId) {
            const userTeam = await Team.findOne({ $or: [{ assistant_project_manager: creatorId }, { lead: creatorId }, { members: creatorId }] });
            if (userTeam) {
                effectiveTeamId = userTeam._id;
                effectiveTeamName = userTeam.name;
            }
        }
    }

    const assignments = [
        {
            userId: req.principal.id,
            username: req.principal.username,
            permission: 'admin',
            assignedAt: effectiveCreationDate ? new Date(effectiveCreationDate) : new Date(),
        }
    ];

    // If PM is specified and different from creator, also ensure PM is in assignments
    if (effectivePm && String(effectivePm) !== String(creatorId)) {
        const pmDoc = await User.findById(effectivePm);
        if (pmDoc) {
            assignments.push({
                userId: pmDoc._id,
                username: pmDoc.username,
                permission: 'admin',
                assignedAt: effectiveCreationDate ? new Date(effectiveCreationDate) : new Date(),
            });
        }
    }

    const projectPayload = {
        name,
        clientName: clientName || '',
        clientId: clientId || null,
        contactPerson: effectiveContactPerson,
        clientContactPersons: Array.isArray(clientContactPersons) ? clientContactPersons : (effectiveContactPerson ? [effectiveContactPerson] : []),
        caldimProjectManager: effectivePm,
        caldimProjectManagerName: effectivePmName,
        caldimAssistantProjectManager: effectiveApm,
        caldimAssistantProjectManagerName: effectiveApmName,
        caldimTeamLead: effectiveTl,
        caldimTeamLeadName: effectiveTlName,
        teamId: effectiveTeamId,
        teamName: effectiveTeamName,
        description: description || '',
        status: status === 'active' ? 'in_progress' : (status || 'in_progress'),
        location: location || '',
        approximateDrawingsCount: Number(approximateDrawingsCount) || 0,
        trackingMode: trackingMode || 'sow',
        sequences: finalSequences,
        scopeOfWork: processedScopeOfWork,
        connectionDesignVendor: connectionDesignVendor || '',
        connectionDesignContact: connectionDesignContact || '',
        connectionDesignEmail: connectionDesignEmail || '',
        year: projectYear,
        startingTransmittalNumber: startNum,
        transmittalCount: initialTransmittalCount,
        createdByAdminId: adminId,
        createdByUserId: creatorId,
        createdByUsername: req.principal.username || '',
        creationDate: effectiveCreationDate,
        projectStartDate: projectStartDate || null,
        financialYear: financialYear || '',
        projectCode: projectCode || '',
        division: division || '',
        projectManager: effectivePmName,
        assignments: assignments,
        drawingCount: 0,
    };
    if (creationDate) {
        projectPayload.createdAt = new Date(creationDate);
    }

    const project = await Project.create(projectPayload);

    const Notification = require('../models/Notification');
    try {
        await Notification.create({
            user: req.principal.id,
            title: 'New Project Assigned',
            body: `Project "${project.name}" has been assigned to you.`,
            type: 'assignment'
        });
    } catch (err) {
        console.error('Failed to create assignment notification:', err);
    }

    const projectWithStats = await attachProjectStats(project);
    res.status(201).json({ project: projectWithStats });
}

/**
 * GET /api/admin/projects/:projectId
 * req.scopedProject is pre-loaded by scopeProjectToAdmin.
 */
async function getProject(req, res) {
    if (req.scopedProject && req.scopedProject.isExternal) {
        const p = req.scopedProject;
        const drawingCount = p.approximateDrawingsCount || 0;
        const approvalCount = Math.round(((p.approvalPercentage || 0) * drawingCount) / 100);
        const fabricationCount = Math.round(((p.fabricationPercentage || 0) * drawingCount) / 100);
        const creator = p.projectManager || p.pm || p.pmName || p.createdBy || p.createdByName || '';
        const projectWithStats = {
            ...p,
            _id: p.id,
            createdByUsername: creator,
            createdBy: creator,
            drawingCount,
            approvalCount,
            fabricationCount,
            openRfiCount: 0,
            closedRfiCount: 0,
            sequences: [],
            assignments: []
        };
        return res.json({ project: projectWithStats });
    }
    const projectWithStats = await attachProjectStats(req.scopedProject);
    res.json({ project: projectWithStats });
}

/**
 * PATCH /api/admin/projects/:projectId
 * Updates mutable fields. Cannot change createdByAdminId.
 */
async function updateProject(req, res) {
    const project = req.scopedProject;
    const { 
        name, clientName, clientId, contactPerson, clientContactPersons,
        caldimProjectManager, caldimProjectManagerName, caldimAssistantProjectManager, caldimAssistantProjectManagerName,
        caldimTeamLead, caldimTeamLeadName, teamId, teamName,
        description, status, approximateDrawingsCount, location, sequences, scopeOfWork, 
        connectionDesignVendor, connectionDesignContact, connectionDesignEmail, creationDate, 
        projectStartDate, financialYear, projectCode, division, projectManager 
    } = req.body;

    if (name !== undefined) project.name = name;
    if (clientName !== undefined) project.clientName = clientName;
    if (clientId !== undefined) project.clientId = clientId;
    if (contactPerson !== undefined) project.contactPerson = contactPerson;
    if (clientContactPersons !== undefined && Array.isArray(clientContactPersons)) {
        project.clientContactPersons = clientContactPersons;
        if (!project.contactPerson && clientContactPersons.length > 0) {
            project.contactPerson = clientContactPersons[0];
        }
    }
    if (caldimProjectManager !== undefined) project.caldimProjectManager = caldimProjectManager || null;
    if (caldimProjectManagerName !== undefined) {
        project.caldimProjectManagerName = caldimProjectManagerName || '';
        if (caldimProjectManagerName && !projectManager) {
            project.projectManager = caldimProjectManagerName;
        }
    }
    if (caldimAssistantProjectManager !== undefined) project.caldimAssistantProjectManager = caldimAssistantProjectManager || null;
    if (caldimAssistantProjectManagerName !== undefined) project.caldimAssistantProjectManagerName = caldimAssistantProjectManagerName || '';
    if (caldimTeamLead !== undefined) project.caldimTeamLead = caldimTeamLead || null;
    if (caldimTeamLeadName !== undefined) project.caldimTeamLeadName = caldimTeamLeadName || '';
    if (teamId !== undefined) project.teamId = teamId || null;
    if (teamName !== undefined) project.teamName = teamName || '';
    if (description !== undefined) project.description = description;
    if (location !== undefined) project.location = location;
    if (approximateDrawingsCount !== undefined) project.approximateDrawingsCount = Number(approximateDrawingsCount) || 0;
    if (projectStartDate !== undefined) project.projectStartDate = projectStartDate;
    if (financialYear !== undefined) project.financialYear = financialYear;
    if (projectCode !== undefined) project.projectCode = projectCode;
    if (division !== undefined) project.division = division;
    if (projectManager !== undefined) project.projectManager = projectManager;
    if (creationDate !== undefined) {
        project.creationDate = creationDate || null;
        if (creationDate) {
            project.createdAt = new Date(creationDate);
        }
    }
    const today = new Date();
    if (sequences !== undefined && Array.isArray(sequences)) {
        project.sequences = sequences.map((s, idx) => ({
            name: (s.name || '').trim() || `Seq ${idx + 1}`,
            status: s.status === 'Completed' ? 'Completed' : 'Not Completed',
            deadline: s.deadline || null,
            approvalDate: s.approvalDate ? new Date(s.approvalDate) : today,
            fabricationDate: s.fabricationDate ? new Date(s.fabricationDate) : null
        }));
    }
    if (scopeOfWork !== undefined && Array.isArray(scopeOfWork)) {
        project.scopeOfWork = scopeOfWork.map((s, idx) => ({
            name: (s.name || '').trim() || `SOW ${String(idx + 1).padStart(2, '0')}`,
            percentage: Number(s.percentage) || 0,
            approval: Number(s.approval) || 0,
            fabrication: Number(s.fabrication) || 0,
            status: s.status || 'Yet to Start',
            approvalDate: s.approvalDate ? new Date(s.approvalDate) : (s.approvalDate === null ? null : today),
            fabricationDate: s.fabricationDate ? new Date(s.fabricationDate) : null,
            deadline: s.deadline ? new Date(s.deadline) : null,
            sequences: Array.isArray(s.sequences) ? s.sequences.map((seq, seqIdx) => ({
                name: (seq.name || '').trim() || `SEQ ${String(seqIdx + 1).padStart(2, '0')}`,
                status: seq.status === 'Completed' ? 'Completed' : 'Not Completed',
                deadline: seq.deadline || null,
                approvalDate: seq.approvalDate ? new Date(seq.approvalDate) : today,
                fabricationDate: seq.fabricationDate ? new Date(seq.fabricationDate) : null
            })) : []
        }));
    }
    if (req.body.additionalScopeOfWork !== undefined && Array.isArray(req.body.additionalScopeOfWork)) {
        project.additionalScopeOfWork = req.body.additionalScopeOfWork.map((s, idx) => ({
            name: (s.name || '').trim() || `Additional SOW ${String(idx + 1).padStart(2, '0')}`,
            percentage: Number(s.percentage) || 0,
            approval: Number(s.approval) || 0,
            fabrication: Number(s.fabrication) || 0,
            status: s.status || 'Yet to Start',
            approvalDate: s.approvalDate ? new Date(s.approvalDate) : (s.approvalDate === null ? null : today),
            fabricationDate: s.fabricationDate ? new Date(s.fabricationDate) : null,
            deadline: s.deadline ? new Date(s.deadline) : null,
            sequences: Array.isArray(s.sequences) ? s.sequences.map((seq, seqIdx) => ({
                name: (seq.name || '').trim() || `SEQ ${String(seqIdx + 1).padStart(2, '0')}`,
                status: seq.status === 'Completed' ? 'Completed' : 'Not Completed',
                deadline: seq.deadline || null,
                approvalDate: seq.approvalDate ? new Date(seq.approvalDate) : today,
                fabricationDate: seq.fabricationDate ? new Date(seq.fabricationDate) : null
            })) : []
        }));
    }
    if (connectionDesignVendor !== undefined) project.connectionDesignVendor = connectionDesignVendor;
    if (connectionDesignContact !== undefined) project.connectionDesignContact = connectionDesignContact;
    if (connectionDesignEmail !== undefined) project.connectionDesignEmail = connectionDesignEmail;
    if (req.body.trackingMode !== undefined) project.trackingMode = req.body.trackingMode;
    if (req.body.year !== undefined) project.year = Number(req.body.year);
    if (status !== undefined) {
        const normalizedStatus = status === 'active' ? 'in_progress' : status;
        if (!['active', 'in_progress', 'on_hold', 'completed', 'archived'].includes(normalizedStatus)) {
            return res.status(400).json({ error: 'Invalid status value.' });
        }
        project.status = normalizedStatus;
    }

    await project.save();
    const projectWithStats = await attachProjectStats(project);
    res.json({ project: projectWithStats });
}

/**
 * DELETE /api/admin/projects/:projectId
 * Deletes project and all its drawings/extractions.
 * Also removes the project folder from the remote storage server.
 */
async function deleteProject(req, res) {
    const project = req.scopedProject;
    const projectName = project.name.replace(/[^a-zA-Z0-9 _-]/g, '_');
    const projectId = project._id;

    // 1. Delete all project folders from remote storage server and local storage drive
    if (storageGateway.isEnabled()) {
        const foldersToDelete = new Set([
            `Projects/${projectName}`,
            `Projects/${project.name}`,
            `Projects/${project.name.replace(/ /g, '_')}`,
            `Projects/${project.name.replace(/_/g, ' ')}`
        ]);
        const DeletedStoragePath = require('../models/DeletedStoragePath');
        for (const folder of foldersToDelete) {
            try {
                await storageGateway.deleteFile(folder);
                console.log(`[DeleteProject] Storage folder "${folder}" deleted from server.`);
            } catch (err) {
                if (!err.message.includes('not found') && !err.message.includes('404')) {
                    console.warn(`[DeleteProject] Warning deleting "${folder}":`, err.message);
                }
            }
            try {
                await DeletedStoragePath.updateOne(
                    { path: folder },
                    { $set: { path: folder, deletedAt: new Date(), deletedBy: req.principal?.username || 'admin' } },
                    { upsert: true }
                );
            } catch (_) {}
        }
    }

    // 2. Clean up local temp files and local Excel workbooks
    const extractions = await DrawingExtraction.find({ projectId }).lean();
    for (const doc of extractions) {
        if (doc.fileUrl && fs.existsSync(doc.fileUrl)) {
            try { fs.unlinkSync(doc.fileUrl); } catch (_) { }
        }
    }

    // Clean up generated project Excel sheets from uploads/excel/
    try {
        const excelDir = path.join(__dirname, '../../uploads/excel');
        if (fs.existsSync(excelDir)) {
            const files = fs.readdirSync(excelDir);
            for (const f of files) {
                if (f.startsWith(String(projectId))) {
                    try { fs.unlinkSync(path.join(excelDir, f)); } catch (_) {}
                }
            }
        }
    } catch (_) {}

    // Clean up temp files from uploads/temp/
    try {
        const tempDir = path.join(__dirname, '../../uploads/temp');
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            for (const f of files) {
                if (f.includes(String(projectId))) {
                    try { fs.unlinkSync(path.join(tempDir, f)); } catch (_) {}
                }
            }
        }
    } catch (_) {}

    // 3. Delete all GridFS files in Atlas to completely free up database quota
    try {
        const { getBucket } = require('../utils/gridfs');
        const bucket = getBucket();
        if (bucket) {
            const [extDocs, rfiDocs, cdrfiDocs] = await Promise.all([
                DrawingExtraction.find({ projectId }).select('fileId fileUrl').lean(),
                RfiExtraction.find({ projectId }).select('attachments.fileId attachments.fileUrl').lean(),
                CdrfiExtraction.find({ projectId }).select('attachments.fileId attachments.fileUrl').lean()
            ]);

            const fileIdsToDelete = new Set();
            for (const d of extDocs) {
                if (d.fileId && mongoose.Types.ObjectId.isValid(d.fileId)) fileIdsToDelete.add(String(d.fileId));
                if (d.fileUrl && mongoose.Types.ObjectId.isValid(d.fileUrl)) fileIdsToDelete.add(String(d.fileUrl));
            }
            for (const d of rfiDocs) {
                (d.attachments || []).forEach(a => {
                    if (a.fileId && mongoose.Types.ObjectId.isValid(a.fileId)) fileIdsToDelete.add(String(a.fileId));
                });
            }
            for (const d of cdrfiDocs) {
                (d.attachments || []).forEach(a => {
                    if (a.fileId && mongoose.Types.ObjectId.isValid(a.fileId)) fileIdsToDelete.add(String(a.fileId));
                });
            }

            for (const fid of fileIdsToDelete) {
                try {
                    await bucket.delete(new mongoose.Types.ObjectId(fid));
                } catch (_) {}
            }
            if (fileIdsToDelete.size > 0) {
                console.log(`[DeleteProject] Cleaned up ${fileIdsToDelete.size} GridFS file(s) for project "${project.name}".`);
            }
        }
    } catch (gfsErr) {
        console.warn('[DeleteProject] Error cleaning up GridFS files:', gfsErr.message);
    }

    // 4. Delete all associated DB records across all models (by projectId AND by name/path to guarantee 100% removal)
    const nameRegex = new RegExp(`^${project.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const pathRegex = new RegExp(`^Projects/${project.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`, 'i');
    const altPathRegex = new RegExp(`^Projects/${project.name.replace(/ /g, '_').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`, 'i');

    const Transmittal = require('../models/Transmittal');
    const DrawingLog = require('../models/DrawingLog');
    const WeeklyProgress = require('../models/WeeklyProgress');
    const Notification = require('../models/Notification');

    await Promise.all([
        Drawing.deleteMany({ $or: [{ projectId }, { projectName: nameRegex }] }),
        DrawingExtraction.deleteMany({ $or: [{ projectId }, { storageGatewayPath: pathRegex }, { storageGatewayPath: altPathRegex }] }),
        RfiExtraction.deleteMany({ $or: [{ projectId }, { storageGatewayPath: pathRegex }, { storageGatewayPath: altPathRegex }] }),
        CdrfiExtraction.deleteMany({ $or: [{ projectId }, { storageGatewayPath: pathRegex }, { storageGatewayPath: altPathRegex }] }),
        ChangeOrder.deleteMany({ $or: [{ projectId }, { projectName: nameRegex }] }),
        Transmittal.deleteMany({ $or: [{ projectId }, { projectName: nameRegex }] }),
        DrawingLog.deleteMany({ $or: [{ projectId }, { projectName: nameRegex }] }),
        WeeklyProgress.deleteMany({ $or: [{ projectId }, { projectName: nameRegex }] }),
        Notification.deleteMany({
            $or: [
                { projectId },
                { title: nameRegex },
                { body: nameRegex }
            ]
        })
    ]);

    // 4. Send email alert to that particular team (PM, APM, Team Lead)
    try {
        const User = require('../models/User');
        const { sendFolderDeletionAlert } = require('../services/emailService');
        let userDoc = null;
        if (req.principal?.id && req.principal.id !== 'viewer') {
            userDoc = await User.findById(req.principal.id).select('displayName email role username').lean();
        }
        const deletedBy = {
            username: req.principal?.username || 'Unknown',
            displayName: userDoc?.displayName || req.principal?.username || 'User',
            email: req.principal?.email || userDoc?.email || '',
            role: req.principal?.role || 'user'
        };

        sendFolderDeletionAlert({
            project,
            deletedItemPath: `Project "${project.name}" (entire project and all associated files)`,
            deletedBy,
            isProjectDeletion: true
        }).catch(mailErr => {
            console.error('[DeleteProject] Email notification error:', mailErr.message);
        });
    } catch (emailErr) {
        console.error('[DeleteProject] Error preparing email alert:', emailErr.message);
    }

    // 5. Delete project itself
    await project.deleteOne();

    res.json({ message: `Project "${project.name}" and all related data deleted from database and storage server.` });
}

/**
 * POST /api/admin/projects/:projectId/assignments
 * Assigns a user to a project.
 *
 * SECURITY: validateCrossAdminAssignment middleware runs first,
 * ensuring req.assignmentUser.adminId === req.principal.adminId.
 *
 * Body: { userId, permission }
 */
async function assignUser(req, res) {
    const project = req.scopedProject;
    const user = req.assignmentUser;   // pre-validated by middleware
    const permission = req.body.permission || 'viewer';

    if (!['viewer', 'editor', 'admin'].includes(permission)) {
        return res.status(400).json({ error: 'permission must be viewer, editor, or admin.' });
    }

    // Check if user is already assigned → update permission instead
    const existingIdx = project.assignments.findIndex(
        (a) => a.userId.toString() === user._id.toString()
    );

    if (existingIdx >= 0) {
        project.assignments[existingIdx].permission = permission;
    } else {
        project.assignments.push({
            userId: user._id,
            username: user.username,
            permission,
            assignedAt: new Date(),
        });
    }

    await project.save({ validateModifiedOnly: true });

    // Create Notification
    try {
        const Notification = require('../models/Notification');
        await Notification.create({
            user: user._id,
            title: 'New Project Assigned',
            body: `Project "${project.name}" has been assigned to you.`,
            type: 'assignment'
        });
    } catch (err) {
        console.error('Failed to create assignment notification:', err);
    }

    res.json({ project });
}

/**
 * DELETE /api/admin/projects/:projectId/assignments/:userId
 * Removes a user's assignment from a project.
 * Also validates the userId belongs to this admin.
 */
async function removeAssignment(req, res) {
    const project = req.scopedProject;
    const { userId } = req.params;
    const adminId = req.principal.adminId;

    // Safety check: confirm the userId belongs to this admin (Removing global filter here because admin can manage any user)
    const User = require('../models/User');
    const user = await User.findOne({ _id: userId });
    if (!user) {
        return res.status(403).json({
            error: 'Cannot remove assignment: user not in your admin scope.',
        });
    }

    const before = project.assignments.length;
    project.assignments = project.assignments.filter(
        (a) => a.userId.toString() !== userId
    );

    if (project.assignments.length === before) {
        return res.status(404).json({ error: 'Assignment not found.' });
    }

    await project.save({ validateModifiedOnly: true });
    res.json({ message: 'Assignment removed.', project });
}

/**
 * GET /api/admin/projects/status/excel
 * Downloads an Excel report with the status of all projects owned by this admin.
 * Columns: Project Name, Client Name, Total Drawings, Fabrication Count, Approval Count,
 *           Hold Count, Pending Count, Failed Count, Overall Status, Last Updated
 */
async function downloadAllProjectsStatusExcel(req, res) {
    const accessFilter = await buildProjectQueryForUser(req.principal);
    const filter = { ...accessFilter };

    const projectsData = await getProjectStatusReportData(filter);
    if (!projectsData || projectsData.length === 0) {
        return res.status(404).json({ error: 'No projects found.' });
    }

    const { buffer, filename } = await generateProjectStatusExcel(projectsData);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
}

/**
 * POST /api/admin/projects/:projectId/cor
 * Upload COR Excel file and parse into ChangeOrder model.
 */
async function uploadCOR(req, res) {
    const project = req.scopedProject;
    const adminId = req.principal.adminId;

    if (!req.file) {
        return res.status(400).json({ error: 'No Excel file uploaded.' });
    }

    try {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(req.file.path);

        const worksheet = workbook.getWorksheet(1); // Read first sheet
        if (!worksheet) {
            return res.status(400).json({ error: 'No worksheet found in Excel.' });
        }

        /**
         * EXPECTED COLUMNS in Excel:
         * A: CO Number
         * B: Description
         * C: Status (PENDING, APPROVED, WORK_COMPLETED, CANCELLED)
         * D: Amount
         * E: Date
         */
        let count = 0;
        const rows = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // skip header

            const coNumber = row.getCell(1).text?.trim();
            const description = row.getCell(2).text?.trim();
            let statusRaw = row.getCell(3).text?.trim()?.toUpperCase();
            const amount = parseFloat(row.getCell(4).value) || 0;
            const dateVal = row.getCell(5).value;

            // Map some common variations to internal enum
            if (statusRaw === 'COMPLETED') statusRaw = 'WORK_COMPLETED';
            if (statusRaw === 'VOID' || statusRaw === 'VOIDED' || statusRaw === 'DECLINED' || statusRaw === 'REJECTED' || statusRaw === 'CANCELLED' || statusRaw?.includes('VOID') || statusRaw?.includes('CANCEL')) {
                statusRaw = 'CANCELLED';
            }
            const VALID = ['PENDING', 'APPROVED', 'WORK_COMPLETED', 'CANCELLED'];
            const status = VALID.includes(statusRaw) ? statusRaw : 'PENDING';

            if (coNumber) {
                rows.push({
                    projectId: project._id,
                    createdByAdminId: adminId,
                    coNumber,
                    description: description || '',
                    status,
                    amount,
                    date: dateVal instanceof Date ? dateVal : new Date(),
                });
            }
        });

        if (rows.length === 0) {
            return res.status(400).json({ error: 'No valid rows found in Excel.' });
        }

        // Upsert all rows
        for (const r of rows) {
            await ChangeOrder.findOneAndUpdate(
                { projectId: r.projectId, coNumber: r.coNumber },
                r,
                { upsert: true, new: true }
            );
            count++;
        }

        // cleanup file
        const fs = require('fs');
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        res.json({ message: `Success: ${count} change orders processed.` });
    } catch (error) {
        console.error('[uploadCOR] Error:', error);
        res.status(500).json({ error: 'Failed to process COR Excel.' });
    }
}

/**
 * POST /api/admin/projects/:projectId/reserve-transmittal
 */
async function reserveTransmittalNumber(req, res) {
    const project = req.scopedProject;
    const updated = await Project.findByIdAndUpdate(
        project._id,
        { $inc: { transmittalCount: 1 } },
        { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: 'Project not found.' });
    res.json({ transmittalNumber: updated.transmittalCount });
}

/**
 * GET /api/admin/projects/external
 * Retrieves projects and metadata from external App A.
 * Modified to return empty as external projects are now merged with local projects.
 */
async function listExternalProjects(req, res) {
    try {
        const result = await getExternalProjects();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve external projects', details: err.message });
    }
}

/**
 * POST /api/admin/projects/:projectId/upload-folder
 *
 * Accepts: multipart/form-data with:
 *   - files[]         — the files with webkitRelativePath preserved as relative path in the folder
 *   - paths[]         — matching array of relative paths (same index as files)
 *   - sequences[]     — (optional) sequence tags
 *   - transmittalNumber — (optional) a pre-reserved transmittal number
 *
 * Behaviour:
 *   1. Uploads ALL files to storage gateway preserving directory structure:
 *      Projects/<projectName>/<topFolder>/<relativePath>
 *   2. Detects drawing PDFs inside the "Drawings/Detail sheets" and "Drawings/E-Sheets" folders
 *      (case-insensitive, backslash or forward-slash separator)
 *   3. Saves a temp local copy of each drawing PDF for the AI service to read
 *   4. Creates DrawingExtraction records and fires the extraction pipeline
 */
async function uploadFolder(req, res) {
    const project = req.scopedProject;
    const adminId = req.principal.adminId;
    const uploadedBy = req.principal.username;
    const projectId = project._id.toString();

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded.' });
    }

    const pathArray = Array.isArray(req.body.paths) ? req.body.paths : (req.body.paths ? [req.body.paths] : []);
    const targetTransmittalNumber = req.body.transmittalNumber ? parseInt(req.body.transmittalNumber, 10) : null;
    const uploadPurpose = req.body.uploadPurpose === 'Approval' ? 'Approval' : 'Fabrication';
    let sequences = [];
    if (req.body.sequences) {
        sequences = Array.isArray(req.body.sequences) ? req.body.sequences : [req.body.sequences];
    }

    const projectName = project.name.replace(/[^a-zA-Z0-9 _-]/g, '_');

    // Patterns that indicate a drawing PDF worth extracting
    // Made more permissive to support simple "Drawings" folders, "Erection Drawings", etc.
    const DRAWING_FOLDER_PATTERN = /[\\/](detail|d|e|erection|gather|g|shop|connection|fabrication|part|structural)?[\s_-]*(sheets?|drawings?|plans?)[\s\\/]/i;
    const BINDER_PATTERN = /binder/i;
    const GATHER_SHEET_PATTERN = /gather[\s_-]*sheets?/i;

    // ── Step 1: Upload all files to storage gateway ───────
    const uploadResults = [];
    const drawingFiles = []; // subset that are drawing PDFs

    for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const relativePath = pathArray[i] || file.originalname;

        // Get the optional base target path (from Storage UI), otherwise default to root project folder
        let baseTarget = req.body.targetPath || `Projects/${projectName}`;

        // Sanitize baseTarget if it points to Logs for non-log files
        const isLogFile = (fn) => fn && /transmittal|drawing_log|drawing log|master_log|master log/i.test(fn);
        if (/\/Logs($|\/)/i.test(baseTarget) || /^Logs($|\/)/i.test(baseTarget)) {
            if (!isLogFile(file.originalname)) {
                baseTarget = baseTarget.replace(/\/Logs($|\/)/gi, '/').replace(/^Logs($|\/)/gi, '').replace(/\/+/g, '/').replace(/\/$/, '');
            }
        }

        // Determine storage path, preserving the relative upload structure
        const targetDir = `${baseTarget}/${path.dirname(relativePath).replace(/\\/g, '/')}`;
        const cleanTargetDir = targetDir.replace(/\/+/g, '/').replace(/\/$/, '').replace(/\/\.$/, '');

        let storageGatewayPath = null;
        let uploadedToGateway = false;

        if (storageGateway.isEnabled()) {
            let lastError = null;
            const maxRetries = 1; // Changed to 1: Do not retry if the Storage Agent is offline. Fail fast to GridFS.
            const baseDelay = 1000; // 1 second base delay

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const fileBuffer = fs.readFileSync(file.path);
                    await storageGateway.uploadFile(cleanTargetDir, file.originalname, fileBuffer);
                    storageGatewayPath = `${cleanTargetDir}/${file.originalname}`;
                    console.log(`[FolderUpload] Stored: ${storageGatewayPath} (Attempt ${attempt})`);
                    uploadedToGateway = true;
                    break;
                } catch (err) {
                    lastError = err;
                    const isRateLimit = err.message.includes('Too many requests') || err.message.includes('429');
                    const waitTime = isRateLimit ? baseDelay * attempt * 2 : baseDelay * attempt;

                    console.warn(`[FolderUpload] Attempt ${attempt} failed for ${file.originalname}. Error: ${err.message}. Retrying in ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }

            if (!uploadedToGateway) {
                console.error(`[FolderUpload] CRITICAL: Failed to store ${relativePath} to Storage Gateway after ${maxRetries} attempts. Error:`, lastError?.message);
                console.error(`[FolderUpload] Target Path was: ${cleanTargetDir}`);
                uploadResults.push({ name: file.originalname, path: relativePath, status: 'failed_gateway', error: lastError?.message || 'Gateway Upload failed' });
                console.warn(`[FolderUpload] Continuing without Storage Gateway sync for ${file.originalname}. Falling back to GridFS/Local.`);
            }
        }

        // 3. Fallback to GridFS if Storage Gateway is not enabled or if it failed
        if (!uploadedToGateway) {
            try {
                const gridfs = require('../utils/gridfs');
                const bucket = gridfs.getBucket();
                if (bucket) {
                    const uploadStream = bucket.openUploadStream(file.originalname, {
                        contentType: file.mimetype,
                        metadata: { originalName: file.originalname, path: cleanTargetDir }
                    });
                    fs.createReadStream(file.path).pipe(uploadStream);
                    await new Promise((resolve, reject) => {
                        uploadStream.on('finish', resolve);
                        uploadStream.on('error', reject);
                    });
                    console.log(`[FolderUpload] Uploaded to GridFS as fallback: ${file.originalname}`);
                }
            } catch (err) {
                console.error('[FolderUpload] Failed to upload to GridFS:', err.message);
            }
        }

        uploadResults.push({ name: file.originalname, path: relativePath, status: 'stored' });

        // ── Step 2: Check if this file is a drawing PDF ───
        const originalName = file.originalname.trim();
        const isPdf = file.mimetype === 'application/pdf' || originalName.toLowerCase().endsWith('.pdf');

        // For flat files, relativePath might just be the filename. We want to test the full intended target path.
        const fullVirtualPath = `${cleanTargetDir}/${originalName}`.replace(/\/+/g, '/');

        // STRICT CHECK: ONLY files located inside Detail Sheets or Erection Sheets folders may be extracted
        function getDrawingSheetCategory(testPath) {
            if (!testPath) return null;
            const normalized = testPath.replace(/\\/g, '/');
            const parts = normalized.split('/');
            const dirParts = parts.slice(0, parts.length - 1);
            for (const p of dirParts) {
                const trimmed = p.trim();
                // Exclude binders or gather sheets completely
                if (/binder/i.test(trimmed) || /gather[\s_-]*sheets?/i.test(trimmed)) {
                    return null;
                }
                // Detail Sheets
                if (/^(d[\s\-_]*sheets?|detail[\s\-_]*sheets?|detail[\s\-_]*drawings?)$/i.test(trimmed)) {
                    return 'DETAIL SHEET';
                }
                // Erection Sheets
                if (/^(e[\s\-_]*sheets?|erection[\s\-_]*sheets?|erection[\s\-_]*drawings?|erection[\s\-_]*plans?)$/i.test(trimmed)) {
                    return 'ERECTION SHEET';
                }
            }
            return null;
        }

        const detectedSheetCategory = getDrawingSheetCategory(fullVirtualPath) || getDrawingSheetCategory(relativePath);

        if (isPdf && detectedSheetCategory) {
            drawingFiles.push({
                file,
                relativePath,
                folderName: detectedSheetCategory,
                storageGatewayPath,
            });
        } else {
            // Not a drawing PDF in Detail Sheets or Erection Sheets folder, skip extraction and clean up disk copy
            try { fs.unlinkSync(file.path); } catch (_) { }
        }
    }

    // ── Step 3: Create extraction docs using the existing local disk paths ──
    const extractionDocs = [];

    for (const { file, relativePath, folderName, storageGatewayPath } of drawingFiles) {
        extractionDocs.push({
            projectId,
            createdByAdminId: adminId,
            originalFileName: file.originalname,
            fileUrl: file.path, // Use the disk file path directly
            storageGatewayPath: storageGatewayPath || relativePath || '',
            folderName,
            fileSize: file.size,
            uploadedBy,
            targetTransmittalNumber,
            uploadPurpose,
            sequences,
            status: 'queued',
        });
    }

    let savedDocs = [];
    if (extractionDocs.length > 0) {
        // Removed pre-cleanup (deleteMany) so that extractionService.js can properly
        // detect duplicates by comparing against existing completed extractions.

        savedDocs = await DrawingExtraction.insertMany(extractionDocs);

        // Fire extraction pipeline for each drawing
        for (const doc of savedDocs) {
            runExtractionPipeline(
                doc._id.toString(),
                doc.fileUrl,
                projectId,
                targetTransmittalNumber
            ).catch(err => console.error(`[FolderUpload] Pipeline error for ${doc.originalFileName}:`, err.message));
        }
    }

    const storedCount = uploadResults.filter(r => r.status === 'stored').length;
    const failedCount = uploadResults.filter(r => r.status === 'failed').length;

    res.status(202).json({
        message: `${storedCount} file(s) stored on server. ${savedDocs.length} drawing(s) queued for extraction.${failedCount > 0 ? ` (${failedCount} files failed to store)` : ''}`,
        storedCount,
        drawingsQueued: savedDocs.length,
        extractionIds: savedDocs.map(d => d._id),
        transmittalNumber: targetTransmittalNumber,
        failedCount,
        results: uploadResults,
        drawings: savedDocs.map(d => ({ name: d.originalFileName, folder: d.folderName, id: d._id.toString() })),
    });
}

/**
 * POST /api/admin/projects/:projectId/allocations
 * Allocates users (team members and team leads) to this project with their access level.
 * Body: {
 *   allocations: [ { userId: string, permission: 'viewer' | 'editor' } ]
 * }
 */
async function allocateUsers(req, res) {
    const project = req.scopedProject;
    const adminId = req.principal.adminId;
    const { allocations } = req.body;

    if (!Array.isArray(allocations)) {
        return res.status(400).json({ error: 'allocations must be an array.' });
    }

    const User = require('../models/User');
    const Notification = require('../models/Notification');

    // Keep admin / creator assignments intact
    const existingAdminAssignments = (project.assignments || []).filter(
        a => a.permission === 'admin' || a.userId.toString() === req.principal.id.toString()
    );

    const updatedAssignments = [...existingAdminAssignments];
    const newNotifications = [];

    for (const alloc of allocations) {
        if (!alloc.userId) continue;
        const permission = ['viewer', 'editor', 'admin'].includes(alloc.permission) ? alloc.permission : 'viewer';

        // If user already in updatedAssignments as admin, leave as admin unless updating permission
        const existingIdx = updatedAssignments.findIndex(a => a.userId.toString() === alloc.userId.toString());
        if (existingIdx >= 0) {
            if (updatedAssignments[existingIdx].permission !== 'admin') {
                updatedAssignments[existingIdx].permission = permission;
            }
            continue;
        }

        const user = await User.findOne({ _id: alloc.userId, adminId });
        if (!user) continue;

        const wasPreviouslyAssigned = (project.assignments || []).some(
            a => a.userId.toString() === alloc.userId.toString()
        );

        updatedAssignments.push({
            userId: user._id,
            username: user.username,
            permission,
            assignedAt: new Date()
        });

        if (!wasPreviouslyAssigned) {
            newNotifications.push({
                user: user._id,
                title: 'New Project Assigned',
                body: `You have been allocated to project "${project.name}" with ${permission === 'editor' ? 'Edit' : 'View'} access.`,
                type: 'assignment'
            });
        }
    }

    project.assignments = updatedAssignments;
    await project.save({ validateModifiedOnly: true });

    if (newNotifications.length > 0) {
        try {
            await Notification.insertMany(newNotifications);
        } catch (e) {
            console.error('[Allocations] Notification insert error:', e.message);
        }
    }

    const projectWithStats = await attachProjectStats(project);
    res.json({
        message: 'Project allocations updated successfully.',
        project: projectWithStats
    });
}

module.exports = {
    listProjects,
    createProject,
    getProject,
    updateProject,
    deleteProject,
    assignUser,
    removeAssignment,
    allocateUsers,
    downloadAllProjectsStatusExcel,
    uploadCOR,
    reserveTransmittalNumber,
    listExternalProjects,
    uploadFolder,
};