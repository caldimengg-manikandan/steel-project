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
 * 2. Project Manager (PM):
 *    - Sees projects where they are caldimProjectManager
 *    - Sees projects created by them
 *    - Sees projects created by or assigned to any APM, Team Lead, or member in their teams
 *    - Sees projects where caldimAssistantProjectManager or caldimTeamLead reports to them
 *    - Sees projects associated with their team(s)
 * 3. Assistant Project Manager (APM):
 *    - Sees projects created by them
 *    - Sees projects where they are caldimAssistantProjectManager
 *    - Sees projects created by or assigned to any Team Lead or member in their team(s)
 *    - Sees projects for their team(s)
 * 4. Team Lead / Assistant Team Lead (TL):
 *    - Sees projects created by them
 *    - Sees projects where they are caldimTeamLead
 *    - Sees projects for their team(s)
 * 5. Team Member / User:
 *    - Sees projects assigned to them or their team
 */
async function buildProjectQueryForUser(principal) {
    if (!principal) return { _id: null };

    const role = principal.role;
    const adminId = principal.adminId;
    const userId = principal.id;
    const queryUserId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    const userNames = [principal.displayName, principal.username].filter(Boolean);

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
        // Teams where this user is PM, lead, or member
        const pmTeams = await Team.find({
            $or: [
                { project_manager: queryUserId },
                { lead: queryUserId },
                { members: queryUserId }
            ]
        });
        const pmTeamIds = pmTeams.map(t => t._id);
        const pmTeamNames = pmTeams.map(t => t.name).filter(Boolean);

        const subordinateUserIds = [queryUserId];
        pmTeams.forEach(t => {
            const isTeamPm = t.project_manager && String(t.project_manager) === String(userId);
            if (isTeamPm) {
                if (t.assistant_project_manager) {
                    const aId = t.assistant_project_manager._id || t.assistant_project_manager;
                    if (aId && !subordinateUserIds.some(id => String(id) === String(aId))) {
                        subordinateUserIds.push(aId);
                    }
                }
                if (Array.isArray(t.lead)) {
                    t.lead.forEach(l => {
                        const lId = l?._id || l;
                        if (lId && !subordinateUserIds.some(id => String(id) === String(lId))) {
                            subordinateUserIds.push(lId);
                        }
                    });
                }
                if (Array.isArray(t.members)) {
                    t.members.forEach(m => {
                        const mId = m?._id || m;
                        if (mId && !subordinateUserIds.some(id => String(id) === String(mId))) {
                            subordinateUserIds.push(mId);
                        }
                    });
                }
            }
        });

        const directSubordinates = await User.find({ project_manager: queryUserId }).select('_id');
        directSubordinates.forEach(u => {
            if (!subordinateUserIds.some(id => String(id) === String(u._id))) {
                subordinateUserIds.push(u._id);
            }
        });

        return {
            ...tenantCondition,
            $or: [
                { caldimProjectManager: queryUserId },
                ...(userNames.length > 0 ? [{ caldimProjectManagerName: { $in: userNames } }] : []),
                ...(userNames.length > 0 ? [{ projectManager: { $in: userNames } }] : []),
                { createdByUserId: { $in: subordinateUserIds } },
                ...(userNames.length > 0 ? [{ createdByUsername: { $in: userNames } }] : []),
                { 'assignments.userId': { $in: subordinateUserIds } },
                { caldimAssistantProjectManager: { $in: subordinateUserIds } },
                { caldimTeamLead: { $in: subordinateUserIds } },
                { teamId: { $in: pmTeamIds } },
                ...(pmTeamNames.length > 0 ? [{ teamName: { $in: pmTeamNames } }] : [])
            ]
        };
    }

    if (role === 'assistant_project_manager') {
        // Teams where this user is APM, lead, or member
        const apmTeams = await Team.find({
            $or: [
                { assistant_project_manager: queryUserId },
                { lead: queryUserId },
                { members: queryUserId }
            ]
        });
        const apmTeamIds = apmTeams.map(t => t._id);
        const apmTeamNames = apmTeams.map(t => t.name).filter(Boolean);

        // Subordinate users: all leads and members in teams where this user is the APM
        const subordinateUserIds = [queryUserId];
        apmTeams.forEach(t => {
            const isTeamApm = t.assistant_project_manager && String(t.assistant_project_manager) === String(userId);
            if (isTeamApm) {
                if (Array.isArray(t.lead)) {
                    t.lead.forEach(l => {
                        const lId = l?._id || l;
                        if (lId && !subordinateUserIds.some(id => String(id) === String(lId))) {
                            subordinateUserIds.push(lId);
                        }
                    });
                }
                if (Array.isArray(t.members)) {
                    t.members.forEach(m => {
                        const mId = m?._id || m;
                        if (mId && !subordinateUserIds.some(id => String(id) === String(mId))) {
                            subordinateUserIds.push(mId);
                        }
                    });
                }
            }
        });

        // Also check if any users report directly to this APM
        const directSubordinates = await User.find({ assistant_project_manager: queryUserId }).select('_id');
        directSubordinates.forEach(u => {
            if (!subordinateUserIds.some(id => String(id) === String(u._id))) {
                subordinateUserIds.push(u._id);
            }
        });

        return {
            ...tenantCondition,
            $or: [
                { caldimAssistantProjectManager: queryUserId },
                ...(userNames.length > 0 ? [{ caldimAssistantProjectManagerName: { $in: userNames } }] : []),
                { createdByUserId: { $in: subordinateUserIds } },
                ...(userNames.length > 0 ? [{ createdByUsername: { $in: userNames } }] : []),
                { 'assignments.userId': { $in: subordinateUserIds } },
                { caldimTeamLead: { $in: subordinateUserIds } },
                { teamId: { $in: apmTeamIds } },
                ...(apmTeamNames.length > 0 ? [{ teamName: { $in: apmTeamNames } }] : [])
            ]
        };
    }

    if (role === 'team_lead' || role === 'assistant_team_lead') {
        const tlTeams = await Team.find({
            $or: [
                { lead: queryUserId },
                { members: queryUserId }
            ]
        });
        const tlTeamIds = tlTeams.map(t => t._id);
        const tlTeamNames = tlTeams.map(t => t.name).filter(Boolean);

        return {
            ...tenantCondition,
            $or: [
                { caldimTeamLead: queryUserId },
                ...(userNames.length > 0 ? [{ caldimTeamLeadName: { $in: userNames } }] : []),
                { createdByUserId: queryUserId },
                ...(userNames.length > 0 ? [{ createdByUsername: { $in: userNames } }] : []),
                { 'assignments.userId': queryUserId },
                { teamId: { $in: tlTeamIds } },
                ...(tlTeamNames.length > 0 ? [{ teamName: { $in: tlTeamNames } }] : [])
            ]
        };
    }

    // Default: team_member / user / viewer
    const memberTeams = await Team.find({ members: queryUserId }).select('_id name');
    const memberTeamIds = memberTeams.map(t => t._id);
    const memberTeamNames = memberTeams.map(t => t.name).filter(Boolean);

    return {
        ...tenantCondition,
        $or: [
            { 'assignments.userId': queryUserId },
            { createdByUserId: queryUserId },
            ...(userNames.length > 0 ? [{ createdByUsername: { $in: userNames } }] : []),
            { teamId: { $in: memberTeamIds } },
            ...(memberTeamNames.length > 0 ? [{ teamName: { $in: memberTeamNames } }] : [])
        ]
    };
}

module.exports = {
    buildProjectQueryForUser
};
