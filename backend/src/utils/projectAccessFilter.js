const mongoose = require('mongoose');
const User = require('../models/User');
const Team = require('../models/Team');
const Project = require('../models/Project');

/**
 * Builds the MongoDB query filter for projects accessible to the logged-in user.
 *
 * Visibility Rules:
 * 1. Admin / Superadmin:
 *    - Full access to all projects in the tenant.
 * 2. Project Manager (A):
 *    - "their project manager should need to know all the projects"
 *    - Sees projects where A is caldimProjectManager
 *    - Sees projects created by A
 *    - Sees projects created by or assigned to any APM, Team Lead, or member reporting to A
 *    - Sees projects where caldimAssistantProjectManager or caldimTeamLead reports to A
 *    - Sees projects associated with any team under A
 *    - Sees projects assigned to A in assignments
 * 3. Assistant Project Manager (B):
 *    - Sees projects created by B (createdByUserId or assignments)
 *    - Sees projects where B is caldimAssistantProjectManager
 *    - Sees projects created by or assigned to users reporting to B
 *    - Sees projects for B's team(s)
 *    - DOES NOT see projects created by other APMs or Team Leads (e.g. C) under the same PM
 * 4. Team Lead / Assistant Team Lead (B):
 *    - Sees projects created by B (createdByUserId or assignments)
 *    - Sees projects where B is caldimTeamLead
 *    - Sees projects for B's team(s)
 *    - DOES NOT see projects created by other Team Leads or APMs under the same PM or in other teams
 * 5. Team Member / User:
 *    - Sees projects assigned to them or their team
 */
async function buildProjectQueryForUser(principal) {
    if (!principal) return { _id: null };

    const role = principal.role;
    const adminId = principal.adminId;
    const userId = principal.id;
    const queryUserId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;

    // Superadmin has global tenant access
    if (role === 'superadmin') {
        return {};
    }

    // Tenant Admin sees all projects in their admin tenant
    if (role === 'admin') {
        const query = {};
        if (adminId && adminId !== 'viewer') {
            query.createdByAdminId = mongoose.Types.ObjectId.isValid(adminId) ? new mongoose.Types.ObjectId(adminId) : adminId;
        }
        return query;
    }

    // Sample project is only visible to admin / superadmin
    const tenantCondition = {
        name: { $not: /^sample$/i },
        _id: { $ne: new mongoose.Types.ObjectId('6acdf3e30e985d1d06af4ee7') }
    };
    if (adminId && adminId !== 'viewer') {
        tenantCondition.createdByAdminId = mongoose.Types.ObjectId.isValid(adminId) ? new mongoose.Types.ObjectId(adminId) : adminId;
    }

    if (role === 'project_manager') {
        // Find all users reporting to this PM (APMs, Team Leads, Members)
        const subordinateUsers = await User.find({
            $or: [
                { project_manager: queryUserId },
                { _id: queryUserId }
            ]
        }).select('_id');
        const subordinateUserIds = subordinateUsers.map(u => u._id);

        // Find teams under this PM (directly or via leads reporting to this PM)
        const pmTeams = await Team.find({
            $or: [
                { project_manager: queryUserId },
                { lead: { $in: subordinateUserIds } },
                { members: { $in: subordinateUserIds } }
            ]
        }).select('_id');
        const pmTeamIds = pmTeams.map(t => t._id);

        return {
            ...tenantCondition,
            $or: [
                { caldimProjectManager: queryUserId },
                { createdByUserId: { $in: subordinateUserIds } },
                { 'assignments.userId': { $in: subordinateUserIds } },
                { caldimAssistantProjectManager: { $in: subordinateUserIds } },
                { caldimTeamLead: { $in: subordinateUserIds } },
                { teamId: { $in: pmTeamIds } }
            ]
        };
    }

    if (role === 'assistant_project_manager') {
        // Subordinates reporting to this APM
        const subordinateUsers = await User.find({
            $or: [
                { assistant_project_manager: queryUserId },
                { _id: queryUserId }
            ]
        }).select('_id');
        const subordinateUserIds = subordinateUsers.map(u => u._id);

        // Teams where this APM is APM, lead, or where leads report to this APM
        const apmTeams = await Team.find({
            $or: [
                { assistant_project_manager: queryUserId },
                { lead: queryUserId },
                { lead: { $in: subordinateUserIds } },
                { members: queryUserId }
            ]
        }).select('_id');
        const apmTeamIds = apmTeams.map(t => t._id);

        return {
            ...tenantCondition,
            $or: [
                { caldimAssistantProjectManager: queryUserId },
                { createdByUserId: { $in: subordinateUserIds } },
                { 'assignments.userId': queryUserId },
                { caldimTeamLead: { $in: subordinateUserIds } },
                { teamId: { $in: apmTeamIds } }
            ]
        };
    }

    if (role === 'team_lead' || role === 'assistant_team_lead') {
        // Teams where this user is lead or member
        const tlTeams = await Team.find({
            $or: [
                { lead: queryUserId },
                { members: queryUserId }
            ]
        }).select('_id');
        const tlTeamIds = tlTeams.map(t => t._id);

        return {
            ...tenantCondition,
            $or: [
                { caldimTeamLead: queryUserId },
                { createdByUserId: queryUserId },
                { 'assignments.userId': queryUserId },
                { teamId: { $in: tlTeamIds } }
            ]
        };
    }

    // Default: team_member / user / viewer
    const memberTeams = await Team.find({ members: queryUserId }).select('_id');
    const memberTeamIds = memberTeams.map(t => t._id);

    return {
        ...tenantCondition,
        $or: [
            { 'assignments.userId': queryUserId },
            { teamId: { $in: memberTeamIds } }
        ]
    };
}

/**
 * Checks if a specific project is accessible to the principal.
 */
async function canUserAccessProject(principal, projectId) {
    if (!principal || !projectId) return false;
    if (principal.role === 'superadmin' || principal.role === 'admin') return true;

    const baseFilter = await buildProjectQueryForUser(principal);
    const targetId = mongoose.Types.ObjectId.isValid(projectId) ? new mongoose.Types.ObjectId(projectId) : projectId;

    const query = {
        $and: [
            { _id: targetId },
            baseFilter
        ]
    };

    const exists = await Project.exists(query);
    return !!exists;
}

module.exports = {
    buildProjectQueryForUser,
    canUserAccessProject
};
