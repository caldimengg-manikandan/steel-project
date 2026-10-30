import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useMessage } from '../../context/MessageContext';
import { adminListProjects, adminCreateProject, adminDeleteProject, adminUpdateProject, adminListExternalProjects } from '../../services/projectApi';
import { adminListClients } from '../../services/adminClientApi';
import { adminListUsers } from '../../services/adminUserApi';
import { adminListTeams, type Team } from '../../services/adminTeamApi';
import { IconPlus, IconEdit, IconTrash, IconOpen, IconClose } from '../../components/Icons';
import { formatDate } from '../../utils/dateUtils';
import type { Project, ProjectStatus, Client, ClientContact, User } from '../../types';

const STATUS_OPTIONS: ProjectStatus[] = ['in_progress', 'on_hold', 'completed', 'archived'];
const STATUS_LABEL: Record<ProjectStatus, string> = {
    in_progress: 'In-progress', on_hold: 'On Hold', completed: 'Completed', archived: 'Archived',
};

const STATUS_CLS: Record<ProjectStatus, string> = {
    in_progress: 'badge-success', on_hold: 'badge-danger', completed: 'badge-info', archived: 'badge-warning',
};

const getBadgeClass = (text: string) => {
    const s = (text || '').toLowerCase();
    if (s.includes('hold')) return 'badge-danger';
    if (s.includes('complete')) return 'badge-info';
    if (s.includes('archiv')) return 'badge-warning';
    return 'badge-success';
};

const formatBadgeText = (text: string) => {
    if (!text) return text;
    let formatted = text.replace(/_/g, ' ');
    if (formatted.toLowerCase() === 'in progress') return 'In-progress';
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
};

const getOriginalCategory = (p: any) => {
    if (!p.rawStatus) return p.status || 'active';
    const s = p.rawStatus.toLowerCase();
    if (s.includes('hold') || s.includes('pause') || s.includes('stop')) return 'on_hold';
    if (s.includes('complete') || s.includes('finish') && !s.includes('not')) return 'completed';
    if (s.includes('archiv')) return 'archived';
    return 'in_progress';
};

interface CreateProjectForm {
    name: string;
    clientName: string;
    clientId: string;
    contactPerson: ClientContact | null;
    clientContactPersons?: ClientContact[];
    caldimProjectManager?: string;
    caldimProjectManagerName?: string;
    caldimAssistantProjectManager?: string;
    caldimAssistantProjectManagerName?: string;
    caldimTeamLead?: string;
    caldimTeamLeadName?: string;
    teamId?: string;
    teamName?: string;
    description: string;
    status: ProjectStatus;
    location: string;
    trackingMode: 'sow' | 'seq';
    scopeOfWork: Array<{ 
        name: string; 
        percentage: number; 
        approval: number; 
        fabrication: number; 
        status: string;
        approvalDate?: string;
        fabricationDate?: string | null;
        sequences: Array<{ name: string; status: string; deadline?: string; approvalDate?: string; fabricationDate?: string }>;
    }>;
    connectionDesignVendor: string;
    connectionDesignContact: string;
    connectionDesignEmail: string;
    year: string;
    lastTransmittalNumber: string;
    creationDate: string;
    projectStartDate?: string;
    financialYear?: string;
    projectCode?: string;
    division?: string;
    projectManager?: string;
}
const generateSowRows = (countVal: string, nameVal: string, currentRows: any[], isAdditional: boolean = false, trackingMode: 'sow' | 'seq' = 'sow') => {
    const count = parseInt(countVal) || 0;
    if (count < 0) return currentRows;
    if (count === 0) return [];

    let base = nameVal.trim() || (isAdditional ? 'Additional SOW ' : (trackingMode === 'seq' ? 'SEQ ' : 'SOW '));
    let startNum = 1;
    let padLength = 0;

    const match = base.match(/^(.*?)(\d+)$/);
    if (match) {
        base = match[1];
        startNum = parseInt(match[2], 10);
        padLength = match[2].length;
    } else if (nameVal.trim()) {
        padLength = 0; // Natural sorting will handle this without padding
    } else {
        padLength = 2; // Default padding for empty name 'SOW 01'
    }

    let newRows = [...currentRows];
    const today = new Date().toISOString().split('T')[0];
    
    if (count > newRows.length) {
        for (let i = newRows.length; i < count; i++) {
            newRows.push({ name: '', percentage: 0, approval: 0, fabrication: 0, status: 'Yet to Start', approvalDate: today, fabricationDate: null });
        }
    } else if (count < newRows.length) {
        newRows = newRows.slice(0, count);
    }

    for (let i = 0; i < newRows.length; i++) {
        const num = startNum + i;
        const numStr = padLength > 0 ? String(num).padStart(padLength, '0') : String(num);
        newRows[i].name = `${base}${numStr}`;
    }

    if (newRows.length > 0) {
        const totalAmount = 100;
        const defaultPct = Math.round((totalAmount / newRows.length) * 100) / 100;
        newRows = newRows.map((row, idx) => {
            if (idx === newRows.length - 1) {
                const sumOthers = defaultPct * (newRows.length - 1);
                const remainder = Math.round((totalAmount - sumOthers) * 100) / 100;
                return { ...row, percentage: remainder };
            }
            return { ...row, percentage: defaultPct };
        });
    }

    return newRows;
};

const generateAdditionalSowRows = (countVal: string, nameVal: string, currentRows: any[], originalSowRows: any[], originalCountFromDb: number) => {
    const count = parseInt(countVal) || 0;
    if (count < 0) return { newRows: currentRows, newOriginalSow: originalSowRows };

    const effectiveCount = Math.max(count, originalCountFromDb);
    if (effectiveCount === 0) return { newRows: [], newOriginalSow: originalSowRows };

    let base = nameVal.trim() || 'Additional SOW ';
    let startNum = 1;
    let padLength = 0;

    const match = base.match(/^(.*?)(\d+)$/);
    if (match) {
        base = match[1];
        startNum = parseInt(match[2], 10);
        padLength = match[2].length;
    } else if (nameVal.trim()) {
        padLength = 0;
    } else {
        padLength = 2;
    }

    let newRows = [...currentRows];
    
    if (effectiveCount > newRows.length) {
        for (let i = newRows.length; i < effectiveCount; i++) {
            newRows.push({ name: '', percentage: 0, approval: 0, fabrication: 0, status: 'Yet to Start' });
        }
    } else if (effectiveCount < newRows.length) {
        newRows = newRows.slice(0, effectiveCount);
    }

    for (let i = 0; i < newRows.length; i++) {
        const num = startNum + i;
        const numStr = padLength > 0 ? String(num).padStart(padLength, '0') : String(num);
        newRows[i].name = `${base}${numStr}`;
    }

    let newOriginalSow = [...originalSowRows];
    if (newOriginalSow.length > 0) {
        const totalAdd = Math.round(newRows.reduce((acc, curr) => acc + (Number(curr.percentage) || 0), 0) * 100) / 100;
        const remaining = Math.round((100 - totalAdd) * 100) / 100;
        const defaultPct = Math.round((remaining / newOriginalSow.length) * 100) / 100;
        newOriginalSow = newOriginalSow.map((row, idx) => {
            if (idx === newOriginalSow.length - 1) {
                const sumOthers = defaultPct * (newOriginalSow.length - 1);
                const rem = Math.round((remaining - sumOthers) * 100) / 100;
                return { ...row, percentage: rem };
            }
            return { ...row, percentage: defaultPct };
        });
    }

    return { newRows, newOriginalSow };
};

const AddSeqInline = ({ onAdd }: { onAdd: (count: number) => void }) => {
    const [isAdding, setIsAdding] = useState(false);
    const [count, setCount] = useState('');

    if (!isAdding) {
        return (
            <button 
                type="button" 
                className="btn btn-secondary btn-sm"
                onClick={() => setIsAdding(true)}
            >
                + Add Seq
            </button>
        );
    }

    return (
        <div className="form-group" style={{ margin: 0, minWidth: 200 }}>
            <label className="form-label">Number of Sequences <span style={{ color: 'red' }}>*</span></label>
            <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                    type="number" 
                    className="form-control" 
                    placeholder="e.g. 2"
                    value={count}
                    min={1}
                    autoFocus
                    onChange={(e) => setCount(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            const num = parseInt(count);
                            if (!isNaN(num) && num > 0) {
                                onAdd(num);
                                setCount('');
                                setIsAdding(false);
                            }
                        } else if (e.key === 'Escape') {
                            setIsAdding(false);
                            setCount('');
                        }
                    }}
                />
                <button 
                    type="button" 
                    className="btn btn-primary"
                    onClick={() => {
                        const num = parseInt(count);
                        if (!isNaN(num) && num > 0) {
                            onAdd(num);
                            setCount('');
                            setIsAdding(false);
                        }
                    }}
                >
                    Add
                </button>
                <button 
                    type="button" 
                    className="btn btn-light"
                    style={{ border: '1px solid #cbd5e1' }}
                    onClick={() => {
                        setIsAdding(false);
                        setCount('');
                    }}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
};

const DEFAULT_FORM: CreateProjectForm = {
    name: '',
    clientName: '',
    clientId: '',
    contactPerson: null,
    clientContactPersons: [],
    caldimProjectManager: '',
    caldimProjectManagerName: '',
    caldimAssistantProjectManager: '',
    caldimAssistantProjectManagerName: '',
    caldimTeamLead: '',
    caldimTeamLeadName: '',
    teamId: '',
    teamName: '',
    description: '',
    status: 'in_progress',
    location: '',
    trackingMode: 'sow',
    scopeOfWork: [],
    connectionDesignVendor: '',
    connectionDesignContact: '',
    connectionDesignEmail: '',
    year: String(new Date().getFullYear()),
    lastTransmittalNumber: '0',
    creationDate: '',
    projectStartDate: '',
    financialYear: '',
    projectCode: '',
    division: '',
    projectManager: '',
};

interface PmTeamLeadOption {
    type: 'apm' | 'team_lead';
    id: string; // User ID
    name: string;
    email?: string;
    teamId?: string;
    teamName?: string;
    label: string;
}

function getTeamOptionsForPm(pmId: string, allUsers: User[], allTeams: Team[]): PmTeamLeadOption[] {
    if (!pmId) return [];
    const pmIdStr = String(pmId);

    const options: PmTeamLeadOption[] = [];
    const seenKeys = new Set<string>();
    const seenApmUserIds = new Set<string>();
    const seenTlUserIds = new Set<string>();

    // 1. Teams that belong to this PM (directly or via leads reporting to this PM)
    const pmTeams = allTeams.filter(t => {
        const tPmId = t.project_manager ? String(t.project_manager._id || t.project_manager.id || t.project_manager) : '';
        if (tPmId === pmIdStr) return true;

        const leads = Array.isArray(t.lead) ? t.lead : (t.lead ? [t.lead] : []);
        return leads.some((l: any) => {
            const leadId = String(l?._id || l?.id || l);
            const lUser = allUsers.find(u => String(u.id || (u as any)._id) === leadId) || (typeof l === 'object' ? l : null);
            const userPm = lUser?.project_manager ? String((lUser.project_manager as any)?._id || (lUser.project_manager as any)?.id || lUser.project_manager) : '';
            return userPm === pmIdStr;
        });
    });

    // For each team under this PM:
    // If there is an APM in the team, show ONLY the APM — DO NOT fetch their team lead!
    // If there is NO APM in the team, ONLY then populate the Team Lead(s).
    pmTeams.forEach(t => {
        const teamId = String(t._id || t.id);
        const teamName = t.name;

        let apmUser: User | null = null;

        // A. Check if APM is set directly on the team
        if (t.assistant_project_manager) {
            const apmId = String(t.assistant_project_manager._id || t.assistant_project_manager.id || t.assistant_project_manager);
            apmUser = allUsers.find(u => String(u.id || (u as any)._id) === apmId) || (typeof t.assistant_project_manager === 'object' ? t.assistant_project_manager : null);
        }

        // B. Check if any team lead of this team reports to an APM
        if (!apmUser && Array.isArray(t.lead)) {
            for (const l of t.lead) {
                const leadId = String(l?._id || l?.id || l);
                const leadDoc = allUsers.find(u => String(u.id || (u as any)._id) === leadId) || (typeof l === 'object' ? l : null);
                if (leadDoc?.assistant_project_manager) {
                    const apmId = String((leadDoc.assistant_project_manager as any)?._id || (leadDoc.assistant_project_manager as any)?.id || leadDoc.assistant_project_manager);
                    apmUser = allUsers.find(u => String(u.id || (u as any)._id) === apmId) || null;
                    if (apmUser) break;
                }
            }
        }

        // C. Check if any APM user has this team as their team or is in members
        if (!apmUser) {
            apmUser = allUsers.find(u => {
                if (u.role !== 'assistant_project_manager') return false;
                const uTeamId = u.team ? String((u.team as any)?._id || (u.team as any)?.id || u.team) : '';
                if (uTeamId && uTeamId === teamId) return true;
                const members = Array.isArray(t.members) ? t.members : (Array.isArray(t.users) ? t.users : []);
                return members.some((m: any) => String(m?._id || m?.id || m) === String(u.id || (u as any)._id));
            }) || null;
        }

        if (apmUser) {
            const apmId = String(apmUser.id || (apmUser as any)._id);
            const apmName = apmUser.displayName || apmUser.username;
            seenApmUserIds.add(apmId);
            const key = `apm-${apmId}-${teamId}`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                options.push({
                    type: 'apm',
                    id: apmId,
                    name: apmName,
                    email: apmUser.email,
                    teamId,
                    teamName,
                    label: `${teamName} — APM: ${apmName}`
                });
            }
        }

        // Always also populate Team Lead(s) for the team
        const leads = Array.isArray(t.lead) ? t.lead : (t.lead ? [t.lead] : []);
        leads.forEach((l: any) => {
            const leadId = String(l?._id || l?.id || l);
            const leadDoc = allUsers.find(u => String(u.id || (u as any)._id) === leadId) || (typeof l === 'object' ? l : null);
            if (leadDoc) {
                const leadIdStr = String(leadDoc.id || (leadDoc as any)._id);
                const leadName = leadDoc.displayName || leadDoc.username;
                seenTlUserIds.add(leadIdStr);
                const key = `tl-${leadIdStr}-${teamId}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    options.push({
                        type: 'team_lead',
                        id: leadIdStr,
                        name: leadName,
                        email: leadDoc.email,
                        teamId,
                        teamName,
                        label: `${teamName} — Team Lead: ${leadName}`
                    });
                }
            }
        });
    });

    // 2. Direct APMs under this PM not yet included as part of any team
    const directApms = getApmsForPm(pmId, allUsers);
    directApms.forEach(apm => {
        const apmId = String(apm.id || (apm as any)._id);
        if (!seenApmUserIds.has(apmId)) {
            seenApmUserIds.add(apmId);
            const apmName = apm.displayName || apm.username;
            options.push({
                type: 'apm',
                id: apmId,
                name: apmName,
                email: apm.email,
                label: `APM: ${apmName}`
            });
        }
    });

    // 3. Direct Team Leads reporting directly to this PM (not under any team with an APM, and not already included)
    allUsers.filter(u => u.role === 'team_lead' || u.role === 'assistant_team_lead').forEach(tl => {
        const tlPmId = tl.project_manager ? String((tl.project_manager as any)?._id || (tl.project_manager as any)?.id || tl.project_manager) : '';
        if (tlPmId === pmIdStr) {
            const tlId = String(tl.id || (tl as any)._id);
            if (tl.assistant_project_manager || seenTlUserIds.has(tlId)) {
                return;
            }
            const tlName = tl.displayName || tl.username;
            options.push({
                type: 'team_lead',
                id: tlId,
                name: tlName,
                email: tl.email,
                label: `Team Lead: ${tlName}`
            });
            seenTlUserIds.add(tlId);
        }
    });

    return options;
}

function getApmsForPm(pmId: string, allUsers: User[]): User[] {

    if (!pmId) return [];
    const pmIdStr = String(pmId);

    // 1. APMs that directly have this PM as their project_manager
    const directApms = allUsers.filter(u => {
        if (u.role !== 'assistant_project_manager') return false;
        const userPm = typeof u.project_manager === 'object' ? (u.project_manager as any)?._id || (u.project_manager as any)?.id : u.project_manager;
        return userPm && String(userPm) === pmIdStr;
    });

    // 2. APMs linked via team members/users where user's PM is pmId and user's APM is this APM
    const linkedApmIds = new Set<string>();
    allUsers.forEach(u => {
        const userPm = typeof u.project_manager === 'object' ? (u.project_manager as any)?._id || (u.project_manager as any)?.id : u.project_manager;
        if (userPm && String(userPm) === pmIdStr && u.assistant_project_manager) {
            const apmId = typeof u.assistant_project_manager === 'object' ? (u.assistant_project_manager as any)?._id || (u.assistant_project_manager as any)?.id : u.assistant_project_manager;
            if (apmId) linkedApmIds.add(String(apmId));
        }
    });

    const indirectApms = allUsers.filter(u => 
        u.role === 'assistant_project_manager' && linkedApmIds.has(String(u.id || (u as any)._id))
    );

    // 3. APM assigned directly on the PM user document (if any)
    const pmUser = allUsers.find(u => String(u.id || (u as any)._id) === pmIdStr);
    if (pmUser && pmUser.assistant_project_manager) {
        const pmApmId = typeof pmUser.assistant_project_manager === 'object' 
            ? (pmUser.assistant_project_manager as any)?._id || (pmUser.assistant_project_manager as any)?.id
            : pmUser.assistant_project_manager;
        if (pmApmId) {
            const pmApm = allUsers.find(u => u.role === 'assistant_project_manager' && String(u.id || (u as any)._id) === String(pmApmId));
            if (pmApm && !indirectApms.some(a => String(a.id || (a as any)._id) === String(pmApm.id || (pmApm as any)._id))) {
                indirectApms.push(pmApm);
            }
        }
    }

    // Combine direct and indirect (deduplicated)
    const combined = [...directApms];
    indirectApms.forEach(apm => {
        const apmId = String(apm.id || (apm as any)._id);
        if (!combined.some(c => String(c.id || (c as any)._id) === apmId)) {
            combined.push(apm);
        }
    });

    return combined;
}

export default function AdminProjects() {

    const navigate = useNavigate();
    const { showMessage } = useMessage();
    const [projects, setProjects] = useState<Project[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [totalProjectsCount, setTotalProjectsCount] = useState<number>(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [modalError, setModalError] = useState('');
    const [search, setSearch] = useState('');
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState<CreateProjectForm>(DEFAULT_FORM);
    const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
    const [editTarget, setEditTarget] = useState<Project | null>(null);
    const [editMode, setEditMode] = useState<'full' | 'sequences'>('full');
    const [actionLoading, setActionLoading] = useState(false);
    const [clients, setClients] = useState<Client[]>([]);
    const [externalProjects, setExternalProjects] = useState<any[]>([]);
    const [sequenceNames, setSequenceNames] = useState<Array<{ name: string; deadline?: string; approvalDate?: string; fabricationDate?: string }>>([]);
    const [seqInput, setSeqInput] = useState<string>('');
    const [sowInput, setSowInput] = useState<string>('');
    const [sowNameInput, setSowNameInput] = useState<string>('');
    const [isCreateSowCollapsed, setIsCreateSowCollapsed] = useState<boolean>(false);
    const [editSowInput, setEditSowInput] = useState<string>('');
    const [editSowNameInput, setEditSowNameInput] = useState<string>('');
    const [teams, setTeams] = useState<Team[]>([]);
    const [showAdditionalSowFields, setShowAdditionalSowFields] = useState<boolean>(false);
    const { user: authUser, logout } = useAuth();
    const fetchProjects = useCallback(async () => {
        try {
            setLoading(true);
            setError('');

            const [projData, clientData, externalData, userData, teamsData] = await Promise.all([
                adminListProjects(),
                adminListClients(),
                adminListExternalProjects(),
                adminListUsers().catch(() => ({ users: [] })),
                adminListTeams().catch(() => [])
            ]);

            if (!projData || !Array.isArray(projData.projects)) {
                throw new Error('Invalid project data received from server');
            }

            setClients(clientData.clients || []);
            setExternalProjects(externalData.projects || []);
            setUsers(userData.users || []);
            setTeams(teamsData || []);

            const mapped = projData.projects.map((p: any) => ({
                ...p,
                id: String(p._id || p.id),
            }));
            setProjects(mapped);
            setTotalProjectsCount(projData.count || mapped.length);
        } catch (err: any) {
            setError(err.message || 'Failed to load projects');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProjects();
    }, [fetchProjects]);

    useEffect(() => {
        if (error.includes('expired') || error.includes('log in again')) {
            logout();
            navigate('/login');
        }
    }, [error, logout, navigate]);

    const allProjects = projects.map(p => ({ ...p, isExternal: false }));

    const filtered = allProjects.filter(
        (p) =>
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.clientName.toLowerCase().includes(search.toLowerCase())
    );

    const distinctVendors = Array.from(
        new Set(
            projects
                .map(p => p.connectionDesignVendor)
                .filter(v => typeof v === 'string' && v.trim() !== '')
        )
    );

    const handleOpenCreateModal = () => {
        let initialForm: CreateProjectForm = { ...DEFAULT_FORM };
        if (authUser) {
            const authUserId = String(authUser.id || (authUser as any)._id);
            const authRole = authUser.role;

            if (authRole === 'project_manager') {
                initialForm.caldimProjectManager = authUserId;
                initialForm.caldimProjectManagerName = authUser.displayName || authUser.username;
            } else if (authRole === 'assistant_project_manager') {
                initialForm.caldimAssistantProjectManager = authUserId;
                initialForm.caldimAssistantProjectManagerName = authUser.displayName || authUser.username;

                // Find their PM
                const pmRef = authUser.project_manager;
                const pmId = pmRef ? String((pmRef as any)._id || (pmRef as any).id || pmRef) : '';
                if (pmId) {
                    const pmUser = users.find(u => String(u.id || (u as any)._id) === pmId);
                    if (pmUser) {
                        initialForm.caldimProjectManager = pmId;
                        initialForm.caldimProjectManagerName = pmUser.displayName || pmUser.username;
                    }
                }

                // Find their team
                const myTeam = teams.find(t => {
                    const apmId = t.assistant_project_manager ? String((t.assistant_project_manager as any)._id || (t.assistant_project_manager as any).id || t.assistant_project_manager) : '';
                    if (apmId === authUserId) return true;
                    const teamMembers = Array.isArray(t.members) ? t.members : (Array.isArray(t.users) ? t.users : []);
                    return teamMembers.some((u: any) => String(u._id || u.id || u) === authUserId);
                });
                if (myTeam) {
                    initialForm.teamId = String(myTeam._id || myTeam.id);
                    initialForm.teamName = myTeam.name;
                    if (!initialForm.caldimProjectManager && myTeam.project_manager) {
                        const tPmId = String((myTeam.project_manager as any)._id || (myTeam.project_manager as any).id || myTeam.project_manager);
                        const pmUser = users.find(u => String(u.id || (u as any)._id) === tPmId);
                        if (pmUser) {
                            initialForm.caldimProjectManager = tPmId;
                            initialForm.caldimProjectManagerName = pmUser.displayName || pmUser.username;
                        }
                    }
                }
            } else if (authRole === 'team_lead' || authRole === 'assistant_team_lead') {
                initialForm.caldimTeamLead = authUserId;
                initialForm.caldimTeamLeadName = authUser.displayName || authUser.username;

                // Find their team
                const myTeam = teams.find(t => {
                    const leads = Array.isArray(t.lead) ? t.lead : (t.lead ? [t.lead] : []);
                    if (leads.some((l: any) => String(l._id || l.id || l) === authUserId)) return true;
                    const teamMembers = Array.isArray(t.members) ? t.members : (Array.isArray(t.users) ? t.users : []);
                    return teamMembers.some((u: any) => String(u._id || u.id || u) === authUserId);
                });
                if (myTeam) {
                    initialForm.teamId = String(myTeam._id || myTeam.id);
                    initialForm.teamName = myTeam.name;
                    if (myTeam.project_manager) {
                        const tPmId = String((myTeam.project_manager as any)._id || (myTeam.project_manager as any).id || myTeam.project_manager);
                        const pmUser = users.find(u => String(u.id || (u as any)._id) === tPmId);
                        if (pmUser) {
                            initialForm.caldimProjectManager = tPmId;
                            initialForm.caldimProjectManagerName = pmUser.displayName || pmUser.username;
                        }
                    }
                }

                if (!initialForm.caldimProjectManager && authUser.project_manager) {
                    const pmRef = authUser.project_manager;
                    const pmId = String((pmRef as any)._id || (pmRef as any).id || pmRef);
                    const pmUser = users.find(u => String(u.id || (u as any)._id) === pmId);
                    if (pmUser) {
                        initialForm.caldimProjectManager = pmId;
                        initialForm.caldimProjectManagerName = pmUser.displayName || pmUser.username;
                    }
                }
            }
        }
        setForm(initialForm);
        setSeqInput('0');
        setSowInput('0');
        setSowNameInput('');
        setIsCreateSowCollapsed(false);
        setShowCreate(true);
    };

    async function handleCreate() {
        if (!form.name.trim() || !form.clientId) return;

        const selectedClient = clients.find(c => (c.id || c._id) === form.clientId);
        if (!selectedClient) return;

        try {
            setActionLoading(true);
            setModalError('');
            const today = form.creationDate || new Date().toISOString().split('T')[0];
            const preparedScopeOfWork = (form.scopeOfWork || []).map(s => ({
                ...s,
                approvalDate: s.approvalDate || today,
                fabricationDate: s.fabricationDate || null,
                sequences: (s.sequences || []).map((seq: any) => ({
                    ...seq,
                    approvalDate: seq.approvalDate || today,
                    fabricationDate: seq.fabricationDate || null
                }))
            }));
            const sequencesPayload = form.trackingMode === 'seq'
                ? (preparedScopeOfWork || []).map((s: any) => ({
                    name: s.name,
                    status: s.status === 'Completed' ? 'Completed' : 'Not Completed',
                    approvalDate: s.sequences?.[0]?.approvalDate || s.approvalDate || today,
                    fabricationDate: s.sequences?.[0]?.fabricationDate || s.fabricationDate || null
                }))
                : (preparedScopeOfWork || []).flatMap(s => s.sequences || []);

            if (Number(form.year) <= 2025 && !form.creationDate) {
                setModalError(`Please select the Date of Project Creation for this ${form.year} project.`);
                return;
            }

            const { project } = await adminCreateProject({
                name: form.name.trim(),
                clientName: selectedClient.name,
                clientId: form.clientId,
                contactPerson: form.contactPerson,
                clientContactPersons: form.clientContactPersons,
                caldimProjectManager: form.caldimProjectManager || undefined,
                caldimProjectManagerName: form.caldimProjectManagerName || undefined,
                caldimAssistantProjectManager: form.caldimAssistantProjectManager || undefined,
                caldimAssistantProjectManagerName: form.caldimAssistantProjectManagerName || undefined,
                caldimTeamLead: form.caldimTeamLead || undefined,
                caldimTeamLeadName: form.caldimTeamLeadName || undefined,
                teamId: form.teamId || undefined,
                teamName: form.teamName || undefined,
                description: form.description.trim(),
                status: form.status,
                trackingMode: form.trackingMode,
                scopeOfWork: preparedScopeOfWork,
                location: form.location,
                sequences: sequencesPayload,
                connectionDesignVendor: form.connectionDesignVendor,
                connectionDesignContact: form.connectionDesignContact,
                connectionDesignEmail: form.connectionDesignEmail,
                year: Number(form.year),
                startingTransmittalNumber: Number(form.year) <= 2026 ? (Number(form.lastTransmittalNumber) || 0) + 1 : 1,
                creationDate: form.creationDate || undefined,
                projectStartDate: form.projectStartDate || undefined,
                financialYear: form.financialYear || undefined,
                projectCode: form.projectCode || undefined,
                division: form.division || undefined,
                projectManager: form.projectManager || undefined,
            } as any);

            const newProject = {
                ...project,
                id: project._id || project.id
            };

            setProjects((prev) => [newProject, ...prev]);
            setShowCreate(false);
            setForm(DEFAULT_FORM);
            setSeqInput('0');
            setSowInput('0');
            setSowNameInput('');
        } catch (err: any) {
            setModalError(`Create failed: ${err.message}`);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleDelete(id: string) {
        try {
            setActionLoading(true);
            setError('');
            await adminDeleteProject(id);
            setProjects((prev) => prev.filter((p) => p.id !== id));
            setDeleteTarget(null);
        } catch (err: any) {
            setError(`Delete failed: ${err.message}`);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleEditSave() {
        if (!editTarget) return;

        if (editMode === 'full') {
            const rawSum = (editTarget.scopeOfWork || []).reduce((acc, curr) => acc + (Number(curr.percentage) || 0), 0);
            const totalSowPercentage = Math.round(rawSum * 100) / 100;
            
            const hasSow = (editTarget.scopeOfWork && editTarget.scopeOfWork.length > 0);
            if (hasSow && totalSowPercentage !== 100) {
                const msgText = `The sum of Percentage of Total Work (%) across ALL Scope of Work entries must equal exactly 100. Current sum is ${totalSowPercentage}.`;
                setModalError('');
                showMessage('Invalid Scope of Work', msgText, 'warning');
                return;
            }
        }

        try {
            setActionLoading(true);
            setModalError('');
            const today = new Date().toISOString().split('T')[0];
            const preparedScopeOfWork = (editTarget.scopeOfWork || []).map(s => ({
                ...s,
                approvalDate: s.approvalDate || today,
                fabricationDate: s.fabricationDate || null,
                sequences: (s.sequences || []).map((seq: any) => ({
                    ...seq,
                    approvalDate: seq.approvalDate || today,
                    fabricationDate: seq.fabricationDate || null
                }))
            }));
            const preparedAdditionalScopeOfWork = (editTarget.additionalScopeOfWork || []).map(s => ({
                ...s,
                approvalDate: s.approvalDate || today,
                fabricationDate: s.fabricationDate || null,
                sequences: (s.sequences || []).map((seq: any) => ({
                    ...seq,
                    approvalDate: seq.approvalDate || today,
                    fabricationDate: seq.fabricationDate || null
                }))
            }));
            const sequencesPayload = (editTarget.trackingMode === 'seq')
                ? (preparedScopeOfWork || []).map((s: any) => ({
                    name: s.name,
                    status: s.status === 'Completed' ? 'Completed' : 'Not Completed',
                    approvalDate: s.sequences?.[0]?.approvalDate || s.approvalDate || today,
                    fabricationDate: s.sequences?.[0]?.fabricationDate || s.fabricationDate || null
                }))
                : (editTarget.trackingMode === 'sow'
                    ? (preparedScopeOfWork || []).flatMap(s => s.sequences || [])
                    : (editTarget.sequences || []).map((seq: any) => ({
                        ...seq,
                        approvalDate: seq.approvalDate || today
                    })));

            const { project } = await adminUpdateProject(editTarget.id, {
                name: editTarget.name,
                clientName: editTarget.clientName,
                clientId: editTarget.clientId,
                contactPerson: editTarget.contactPerson,
                clientContactPersons: editTarget.clientContactPersons,
                caldimProjectManager: editTarget.caldimProjectManager || undefined,
                caldimProjectManagerName: editTarget.caldimProjectManagerName || undefined,
                caldimAssistantProjectManager: editTarget.caldimAssistantProjectManager || undefined,
                caldimAssistantProjectManagerName: editTarget.caldimAssistantProjectManagerName || undefined,
                caldimTeamLead: editTarget.caldimTeamLead || undefined,
                caldimTeamLeadName: editTarget.caldimTeamLeadName || undefined,
                teamId: editTarget.teamId || undefined,
                teamName: editTarget.teamName || undefined,
                description: editTarget.description,
                status: editTarget.status,
                scopeOfWork: preparedScopeOfWork,
                additionalScopeOfWork: preparedAdditionalScopeOfWork,
                location: editTarget.location,
                sequences: sequencesPayload,
                connectionDesignVendor: editTarget.connectionDesignVendor,
                connectionDesignContact: editTarget.connectionDesignContact,
                connectionDesignEmail: editTarget.connectionDesignEmail
            } as any);

            // Re-map with consistent ID
            const updatedProject = {
                ...project,
                id: project._id || project.id
            };

            setProjects((prev) =>
                prev.map((p) => (p.id === updatedProject.id ? updatedProject : p))
            );
            setEditTarget(null);
        } catch (err: any) {
            setModalError(`Update failed: ${err.message}`);
        } finally {
            setActionLoading(false);
        }
    }

    const SearchIcon = () => (
        <svg viewBox="0 0 16 16" fill="none" strokeWidth="1.5" stroke="currentColor" width="14" height="14">
            <circle cx="6.5" cy="6.5" r="4.5" />
            <path d="M10 10l3.5 3.5" strokeLinecap="round" />
        </svg>
    );

    const handleProjectNavigation = (project: Project | any) => {
        const projectId = String(project?.id || project?._id || '').trim();
        if (!projectId || projectId === 'undefined') return;

        navigate(`/admin/projects/${projectId}`);
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">Projects</h2>
                    <p className="page-subtitle">Manage all steel detailing projects</p>
                </div>
                <button className="btn btn-primary" onClick={handleOpenCreateModal}>
                    <span style={{ marginRight: 8, display: 'inline-flex' }}><IconPlus /></span> Create Project
                </button>
            </div>

            {/* Quick stats row */}
            <div className="stats-grid mb-lg" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                {[
                    { label: 'Total Projects', value: Math.max(totalProjectsCount, allProjects.length), cls: 'accent-blue' },
                    { label: 'In-progress', value: allProjects.filter((p) => getOriginalCategory(p) === 'in_progress').length, cls: 'accent-green' },
                    { label: 'On Hold', value: allProjects.filter((p) => getOriginalCategory(p) === 'on_hold').length, cls: 'accent-amber' },
                    { label: 'Completed', value: allProjects.filter((p) => getOriginalCategory(p) === 'completed').length, cls: 'accent-slate' },
                ].map(({ label, value, cls }) => (
                    <div className={`stat-card ${cls}`} key={label}>
                        <div className="stat-card-label">{label}</div>
                        <div className="stat-card-value">{value}</div>
                    </div>
                ))}
            </div>

            {/* Filter */}
            <div className="filter-toolbar mb-md">
                <div className="search-input-wrapper">
                    <SearchIcon />
                    <input
                        type="text"
                        className="form-control"
                        placeholder="Search projects or clients…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ paddingLeft: 34 }}
                        disabled={loading}
                    />
                </div>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                    {filtered.length} of {allProjects.length} projects
                </span>
            </div>

            {error && (
                <div className="info-box danger mb-md" style={{ padding: '12px 16px', borderRadius: 8 }}>
                    <strong>Error:</strong> {error}
                    <button onClick={fetchProjects} className="btn btn-ghost btn-sm" style={{ marginLeft: 12 }}>Retry</button>
                </div>
            )}

            {/* Table */}
            <div className="table-wrapper">
                {loading ? (
                    <div className="table-empty" style={{ padding: '60px 0' }}>
                        <div className="spinner mb-sm"></div>
                        <p>Loading projects from server...</p>
                    </div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th style={{ width: 40 }}>#</th>
                                <th>Client Name</th>
                                <th>Project Name</th>
                                <th>Created</th>
                                <th>Approval %</th>
                                <th>Fabrication %</th>
                                <th>Sequence</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr><td colSpan={9} className="table-empty">No projects match your search.</td></tr>
                            ) : (
                                filtered.map((p, i) => (
                                    <tr key={p.id}>
                                        <td className="text-muted font-mono" style={{ fontSize: 12 }}>{i + 1}</td>
                                        <td style={{ color: 'var(--color-text-secondary)' }}>{p.clientName}</td>
                                        <td>
                                            <span
                                                onClick={() => handleProjectNavigation(p)}
                                                style={{
                                                    fontWeight: 700,
                                                    fontSize: 14,
                                                    color: 'var(--color-text-primary)',
                                                    cursor: 'pointer',
                                                    textDecoration: 'underline',
                                                    textUnderlineOffset: '2px'
                                                }}
                                            >
                                                {p.name}
                                            </span>
                                        </td>
                                        <td className="text-muted font-mono" style={{ fontSize: 12.5 }}>
                                            {formatDate(p.creationDate || p.createdAt)}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 100 }}>
                                                <div style={{ flex: 1, height: 3, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                                                    <div style={{ width: `${p.approvalPercentage || 0}%`, height: '100%', background: 'var(--color-primary)', opacity: 0.8 }} />
                                                </div>
                                                <span className="font-mono" style={{ fontSize: 12, fontWeight: 750, color: '#1e293b' }}>{p.approvalPercentage || 0}%</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 100 }}>
                                                <div style={{ flex: 1, height: 3, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                                                    <div style={{ width: `${p.fabricationPercentage || 0}%`, height: '100%', background: '#10b981', opacity: 0.8 }} />
                                                </div>
                                                <span className="font-mono" style={{ fontSize: 12, fontWeight: 750, color: '#1e293b' }}>{p.fabricationPercentage || 0}%</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div
                                                onClick={() => {
                                                    setEditTarget({ ...p });
                                                    setEditMode('full');
                                                    setSeqInput((p.sequences?.length || 0).toString());
                                                    setEditSowInput((p.additionalScopeOfWork?.length || 0).toString());
                                                }}
                                                title="View / Edit Sequences"
                                                style={{
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 6,
                                                    background: '#f8fafc',
                                                    padding: '4px 12px',
                                                    borderRadius: '8px',
                                                    border: '1px solid #e2e8f0',
                                                    width: 'fit-content'
                                                }}
                                            >
                                                <span style={{ fontSize: 13, fontWeight: 800, color: '#1e293b' }}>
                                                    {p.sequences?.length || (p.scopeOfWork?.length || 0)}
                                                </span>
                                                <span style={{ fontSize: 10, fontWeight: 650, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                                                    SEQ
                                                </span>
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`badge ${getBadgeClass(p.rawStatus || STATUS_LABEL[p.status as ProjectStatus] || p.status)}`}>
                                                {formatBadgeText(p.rawStatus || STATUS_LABEL[p.status as ProjectStatus] || p.status)}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="btn-group">
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => p.id && p.id !== 'undefined' && navigate(`/admin/projects/${p.id}`)}
                                                    title="Open Project"
                                                    disabled={!p.id || p.id === 'undefined'}
                                                >
                                                    <IconOpen /> Open
                                                </button>
                                                <button
                                                    className="btn btn-ghost btn-sm btn-icon"
                                                    onClick={() => {
                                                        setEditTarget({ ...p });
                                                        setEditMode('full');
                                                        setSeqInput((p.sequences?.length || 0).toString());
                                                        setEditSowInput((p.additionalScopeOfWork?.length || 0).toString());
                                                    }}
                                                    title="Edit"
                                                >
                                                    <IconEdit />
                                                </button>
                                                <button
                                                    className="btn btn-danger btn-sm btn-icon"
                                                    onClick={() => setDeleteTarget(p)}
                                                    title="Delete"
                                                >
                                                    <IconTrash />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ── Create Modal ── */}
            {showCreate && (
                <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCreate(false) }}>
                    <div className="modal modal-lg" style={{ maxWidth: '1050px', width: '95vw' }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Create New Project</span>
                            <button className="modal-close" onClick={() => setShowCreate(false)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label required">Client / Organization</label>
                                <select
                                    className="form-control"
                                    value={form.clientId}
                                    onChange={(e) => {
                                        const cId = e.target.value;
                                        setForm({ ...form, clientId: cId, contactPerson: null, clientContactPersons: [] });
                                    }}
                                >
                                    <option value="">Select a Client</option>
                                    {clients.map(c => (
                                        <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                            
                            {form.clientId && (
                                <div className="form-group">
                                    <label className="form-label">Available Projects in Project Management</label>
                                    <select
                                        className="form-control"
                                        onChange={(e) => {
                                            const selectedProjectName = e.target.value;
                                            if (selectedProjectName) {
                                                const ep = externalProjects.find(p => p.name === selectedProjectName);
                                                if (ep) {
                                                    let fetchedYear = form.year;
                                                    let fetchedStartDate = '';

                                                    if (ep.projectStartDate) {
                                                        const parsedDate = new Date(ep.projectStartDate);
                                                        if (!isNaN(parsedDate.getTime())) {
                                                            fetchedStartDate = parsedDate.toISOString().split('T')[0];
                                                            fetchedYear = String(parsedDate.getFullYear());
                                                        }
                                                    } else if (ep.financialYear) {
                                                        const fyMatch = String(ep.financialYear).match(/(\d{2,4})/);
                                                        if (fyMatch) {
                                                            let yNum = parseInt(fyMatch[1], 10);
                                                            if (yNum < 100) yNum += 2000;
                                                            fetchedYear = String(yNum);
                                                        }
                                                    }

                                                    const isOldYear = Number(fetchedYear) <= 2025 && Number(fetchedYear) >= 2000;
                                                    const creationDateVal = fetchedStartDate || (isOldYear ? (form.creationDate || `${fetchedYear}-01-01`) : '');

                                                    setForm(prev => ({
                                                        ...prev,
                                                        name: ep.name,
                                                        year: fetchedYear,
                                                        creationDate: creationDateVal,
                                                        projectStartDate: ep.projectStartDate || (fetchedStartDate ? new Date(fetchedStartDate).toISOString() : ''),
                                                        financialYear: ep.financialYear || '',
                                                        projectCode: ep.projectCode || '',
                                                        division: ep.division || '',
                                                        projectManager: ep.projectManager || '',
                                                        location: ep.location || prev.location || '',
                                                        lastTransmittalNumber: isOldYear ? (prev.lastTransmittalNumber || '0') : '0',
                                                    }));
                                                } else {
                                                    setForm(prev => ({ ...prev, name: selectedProjectName }));
                                                }
                                            }
                                        }}
                                        defaultValue=""
                                    >
                                        <option value="">-- Select a project to auto-fill name & details --</option>
                                        {externalProjects
                                            .filter(ep => {
                                                const selectedClient = clients.find(c => (c.id || c._id) === form.clientId);
                                                if (!selectedClient || !selectedClient.name || !ep.clientName) return false;
                                                
                                                const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
                                                const normEp = normalize(ep.clientName);
                                                const normSelected = normalize(selectedClient.name);
                                                
                                                return normEp.includes(normSelected) || normSelected.includes(normEp);
                                            })
                                            .map((ep, idx) => (
                                                <option key={idx} value={ep.name}>{ep.name} ({ep.status || 'active'})</option>
                                            ))
                                        }
                                    </select>
                                    <small style={{ color: 'var(--color-text-secondary)', marginTop: 4, display: 'block' }}>
                                        Selecting a project will auto-fill Project Name, Year, Start Date, and Project Details.
                                    </small>
                                </div>
                            )}

                            {form.clientId && (
                                <div className="form-group">
                                    <label className="form-label required">Client Contact Person</label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                                        {clients.find(c => (c.id || c._id) === form.clientId)?.contacts.map((con, idx) => {
                                            const isChecked = (form.clientContactPersons || []).some(c => c.email === con.email) || form.contactPerson?.email === con.email;
                                            return (
                                                <label
                                                    key={idx}
                                                    style={{
                                                        display: 'flex', alignItems: 'flex-start', gap: 10,
                                                        padding: '10px 14px', border: `1px solid ${isChecked ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                                        borderRadius: 6, cursor: 'pointer', background: isChecked ? 'var(--color-primary-light)' : '#fff',
                                                        transition: 'all 0.2s', margin: 0
                                                    }}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={(e) => {
                                                            const current = form.clientContactPersons || (form.contactPerson ? [form.contactPerson] : []);
                                                            let updated: ClientContact[];
                                                            if (e.target.checked) {
                                                                updated = [...current, con];
                                                            } else {
                                                                updated = current.filter(c => c.email !== con.email);
                                                            }
                                                            setForm({
                                                                ...form,
                                                                clientContactPersons: updated,
                                                                contactPerson: updated.length > 0 ? updated[0] : null
                                                            });
                                                        }}
                                                        style={{ marginTop: 2, cursor: 'pointer' }}
                                                    />
                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>{con.name}</span>
                                                        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                                                            {con.email}{con.phone ? ` • ${con.phone}` : ''}{con.designation ? ` (${con.designation})` : ''}
                                                        </span>
                                                    </div>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Caldim Contact Person (PM dropdown + APM / Team Lead options) */}
                            <div className="form-group" style={{ marginTop: 12 }}>
                                <label className="form-label" style={{ fontWeight: 700, fontSize: 13 }}>Caldim Contact Person</label>
                                <div style={{ padding: '14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    <div>
                                        <label className="form-label" style={{ fontSize: 12, marginBottom: 4 }}>Project Manager</label>
                                        <select
                                            className="form-control"
                                            value={form.caldimProjectManager || ''}
                                            onChange={(e) => {
                                                const pmId = e.target.value;
                                                const pmUser = users.find(u => String(u.id || (u as any)._id) === pmId);
                                                const teamOpts = getTeamOptionsForPm(pmId, users, teams);
                                                const autoOpt = teamOpts.length === 1 ? teamOpts[0] : null;
                                                setForm({
                                                    ...form,
                                                    caldimProjectManager: pmId,
                                                    caldimProjectManagerName: pmUser ? (pmUser.displayName || pmUser.username) : '',
                                                    caldimAssistantProjectManager: autoOpt && autoOpt.type === 'apm' ? autoOpt.id : '',
                                                    caldimAssistantProjectManagerName: autoOpt && autoOpt.type === 'apm' ? autoOpt.name : '',
                                                    caldimTeamLead: autoOpt && autoOpt.type === 'team_lead' ? autoOpt.id : '',
                                                    caldimTeamLeadName: autoOpt && autoOpt.type === 'team_lead' ? autoOpt.name : '',
                                                    teamId: autoOpt?.teamId || '',
                                                    teamName: autoOpt?.teamName || ''
                                                });
                                            }}
                                        >
                                            <option value="">Select Project Manager</option>
                                            {users.filter(u => u.role === 'project_manager').map(u => (
                                                <option key={u.id || u._id} value={u.id || u._id}>
                                                    {u.displayName || u.username} ({u.email})
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {form.caldimProjectManager && (() => {
                                        const teamOptions = getTeamOptionsForPm(form.caldimProjectManager, users, teams);

                                        return (
                                            <div style={{ marginTop: 4 }}>
                                                <label className="form-label" style={{ fontSize: 12, marginBottom: 6 }}>
                                                    Assigned Team / APM or Team Lead
                                                </label>
                                                {teamOptions.length === 0 ? (
                                                    <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', padding: '8px 12px', background: '#f8fafc', borderRadius: 6, border: '1px dashed #cbd5e1' }}>
                                                        No Assistant Project Manager or Team Lead assigned under this Project Manager.
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        {teamOptions.map((opt, idx) => {
                                                            const isSelected = (opt.type === 'apm' && form.caldimAssistantProjectManager === opt.id) ||
                                                                               (opt.type === 'team_lead' && form.caldimTeamLead === opt.id);
                                                            return (
                                                                <label
                                                                    key={`${opt.type}-${opt.id}-${opt.teamId || idx}`}
                                                                    style={{
                                                                        display: 'flex', alignItems: 'center', gap: 10,
                                                                        padding: '8px 12px', border: `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                                                        borderRadius: 6, cursor: 'pointer', background: isSelected ? 'var(--color-primary-light, #eff6ff)' : '#fff',
                                                                        transition: 'all 0.2s', margin: 0
                                                                    }}
                                                                >
                                                                    <input
                                                                        type="radio"
                                                                        name="createCaldimTeamOptionRadio"
                                                                        checked={isSelected}
                                                                        onChange={() => {
                                                                            if (opt.type === 'apm') {
                                                                                setForm({
                                                                                    ...form,
                                                                                    caldimAssistantProjectManager: opt.id,
                                                                                    caldimAssistantProjectManagerName: opt.name,
                                                                                    caldimTeamLead: '',
                                                                                    caldimTeamLeadName: '',
                                                                                    teamId: opt.teamId || '',
                                                                                    teamName: opt.teamName || ''
                                                                                });
                                                                            } else {
                                                                                setForm({
                                                                                    ...form,
                                                                                    caldimAssistantProjectManager: '',
                                                                                    caldimAssistantProjectManagerName: '',
                                                                                    caldimTeamLead: opt.id,
                                                                                    caldimTeamLeadName: opt.name,
                                                                                    teamId: opt.teamId || '',
                                                                                    teamName: opt.teamName || ''
                                                                                });
                                                                            }
                                                                        }}
                                                                        style={{ cursor: 'pointer' }}
                                                                    />
                                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>
                                                                            {opt.label}
                                                                        </span>
                                                                        {opt.email && (
                                                                            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                                                                {opt.email}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>


                            <div className="form-group">
                                <label className="form-label required">Project Name</label>
                                <input className="form-control" placeholder="e.g. SteelFrame Tower B"
                                    value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label required">Project Year</label>
                                <input
                                    className="form-control"
                                    type="number"
                                    placeholder="e.g. 2025"
                                    min="2000"
                                    max="2100"
                                    value={form.year}
                                    onChange={(e) => {
                                        const yr = e.target.value;
                                        setForm({
                                            ...form,
                                            year: yr,
                                            lastTransmittalNumber: '0',
                                            creationDate: Number(yr) <= 2025 && Number(yr) >= 2000 ? (form.creationDate || `${yr}-01-01`) : ''
                                        });
                                    }}
                                />
                            </div>

                            {Number(form.year) <= 2025 && Number(form.year) >= 2000 && (
                                <div className="form-group" style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '14px 16px' }}>
                                    <label className="form-label required" style={{ color: '#0369a1', fontWeight: 600 }}>Date of Project Creation</label>
                                    <p style={{ fontSize: 12, color: '#0284c7', marginBottom: 8, marginTop: 2 }}>
                                        Since this is a {form.year} project, enter the date of project creation.
                                    </p>
                                    <input
                                        className="form-control"
                                        type="date"
                                        required
                                        value={form.creationDate || ''}
                                        onChange={(e) => setForm({ ...form, creationDate: e.target.value })}
                                    />
                                </div>
                            )}

                            {Number(form.year) <= 2026 && Number(form.year) >= 2000 && (
                                <div className="form-group" style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '14px 16px' }}>
                                    <label className="form-label required" style={{ color: '#c2410c' }}>Last Transmittal Number</label>
                                    <p style={{ fontSize: 12, color: '#9a3412', marginBottom: 8, marginTop: 2 }}>
                                        Since this is a {form.year} project, enter the last transmittal number used (e.g. if previous transmittals went up to 12, enter 12. If none, enter 0).
                                    </p>
                                    <input
                                        className="form-control"
                                        type="number"
                                        placeholder="e.g. 12"
                                        min="0"
                                        value={form.lastTransmittalNumber || ''}
                                        onChange={(e) => setForm({ ...form, lastTransmittalNumber: e.target.value })}
                                    />
                                </div>
                            )}

                            <div className="form-group">
                                        <label className="form-label">Description</label>
                                        <textarea className="form-control" placeholder="Brief project description…" rows={3}
                                            value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                            </div>

                            {/* ── Tracking Mode Selection ── */}
                            <div className="form-group" style={{ marginBottom: 16 }}>
                                <label className="form-label required">Project Structure</label>
                                <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginTop: 8 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
                                        <input 
                                            type="radio" 
                                            name="trackingMode" 
                                            checked={form.trackingMode === 'sow'} 
                                            onChange={() => {
                                                setForm({ ...form, trackingMode: 'sow', scopeOfWork: [] });
                                                setSowInput('');
                                                setSowNameInput('');
                                            }} 
                                            style={{ margin: 0 }}
                                        />
                                        Scope of Work (SOW) Based
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
                                        <input 
                                            type="radio" 
                                            name="trackingMode" 
                                            checked={form.trackingMode === 'seq'} 
                                            onChange={() => {
                                                setForm({ ...form, trackingMode: 'seq', scopeOfWork: [] });
                                                setSowInput('');
                                                setSowNameInput('');
                                            }} 
                                            style={{ margin: 0 }}
                                        />
                                        Sequence (SEQ) Based
                                    </label>
                                </div>
                            </div>

                            {/* ── Scope of Work Builder (Create Project) ── */}
                            <div style={{ display: 'flex', gap: '16px' }}>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label className="form-label">Number of {form.trackingMode === 'seq' ? 'SEQ' : 'SOW'} Items <span style={{ color: 'red' }}>*</span></label>
                                    <input
                                        className="form-control"
                                        type="number"
                                        placeholder="e.g. 5"
                                        value={sowInput}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setSowInput(val);
                                            const newRows = generateSowRows(val, sowNameInput, form.scopeOfWork || [], false, form.trackingMode);
                                            const updatedRows = newRows.map(r => ({...r, sequences: r.sequences || []}));
                                            setForm({ ...form, scopeOfWork: updatedRows });
                                        }}

                                    />
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label className="form-label">Starting {form.trackingMode === 'seq' ? 'SEQ' : 'SOW'} Name</label>
                                    <input
                                        className="form-control"
                                        type="text"
                                        placeholder={form.trackingMode === 'seq' ? 'e.g. SEQ01' : 'e.g. SOWLO1'}
                                        value={sowNameInput}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setSowNameInput(val);
                                            const newRows = generateSowRows(sowInput, val, form.scopeOfWork || [], false, form.trackingMode);
                                            // Initialize sequences if they don't exist
                                            const updatedRows = newRows.map(r => ({...r, sequences: r.sequences || []}));
                                            setForm({ ...form, scopeOfWork: updatedRows });
                                        }}
                                    />
                                </div>
                            </div>

                            {form.scopeOfWork && form.scopeOfWork.length > 0 && (
                                <div style={{ marginTop: 16, padding: '16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                            Configure {form.trackingMode === 'seq' ? 'Sequence' : 'Scope of Work'} Details
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setIsCreateSowCollapsed(prev => !prev)}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                padding: '4px 10px',
                                                borderRadius: 6,
                                                border: '1px solid #cbd5e1',
                                                background: isCreateSowCollapsed ? '#eff6ff' : '#ffffff',
                                                color: isCreateSowCollapsed ? '#2563eb' : '#475569',
                                                cursor: 'pointer',
                                                fontSize: 12,
                                                fontWeight: 700,
                                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                            }}
                                        >
                                            {isCreateSowCollapsed ? (
                                                <>
                                                    <span style={{ fontSize: 14, fontWeight: 'bold' }}>+</span>
                                                    <span>Expand</span>
                                                </>
                                            ) : (
                                                <>
                                                    <span style={{ fontSize: 14, fontWeight: 'bold' }}>−</span>
                                                    <span>Collapse</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                    {isCreateSowCollapsed ? (
                                        <div
                                            onClick={() => setIsCreateSowCollapsed(false)}
                                            style={{
                                                padding: '12px 16px',
                                                borderRadius: 6,
                                                background: '#ffffff',
                                                border: '1.5px dashed #94a3b8',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                cursor: 'pointer',
                                                color: '#475569',
                                                fontSize: 12
                                            }}
                                        >
                                            <span>
                                                📦 <strong>{form.scopeOfWork.length}</strong> {form.trackingMode === 'seq' ? 'sequences' : 'SOW items'} configured 
                                                (Total: <strong style={{ color: Number((form.scopeOfWork || []).reduce((acc, curr) => acc + (Number(curr.percentage) || 0), 0).toFixed(2)) === 100 ? '#16a34a' : '#ef4444' }}>
                                                    {Number((form.scopeOfWork || []).reduce((acc, curr) => acc + (Number(curr.percentage) || 0), 0).toFixed(2))}%
                                                </strong>). Click to expand / edit.
                                            </span>
                                            <span style={{ color: '#2563eb', fontWeight: 700 }}>Show Details →</span>
                                        </div>
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        {form.scopeOfWork.map((item, idx) => (
                                            <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 6 }}>
                                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                    <div style={{ flex: 2 }}>
                                                        <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Name</label>
                                                        <input
                                                            className="form-control form-control-sm"
                                                            value={item.name}
                                                            onChange={(e) => {
                                                                const newSow = [...(form.scopeOfWork || [])];
                                                                newSow[idx] = { ...newSow[idx], name: e.target.value };
                                                                setForm({ ...form, scopeOfWork: newSow });
                                                            }}
                                                        />
                                                    </div>
                                                    <div style={{ flex: 1.8 }}>
                                                        <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Percentage of Total Work (%)</label>
                                                        <input
                                                            type="number"
                                                            className="form-control form-control-sm"
                                                            value={item.percentage || ''}
                                                            onChange={(e) => {
                                                                const newSow = [...(form.scopeOfWork || [])];
                                                                newSow[idx] = { ...newSow[idx], percentage: Number(e.target.value) };
                                                                setForm({ ...form, scopeOfWork: newSow });
                                                            }}
                                                        />
                                                    </div>
                                                    <div style={{ flex: 1.2 }}>
                                                        <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Approval (%)</label>
                                                        <input
                                                            type="number"
                                                            className="form-control form-control-sm"
                                                            value={item.approval || ''}
                                                            onChange={(e) => {
                                                                const newSow = [...(form.scopeOfWork || [])];
                                                                newSow[idx] = { ...newSow[idx], approval: Number(e.target.value) };
                                                                setForm({ ...form, scopeOfWork: newSow });
                                                            }}
                                                        />
                                                    </div>
                                                    <div style={{ flex: 1.2 }}>
                                                        <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Fabrication (%)</label>
                                                        <input
                                                            type="number"
                                                            className="form-control form-control-sm"
                                                            value={item.fabrication || ''}
                                                            onChange={(e) => {
                                                                const newSow = [...(form.scopeOfWork || [])];
                                                                newSow[idx] = { ...newSow[idx], fabrication: Number(e.target.value) };
                                                                setForm({ ...form, scopeOfWork: newSow });
                                                            }}
                                                        />
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const newSow = (form.scopeOfWork || []).filter((_, i) => i !== idx);
                                                            setForm({ ...form, scopeOfWork: newSow });
                                                        }}
                                                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4, marginTop: 14, fontSize: 14, fontWeight: 700 }}
                                                        title={`Remove ${form.trackingMode === 'seq' ? 'SEQ' : 'SOW'} item`}
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                                
                                                {/* Nested Sequences UI for SOW mode */}
                                                {form.trackingMode === 'sow' && (
                                                    <div style={{ marginTop: 8, padding: '10px', background: '#f1f5f9', borderRadius: 4, border: '1px dashed #cbd5e1' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                                            <span style={{ fontSize: 11, fontWeight: 600, color: '#334155' }}>Sequences for {item.name || `SOW ${idx + 1}`}</span>
                                                            <AddSeqInline 
                                                                onAdd={(count) => {
                                                                    const newSow = [...(form.scopeOfWork || [])];
                                                                    const currentSeqs = newSow[idx].sequences || [];
                                                                    
                                                                    let globalSeqCount = 1;
                                                                    for(let i=0; i<idx; i++) {
                                                                        globalSeqCount += (newSow[i].sequences?.length || 0);
                                                                    }
                                                                    globalSeqCount += currentSeqs.length;
                                                                    
                                                                    const today = new Date().toISOString().split('T')[0];
                                                                    const newSeqs = [];
                                                                    for(let i = 0; i < count; i++) {
                                                                        newSeqs.push({
                                                                            name: `SEQ${String(globalSeqCount + i).padStart(2, '0')}`,
                                                                            status: 'Not Completed',
                                                                            approvalDate: today,
                                                                            fabricationDate: ''
                                                                        });
                                                                    }
                                                                    
                                                                    newSow[idx] = { ...newSow[idx], sequences: [...currentSeqs, ...newSeqs] };
                                                                    setForm({ ...form, scopeOfWork: newSow });
                                                                }}
                                                            />
                                                        </div>
                                                        {(item.sequences && item.sequences.length > 0) ? (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                                {item.sequences.map((seq, seqIdx) => (
                                                                    <div key={seqIdx} style={{ display: 'flex', gap: 10, alignItems: 'center', paddingBottom: 6, borderBottom: '1px dashed #cbd5e1' }}>
                                                                        <div style={{ flex: 1 }}>
                                                                            <label className="form-label" style={{ fontSize: 10 }}>Sequence Name</label>
                                                                            <input
                                                                                className="form-control form-control-sm"
                                                                                value={seq.name}
                                                                                onChange={(e) => {
                                                                                    const newSow = [...(form.scopeOfWork || [])];
                                                                                    newSow[idx].sequences[seqIdx].name = e.target.value;
                                                                                    setForm({ ...form, scopeOfWork: newSow });
                                                                                }}
                                                                            />
                                                                        </div>
                                                                        <div style={{ flex: 1 }}>
                                                                            <label className="form-label" style={{ fontSize: 10 }}>Approval Date</label>
                                                                            <input
                                                                                className="form-control form-control-sm"
                                                                                type="date"
                                                                                value={seq.approvalDate ? String(seq.approvalDate).split('T')[0] : ''}
                                                                                onChange={(e) => {
                                                                                    const newSow = [...(form.scopeOfWork || [])];
                                                                                    newSow[idx].sequences[seqIdx].approvalDate = e.target.value;
                                                                                    setForm({ ...form, scopeOfWork: newSow });
                                                                                }}
                                                                            />
                                                                        </div>
                                                                        <div style={{ flex: 1 }}>
                                                                            <label className="form-label" style={{ fontSize: 10 }}>Fab Date</label>
                                                                            <input
                                                                                className="form-control form-control-sm"
                                                                                type="date"
                                                                                value={seq.fabricationDate ? String(seq.fabricationDate).split('T')[0] : ''}
                                                                                onChange={(e) => {
                                                                                    const newSow = [...(form.scopeOfWork || [])];
                                                                                    newSow[idx].sequences[seqIdx].fabricationDate = e.target.value;
                                                                                    setForm({ ...form, scopeOfWork: newSow });
                                                                                }}
                                                                            />
                                                                        </div>
                                                                        <span 
                                                                            style={{ cursor: 'pointer', color: '#ef4444', fontWeight: 'bold', marginTop: 22 }}
                                                                            onClick={() => {
                                                                                const newSow = [...(form.scopeOfWork || [])];
                                                                                newSow[idx].sequences = newSow[idx].sequences.filter((_, i) => i !== seqIdx);
                                                                                setForm({ ...form, scopeOfWork: newSow });
                                                                            }}
                                                                            title="Remove Sequence"
                                                                        >×</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', padding: '4px 0' }}>No sequences added.</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', paddingRight: 10 }}>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>
                                            Total Percentage: 
                                            <span style={{ 
                                                marginLeft: 8, 
                                                color: Number((form.scopeOfWork || []).reduce((acc, curr) => acc + (Number(curr.percentage) || 0), 0).toFixed(2)) === 100 ? '#16a34a' : '#ef4444' 
                                            }}>
                                                {Number((form.scopeOfWork || []).reduce((acc, curr) => acc + (Number(curr.percentage) || 0), 0).toFixed(2))}%
                                            </span>
                                        </div>
                                    </div>
                                    </>
                                )}
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label required">Location</label>
                                <select className="form-control" value={form.location}
                                    onChange={(e) => setForm({ ...form, location: e.target.value })}>
                                    <option value="">Select Location</option>
                                    <option value="Chennai">Chennai</option>
                                    <option value="Hosur">Hosur</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Initial Status</label>
                                <select className="form-control" value={form.status}
                                    onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>
                                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                                </select>
                            </div>

                            <div style={{ marginTop: 24, padding: '16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                                    Connection Design
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Vendor / Client Name</label>
                                    <input
                                        className="form-control"
                                        placeholder="Enter vendor details"
                                        list="client-list-create"
                                        value={form.connectionDesignVendor || ''}
                                        onChange={(e) => setForm({ ...form, connectionDesignVendor: e.target.value })}
                                    />
                                    <datalist id="client-list-create">
                                        {distinctVendors.map((v, i) => <option key={`vendor-${i}`} value={v} />)}
                                    </datalist>
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Contact Number</label>
                                    <input
                                        type="tel"
                                        className="form-control"
                                        placeholder="e.g., 9876543210"
                                        pattern="^[0-9]{10}$"
                                        maxLength={10}
                                        title="Please enter exactly 10 digits."
                                        value={form.connectionDesignContact || ''}
                                        onChange={(e) => {
                                            const onlyDigits = e.target.value.replace(/\D/g, '');
                                            setForm({ ...form, connectionDesignContact: onlyDigits });
                                        }}
                                    />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Email Address</label>
                                    <input
                                        type="email"
                                        className="form-control"
                                        placeholder="john@example.com"
                                        pattern="^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
                                        title="Please enter a valid email address."
                                        value={form.connectionDesignEmail || ''}
                                        onChange={(e) => setForm({ ...form, connectionDesignEmail: e.target.value })}
                                    />
                                </div>
                            </div>

                            {modalError && (
                                <div className="info-box danger mb-md" style={{ fontSize: 13, padding: '10px 14px' }}>
                                    {modalError}
                                </div>
                            )}

                            <div className="form-actions">
                                <button className="btn btn-secondary"
                                    onClick={() => { setShowCreate(false); setForm(DEFAULT_FORM); setError(''); setModalError(''); }}>Cancel</button>
                                <button className="btn btn-primary"
                                    onClick={() => {
                                        const missing: string[] = [];
                                        if (!form.clientId) missing.push('Client / Organization');
                                        const hasContact = (form.clientContactPersons && form.clientContactPersons.length > 0) || form.contactPerson;
                                        if (!hasContact) missing.push('Client Contact Person');
                                        if (!form.name.trim()) missing.push('Project Name');
                                        if (!form.year || isNaN(Number(form.year))) missing.push('Project Year');
                                        if (Number(form.year) <= 2026 && Number(form.year) >= 2000 && (form.lastTransmittalNumber === undefined || form.lastTransmittalNumber.toString().trim() === '')) {
                                            missing.push('Last Transmittal Number');
                                        }
                                        if (!form.location) missing.push('Location');
                                        if (!form.scopeOfWork || form.scopeOfWork.length === 0) missing.push(form.trackingMode === 'seq' ? 'Sequences' : 'Scope of Work');

                                        if (missing.length > 0) {
                                            const msgText = 'Please fill in the following required field(s):\n• ' + missing.join('\n• ');
                                            setModalError('');
                                            showMessage('Required Fields Missing', msgText, 'warning');
                                            return;
                                        }

                                        const rawSum = (form.scopeOfWork || []).reduce((acc, curr) => acc + (Number(curr.percentage) || 0), 0);
                                        const sumPercentage = Math.round(rawSum * 100) / 100;
                                        if (form.scopeOfWork && form.scopeOfWork.length > 0 && sumPercentage !== 100) {
                                            const msgText = `The sum of Percentage of Total Work (%) across all SOWs must equal exactly 100. Current sum is ${sumPercentage}.`;
                                            setModalError('');
                                            showMessage('Invalid Scope of Work', msgText, 'warning');
                                            return;
                                        }

                                        // All validations passed, proceed with creation
                                        handleCreate();
                                    }}
                                    disabled={actionLoading}
                                >
                                    {actionLoading ? 'Creating...' : 'Create Project'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Edit Modal ── */}
            {editTarget && (
                <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setEditTarget(null); setModalError(''); } }}>
                    <div className="modal modal-lg" style={{ maxWidth: '1050px', width: '95vw' }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">{editMode === 'sequences' ? `Manage Sequences: ${editTarget.name}` : 'Edit Project'}</span>
                            <button className="modal-close" onClick={() => { setEditTarget(null); setModalError(''); }}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            {editMode === 'full' && (
                                <>
                                    <div className="form-group">
                                        <label className="form-label required">Project Name</label>
                                        <input className="form-control" value={editTarget.name || ''}
                                            onChange={(e) => setEditTarget({ ...editTarget, name: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label required">Client Name</label>
                                        <select
                                            className="form-control"
                                            value={editTarget.clientName}
                                            onChange={(e) => {
                                                const selectedName = e.target.value;
                                                const selectedClient = clients.find(c => c.name === selectedName);
                                                setEditTarget({
                                                    ...editTarget,
                                                    clientName: selectedName,
                                                    clientId: selectedClient ? (selectedClient.id || selectedClient._id) : editTarget.clientId,
                                                    contactPerson: undefined,
                                                    clientContactPersons: []
                                                });
                                            }}
                                        >
                                            <option value="">Select a Client</option>
                                            {clients.map(c => (
                                                <option key={c.id || c._id} value={c.name}>{c.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {editTarget.clientId && (
                                        <div className="form-group">
                                            <label className="form-label required">Client Contact Person</label>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                                                {clients.find(c => (c.id || c._id) === editTarget.clientId)?.contacts.map((con, idx) => {
                                                    const isChecked = (editTarget.clientContactPersons || []).some(c => c.email === con.email) || editTarget.contactPerson?.email === con.email;
                                                    return (
                                                        <label
                                                            key={idx}
                                                            style={{
                                                                display: 'flex', alignItems: 'flex-start', gap: 10,
                                                                padding: '10px 14px', border: `1px solid ${isChecked ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                                                borderRadius: 6, cursor: 'pointer', background: isChecked ? 'var(--color-primary-light)' : '#fff',
                                                                transition: 'all 0.2s', margin: 0
                                                            }}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={isChecked}
                                                                onChange={(e) => {
                                                                    const current = editTarget.clientContactPersons || (editTarget.contactPerson ? [editTarget.contactPerson] : []);
                                                                    let updated: ClientContact[];
                                                                    if (e.target.checked) {
                                                                        updated = [...current, con];
                                                                    } else {
                                                                        updated = current.filter(c => c.email !== con.email);
                                                                    }
                                                                    setEditTarget({
                                                                        ...editTarget,
                                                                        clientContactPersons: updated,
                                                                        contactPerson: updated.length > 0 ? updated[0] : undefined
                                                                    });
                                                                }}
                                                                style={{ marginTop: 2, cursor: 'pointer' }}
                                                            />
                                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>{con.name}</span>
                                                                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                                                                    {con.email}{con.phone ? ` • ${con.phone}` : ''}{con.designation ? ` (${con.designation})` : ''}
                                                                </span>
                                                            </div>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Caldim Contact Person in Edit Modal */}
                                    <div className="form-group" style={{ marginTop: 12 }}>
                                        <label className="form-label" style={{ fontWeight: 700, fontSize: 13 }}>Caldim Contact Person</label>
                                        <div style={{ padding: '14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                                            <div>
                                                <label className="form-label" style={{ fontSize: 12, marginBottom: 4 }}>Project Manager</label>
                                                <select
                                                    className="form-control"
                                                    value={editTarget.caldimProjectManager || ''}
                                                    onChange={(e) => {
                                                        const pmId = e.target.value;
                                                        const pmUser = users.find(u => String(u.id || (u as any)._id) === pmId);
                                                        const teamOpts = getTeamOptionsForPm(pmId, users, teams);
                                                        const autoOpt = teamOpts.length === 1 ? teamOpts[0] : null;
                                                        setEditTarget({
                                                            ...editTarget,
                                                            caldimProjectManager: pmId,
                                                            caldimProjectManagerName: pmUser ? (pmUser.displayName || pmUser.username) : '',
                                                            caldimAssistantProjectManager: autoOpt && autoOpt.type === 'apm' ? autoOpt.id : '',
                                                            caldimAssistantProjectManagerName: autoOpt && autoOpt.type === 'apm' ? autoOpt.name : '',
                                                            caldimTeamLead: autoOpt && autoOpt.type === 'team_lead' ? autoOpt.id : '',
                                                            caldimTeamLeadName: autoOpt && autoOpt.type === 'team_lead' ? autoOpt.name : '',
                                                            teamId: autoOpt?.teamId || '',
                                                            teamName: autoOpt?.teamName || ''
                                                        });
                                                    }}
                                                >
                                                    <option value="">Select Project Manager</option>
                                                    {users.filter(u => u.role === 'project_manager').map(u => (
                                                        <option key={u.id || u._id} value={u.id || u._id}>
                                                            {u.displayName || u.username} ({u.email})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            {editTarget.caldimProjectManager && (() => {
                                                const teamOptions = getTeamOptionsForPm(editTarget.caldimProjectManager, users, teams);

                                                return (
                                                    <div style={{ marginTop: 4 }}>
                                                        <label className="form-label" style={{ fontSize: 12, marginBottom: 6 }}>
                                                            Assigned Team / APM or Team Lead
                                                        </label>
                                                        {teamOptions.length === 0 ? (
                                                            <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', padding: '8px 12px', background: '#f8fafc', borderRadius: 6, border: '1px dashed #cbd5e1' }}>
                                                                No Assistant Project Manager or Team Lead assigned under this Project Manager.
                                                            </div>
                                                        ) : (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                                {teamOptions.map((opt, idx) => {
                                                                    const isSelected = (opt.type === 'apm' && editTarget.caldimAssistantProjectManager === opt.id) ||
                                                                                       (opt.type === 'team_lead' && editTarget.caldimTeamLead === opt.id);
                                                                    return (
                                                                        <label
                                                                            key={`${opt.type}-${opt.id}-${opt.teamId || idx}`}
                                                                            style={{
                                                                                display: 'flex', alignItems: 'center', gap: 10,
                                                                                padding: '8px 12px', border: `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                                                                borderRadius: 6, cursor: 'pointer', background: isSelected ? 'var(--color-primary-light, #eff6ff)' : '#fff',
                                                                                transition: 'all 0.2s', margin: 0
                                                                            }}
                                                                        >
                                                                            <input
                                                                                type="radio"
                                                                                name="editCaldimTeamOptionRadio"
                                                                                checked={isSelected}
                                                                                onChange={() => {
                                                                                    if (opt.type === 'apm') {
                                                                                        setEditTarget({
                                                                                            ...editTarget,
                                                                                            caldimAssistantProjectManager: opt.id,
                                                                                            caldimAssistantProjectManagerName: opt.name,
                                                                                            caldimTeamLead: '',
                                                                                            caldimTeamLeadName: '',
                                                                                            teamId: opt.teamId || '',
                                                                                            teamName: opt.teamName || ''
                                                                                        });
                                                                                    } else {
                                                                                        setEditTarget({
                                                                                            ...editTarget,
                                                                                            caldimAssistantProjectManager: '',
                                                                                            caldimAssistantProjectManagerName: '',
                                                                                            caldimTeamLead: opt.id,
                                                                                            caldimTeamLeadName: opt.name,
                                                                                            teamId: opt.teamId || '',
                                                                                            teamName: opt.teamName || ''
                                                                                        });
                                                                                    }
                                                                                }}
                                                                                style={{ cursor: 'pointer' }}
                                                                            />
                                                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>
                                                                                    {opt.label}
                                                                                </span>
                                                                                {opt.email && (
                                                                                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                                                                        {opt.email}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </label>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Description</label>
                                        <textarea className="form-control" rows={3} value={editTarget.description || ''}
                                            onChange={(e) => setEditTarget({ ...editTarget, description: e.target.value })} />
                                    </div>
                                    {/* ── Scope of Work Builder (Edit Project) ── */}
                                    {/* ── Original Scope of Work Progress (Frozen) ── */}

                                    {editTarget.scopeOfWork && editTarget.scopeOfWork.length > 0 && (
                                        <div style={{ marginTop: 16, padding: '16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                    {editTarget.trackingMode === 'seq' ? 'Configure Sequence Progress' : 'Configure Scope of Work Progress'}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                                  {editTarget.scopeOfWork.map((item, idx) => (
                                                      <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 6 }}>
                                                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                              <div style={{ flex: 2 }}>
                                                                  <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Name</label>
                                                                  <input
                                                                      className="form-control form-control-sm"
                                                                      value={item.name}
                                                                      disabled={true}
                                                                      style={{ backgroundColor: '#f1f5f9', cursor: 'not-allowed' }}
                                                                      onChange={(e) => {
                                                                          const newSow = [...(editTarget.scopeOfWork || [])];
                                                                          newSow[idx].name = e.target.value;
                                                                          setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                      }}
                                                                  />
                                                              </div>
                                                              <div style={{ flex: 1.8 }}>
                                                                  <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Percentage of Total Work (%)</label>
                                                                  <input
                                                                      type="number"
                                                                      className="form-control form-control-sm"
                                                                      value={item.percentage || ''}
                                                                      onChange={(e) => {
                                                                          const newVal = Number(e.target.value);
                                                                          const newSow = [...(editTarget.scopeOfWork || [])];
                                                                          const oldVal = newSow[idx].percentage || 0;
                                                                          newSow[idx] = { ...newSow[idx], percentage: newVal };
                                                                          
                                                                          // Re-calculate other SOW percentages to maintain 100% total if needed
                                                                          // As per user request: if new is 20, old 100 should become 80.
                                                                          // Proportionally adjust the others so the sum becomes 100.
                                                                          let otherSum = 0;
                                                                          for(let i=0; i<newSow.length; i++) {
                                                                              if (i !== idx) otherSum += (newSow[i].percentage || 0);
                                                                          }
                                                                          if (otherSum > 0) {
                                                                              const targetOtherSum = 100 - newVal;
                                                                              for(let i=0; i<newSow.length; i++) {
                                                                                  if (i !== idx) {
                                                                                      newSow[i].percentage = Number(((newSow[i].percentage || 0) * (targetOtherSum / otherSum)).toFixed(2));
                                                                                  }
                                                                              }
                                                                          }

                                                                          setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                      }}
                                                                  />
                                                              </div>
                                                              <div style={{ flex: 1.2 }}>
                                                                  <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Approval (%)</label>
                                                                  <input
                                                                      type="number"
                                                                      className="form-control form-control-sm"
                                                                      value={item.approval || ''}
                                                                      min="0"
                                                                      max="100"
                                                                      onChange={(e) => {
                                                                          const newSow = [...(editTarget.scopeOfWork || [])];
                                                                          newSow[idx] = { ...newSow[idx], approval: Number(e.target.value) };
                                                                          setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                      }}
                                                                  />
                                                              </div>
                                                              <div style={{ flex: 1.2 }}>
                                                                  <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Fabrication (%)</label>
                                                                  <input
                                                                      type="number"
                                                                      className="form-control form-control-sm"
                                                                      value={item.fabrication || ''}
                                                                      min="0"
                                                                      max="100"
                                                                      onChange={(e) => {
                                                                          const newSow = [...(editTarget.scopeOfWork || [])];
                                                                          newSow[idx] = { ...newSow[idx], fabrication: Number(e.target.value) };
                                                                          setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                      }}
                                                                  />
                                                              </div>
                                                          </div>
                                                          
                                                          {/* Nested Sequences UI for SOW mode */}
                                                          {(!editTarget.trackingMode || editTarget.trackingMode === 'sow') && (
                                                              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
                                                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                                                      <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Sequences for {item.name || `SOW ${idx + 1}`}</span>
                                                                      <AddSeqInline 
                                                                          onAdd={(count) => {
                                                                              const newSow = [...(editTarget.scopeOfWork || [])];
                                                                              const currentSeqs = newSow[idx].sequences || [];
                                                                              
                                                                              let globalSeqCount = 1;
                                                                              for(let i=0; i<idx; i++) {
                                                                                  globalSeqCount += (newSow[i].sequences?.length || 0);
                                                                              }
                                                                              globalSeqCount += currentSeqs.length;
                                                                              
                                                                              const newSeqs = [];
                                                                              for(let i = 0; i < count; i++) {
                                                                                  newSeqs.push({ name: `SEQ${String(globalSeqCount + i).padStart(2, '0')}`, status: 'Not Completed', approvalDate: new Date().toISOString().split('T')[0], fabricationDate: '' });
                                                                              }
                                                                              
                                                                              newSow[idx] = { ...newSow[idx], sequences: [...currentSeqs, ...newSeqs] };
                                                                              setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                          }}
                                                                      />
                                                                  </div>
                                                                  {(item.sequences && item.sequences.length > 0) ? (
                                                                      <div style={{ overflowX: 'auto', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                                                                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                                                              <thead style={{ background: '#f8fafc' }}>
                                                                                  <tr>
                                                                                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>Sequence Name</th>
                                                                                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>Approval Date</th>
                                                                                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>Fab Date</th>
                                                                                      <th style={{ padding: '6px 10px', textAlign: 'center', width: 40, borderBottom: '1px solid #e2e8f0' }}></th>
                                                                                  </tr>
                                                                              </thead>
                                                                              <tbody>
                                                                                  {item.sequences?.map((seq: any, seqIdx: number) => (
                                                                                      <tr key={seqIdx} style={{ borderBottom: seqIdx === item.sequences!.length - 1 ? 'none' : '1px solid #f1f5f9' }}>
                                                                                          <td style={{ padding: '4px 10px' }}>
                                                                                              <input
                                                                                                  className="form-control form-control-sm"
                                                                                                  style={{ height: 26, fontSize: 11, background: 'transparent', border: '1px solid transparent' }}
                                                                                                  onFocus={(e) => e.target.style.border = '1px solid #cbd5e1'}
                                                                                                  onBlur={(e) => e.target.style.border = '1px solid transparent'}
                                                                                                  value={seq.name}
                                                                                                  onChange={(e) => {
                                                                                                      const newSow = [...(editTarget.scopeOfWork || [])];
                                                                                                      newSow[idx].sequences![seqIdx].name = e.target.value;
                                                                                                      setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                                                  }}
                                                                                              />
                                                                                          </td>
                                                                                          <td style={{ padding: '4px 10px' }}>
                                                                                              <input
                                                                                                  className="form-control form-control-sm"
                                                                                                  type="date"
                                                                                                  style={{ height: 26, fontSize: 11, background: 'transparent', border: '1px solid transparent' }}
                                                                                                  onFocus={(e) => e.target.style.border = '1px solid #cbd5e1'}
                                                                                                  onBlur={(e) => e.target.style.border = '1px solid transparent'}
                                                                                                  value={seq.approvalDate ? String(seq.approvalDate).split('T')[0] : ''}
                                                                                                  onChange={(e) => {
                                                                                                      const newSow = [...(editTarget.scopeOfWork || [])];
                                                                                                      newSow[idx].sequences![seqIdx].approvalDate = e.target.value;
                                                                                                      setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                                                  }}
                                                                                              />
                                                                                          </td>
                                                                                          <td style={{ padding: '4px 10px' }}>
                                                                                              <input
                                                                                                  className="form-control form-control-sm"
                                                                                                  type="date"
                                                                                                  style={{ height: 26, fontSize: 11, background: 'transparent', border: '1px solid transparent' }}
                                                                                                  onFocus={(e) => e.target.style.border = '1px solid #cbd5e1'}
                                                                                                  onBlur={(e) => e.target.style.border = '1px solid transparent'}
                                                                                                  value={seq.fabricationDate ? String(seq.fabricationDate).split('T')[0] : ''}
                                                                                                  onChange={(e) => {
                                                                                                      const newSow = [...(editTarget.scopeOfWork || [])];
                                                                                                      newSow[idx].sequences![seqIdx].fabricationDate = e.target.value;
                                                                                                      setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                                                  }}
                                                                                              />
                                                                                          </td>
                                                                                          <td style={{ padding: '4px 10px', textAlign: 'center' }}>
                                                                                              <span 
                                                                                                  style={{ cursor: 'pointer', color: '#ef4444', fontWeight: 'bold', fontSize: 14 }}
                                                                                                  onClick={() => {
                                                                                                      const newSow = [...(editTarget.scopeOfWork || [])];
                                                                                                      newSow[idx].sequences = newSow[idx].sequences!.filter((_: any, i: number) => i !== seqIdx);
                                                                                                      setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                                                  }}
                                                                                                  title="Remove Sequence"
                                                                                              >×</span>
                                                                                          </td>
                                                                                      </tr>
                                                                                  ))}
                                                                              </tbody>
                                                                          </table>
                                                                      </div>
                                                                  ) : (
                                                                      <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', padding: '4px 0' }}>No sequences added.</div>
                                                                  )}
                                                              </div>
                                                          )}
                                                      </div>
                                                  ))}
                                              </div>
                                              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', paddingRight: 10 }}>
                                                  <div style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>
                                                      Total Percentage: 
                                                      <span style={{ 
                                                          marginLeft: 8, 
                                                          color: Number((editTarget.scopeOfWork || []).reduce((acc, curr) => acc + (Number(curr.percentage) || 0), 0).toFixed(2)) === 100 ? '#16a34a' : '#ef4444' 
                                                      }}>
                                                          {Number((editTarget.scopeOfWork || []).reduce((acc, curr) => acc + (Number(curr.percentage) || 0), 0).toFixed(2))}%
                                                      </span>
                                                  </div>
                                              </div>
                                          </div>
                                      )}
                                    {/* ── Additional Scope of Work Builder (Edit Project) ── */}
                                    <div style={{ marginTop: 16, marginBottom: showAdditionalSowFields ? 0 : 20 }}>
                                        <button 
                                            type="button" 
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setShowAdditionalSowFields(!showAdditionalSowFields)}
                                        >
                                            {showAdditionalSowFields ? 'Hide Additional SOW Builder' : '+ Add Additional SOW'}
                                        </button>
                                    </div>

                                    {showAdditionalSowFields && (
                                        <div style={{ marginTop: 16, marginBottom: 20, display: 'flex', gap: '16px', background: '#f8fafc', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                                                <label className="form-label">Number of Additional SOWs</label>
                                                <input
                                                    className="form-control"
                                                    type="number"
                                                    placeholder="e.g. 2"
                                                    value={editSowInput}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setEditSowInput(val);
                                                        const originalCount = projects.find(p => p.id === editTarget.id)?.additionalScopeOfWork?.length || 0;
                                                        const { newRows, newOriginalSow } = generateAdditionalSowRows(val, editSowNameInput, editTarget.additionalScopeOfWork || [], editTarget.scopeOfWork || [], originalCount);
                                                        setEditTarget({ ...editTarget, additionalScopeOfWork: newRows, scopeOfWork: newOriginalSow });
                                                    }}
                                                />
                                            </div>
                                            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                                                <label className="form-label">Starting SOW Name</label>
                                                <input
                                                    className="form-control"
                                                    type="text"
                                                    placeholder="e.g. SOWLO1"
                                                    value={editSowNameInput}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setEditSowNameInput(val);
                                                        const originalCount = projects.find(p => p.id === editTarget.id)?.additionalScopeOfWork?.length || 0;
                                                        const { newRows, newOriginalSow } = generateAdditionalSowRows(editSowInput, val, editTarget.additionalScopeOfWork || [], editTarget.scopeOfWork || [], originalCount);
                                                        setEditTarget({ ...editTarget, additionalScopeOfWork: newRows, scopeOfWork: newOriginalSow });
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {editTarget.additionalScopeOfWork && editTarget.additionalScopeOfWork.length > 0 && (
                                        <div style={{ marginTop: 16, padding: '16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                    Configure Additional Scope of Work
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                                  {editTarget.additionalScopeOfWork.map((item, idx) => (
                                                      <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 6 }}>
                                                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                              <div style={{ flex: 2 }}>
                                                                  <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Name</label>
                                                                  <input
                                                                      className="form-control form-control-sm"
                                                                      value={item.name}
                                                                      disabled={true}
                                                                      style={{ backgroundColor: '#f1f5f9', cursor: 'not-allowed' }}
                                                                      onChange={(e) => {
                                                                          const newSow = [...(editTarget.additionalScopeOfWork || [])];
                                                                          newSow[idx] = { ...newSow[idx], name: e.target.value };
                                                                          setEditTarget({ ...editTarget, additionalScopeOfWork: newSow });
                                                                      }}
                                                                  />
                                                              </div>
                                                              <div style={{ flex: 1.8 }}>
                                                                  <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Percentage of Total Work (%)</label>
                                                                  <input
                                                                      type="number"
                                                                      className="form-control form-control-sm"
                                                                      value={item.percentage || ''}
                                                                      onChange={(e) => {
                                                                          const newSow = [...(editTarget.additionalScopeOfWork || [])];
                                                                          newSow[idx] = { ...newSow[idx], percentage: Number(e.target.value) };
                                                                          
                                                                          setEditTarget({ ...editTarget, additionalScopeOfWork: newSow });
                                                                      }}
                                                                  />
                                                              </div>
                                                              <div style={{ flex: 1.2 }}>
                                                                  <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Approval (%)</label>
                                                                  <input
                                                                      type="number"
                                                                      className="form-control form-control-sm"
                                                                      value={item.approval || ''}
                                                                      min="0"
                                                                      max="100"
                                                                      onChange={(e) => {
                                                                          const newSow = [...(editTarget.additionalScopeOfWork || [])];
                                                                          newSow[idx] = { ...newSow[idx], approval: Number(e.target.value) };
                                                                          setEditTarget({ ...editTarget, additionalScopeOfWork: newSow });
                                                                      }}
                                                                  />
                                                              </div>
                                                              <div style={{ flex: 1.2 }}>
                                                                  <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Fabrication (%)</label>
                                                                  <input
                                                                      type="number"
                                                                      className="form-control form-control-sm"
                                                                      value={item.fabrication || ''}
                                                                      min="0"
                                                                      max="100"
                                                                      onChange={(e) => {
                                                                          const newSow = [...(editTarget.additionalScopeOfWork || [])];
                                                                          newSow[idx] = { ...newSow[idx], fabrication: Number(e.target.value) };
                                                                          setEditTarget({ ...editTarget, additionalScopeOfWork: newSow });
                                                                      }}
                                                                  />
                                                              </div>
                                                          </div>
                                                          
                                                          {/* Nested Sequences UI for Additional SOW */}
                                                          {(!editTarget.trackingMode || editTarget.trackingMode === 'sow') && (
                                                              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
                                                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                                                      <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Sequences for {item.name || `Additional SOW ${idx + 1}`}</span>
                                                                      <AddSeqInline 
                                                                          onAdd={(count) => {
                                                                              const newSow = [...(editTarget.additionalScopeOfWork || [])];
                                                                              const currentSeqs = newSow[idx].sequences || [];
                                                                              
                                                                              let globalSeqCount = 1;
                                                                              // Count from main SOW
                                                                              for(let i=0; i<(editTarget.scopeOfWork?.length || 0); i++) {
                                                                                  globalSeqCount += (editTarget.scopeOfWork?.[i].sequences?.length || 0);
                                                                              }
                                                                              // Count from previous additional SOWs
                                                                              for(let i=0; i<idx; i++) {
                                                                                  globalSeqCount += (newSow[i].sequences?.length || 0);
                                                                              }
                                                                              globalSeqCount += currentSeqs.length;
                                                                              
                                                                              const newSeqs = [];
                                                                              for(let i = 0; i < count; i++) {
                                                                                  newSeqs.push({ name: `SEQ${String(globalSeqCount + i).padStart(2, '0')}`, status: 'Not Completed', approvalDate: new Date().toISOString().split('T')[0], fabricationDate: '' });
                                                                              }
                                                                              
                                                                              newSow[idx] = { ...newSow[idx], sequences: [...currentSeqs, ...newSeqs] };
                                                                              setEditTarget({ ...editTarget, additionalScopeOfWork: newSow });
                                                                          }}
                                                                      />
                                                                  </div>
                                                                  {(item.sequences && item.sequences.length > 0) ? (
                                                                      <div style={{ overflowX: 'auto', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                                                                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                                                              <thead style={{ background: '#f8fafc' }}>
                                                                                  <tr>
                                                                                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>Sequence Name</th>
                                                                                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>Approval Date</th>
                                                                                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>Fab Date</th>
                                                                                      <th style={{ padding: '6px 10px', textAlign: 'center', width: 40, borderBottom: '1px solid #e2e8f0' }}></th>
                                                                                  </tr>
                                                                              </thead>
                                                                              <tbody>
                                                                                  {item.sequences?.map((seq: any, seqIdx: number) => (
                                                                                      <tr key={seqIdx} style={{ borderBottom: seqIdx === item.sequences!.length - 1 ? 'none' : '1px solid #f1f5f9' }}>
                                                                                          <td style={{ padding: '4px 10px' }}>
                                                                                              <input
                                                                                                  className="form-control form-control-sm"
                                                                                                  style={{ height: 26, fontSize: 11, background: 'transparent', border: '1px solid transparent' }}
                                                                                                  onFocus={(e) => e.target.style.border = '1px solid #cbd5e1'}
                                                                                                  onBlur={(e) => e.target.style.border = '1px solid transparent'}
                                                                                                  value={seq.name}
                                                                                                  onChange={(e) => {
                                                                                                      const newSow = [...(editTarget.additionalScopeOfWork || [])];
                                                                                                      newSow[idx].sequences![seqIdx].name = e.target.value;
                                                                                                      setEditTarget({ ...editTarget, additionalScopeOfWork: newSow });
                                                                                                  }}
                                                                                              />
                                                                                          </td>
                                                                                          <td style={{ padding: '4px 10px' }}>
                                                                                              <input
                                                                                                  className="form-control form-control-sm"
                                                                                                  type="date"
                                                                                                  style={{ height: 26, fontSize: 11, background: 'transparent', border: '1px solid transparent' }}
                                                                                                  onFocus={(e) => e.target.style.border = '1px solid #cbd5e1'}
                                                                                                  onBlur={(e) => e.target.style.border = '1px solid transparent'}
                                                                                                  value={seq.approvalDate ? String(seq.approvalDate).split('T')[0] : ''}
                                                                                                  onChange={(e) => {
                                                                                                      const newSow = [...(editTarget.additionalScopeOfWork || [])];
                                                                                                      newSow[idx].sequences![seqIdx].approvalDate = e.target.value;
                                                                                                      setEditTarget({ ...editTarget, additionalScopeOfWork: newSow });
                                                                                                  }}
                                                                                              />
                                                                                          </td>
                                                                                          <td style={{ padding: '4px 10px' }}>
                                                                                              <input
                                                                                                  className="form-control form-control-sm"
                                                                                                  type="date"
                                                                                                  style={{ height: 26, fontSize: 11, background: 'transparent', border: '1px solid transparent' }}
                                                                                                  onFocus={(e) => e.target.style.border = '1px solid #cbd5e1'}
                                                                                                  onBlur={(e) => e.target.style.border = '1px solid transparent'}
                                                                                                  value={seq.fabricationDate ? String(seq.fabricationDate).split('T')[0] : ''}
                                                                                                  onChange={(e) => {
                                                                                                      const newSow = [...(editTarget.additionalScopeOfWork || [])];
                                                                                                      newSow[idx].sequences![seqIdx].fabricationDate = e.target.value;
                                                                                                      setEditTarget({ ...editTarget, additionalScopeOfWork: newSow });
                                                                                                  }}
                                                                                              />
                                                                                          </td>
                                                                                          <td style={{ padding: '4px 10px', textAlign: 'center' }}>
                                                                                              <span 
                                                                                                  style={{ cursor: 'pointer', color: '#ef4444', fontWeight: 'bold', fontSize: 14 }}
                                                                                                  onClick={() => {
                                                                                                      const newSow = [...(editTarget.additionalScopeOfWork || [])];
                                                                                                      newSow[idx].sequences = newSow[idx].sequences!.filter((_: any, i: number) => i !== seqIdx);
                                                                                                      setEditTarget({ ...editTarget, additionalScopeOfWork: newSow });
                                                                                                  }}
                                                                                                  title="Remove Sequence"
                                                                                              >×</span>
                                                                                          </td>
                                                                                      </tr>
                                                                                  ))}
                                                                              </tbody>
                                                                          </table>
                                                                      </div>
                                                                  ) : (
                                                                      <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', padding: '4px 0' }}>No sequences added.</div>
                                                                  )}
                                                              </div>
                                                          )}
                                                      </div>
                                                  ))}
                                              </div>
                                              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', paddingRight: 10 }}>
                                                  <div style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>
                                                      Total Percentage: 
                                                      <span style={{ 
                                                          marginLeft: 8, 
                                                          color: (editTarget.additionalScopeOfWork || []).reduce((acc, curr) => acc + (Number(curr.percentage) || 0), 0) === 100 ? '#16a34a' : '#ef4444' 
                                                      }}>
                                                          {(editTarget.additionalScopeOfWork || []).reduce((acc, curr) => acc + (Number(curr.percentage) || 0), 0)}%
                                                      </span>
                                                  </div>
                                              </div>
                                          </div>
                                      )}
                                    <div className="form-group">
                                        <label className="form-label">Location</label>
                                        <select className="form-control" value={editTarget.location || ''}
                                            onChange={(e) => setEditTarget({ ...editTarget, location: e.target.value })}>
                                            <option value="">Select Location</option>
                                            <option value="Chennai">Chennai</option>
                                            <option value="Hosur">Hosur</option>
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Status</label>
                                        <select className="form-control" value={editTarget.status || ''}
                                            onChange={(e) => setEditTarget({ ...editTarget, status: e.target.value as ProjectStatus })}>
                                            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                                        </select>
                                    </div>
                                    <div style={{ marginTop: 20, padding: '16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                                            Connection Design
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Vendor / Client Name</label>
                                            <input
                                                className="form-control"
                                                placeholder="Enter vendor details"
                                                list="client-list-edit"
                                                value={editTarget.connectionDesignVendor || ''}
                                                onChange={(e) => setEditTarget({ ...editTarget, connectionDesignVendor: e.target.value })}
                                            />
                                            <datalist id="client-list-edit">
                                                {distinctVendors.map((v, i) => <option key={`edit-vendor-${i}`} value={v} />)}
                                            </datalist>
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">Contact Number</label>
                                            <input
                                                type="tel"
                                                className="form-control"
                                                placeholder="e.g., 9876543210"
                                                pattern="^[0-9]{10}$"
                                                maxLength={10}
                                                title="Please enter exactly 10 digits."
                                                value={editTarget.connectionDesignContact || ''}
                                                onChange={(e) => {
                                                    const onlyDigits = e.target.value.replace(/\D/g, '');
                                                    setEditTarget({ ...editTarget, connectionDesignContact: onlyDigits });
                                                }}
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">Email Address</label>
                                            <input
                                                type="email"
                                                className="form-control"
                                                placeholder="john@example.com"
                                                pattern="^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
                                                title="Please enter a valid email address."
                                                value={editTarget.connectionDesignEmail || ''}
                                                onChange={(e) => setEditTarget({ ...editTarget, connectionDesignEmail: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </>
                            )}



                            {/* SOW Sequences Management (shows deadlines when managing sequences for SOW) */}
                            {editTarget.trackingMode === 'sow' && editMode === 'sequences' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    {(editTarget.scopeOfWork || []).map((sow, sowIdx) => (
                                        <div key={sowIdx} style={{ padding: '14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                                <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                                                    Sequences for {sow.name || `SOW ${sowIdx + 1}`}
                                                </span>
                                                <AddSeqInline 
                                                    onAdd={(count) => {
                                                        const newSow = [...(editTarget.scopeOfWork || [])];
                                                        const currentSeqs = newSow[sowIdx].sequences || [];
                                                        let globalSeqCount = 1;
                                                        for (let i = 0; i < sowIdx; i++) {
                                                            globalSeqCount += (newSow[i].sequences?.length || 0);
                                                        }
                                                        globalSeqCount += currentSeqs.length;
                                                        const newSeqs = [];
                                                        for (let i = 0; i < count; i++) {
                                                            newSeqs.push({ name: `SEQ${String(globalSeqCount + i).padStart(2, '0')}`, status: 'Not Completed', approvalDate: new Date().toISOString().split('T')[0], fabricationDate: '' });
                                                        }
                                                        newSow[sowIdx] = { ...newSow[sowIdx], sequences: [...currentSeqs, ...newSeqs] };
                                                        setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                    }}
                                                />
                                            </div>
                                            {sow.sequences && sow.sequences.length > 0 ? (
                                                <div style={{ overflowX: 'auto', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                                        <thead style={{ background: '#f1f5f9' }}>
                                                            <tr>
                                                                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>Sequence Name</th>
                                                                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>Approval Date</th>
                                                                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>Fab Date</th>
                                                                <th style={{ padding: '6px 10px', width: 40 }}></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {sow.sequences!.map((seq: any, seqIdx: number) => (
                                                                <tr key={seqIdx} style={{ borderBottom: seqIdx === sow.sequences!.length - 1 ? 'none' : '1px solid #f1f5f9' }}>
                                                                    <td style={{ padding: '4px 10px' }}>
                                                                        <input
                                                                            className="form-control form-control-sm"
                                                                            value={seq.name}
                                                                            onChange={(e) => {
                                                                                const newSow = [...(editTarget.scopeOfWork || [])];
                                                                                newSow[sowIdx].sequences![seqIdx].name = e.target.value;
                                                                                setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                            }}
                                                                        />
                                                                    </td>
                                                                    <td style={{ padding: '4px 10px' }}>
                                                                        <input
                                                                            className="form-control form-control-sm"
                                                                            type="date"
                                                                            value={seq.approvalDate ? String(seq.approvalDate).split('T')[0] : ''}
                                                                            onChange={(e) => {
                                                                                const newSow = [...(editTarget.scopeOfWork || [])];
                                                                                newSow[sowIdx].sequences![seqIdx].approvalDate = e.target.value;
                                                                                setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                            }}
                                                                        />
                                                                    </td>
                                                                    <td style={{ padding: '4px 10px' }}>
                                                                        <input
                                                                            className="form-control form-control-sm"
                                                                            type="date"
                                                                            value={seq.fabricationDate ? String(seq.fabricationDate).split('T')[0] : ''}
                                                                            onChange={(e) => {
                                                                                const newSow = [...(editTarget.scopeOfWork || [])];
                                                                                newSow[sowIdx].sequences![seqIdx].fabricationDate = e.target.value;
                                                                                setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                            }}
                                                                        />
                                                                    </td>
                                                                    <td style={{ padding: '4px 10px', textAlign: 'center' }}>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const newSow = [...(editTarget.scopeOfWork || [])];
                                                                                newSow[sowIdx].sequences = (newSow[sowIdx].sequences || []).filter((_: any, i: number) => i !== seqIdx);
                                                                                setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                            }}
                                                                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 700 }}
                                                                        >✕</button>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', padding: '4px 0' }}>No sequences added for this SOW.</div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {modalError && (
                                <div className="info-box danger mb-md" style={{ fontSize: 13, padding: '10px 14px' }}>
                                    {modalError}
                                </div>
                            )}
                            <div className="form-actions">
                                <button className="btn btn-secondary" disabled={actionLoading} onClick={() => { setEditTarget(null); setModalError(''); }}>Cancel</button>
                                <button
                                    className="btn btn-primary"
                                    disabled={actionLoading}
                                    onClick={handleEditSave}
                                >
                                    {actionLoading ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Delete Confirm ── */}
            {deleteTarget && (
                <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null) }}>
                    <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Confirm Deletion</span>
                            <button className="modal-close" onClick={() => setDeleteTarget(null)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <p className="confirm-dialog-text">
                                Are you sure you want to permanently delete project{' '}
                                <strong>"{deleteTarget.name}"</strong>? All associated drawings and user
                                assignments will be removed. This cannot be undone.
                            </p>
                            <div className="form-actions">
                                <button className="btn btn-secondary" disabled={actionLoading} onClick={() => setDeleteTarget(null)}>Cancel</button>
                                <button className="btn btn-danger btn-lg" disabled={actionLoading} onClick={() => handleDelete(deleteTarget.id)}>
                                    {actionLoading ? 'Deleting...' : 'Delete Project'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
