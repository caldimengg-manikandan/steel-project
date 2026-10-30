import { getProjectTargetSequences } from '../../utils/sequenceUtils';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getProjectById, updateProjectSequences, updateProjectScopeOfWork, updateProjectAdditionalScopeOfWork, updateProjectAllocations } from '../../services/projectApi';
import { useMessage } from '../../context/MessageContext';
import type { Project, ProjectPermission, User } from '../../types';
import { isFullAccessUser } from '../../types';
import { IconBack, IconUpload, IconClose } from '../../components/Icons';
import { uploadDrawing, listExtractions, checkDuplicates, reserveTransmittalNumber } from '../../services/extractionApi';
import { adminListUsers } from '../../services/adminUserApi';
import { adminListTeams, type Team } from '../../services/adminTeamApi';
import DrawingExtractionPanel from '../../components/DrawingExtractionPanel';
import { formatDate } from '../../utils/dateUtils';
import TransmittalPanel from '../../components/TransmittalPanel';
import { listTransmittals } from '../../services/transmittalApi';
import RfiExtractionPanel from '../../components/RfiPanel';
import FileBrowserPanel from '../../components/FileBrowserPanel';


export default function ProjectView() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { showMessage } = useMessage();
    const isAdmin = isFullAccessUser(user?.role);

    // DEBUG (Step 5): Log ID for troubleshooting
    useEffect(() => {
        console.log(`[ProjectView] URL Parameter 'id' is:`, id);
    }, [id]);

    const [project, setProject] = useState<Project | null>(null);
    const [allRevisions, setAllRevisions] = useState<any[]>([]); // Populated from Extractions
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<'dashboard' | 'revisions' | 'info' | 'extraction' | 'transmittals' | 'rfi' | 'storage' | 'weekly-report' | 'allocations'>('dashboard');
    const [uploadModal, setUploadModal] = useState(false);
    const [uploading, setUploading] = useState(false);
    // Duplicate detection state
    const [dupCheckLoading, setDupCheckLoading] = useState(false);
    const [dupModal, setDupModal] = useState(false);
    const [dupList, setDupList] = useState<Array<{ filename: string; sheetNumber: string; revision: string }>>([]);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    // Transmittal selection modal state
    const [transmittalSelectModal, setTransmittalSelectModal] = useState(false);
    const [existingTransmittals, setExistingTransmittals] = useState<any[]>([]);
    const [loadingTransmittals, setLoadingTransmittals] = useState(false);
    // null = "Create New Transmittal"; number = existing transmittal number
    const [selectedTransmittalNumber, setSelectedTransmittalNumber] = useState<number | null>(null);
    const [selectedSequences, setSelectedSequences] = useState<string[]>([]);
    const [uploadPurpose, setUploadPurpose] = useState<'Fabrication' | 'Approval'>('Fabrication');
    const [isSowDataVisible, setIsSowDataVisible] = useState<boolean>(true);

    // Allocations state
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [allTeams, setAllTeams] = useState<Team[]>([]);
    const [allocationsMap, setAllocationsMap] = useState<Record<string, { selected: boolean; permission?: 'viewer' | 'editor' }>>({});
    const [savingAllocations, setSavingAllocations] = useState(false);
    const [allocationSearch, setAllocationSearch] = useState('');
    const [allocationRoleFilter, setAllocationRoleFilter] = useState<'all' | 'team_member' | 'team_lead'>('all');

    useEffect(() => {
        Promise.all([
            adminListUsers().catch(() => ({ users: [] })),
            adminListTeams().catch(() => [])
        ]).then(([userData, teamsData]) => {
            setAllUsers(userData.users || []);
            setAllTeams(teamsData || []);
        }).catch(err => console.error('[ProjectView] Failed to load data for allocations:', err));
    }, []);

    useEffect(() => {
        if (!project) return;
        const initialMap: Record<string, { selected: boolean; permission?: 'viewer' | 'editor' }> = {};
        (allUsers || []).forEach(u => {
            const uid = String(u.id || u._id);
            const existing = (project.assignments || []).find(a => String(a.userId) === uid && (a.permission === 'viewer' || a.permission === 'editor'));
            initialMap[uid] = {
                selected: !!existing,
                permission: existing ? (existing.permission === 'editor' ? 'editor' : 'viewer') : undefined
            };
        });
        setAllocationsMap(initialMap);
    }, [project, allUsers]);

    const eligibleUsers = useMemo(() => {
        if (!project) return [];

        const getId = (val: any): string => {
            if (!val) return '';
            if (typeof val === 'string') return val.trim();
            return String(val._id || val.id || '').trim();
        };

        const getIds = (val: any): string[] => {
            if (!val) return [];
            if (Array.isArray(val)) {
                return val.map(getId).filter(Boolean);
            }
            const id = getId(val);
            return id ? [id] : [];
        };

        const projectTeamId = getId(project.teamId);
        const projectTeamName = project.teamName ? String(project.teamName).toLowerCase().trim() : '';
        const projectApmId = getId(project.caldimAssistantProjectManager);
        const projectTlId = getId(project.caldimTeamLead);
        const projectPmId = getId(project.caldimProjectManager);
        const creatorId = getId(project.createdByUserId || (project.assignments && project.assignments[0] ? project.assignments[0].userId : ''));

        // Check if the project creator is a PM, APM, or TL
        const creator = allUsers.find(u => getId(u) === creatorId);
        const effectivePmId = projectPmId || (creator?.role === 'project_manager' ? creatorId : '');
        const effectiveApmId = projectApmId || (creator?.role === 'assistant_project_manager' ? creatorId : '');
        const effectiveTlId = projectTlId || ((creator?.role === 'team_lead' || creator?.role === 'assistant_team_lead') ? creatorId : '');

        // Gather allowed user IDs for this project's team hierarchy
        const teamUserIds = new Set<string>();

        // Find all matched teams
        const matchedTeams = new Set<Team>();

        allTeams.forEach(t => {
            const tid = getId(t._id || t.id);
            const tname = String(t.name || '').toLowerCase().trim();
            const tPm = getId(t.project_manager);
            const tApm = getId(t.assistant_project_manager);
            const tLeads = getIds(t.lead);

            // 1. Matches team by ID or name
            if ((projectTeamId && tid === projectTeamId) || (projectTeamName && tname === projectTeamName)) {
                matchedTeams.add(t);
            }
            // 2. Matches project manager
            if (effectivePmId && tPm === effectivePmId) {
                matchedTeams.add(t);
            }
            // 3. Matches assistant project manager
            if (effectiveApmId && tApm === effectiveApmId) {
                matchedTeams.add(t);
            }
            // 4. Matches team lead
            if (effectiveTlId && tLeads.includes(effectiveTlId)) {
                matchedTeams.add(t);
            }
        });

        // Collect all members and leads from all matched teams
        matchedTeams.forEach(t => {
            const members = Array.isArray(t.members) ? t.members : (Array.isArray((t as any).users) ? (t as any).users : []);
            members.forEach((m: any) => {
                const mid = getId(m);
                if (mid) teamUserIds.add(mid);
            });

            const leads = Array.isArray(t.lead) ? t.lead : (t.lead ? [t.lead] : []);
            leads.forEach((l: any) => {
                const lid = getId(l);
                if (lid) teamUserIds.add(lid);
            });
        });

        // Include users reporting to effective TL directly
        if (effectiveTlId) {
            teamUserIds.add(effectiveTlId);
            allUsers.forEach(u => {
                const uLeads = getIds(u.team_lead);
                if (uLeads.includes(effectiveTlId)) {
                    teamUserIds.add(getId(u));
                }
            });
        }

        // Include users reporting to effective APM directly
        if (effectiveApmId) {
            allUsers.forEach(u => {
                if (getId(u.assistant_project_manager) === effectiveApmId) {
                    teamUserIds.add(getId(u));
                    getIds(u.team_lead).forEach(tlId => teamUserIds.add(tlId));
                }
            });
        }

        // Include users reporting to effective PM directly
        if (effectivePmId) {
            allUsers.forEach(u => {
                if (getId(u.project_manager) === effectivePmId) {
                    teamUserIds.add(getId(u));
                    getIds(u.team_lead).forEach(tlId => teamUserIds.add(tlId));
                }
            });
        }

        // Include users explicitly assigned to the team by ID
        if (projectTeamId) {
            allUsers.forEach(u => {
                const uTeamId = getId((u as any).team);
                if (uTeamId === projectTeamId) {
                    teamUserIds.add(getId(u));
                }
            });
        }

        // Full bidirectional closure across APM, PM, TL, and Teams
        let changed = true;
        while (changed) {
            const prevSize = teamUserIds.size;

            // For any user in teamUserIds, include their team leads
            allUsers.forEach(u => {
                if (teamUserIds.has(getId(u))) {
                    getIds(u.team_lead).forEach(tlId => teamUserIds.add(tlId));
                }
            });

            // For any team lead in teamUserIds, include all members reporting to that lead
            const currentLeadIds = new Set<string>();
            teamUserIds.forEach(uid => {
                const u = allUsers.find(usr => getId(usr) === uid);
                if (u && (u.role === 'team_lead' || u.role === 'assistant_team_lead')) {
                    currentLeadIds.add(uid);
                }
            });
            if (currentLeadIds.size > 0) {
                allUsers.forEach(u => {
                    const uLeads = getIds(u.team_lead);
                    if (uLeads.some(lid => currentLeadIds.has(lid))) {
                        teamUserIds.add(getId(u));
                    }
                });
            }

            // For any team containing ANY user in teamUserIds, include all its members and leads
            allTeams.forEach(t => {
                const tMembers = (Array.isArray(t.members) ? t.members : (Array.isArray((t as any).users) ? (t as any).users : [])).map(getId);
                const tLeads = (Array.isArray(t.lead) ? t.lead : (t.lead ? [t.lead] : [])).map(getId);
                const allTUsers = [...tMembers, ...tLeads];
                if (allTUsers.some(uid => teamUserIds.has(uid))) {
                    allTUsers.forEach(uid => teamUserIds.add(uid));
                }
            });

            changed = teamUserIds.size > prevSize;
        }

        return allUsers.filter(u => {
            const uid = getId(u);
            const r = u.role;

            // 1. Only team members and team leads can be allocated (excludes PMs, APMs, Admins)
            const isRoleEligible = r === 'team_member' || r === 'team_lead' || r === 'assistant_team_lead';
            if (!isRoleEligible) return false;

            // 2. Never show the creator of the project ("other than who created the project")
            if (creatorId && uid === creatorId) return false;

            // 3. Never show managing PM or managing APM as an allocatable team member/lead
            if (effectivePmId && uid === effectivePmId) return false;
            if (effectiveApmId && uid === effectiveApmId) return false;

            // 4. If team hierarchy was identified, restrict to those users
            if (teamUserIds.size > 0) {
                return teamUserIds.has(uid);
            }

            // Fallback if no team/PM/APM/TL at all: show all eligible team members/leads
            return true;
        });
    }, [allUsers, allTeams, project]);

    const displayedUsers = useMemo(() => {
        return eligibleUsers.filter(u => {
            if (allocationRoleFilter === 'team_member' && u.role !== 'team_member') return false;
            if (allocationRoleFilter === 'team_lead' && u.role !== 'team_lead' && u.role !== 'assistant_team_lead') return false;
            if (allocationSearch.trim()) {
                const q = allocationSearch.toLowerCase();
                const matchName = (u.displayName || '').toLowerCase().includes(q);
                const matchUser = (u.username || '').toLowerCase().includes(q);
                const matchEmail = (u.email || '').toLowerCase().includes(q);
                const matchDiv = (u.division || '').toLowerCase().includes(q);
                return matchName || matchUser || matchEmail || matchDiv;
            }
            return true;
        });
    }, [eligibleUsers, allocationRoleFilter, allocationSearch]);

    const handleSaveAllocations = async () => {
        if (!project) return;
        try {
            setSavingAllocations(true);
            const projectId = String(project._id || project.id);
            const payload = Object.entries(allocationsMap)
                .filter(([_, data]) => data.selected)
                .map(([userId, data]) => {
                    const usr = allUsers.find(u => String(u.id || u._id) === userId);
                    return {
                        userId,
                        username: usr?.displayName || usr?.username || 'User',
                        permission: (data.permission || 'editor') as 'viewer' | 'editor',
                    };
                });

            const res = await updateProjectAllocations(projectId, payload);
            if (res && res.project) {
                setProject(res.project);
            }
            showMessage('Allocations Saved', `Successfully updated project allocations (${payload.length} assigned).`, 'success');
        } catch (err: any) {
            showMessage('Allocation Failed', err.message || 'Failed to save allocations.', 'error');
        } finally {
            setSavingAllocations(false);
        }
    };

    const fetchData = useCallback(async (isSilent = false) => {
        if (!id || id === 'undefined' || id.length < 5) {
            console.error(`[ProjectView] Bailing fetch due to invalid ID:`, id);
            setError(`Project ID is invalid or missing (Received: "${id}").`);
            setLoading(false);
            return;
        }

        try {
            if (!isSilent) setLoading(true);
            const [projData, extData] = await Promise.all([
                getProjectById(id),
                listExtractions(id)
            ]);

            setProject(projData.project);

            // Step 1: Pre-scan to group all revisions per drawing to determine "Only Fab" status
            const drawingMarksMap: Record<string, Set<string>> = {};
            const completed = extData.extractions.filter((ex: any) => ex.status === 'completed');

            completed.forEach((ex: any) => {
                const sNo = ex.extractedFields.drawingNumber || 'Extracted';
                if (!drawingMarksMap[sNo]) drawingMarksMap[sNo] = new Set();

                const hist = Array.isArray(ex.extractedFields.revisionHistory) && ex.extractedFields.revisionHistory.length > 0
                    ? ex.extractedFields.revisionHistory
                    : [{ mark: ex.extractedFields.revision }];

                hist.forEach((h: any) => {
                    if (h.mark != null && h.mark !== '') {
                        drawingMarksMap[sNo].add(String(h.mark).trim().toUpperCase());
                    }
                });
            });

            // Step 2: Populate revision rows with the "isOnlyFab" flag
            const revs: any[] = [];
            completed.forEach((ex: any) => {
                const sheetNo = ex.extractedFields.drawingNumber || 'Extracted';
                const uploadedBy = ex.uploadedBy;

                // "Only Fabrication" = No alphabetic revision marks exist for this sheet number
                const marks = Array.from(drawingMarksMap[sheetNo] || []);
                const hasApproval = marks.some(m => /^[A-Z]/.test(m));
                const isOnlyFab = marks.length > 0 && !hasApproval;

                const history = Array.isArray(ex.extractedFields.revisionHistory) && ex.extractedFields.revisionHistory.length > 0
                    ? ex.extractedFields.revisionHistory
                    : [{ mark: ex.extractedFields.revision, date: ex.extractedFields.date, remarks: ex.extractedFields.remarks }];

                history.forEach((h: any, i: number) => {
                    if (h.mark !== undefined && h.mark !== null && h.mark !== '') {
                        revs.push({
                            id: `${ex._id}-${i}`,
                            sheetNo,
                            revMark: h.mark,
                            date: h.date || '-',
                            description: ex.extractedFields.drawingTitle || ex.extractedFields.drawingDescription || `[No Title] ${ex.originalFileName}`,
                            revisedBy: uploadedBy,
                            isOnlyFab
                        });
                    }
                });
            });
            setAllRevisions(revs);

        } catch (err: any) {
            setError(err.message || 'Failed to load project details');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const derivedSequences = useMemo(() => {
        return getProjectTargetSequences(project);
    }, [project]);

    // ── Reusable upload helper ────────────────────────────────
    const doUpload = async (filesToUpload: File[]) => {
        const pId = project?._id || project?.id;
        if (!pId) {
            console.error("[ProjectView] Cannot upload: No valid project ID found in state.", project);
            return;
        }

        // Sequence Validation
        if (derivedSequences.length > 0 && selectedSequences.length === 0) {
            showMessage('Sequence Required', 'Please select at least one Sequence before uploading.', 'error');
            return;
        }

        setUploading(true);
        try {
            let numToUse = selectedTransmittalNumber;
            if (numToUse === null) {
                const res = await reserveTransmittalNumber(pId);
                numToUse = res.transmittalNumber;
            }
            const res = await uploadDrawing(pId, filesToUpload, '', numToUse, selectedSequences, uploadPurpose);
            showMessage('Success', res.message, 'success');
            setUploadModal(false);
            setDupModal(false);
            setDupList([]);
            setPendingFiles([]);
            setSelectedSequences([]);
            fetchData();
            setActiveTab('extraction');
        } catch (err: any) {
            showMessage('Upload Failed', err.message, 'error');
        } finally {
            setUploading(false);
        }
    };

    // ── Open transmittal selector before showing the upload modal ──
    const handleUploadButtonClick = async () => {
        const pId = project?._id || project?.id;
        if (!pId) return;
        setLoadingTransmittals(true);
        try {
            const data = await listTransmittals(pId);
            setExistingTransmittals(data.transmittals || []);
        } catch {
            setExistingTransmittals([]);
        } finally {
            setLoadingTransmittals(false);
        }
        // Default selection: "Create New" when none exist, else first transmittal
        setSelectedTransmittalNumber(null);
        setTransmittalSelectModal(true);
    };

    if (loading) {
        return (
            <div className="text-center py-xl" style={{ marginTop: 100 }}>
                <div className="spinner mb-md"></div>
                <p className="text-muted">Loading project details...</p>
            </div>
        );
    }

    if (error || !project) {
        return (
            <div className="empty-state" style={{ marginTop: 60 }}>
                <div className="info-box danger mb-md">{error || 'Project not found.'}</div>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>Go Back</button>
            </div>
        );
    }

    const assignment = project.assignments?.find((a) => a.userId === user?.id);
    const permission: ProjectPermission = isAdmin ? 'admin' : (assignment?.permission as ProjectPermission ?? 'viewer');
    const canUpload = permission === 'editor' || permission === 'admin';

    const STATUS_LABEL: Record<string, string> = { active: 'Active', on_hold: 'On Hold', completed: 'Completed', archived: 'Archived' };
    const STATUS_CLS: Record<string, string> = { active: 'badge-success', in_progress: 'badge-success', on_hold: 'badge-danger', completed: 'badge-info', archived: 'badge-warning' };

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

    /** Format any ISO/UTC date string to IST (Asia/Kolkata) */
    function toIST(raw: string) {
        if (!raw) return '-';
        try {
            return new Date(raw).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
            });
        } catch {
            return raw;
        }
    }

    /** Format creation date or ISO string to friendly display without timezone offset errors */
    function formatCreationDate(creationDate?: string, rawFallback?: string) {
        if (creationDate) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(creationDate)) {
                const [y, m, d] = creationDate.split('-').map(Number);
                return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                });
            }
            try {
                return new Date(creationDate).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                });
            } catch {
                return creationDate;
            }
        }
        return toIST(rawFallback || '');
    }

    const assignedUsers = project?.assignments?.filter(a => a.permission !== 'admin') || [];
    const creatorName = project?.createdByUsername || project?.createdBy || (project?.assignments?.find(a => a.permission === 'admin')?.username) || '';

    return (
        <div>
            {/* Project Header */}
            <div className="project-header-bar">
                <div className="project-header-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <button
                            className="btn btn-ghost btn-sm btn-icon"
                            onClick={() => navigate(-1)}
                            title="Back"
                        >
                            <IconBack />
                        </button>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <h2 className="project-name-heading">{project.name}</h2>
                            <span className={`badge ${getBadgeClass(project.rawStatus || STATUS_LABEL[project.status] || project.status)}`}>
                                {formatBadgeText(project.rawStatus || STATUS_LABEL[project.status] || project.status)}
                            </span>
                        </div>
                    </div>
                    <div className="project-meta-row">
                        <div className="project-meta-item">
                            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M2 14V4l6-2 6 2v10H2z" /></svg>
                            Client: <strong style={{ color: 'var(--color-text-primary)' }}>{project.clientName}</strong>
                        </div>
                        <div className="project-meta-item">
                            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M8 1a4 4 0 100 8A4 4 0 008 1zm0 9c-3 0-6 1.3-6 3v1h12v-1c0-1.7-3-3-6-3z" /></svg>
                            Assigned: {assignedUsers.length} user{assignedUsers.length !== 1 ? 's' : ''}
                        </div>
                        <div className="project-meta-item">
                            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><rect x="1" y="3" width="14" height="12" rx="1" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.2" /><path d="M5 1v3M11 1v3M1 7h14" stroke="currentColor" strokeWidth="1.2" /></svg>
                            Updated: {toIST(project.updatedAt)}
                        </div>
                        {creatorName && (
                            <div className="project-meta-item">
                                <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M8 1a4 4 0 100 8A4 4 0 008 1zm0 9c-3 0-6 1.3-6 3v1h12v-1c0-1.7-3-3-6-3z" /></svg>
                                Created by: <strong style={{ color: 'var(--color-text-primary)' }}>{creatorName}</strong>
                            </div>
                        )}
                        <div className="project-meta-item">
                            <span className={`role-chip ${permission}`}>{permission.charAt(0).toUpperCase() + permission.slice(1)}</span>
                        </div>
                    </div>
                </div>
            </div>


            {/* Tabs */}
            <div className="tab-bar">
                {(['dashboard', 'storage', 'transmittals', 'extraction', 'info', 'allocations'] as const).map((tab) => (
                    <button
                        key={tab}
                        className={`tab-item${activeTab === tab ? ' active' : ''}`}
                        onClick={() => setActiveTab(tab)}
                    >
                        {tab === 'dashboard' && '📊 Dashboard'}
                        {tab === 'storage' && '📁 Storage'}
                        {tab === 'transmittals' && 'Transmittals & Log'}
                        {tab === 'extraction' && 'Extraction'}
                        {tab === 'info' && 'Project Info'}
                        {tab === 'allocations' && '👥 Allocations'}
                    </button>
                ))}
            </div>

            {/* ── Dashboard Tab ── */}
            {activeTab === 'dashboard' && (() => {
                const fabCount = (project as any).fabricationCount || 0;
                const appCount = (project as any).approvalCount || 0;
                const openRfi = project.openRfiCount || 0;
                const closedRfi = project.closedRfiCount || 0;
                const seqs = project.sequences || [];
                const seqTotal = seqs.length;
                const seqDone = seqs.filter((s: any) => s.status === 'Completed').length;
                const seqPct = seqTotal > 0 ? Math.round((seqDone / seqTotal) * 100) : 0;
                const fabPct = project.fabricationPercentage !== undefined ? project.fabricationPercentage : 0;
                const appPct = project.approvalPercentage !== undefined ? project.approvalPercentage : 0;

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 32 }}>

                        {/* ── KPI row — reuse the app's stat-card class ── */}
                        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5,1fr)', marginBottom: 0 }}>

                            {/* Fabrication */}
                            <div className="stat-card accent-green">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div className="stat-card-label">Fabrication</div>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-success-mid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
                                    </div>
                                </div>
                                <div className="stat-card-value">{fabCount}</div>
                            </div>

                            {/* Approval */}
                            <div className="stat-card accent-blue">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div className="stat-card-label">Approval</div>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-info-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-info-mid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                                    </div>
                                </div>
                                <div className="stat-card-value">{appCount}</div>
                            </div>

                            {/* Open RFIs */}
                            <div className="stat-card accent-slate" style={{ '--before-bg': 'var(--color-danger-mid)' } as any}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div className="stat-card-label">Open RFIs</div>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-danger-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger-mid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                                    </div>
                                </div>
                                <div className="stat-card-value" style={{ color: openRfi > 0 ? 'var(--color-danger-mid)' : 'var(--color-text-primary)' }}>{openRfi}</div>
                            </div>

                            {/* Closed RFIs */}
                            <div className="stat-card accent-green" style={{ '--stat-accent': 'var(--color-success-mid)' } as any}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div className="stat-card-label">Closed RFIs</div>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-success-mid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                    </div>
                                </div>
                                <div className="stat-card-value" style={{ color: 'var(--color-success-mid)' }}>{closedRfi}</div>
                            </div>

                            {/* Sequences */}
                            <div className="stat-card accent-violet">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div className="stat-card-label">Sequences</div>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(124,58,237,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                                    </div>
                                </div>
                                <div className="stat-card-value" style={{ color: 'var(--accent-violet)' }}>{seqDone}<span style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: 0 }}>/{seqTotal}</span></div>
                            </div>
                        </div>

                        {/* ── Bottom two-column section ── */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

                            {/* Progress panel */}
                            <div className="card">
                                <div className="card-header">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                                        <span className="card-header-title">Progress Overview</span>
                                    </div>
                                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>Approval · Fabrication</span>
                                </div>
                                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                                    {[
                                        { label: 'Approval', pct: appPct, count: appCount, color: 'var(--color-info-mid)', bg: 'var(--color-info-bg)', barBg: 'rgba(37,99,235,0.12)' },
                                        { label: 'Fabrication', pct: fabPct, count: fabCount, color: 'var(--color-success-mid)', bg: 'var(--color-success-bg)', barBg: 'rgba(22,163,74,0.15)' },
                                    ].map(({ label, pct, count, color, bg, barBg }) => (
                                        <div key={label}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{label}</span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{count} drawings</span>
                                                    <span style={{ fontSize: 12, fontWeight: 700, color, background: bg, padding: '2px 9px', borderRadius: 99, border: `1px solid ${color}22` }}>{pct}%</span>
                                                </div>
                                            </div>
                                            <div style={{ height: 7, background: barBg, borderRadius: 99, overflow: 'hidden' }}>
                                                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.8s ease' }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Right column: Sequences + COR */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                                {/* Sequences list */}
                                <div className="card" style={{ flex: 1 }}>
                                    <div className="card-header">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-violet)" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                                            <span className="card-header-title">Sequences</span>
                                        </div>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-violet)', background: 'rgba(124,58,237,0.1)', padding: '2px 10px', borderRadius: 99 }}>{seqDone}/{seqTotal} done · {seqPct}%</span>
                                    </div>
                                    <div className="card-body" style={{ padding: 'var(--space-md)' }}>
                                        {seqTotal === 0 ? (
                                            <div className="table-empty" style={{ padding: '24px 0' }}>No sequences defined for this project.</div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                {seqs.map((seq: any, idx: number) => {
                                                    const done = seq.status === 'Completed';
                                                    return (
                                                        <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 'var(--radius-md)', background: done ? 'var(--color-success-bg)' : 'var(--color-bg-page)', border: `1px solid ${done ? 'var(--color-success-bg)' : 'var(--color-border-light)'}` }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                <div style={{ width: 7, height: 7, borderRadius: '50%', background: done ? 'var(--color-success-mid)' : 'var(--color-border)', flexShrink: 0 }} />
                                                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{seq.name}</span>
                                                            </div>
                                                            <span className={`badge ${done ? 'badge-success' : 'badge-neutral'}`}>{done ? '✓ Complete' : 'Pending'}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* COR placeholder or External COR Status */}
                                <div className="card" style={{ border: project.corStatus ? '1px solid var(--color-border)' : '1.5px dashed var(--color-border)', flexShrink: 0 }}>
                                    <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px var(--space-lg)' }}>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-lg)', background: project.corStatus ? 'var(--color-success-bg)' : 'var(--color-warning-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={project.corStatus ? 'var(--color-success-mid)' : 'var(--color-warning-mid)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                                            </div>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 3 }}>Change Orders (COR)</div>
                                            {project.corStatus ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                                        Total COR Items: <strong style={{ color: 'var(--color-text-primary)' }}>{project.corStatus.totalCORItems || 0}</strong>
                                                        {project.corStatus.totalAmount !== undefined && (
                                                            <span style={{ marginLeft: 10, color: 'var(--color-text-muted)' }}>
                                                                Total Amount: <strong style={{ color: 'var(--color-text-primary)' }}>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(project.corStatus.totalAmount)}</strong>
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                                                        {Object.entries(project.corStatus.statusSummary || {}).map(([status, val]) => {
                                                            if ((val as number) === 0) return null;
                                                            const amt = project.corStatus?.statusAmounts?.[status];
                                                            return (
                                                                <span key={status} className="badge badge-neutral" style={{ fontSize: 10, padding: '3px 8px', background: 'var(--color-bg-page)', border: '1px solid var(--color-border-light)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                                    <span style={{ fontWeight: 600 }}>{status}: {val as number}</span>
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                    {project.corStatus.items && project.corStatus.items.length > 0 && (
                                                        <div style={{ marginTop: 12, borderTop: '1px solid var(--color-border-light)', paddingTop: 10 }}>
                                                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6, letterSpacing: '0.5px' }}>Individual Change Orders</div>
                                                            <div className="table-wrapper" style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)' }}>
                                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                                                    <thead>
                                                                        <tr style={{ background: 'var(--color-bg-alt)', textAlign: 'left', borderBottom: '1px solid var(--color-border-light)' }}>
                                                                            <th style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>COR #</th>
                                                                            <th style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Amount</th>
                                                                            <th style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Status</th>
                                                                            <th style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Acceptance Date</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {project.corStatus.items.map((item, idx) => (
                                                                            <tr key={idx} style={{ borderBottom: idx === project.corStatus!.items!.length - 1 ? 'none' : '1px solid var(--color-border-light)' }}>
                                                                                <td style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--color-primary)' }}>{item.corNumber}</td>
                                                                                <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>
                                                                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(item.amount)}
                                                                                </td>
                                                                                <td style={{ padding: '6px 10px' }}>
                                                                                    <span className={`badge ${
                                                                                        item.status.toLowerCase() === 'approved' ? 'badge-success' : 
                                                                                        item.status.toLowerCase() === 'pending' || item.status.toLowerCase() === 'submitted' ? 'badge-info' : 
                                                                                        'badge-neutral'
                                                                                    }`} style={{ fontSize: 10, padding: '2px 6px' }}>
                                                                                        {item.status}
                                                                                    </span>
                                                                                </td>
                                                                                <td style={{ padding: '6px 10px', color: 'var(--color-text-muted)' }}>
                                                                                    {item.date ? new Date(item.date).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '-'}
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.55 }}>COR tracking coming soon — requirements will be configured here.</div>
                                            )}
                                        </div>
                                        <span className={`badge ${project.corStatus ? 'badge-success' : 'badge-warning'}`} style={{ flexShrink: 0, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                                            {project.corStatus ? 'Active' : 'Coming Soon'}
                                        </span>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* ── Storage Tab ── */}
            {activeTab === 'storage' && (
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                    <FileBrowserPanel
                        projectId={(project?._id || project?.id) as string}
                        projectName={project.name}
                        canUpload={canUpload}
                        sequences={derivedSequences.map((s: any) => s.name || s)}
                    />
                </div>
            )}

            {/* ── AI Extraction Tab ── */}
            {activeTab === 'extraction' && (
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                    <DrawingExtractionPanel
                        projectId={(project?._id || project?.id) as string}
                        canUpload={canUpload}
                        sequences={derivedSequences}
                        project={project}
                        projectYear={project.year}
                        startingTransmittalNumber={project.startingTransmittalNumber}
                    />
                </div>
            )}

            {/* ── RFI Tab ── */}
            {activeTab === 'rfi' && (
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                    <RfiExtractionPanel
                        projectId={(project?._id || project?.id) as string}
                        projectName={project.name}
                        canUpload={canUpload}
                        sequences={derivedSequences}
                    />
                </div>
            )}

            {activeTab === 'transmittals' && (
                <TransmittalPanel projectId={(project?._id || project?.id) as string} canEdit={canUpload} sequences={derivedSequences} />
            )}

            {/* ── Revision History Tab ── */}
            {activeTab === 'revisions' && (
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Sheet No.</th>
                                <th>Rev Mark</th>
                                <th>Date</th>
                                <th>Description</th>
                                <th>Revised By</th>
                            </tr>
                        </thead>
                        <tbody>
                            {allRevisions.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="table-empty">No revision history found.</td>
                                </tr>
                            ) : (
                                allRevisions.map((r) => (
                                    <tr key={r.id}>
                                        <td className="font-mono" style={{ fontWeight: 600 }}>{r.sheetNo}</td>
                                        <td style={r.isOnlyFab ? { background: '#f1f1f9', fontWeight: 700 } : {}}>
                                            <span className={`role-chip ${r.isOnlyFab ? 'archived' : 'viewer'}`}>
                                                {r.revMark}
                                            </span>
                                        </td>
                                        <td className="text-muted">{r.date}</td>
                                        <td>{r.description}</td>
                                        <td className="text-muted">{r.revisedBy}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ── Project Info Tab ── */}
            {activeTab === 'info' && (
                <div className="card">
                    <div className="card-body">
                        <div className="form-row" style={{ marginBottom: 'var(--space-md)' }}>
                            <div>
                                <div className="form-label" style={{ marginBottom: 4 }}>Project Name</div>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>{project.name}</div>
                            </div>
                            <div>
                                <div className="form-label" style={{ marginBottom: 4 }}>Client Name</div>
                                <div style={{ fontSize: 14 }}>{project.clientName}</div>
                            </div>
                        </div>
                        <div className="form-row" style={{ marginBottom: 'var(--space-md)' }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span className="font-mono text-xs font-bold" style={{ color: 'var(--color-text-secondary)' }}>STATUS</span>
                                    <span className={`badge ${getBadgeClass(project.rawStatus || STATUS_LABEL[project.status] || project.status)}`}>{formatBadgeText(project.rawStatus || STATUS_LABEL[project.status] || project.status)}</span>
                                </div>
                            </div>
                            <div>
                                <div className="form-label" style={{ marginBottom: 4 }}>Created By</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 14, color: 'var(--color-text-primary)' }}>
                                    <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13" style={{ color: 'var(--color-primary)' }}><path d="M8 1a4 4 0 100 8A4 4 0 008 1zm0 9c-3 0-6 1.3-6 3v1h12v-1c0-1.7-3-3-6-3z" /></svg>
                                    <span>{creatorName || 'N/A'}</span>
                                </div>
                            </div>
                        </div>
                        <div className="form-row" style={{ marginBottom: 'var(--space-md)' }}>
                            <div>
                                <div className="form-label" style={{ marginBottom: 4 }}>Project Start Date</div>
                                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-primary)' }}>
                                    {formatCreationDate(project.projectStartDate || project.creationDate, project.createdAt)}
                                </div>
                            </div>
                            <div>
                                <div className="form-label" style={{ marginBottom: 4 }}>Project Year</div>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>
                                    {project.year ? (
                                        <span>
                                            {project.year}
                                            {project.financialYear && (
                                                <span className="badge badge-neutral" style={{ marginLeft: 8, fontSize: 11 }}>
                                                    FY {project.financialYear}
                                                </span>
                                            )}
                                        </span>
                                    ) : (
                                        project.financialYear ? `FY ${project.financialYear}` : 'N/A'
                                    )}
                                </div>
                            </div>
                        </div>
                        {(project.projectCode || project.division || project.projectManager) && (
                            <div className="form-row" style={{ marginBottom: 'var(--space-md)' }}>
                                {project.projectCode && (
                                    <div>
                                        <div className="form-label" style={{ marginBottom: 4 }}>Project Code</div>
                                        <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13, background: 'var(--color-bg-page)', padding: '3px 8px', borderRadius: 4, display: 'inline-block', border: '1px solid var(--color-border-light)' }}>
                                            {project.projectCode}
                                        </div>
                                    </div>
                                )}
                                {project.division && (
                                    <div>
                                        <div className="form-label" style={{ marginBottom: 4 }}>Division / Software</div>
                                        <div style={{ fontSize: 13, fontWeight: 500 }}>{project.division}</div>
                                    </div>
                                )}
                                {project.projectManager && (
                                    <div>
                                        <div className="form-label" style={{ marginBottom: 4 }}>Project Manager</div>
                                        <div style={{ fontSize: 13, fontWeight: 500 }}>{project.projectManager}</div>
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="form-row" style={{ marginBottom: 'var(--space-md)' }}>
                            <div>
                                <div className="form-label" style={{ marginBottom: 4 }}>Created Date</div>
                                <div className="text-muted">{formatCreationDate(project.creationDate, project.createdAt)}</div>
                            </div>
                            {project.location && (
                                <div>
                                    <div className="form-label" style={{ marginBottom: 4 }}>Location</div>
                                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{project.location}</div>
                                </div>
                            )}
                        </div>

                        {/* Client Contact Person(s) */}
                        <div style={{ marginBottom: 'var(--space-md)' }}>
                            <div className="form-label" style={{ marginBottom: 6 }}>Client Contact Person</div>
                            {project.clientContactPersons && project.clientContactPersons.length > 0 ? (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                                    {project.clientContactPersons.map((cc, idx) => (
                                        <div key={idx} style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                                            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>{cc.name}</div>
                                            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{cc.email}</div>
                                            {cc.phone && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>📞 {cc.phone}</div>}
                                            {cc.designation && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>💼 {cc.designation}</div>}
                                        </div>
                                    ))}
                                </div>
                            ) : project.contactPerson ? (
                                <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0', display: 'inline-block' }}>
                                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>{project.contactPerson.name}</div>
                                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{project.contactPerson.email}</div>
                                    {project.contactPerson.phone && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>📞 {project.contactPerson.phone}</div>}
                                </div>
                            ) : (
                                <div className="text-muted" style={{ fontSize: 13 }}>No client contact person specified.</div>
                            )}
                        </div>

                        {/* Caldim Contact Person */}
                        <div style={{ marginBottom: 'var(--space-md)' }}>
                            <div className="form-label" style={{ marginBottom: 6 }}>Caldim Contact Person</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                                <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Project Manager</div>
                                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)', marginTop: 3 }}>
                                        {project.caldimProjectManagerName || project.projectManager || 'Not Assigned'}
                                    </div>
                                </div>
                                {project.caldimAssistantProjectManagerName ? (
                                    <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Assistant Project Manager</div>
                                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)', marginTop: 3 }}>
                                            {project.caldimAssistantProjectManagerName}
                                        </div>
                                    </div>
                                ) : project.caldimTeamLeadName ? (
                                    <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Team Lead</div>
                                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)', marginTop: 3 }}>
                                            {project.caldimTeamLeadName}
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>APM / Team Lead</div>
                                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)', marginTop: 3 }}>
                                            Not Assigned
                                        </div>
                                    </div>
                                )}
                                {project.teamName && (
                                    <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Assigned Team</div>
                                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)', marginTop: 3 }}>
                                            {project.teamName}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {project.description && (
                            <div style={{ marginBottom: 'var(--space-md)' }}>
                                <div className="form-label" style={{ marginBottom: 4 }}>Description</div>
                                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                                    {project.description}
                                </div>
                            </div>
                        )}
                        <div>
                            <div className="form-label" style={{ marginBottom: 8 }}>Assigned Users</div>
                            {assignedUsers.length === 0 ? (
                                <span className="text-muted">No users assigned.</span>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {assignedUsers.map((a) => (
                                        <div
                                            key={a.userId}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 10,
                                                padding: '7px 10px',
                                                border: '1px solid var(--color-border-light)',
                                                borderRadius: 3,
                                                background: '#fafbfc',
                                                fontSize: 13,
                                            }}
                                        >
                                            <div style={{
                                                width: 24, height: 24,
                                                borderRadius: '50%',
                                                background: 'var(--color-primary)',
                                                color: 'white',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 10, fontWeight: 700,
                                            }}>
                                                {a.username.slice(0, 2).toUpperCase()}
                                            </div>
                                            <span style={{ flex: 1, fontWeight: 500 }}>{a.username}</span>
                                            <span className={`role-chip ${a.permission}`}>
                                                {a.permission.charAt(0).toUpperCase() + a.permission.slice(1)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>



                        {/* ── Scope of Work Progress Section ── */}
                        <div style={{ marginTop: 24, borderTop: '1px solid var(--color-border-light)', paddingTop: 20 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                                    Scope of Work Progress
                                </h3>

                                <button
                                    type="button"
                                    onClick={() => setIsSowDataVisible(prev => !prev)}
                                    title={isSowDataVisible ? "Collapse Scope of Work Progress" : "Expand Scope of Work Progress"}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        padding: '4px 10px',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--color-border)',
                                        background: isSowDataVisible ? 'var(--color-bg-page)' : 'var(--color-primary-bg, #eff6ff)',
                                        color: isSowDataVisible ? 'var(--color-text-secondary)' : 'var(--color-primary, #2563eb)',
                                        cursor: 'pointer',
                                        fontSize: 12,
                                        fontWeight: 700,
                                        transition: 'all 0.15s ease-in-out',
                                        boxShadow: 'var(--shadow-xs)'
                                    }}
                                >
                                    {isSowDataVisible ? (
                                        <>
                                            <span style={{ fontSize: 15, lineHeight: 1, fontWeight: 'bold' }}>−</span>
                                            <span>Collapse</span>
                                        </>
                                    ) : (
                                        <>
                                            <span style={{ fontSize: 15, lineHeight: 1, fontWeight: 'bold' }}>+</span>
                                            <span>Expand Data</span>
                                        </>
                                    )}
                                </button>
                            </div>

                            {!isSowDataVisible ? (
                                <div 
                                    onClick={() => setIsSowDataVisible(true)}
                                    style={{
                                        padding: '14px 18px',
                                        borderRadius: 'var(--radius-lg)',
                                        background: 'var(--color-bg-page)',
                                        border: '1.5px dashed var(--color-border)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        cursor: 'pointer',
                                        color: 'var(--color-text-secondary)',
                                        fontSize: 13,
                                        transition: 'all 0.15s'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span style={{
                                            width: 24,
                                            height: 24,
                                            borderRadius: '50%',
                                            background: 'var(--color-primary-bg, #eff6ff)',
                                            color: 'var(--color-primary, #2563eb)',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontWeight: 'bold',
                                            fontSize: 16
                                        }}>+</span>
                                        <span>Scope of Work Progress data is collapsed. Click to view Scope of Work details.</span>
                                    </div>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary, #2563eb)' }}>
                                        Show Details →
                                    </span>
                                </div>
                            ) : (
                                <>
                                    {(!project.scopeOfWork || project.scopeOfWork.length === 0) ? (
                                        <div className="text-muted" style={{ fontSize: 13, padding: '12px 0' }}>No Scope of Work items defined for this project.</div>
                                    ) : (
                                        <div style={{ overflowX: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-lg)' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr style={{ background: 'var(--color-table-header-bg)', borderBottom: '1px solid var(--color-border-light)' }}>
                                                        <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>SOW Name</th>
                                                        <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>% of Total Work</th>
                                                        <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>App (%)</th>
                                                        <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Fab (%)</th>
                                                        <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {project.scopeOfWork.map((sow: any, idx: number) => {
                                                        const rawStatus = sow.status || 'Yet to Start';
                                                        const canEditSow = isAdmin || project.myPermission === 'editor' || project.myPermission === 'admin';

                                                        const sowPct = Number(sow.percentage) || 0;
                                                        const appPctVal = Number(sow.approval) || 0;
                                                        const fabPctVal = Number(sow.fabrication) || 0;

                                                        const handleStatusChange = async (newStatus: string) => {
                                                            if (!id || !project) return;
                                                            if (!canEditSow) {
                                                                showMessage('Permission Denied', 'Only editors or admins can update Scope of Work status.', 'error');
                                                                return;
                                                            }
                                                            const updatedSow = [...(project.scopeOfWork || [])];
                                                            updatedSow[idx] = { ...updatedSow[idx], status: newStatus };
                                                            setProject({ ...project, scopeOfWork: updatedSow });
                                                            try {
                                                                await updateProjectScopeOfWork(id, updatedSow);
                                                                await fetchData(true);
                                                            } catch (err: any) {
                                                                showMessage('Error', `Failed to update SOW status: ${err.message}`, 'error');
                                                                await fetchData(true);
                                                            }
                                                        };

                                                        const handlePercentageChange = async (field: 'approval' | 'fabrication', val: number) => {
                                                            if (!id || !project) return;
                                                            if (!canEditSow) return;
                                                            const clamped = Math.min(100, Math.max(0, val));
                                                            const updatedSow = [...(project.scopeOfWork || [])];
                                                            updatedSow[idx] = { ...updatedSow[idx], [field]: clamped };
                                                            setProject({ ...project, scopeOfWork: updatedSow });
                                                            try {
                                                                await updateProjectScopeOfWork(id, updatedSow);
                                                            } catch (err: any) {
                                                                showMessage('Error', `Failed to update SOW: ${err.message}`, 'error');
                                                                await fetchData(true);
                                                            }
                                                        };

                                                        const isHoldStatus = rawStatus === 'Hold' || rawStatus === 'On Hold';

                                                        return (
                                                            <tr key={idx} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                                                                <td style={{ padding: '12px 14px', fontWeight: 700, fontSize: 13, color: 'var(--color-text-primary)' }}>
                                                                    {sow.name}
                                                                </td>
                                                                <td style={{ padding: '12px 14px', textAlign: 'center', fontSize: 13, fontWeight: 600 }}>
                                                                    {sowPct}%
                                                                </td>
                                                                <td style={{ padding: '12px 14px', textAlign: 'center', fontSize: 13, color: '#2563eb', fontWeight: 600 }}>
                                                                    {canEditSow ? (
                                                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                                                            <input
                                                                                type="number"
                                                                                min="0"
                                                                                max="100"
                                                                                value={appPctVal}
                                                                                onChange={(e) => handlePercentageChange('approval', Number(e.target.value))}
                                                                                style={{ 
                                                                                    width: 60, padding: '4px 6px', textAlign: 'center', 
                                                                                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', 
                                                                                    background: 'var(--color-bg-page)', color: 'var(--color-text-primary)',
                                                                                    fontSize: 13, fontWeight: 600 
                                                                                }}
                                                                            />
                                                                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>%</span>
                                                                        </div>
                                                                    ) : (
                                                                        `${appPctVal}%`
                                                                    )}
                                                                </td>
                                                                <td style={{ padding: '12px 14px', textAlign: 'center', fontSize: 13, color: '#16a34a', fontWeight: 600 }}>
                                                                    {canEditSow ? (
                                                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                                                            <input
                                                                                type="number"
                                                                                min="0"
                                                                                max="100"
                                                                                value={fabPctVal}
                                                                                onChange={(e) => handlePercentageChange('fabrication', Number(e.target.value))}
                                                                                style={{ 
                                                                                    width: 60, padding: '4px 6px', textAlign: 'center', 
                                                                                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', 
                                                                                    background: 'var(--color-bg-page)', color: 'var(--color-text-primary)',
                                                                                    fontSize: 13, fontWeight: 600 
                                                                                }}
                                                                            />
                                                                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>%</span>
                                                                        </div>
                                                                    ) : (
                                                                        `${fabPctVal}%`
                                                                    )}
                                                                </td>
                                                                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                                                                    <select
                                                                        value={rawStatus}
                                                                        onChange={(e) => handleStatusChange(e.target.value)}
                                                                        disabled={!canEditSow}
                                                                        style={{
                                                                            padding: '4px 8px', borderRadius: 'var(--radius-md)',
                                                                            fontSize: 12, fontWeight: 600, cursor: canEditSow ? 'pointer' : 'not-allowed',
                                                                            border: rawStatus === 'Completed' ? '1px solid var(--color-success)' : rawStatus === 'In Progress' ? '1px solid var(--color-info)' : isHoldStatus ? '1px solid #f59e0b' : '1px solid var(--color-border)',
                                                                            background: rawStatus === 'Completed' ? 'var(--color-success-bg)' : rawStatus === 'In Progress' ? 'var(--color-info-bg)' : isHoldStatus ? '#fef3c7' : 'var(--color-bg-page)',
                                                                            color: rawStatus === 'Completed' ? 'var(--color-success-mid)' : rawStatus === 'In Progress' ? 'var(--color-info-mid)' : isHoldStatus ? '#b45309' : 'var(--color-text-muted)',
                                                                        }}
                                                                    >
                                                                        <option value="Yet to Start">Yet to Start</option>
                                                                        <option value="In Progress">In Progress</option>
                                                                        <option value="Hold">Hold</option>
                                                                        <option value="Completed">Completed</option>
                                                                    </select>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {/* ── Additional Scope of Work Progress Section ── */}
                                    {project.additionalScopeOfWork && project.additionalScopeOfWork.length > 0 && (
                                        <div style={{ marginTop: 24, borderTop: '1px solid var(--color-border-light)', paddingTop: 20 }}>
                                            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                                                Additional Scope of Work
                                            </h3>
                                            <div style={{ overflowX: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-lg)' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr style={{ background: 'var(--color-table-header-bg)', borderBottom: '1px solid var(--color-border-light)' }}>
                                                            <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>SOW Name</th>
                                                            <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>% of Total Work</th>
                                                            <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>App (%)</th>
                                                            <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Fab (%)</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {project.additionalScopeOfWork.map((sow: any, idx: number) => {
                                                            const canEditSow = isAdmin || project.myPermission === 'editor' || project.myPermission === 'admin';
                                                            
                                                            const sowPct = Number(sow.percentage) || 0;
                                                            const appPctVal = Number(sow.approval) || 0;
                                                            const fabPctVal = Number(sow.fabrication) || 0;
                                                            
                                                            const handlePercentageChange = async (field: 'approval' | 'fabrication', val: number) => {
                                                                if (!id || !project) return;
                                                                if (!canEditSow) return;
                                                                const clamped = Math.min(100, Math.max(0, val));
                                                                const updatedSow = [...(project.additionalScopeOfWork || [])];
                                                                updatedSow[idx] = { ...updatedSow[idx], [field]: clamped };
                                                                setProject({ ...project, additionalScopeOfWork: updatedSow });
                                                                try {
                                                                    await updateProjectAdditionalScopeOfWork(id, updatedSow);
                                                                } catch (err: any) {
                                                                    showMessage('Error', `Failed to update Additional SOW: ${err.message}`, 'error');
                                                                    await fetchData(true);
                                                                }
                                                            };
                                                            
                                                            return (
                                                                <tr key={idx} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                                                                    <td style={{ padding: '12px 14px', fontWeight: 700, fontSize: 13, color: 'var(--color-text-primary)' }}>
                                                                        {sow.name}
                                                                    </td>
                                                                    <td style={{ padding: '12px 14px', textAlign: 'center', fontSize: 13, fontWeight: 600 }}>
                                                                        {sowPct}%
                                                                    </td>
                                                                    <td style={{ padding: '12px 14px', textAlign: 'center', fontSize: 13, color: '#2563eb', fontWeight: 600 }}>
                                                                        {canEditSow ? (
                                                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                                                                <input
                                                                                    type="number"
                                                                                    min="0"
                                                                                    max="100"
                                                                                    value={appPctVal}
                                                                                    onChange={(e) => handlePercentageChange('approval', Number(e.target.value))}
                                                                                    style={{ 
                                                                                        width: 60, padding: '4px 6px', textAlign: 'center', 
                                                                                        borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', 
                                                                                        background: 'var(--color-bg-page)', color: 'var(--color-text-primary)',
                                                                                        fontSize: 13, fontWeight: 600 
                                                                                    }}
                                                                                />
                                                                                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>%</span>
                                                                            </div>
                                                                        ) : (
                                                                            `${appPctVal}%`
                                                                        )}
                                                                    </td>
                                                                    <td style={{ padding: '12px 14px', textAlign: 'center', fontSize: 13, color: '#16a34a', fontWeight: 600 }}>
                                                                        {canEditSow ? (
                                                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                                                                <input
                                                                                    type="number"
                                                                                    min="0"
                                                                                    max="100"
                                                                                    value={fabPctVal}
                                                                                    onChange={(e) => handlePercentageChange('fabrication', Number(e.target.value))}
                                                                                    style={{ 
                                                                                        width: 60, padding: '4px 6px', textAlign: 'center', 
                                                                                        borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', 
                                                                                        background: 'var(--color-bg-page)', color: 'var(--color-text-primary)',
                                                                                        fontSize: 13, fontWeight: 600 
                                                                                    }}
                                                                                />
                                                                                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>%</span>
                                                                            </div>
                                                                        ) : (
                                                                            `${fabPctVal}%`
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* ── Sequence Progress Section (Always Visible) ── */}
                        <div style={{ marginTop: 24, borderTop: '1px solid var(--color-border-light)', paddingTop: 20 }}>
                            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                                Sequence Progress
                            </h3>

                            {!derivedSequences || derivedSequences.length === 0 ? (
                                <div className="text-muted" style={{ fontSize: 13, padding: '12px 0' }}>No sequences defined for this project.</div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                                    {derivedSequences.map((seq, idx) => {
                                        const isDone = seq.status === 'Completed';
                                        const isHold = seq.status === 'Hold' || seq.status === 'On Hold' || seq.parentStatus === 'Hold' || seq.parentStatus === 'On Hold' || seq.sowStatus === 'Hold' || seq.sowStatus === 'On Hold';
                                        const canEditSequences = (isAdmin || project.myPermission === 'editor' || project.myPermission === 'admin') && !isHold;
                                        
                                        const handleUpdateSequence = async (updates: Partial<typeof seq>) => {
                                            if (!id || !project) return;
                                            if (!canEditSequences) {
                                                showMessage('Permission Denied', 'Only editors or admins can update sequences.', 'error');
                                                return;
                                            }
                                            
                                            try {
                                                if (seq.source === 'sow') {
                                                    const updatedSow = [...(project.scopeOfWork || [])];
                                                    const sIdx = seq.sowIndex ?? 0;
                                                    const qIdx = seq.seqIndex ?? 0;
                                                    const updatedSeqs = [...(updatedSow[sIdx]?.sequences || [])];
                                                    const currentSeq = updatedSeqs[qIdx] || {};
                                                    const nextStatus = updates.status !== undefined ? updates.status : currentSeq.status;
                                                    updatedSeqs[qIdx] = { 
                                                        ...currentSeq, 
                                                        ...updates,
                                                        status: nextStatus
                                                    } as any;
                                                    if (updatedSow[sIdx]) updatedSow[sIdx].sequences = updatedSeqs;
                                                    setProject({ ...project, scopeOfWork: updatedSow });
                                                    await updateProjectScopeOfWork(id, updatedSow);
                                                } else if (seq.source === 'additionalSow') {
                                                    const updatedAddSow = [...(project.additionalScopeOfWork || [])];
                                                    const sIdx = seq.sowIndex ?? 0;
                                                    const qIdx = seq.seqIndex ?? 0;
                                                    const updatedSeqs = [...(updatedAddSow[sIdx]?.sequences || [])];
                                                    const currentSeq = updatedSeqs[qIdx] || {};
                                                    const nextStatus = updates.status !== undefined ? updates.status : currentSeq.status;
                                                    updatedSeqs[qIdx] = { 
                                                        ...currentSeq, 
                                                        ...updates,
                                                        status: nextStatus
                                                    } as any;
                                                    if (updatedAddSow[sIdx]) updatedAddSow[sIdx].sequences = updatedSeqs;
                                                    setProject({ ...project, additionalScopeOfWork: updatedAddSow });
                                                    await updateProjectAdditionalScopeOfWork(id, updatedAddSow);
                                                } else if (seq.source === 'project') {
                                                    const newSeqs = [...(project.sequences || [])];
                                                    const qIdx = seq.seqIndex ?? 0;
                                                    const currentSeq = newSeqs[qIdx] || {};
                                                    const nextStatus = updates.status !== undefined ? updates.status : currentSeq.status;
                                                    newSeqs[qIdx] = { 
                                                        ...currentSeq, 
                                                        ...updates,
                                                        status: nextStatus
                                                    } as any;
                                                    setProject({ ...project, sequences: newSeqs });
                                                    await updateProjectSequences(id, newSeqs);
                                                } else if (seq.source === 'sow-fallback') {
                                                    const updatedSow = [...(project.scopeOfWork || [])];
                                                    const sIdx = seq.sowIndex ?? 0;
                                                    const targetSow = updatedSow[sIdx] || {};
                                                    const nextStatus = updates.status !== undefined ? updates.status : targetSow.status;
                                                    updatedSow[sIdx] = { 
                                                        ...targetSow, 
                                                        status: (nextStatus as any),
                                                        approvalDate: (updates.approvalDate !== undefined ? updates.approvalDate : targetSow.approvalDate) as any,
                                                        fabricationDate: (updates.fabricationDate !== undefined ? updates.fabricationDate : targetSow.fabricationDate) as any
                                                    } as any;
                                                    setProject({ ...project, scopeOfWork: updatedSow });
                                                    await updateProjectScopeOfWork(id, updatedSow);
                                                }
                                                await fetchData(true);
                                            } catch (err: any) {
                                                showMessage('Error', `Failed to update sequence: ${err.message}`, 'error');
                                                await fetchData(true);
                                            }
                                        };
                                        return (
                                            <div
                                                key={idx}
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    padding: '12px 16px',
                                                    background: isHold ? '#fffdf7' : isDone ? 'var(--color-success-bg)' : 'var(--color-bg-card)',
                                                    border: isHold ? '1.5px dashed #f59e0b' : `1px solid ${isDone ? 'var(--color-success-bg)' : 'var(--color-border-light)'}`,
                                                    borderRadius: 'var(--radius-lg)',
                                                    boxShadow: isHold ? 'none' : 'var(--shadow-xs)',
                                                    opacity: isHold ? 0.65 : 1,
                                                    transition: 'all 0.15s',
                                                    gap: 12,
                                                    position: 'relative',
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                                    {/* Sequence name with status dot */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                                                        <div style={{
                                                            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                                            background: isHold ? '#f59e0b' : isDone ? 'var(--color-success-mid)' : 'var(--color-border)',
                                                            boxShadow: isHold ? '0 0 0 3px #fef3c7' : isDone ? '0 0 0 3px var(--color-success-bg)' : 'none',
                                                        }} />
                                                        <span style={{
                                                            fontWeight: 700, fontSize: 13,
                                                            color: isHold ? '#92400e' : 'var(--color-text-primary)',
                                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                        }}>{seq.name}</span>
                                                        {isHold && (
                                                            <span style={{
                                                                fontSize: 10,
                                                                fontWeight: 700,
                                                                padding: '2px 8px',
                                                                borderRadius: 99,
                                                                background: '#fef3c7',
                                                                color: '#b45309',
                                                                border: '1px solid #f59e0b',
                                                                textTransform: 'uppercase',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: 4,
                                                                flexShrink: 0
                                                            }}>
                                                                ⏸ On Hold
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Toggle pill */}
                                                    <div style={{
                                                        display: 'flex',
                                                        flexShrink: 0,
                                                        background: 'var(--color-bg-page)',
                                                        border: '1px solid var(--color-border)',
                                                        borderRadius: 99,
                                                        padding: 3,
                                                        gap: 2,
                                                    }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUpdateSequence({ status: 'Not Completed' })}
                                                            disabled={isHold || !canEditSequences}
                                                            style={{
                                                                padding: '3px 10px',
                                                                borderRadius: 99,
                                                                fontSize: 10,
                                                                fontWeight: 700,
                                                                border: 'none',
                                                                cursor: (isHold || !canEditSequences) ? 'not-allowed' : 'pointer',
                                                                transition: 'all 0.15s',
                                                                background: !isDone ? 'var(--color-danger-mid)' : 'transparent',
                                                                color: !isDone ? 'white' : 'var(--color-text-muted)',
                                                                boxShadow: !isDone ? '0 1px 4px rgba(220,38,38,0.3)' : 'none',
                                                                letterSpacing: 0.2,
                                                                opacity: (isHold || !canEditSequences) ? 0.5 : 1,
                                                            }}
                                                        >
                                                            Pending
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUpdateSequence({ status: 'Completed', fabricationDate: seq.fabricationDate || new Date().toISOString(), approvalDate: seq.approvalDate || new Date().toISOString() })}
                                                            disabled={isHold || !canEditSequences}
                                                            style={{
                                                                padding: '3px 10px',
                                                                borderRadius: 99,
                                                                fontSize: 10,
                                                                fontWeight: 700,
                                                                border: 'none',
                                                                cursor: (isHold || !canEditSequences) ? 'not-allowed' : 'pointer',
                                                                transition: 'all 0.15s',
                                                                background: isDone ? 'var(--color-success-mid)' : 'transparent',
                                                                color: isDone ? 'white' : 'var(--color-text-muted)',
                                                                boxShadow: isDone ? '0 1px 4px rgba(220,38,38,0.3)' : 'none',
                                                                letterSpacing: 0.2,
                                                                opacity: (isHold || !canEditSequences) ? 0.5 : 1,
                                                            }}
                                                        >
                                                            ✓ Done
                                                        </button>
                                                    </div>
                                                </div>

                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                                    <div>
                                                        <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Approval Date</label>
                                                        <input
                                                            type="date"
                                                            className="form-control form-control-sm"
                                                            style={{ height: 28, fontSize: 11, cursor: (isHold || !canEditSequences) ? 'not-allowed' : undefined }}
                                                            value={seq.approvalDate ? String(seq.approvalDate).split('T')[0] : ''}
                                                            onChange={(e) => handleUpdateSequence({ approvalDate: e.target.value })}
                                                            disabled={isHold || !canEditSequences}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Fabrication Date</label>
                                                        <input
                                                            type="date"
                                                            className="form-control form-control-sm"
                                                            style={{ height: 28, fontSize: 11, cursor: (isHold || !canEditSequences) ? 'not-allowed' : undefined }}
                                                            value={seq.fabricationDate ? String(seq.fabricationDate).split('T')[0] : ''}
                                                            onChange={(e) => handleUpdateSequence({ fabricationDate: e.target.value })}
                                                            disabled={isHold || !canEditSequences}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Allocations Tab ── */}
            {activeTab === 'allocations' && (
                <div className="card">
                    <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--color-border-light)', padding: '16px 20px' }}>
                        <div>
                            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                                Project Allocations
                            </h3>
                            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                Assign Team Members and Team Leads to this project. Allocated users will automatically receive project access in their login and appear in the Users &amp; Permission modules.
                            </p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="badge badge-neutral" style={{ fontSize: 12, padding: '6px 12px' }}>
                                {Object.values(allocationsMap).filter(v => v.selected).length} Allocated
                            </span>
                            <button
                                type="button"
                                className="btn btn-primary"
                                disabled={savingAllocations}
                                onClick={handleSaveAllocations}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
                            >
                                {savingAllocations ? (
                                    <>
                                        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" style={{ width: 14, height: 14, borderWidth: 2 }} />
                                        <span>Allocating...</span>
                                    </>
                                ) : (
                                    <>
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                        <span>Allocate</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="card-body" style={{ padding: 20 }}>
                        {/* Filter & Search Bar */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <div style={{ position: 'relative', width: 280 }}>
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="Search team member or lead..."
                                        value={allocationSearch}
                                        onChange={(e) => setAllocationSearch(e.target.value)}
                                        style={{ paddingLeft: 32, fontSize: 13, height: 36 }}
                                    />
                                    <svg
                                        viewBox="0 0 16 16"
                                        fill="none"
                                        strokeWidth="1.5"
                                        stroke="currentColor"
                                        width="14"
                                        height="14"
                                        style={{ position: 'absolute', left: 10, top: 11, color: '#94a3b8' }}
                                    >
                                        <circle cx="6.5" cy="6.5" r="4.5" />
                                        <path d="M10 10l3.5 3.5" strokeLinecap="round" />
                                    </svg>
                                    {allocationSearch && (
                                        <button
                                            type="button"
                                            onClick={() => setAllocationSearch('')}
                                            style={{ position: 'absolute', right: 8, top: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}
                                        >
                                            ×
                                        </button>
                                    )}
                                </div>

                                <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 8, padding: 3 }}>
                                    <button
                                        type="button"
                                        onClick={() => setAllocationRoleFilter('all')}
                                        style={{
                                            padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                            background: allocationRoleFilter === 'all' ? '#fff' : 'transparent',
                                            color: allocationRoleFilter === 'all' ? 'var(--color-primary)' : '#64748b',
                                            boxShadow: allocationRoleFilter === 'all' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none'
                                        }}
                                    >
                                        All ({eligibleUsers.length})
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setAllocationRoleFilter('team_member')}
                                        style={{
                                            padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                            background: allocationRoleFilter === 'team_member' ? '#fff' : 'transparent',
                                            color: allocationRoleFilter === 'team_member' ? 'var(--color-primary)' : '#64748b',
                                            boxShadow: allocationRoleFilter === 'team_member' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none'
                                        }}
                                    >
                                        Team Members ({eligibleUsers.filter(u => u.role === 'team_member').length})
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setAllocationRoleFilter('team_lead')}
                                        style={{
                                            padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                            background: allocationRoleFilter === 'team_lead' ? '#fff' : 'transparent',
                                            color: allocationRoleFilter === 'team_lead' ? 'var(--color-primary)' : '#64748b',
                                            boxShadow: allocationRoleFilter === 'team_lead' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none'
                                        }}
                                    >
                                        Team Leads ({eligibleUsers.filter(u => u.role === 'team_lead' || u.role === 'assistant_team_lead').length})
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    style={{ fontSize: 12 }}
                                    onClick={() => {
                                        const updated = { ...allocationsMap };
                                        displayedUsers.forEach(u => {
                                            const uid = String(u.id || u._id);
                                            updated[uid] = {
                                                selected: true,
                                                permission: updated[uid]?.permission || (u.role === 'team_member' ? 'editor' : 'viewer')
                                            };
                                        });
                                        setAllocationsMap(updated);
                                    }}
                                >
                                    Select All Visible
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    style={{ fontSize: 12 }}
                                    onClick={() => {
                                        const updated = { ...allocationsMap };
                                        displayedUsers.forEach(u => {
                                            const uid = String(u.id || u._id);
                                            if (updated[uid]) {
                                                updated[uid] = { ...updated[uid], selected: false };
                                            }
                                        });
                                        setAllocationsMap(updated);
                                    }}
                                >
                                    Deselect All Visible
                                </button>
                            </div>
                        </div>

                        {/* Allocations Table */}
                        {displayedUsers.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
                                <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
                                <div style={{ fontWeight: 600, fontSize: 14, color: '#475569' }}>No users found</div>
                                <div style={{ fontSize: 12 }}>Try adjusting your search or role filter.</div>
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                                    <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                        <tr>
                                            <th style={{ padding: '10px 14px', width: 44 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={displayedUsers.length > 0 && displayedUsers.every(u => allocationsMap[String(u.id || u._id)]?.selected)}
                                                    onChange={(e) => {
                                                        const checked = e.target.checked;
                                                        const updated = { ...allocationsMap };
                                                        displayedUsers.forEach(u => {
                                                            const uid = String(u.id || u._id);
                                                            updated[uid] = {
                                                                selected: checked,
                                                                permission: updated[uid]?.permission || (u.role === 'team_member' ? 'editor' : 'viewer')
                                                            };
                                                        });
                                                        setAllocationsMap(updated);
                                                    }}
                                                    style={{ cursor: 'pointer' }}
                                                />
                                            </th>
                                            <th style={{ padding: '10px 14px', fontWeight: 600, color: '#475569' }}>User</th>
                                            <th style={{ padding: '10px 14px', fontWeight: 600, color: '#475569' }}>Role</th>
                                            <th style={{ padding: '10px 14px', fontWeight: 600, color: '#475569' }}>Division</th>
                                            <th style={{ padding: '10px 14px', fontWeight: 600, color: '#475569', textAlign: 'right' }}>Access Level</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {displayedUsers.map(u => {
                                            const uid = String(u.id || u._id);
                                            const isAllocated = !!allocationsMap[uid]?.selected;
                                            const currentPerm = allocationsMap[uid]?.permission;
                                            const roleLabel = u.role === 'team_lead' ? 'Team Lead' : (u.role === 'assistant_team_lead' ? 'Assistant Team Lead' : 'Team Member');
                                            const roleClass = (u.role === 'team_lead' || u.role === 'assistant_team_lead') ? 'badge-primary' : 'badge-neutral';
                                            const userDivision = u.division || (() => {
                                                const userTeam = allTeams.find(t => {
                                                    const mems = (t.members || []).concat(t.lead || []);
                                                    return mems.some((m: any) => String(m?._id || m?.id || m) === uid);
                                                });
                                                if (userTeam) {
                                                    if (/tekla/i.test(userTeam.name)) return 'Tekla';
                                                    if (/sds/i.test(userTeam.name)) return 'SDS2';
                                                }
                                                return project?.division || '—';
                                            })();

                                            return (
                                                <tr
                                                    key={uid}
                                                    style={{
                                                        borderBottom: '1px solid #f1f5f9',
                                                        background: isAllocated ? 'rgba(37,99,235,0.03)' : 'transparent',
                                                        transition: 'background 0.15s'
                                                    }}
                                                >
                                                    <td style={{ padding: '12px 14px' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isAllocated}
                                                            onChange={(e) => {
                                                                const checked = e.target.checked;
                                                                setAllocationsMap(prev => ({
                                                                    ...prev,
                                                                    [uid]: {
                                                                        selected: checked,
                                                                        permission: prev[uid]?.permission || (u.role === 'team_member' ? 'editor' : 'viewer')
                                                                    }
                                                                }));
                                                            }}
                                                            style={{ cursor: 'pointer' }}
                                                        />
                                                    </td>
                                                    <td style={{ padding: '12px 14px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                            <div style={{
                                                                width: 32, height: 32, borderRadius: '50%',
                                                                background: isAllocated ? 'var(--color-primary)' : '#94a3b8',
                                                                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                fontSize: 12, fontWeight: 700
                                                            }}>
                                                                {(u.displayName || u.username).slice(0, 2).toUpperCase()}
                                                            </div>
                                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                                                    {u.displayName || u.username}
                                                                </span>
                                                                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                                                    {u.email}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '12px 14px' }}>
                                                        <span className={`badge ${roleClass}`} style={{ fontSize: 11 }}>
                                                            {roleLabel}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '12px 14px', color: 'var(--color-text-secondary)', fontSize: 12 }}>
                                                        {userDivision}
                                                    </td>
                                                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                                                        <div
                                                            style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                background: '#f1f5f9',
                                                                borderRadius: 24,
                                                                padding: 3,
                                                                border: '1px solid #e2e8f0',
                                                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)',
                                                                userSelect: 'none'
                                                            }}
                                                        >
                                                            <button
                                                                type="button"
                                                                title="Grant Viewer (read-only) access"
                                                                onClick={() => {
                                                                    setAllocationsMap(prev => ({
                                                                        ...prev,
                                                                        [uid]: {
                                                                            selected: true,
                                                                            permission: 'viewer'
                                                                        }
                                                                    }));
                                                                }}
                                                                style={{
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: 6,
                                                                    padding: '5px 12px',
                                                                    borderRadius: 20,
                                                                    border: 'none',
                                                                    cursor: 'pointer',
                                                                    fontSize: 12,
                                                                    fontWeight: 650,
                                                                    transition: 'all 0.18s ease-in-out',
                                                                    background: (isAllocated && currentPerm === 'viewer') ? '#2563eb' : 'transparent',
                                                                    color: (isAllocated && currentPerm === 'viewer') ? '#ffffff' : '#64748b',
                                                                    boxShadow: (isAllocated && currentPerm === 'viewer') ? '0 2px 5px rgba(37,99,235,0.28)' : 'none'
                                                                }}
                                                            >
                                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z" />
                                                                    <circle cx="12" cy="12" r="3" />
                                                                </svg>
                                                                <span>Viewer</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                title="Grant Editor (upload and editing) access"
                                                                onClick={() => {
                                                                    setAllocationsMap(prev => ({
                                                                        ...prev,
                                                                        [uid]: {
                                                                            selected: true,
                                                                            permission: 'editor'
                                                                        }
                                                                    }));
                                                                }}
                                                                style={{
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: 6,
                                                                    padding: '5px 12px',
                                                                    borderRadius: 20,
                                                                    border: 'none',
                                                                    cursor: 'pointer',
                                                                    fontSize: 12,
                                                                    fontWeight: 650,
                                                                    transition: 'all 0.18s ease-in-out',
                                                                    background: (isAllocated && currentPerm === 'editor') ? '#059669' : 'transparent',
                                                                    color: (isAllocated && currentPerm === 'editor') ? '#ffffff' : '#64748b',
                                                                    boxShadow: (isAllocated && currentPerm === 'editor') ? '0 2px 5px rgba(5,150,105,0.28)' : 'none'
                                                                }}
                                                            >
                                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                                                </svg>
                                                                <span>Editor</span>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Transmittal Selection Modal ── */}
            {transmittalSelectModal && (
                <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setTransmittalSelectModal(false) }}>
                    <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header" style={{ background: 'linear-gradient(135deg,#1e3a5f,#2563eb)', color: 'white', borderRadius: '8px 8px 0 0' }}>
                            <span className="modal-title" style={{ color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                    <line x1="12" y1="18" x2="12" y2="12" />
                                    <line x1="9" y1="15" x2="15" y2="15" />
                                </svg>
                                Select Transmittal
                            </span>
                            <button className="modal-close" style={{ color: 'white' }} onClick={() => setTransmittalSelectModal(false)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 18, lineHeight: 1.6 }}>
                                Choose which transmittal this folder upload belongs to. All uploaded drawings will be associated with the selected transmittal.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                                {/* Existing transmittals */}
                                {existingTransmittals.map(t => (
                                    <label
                                        key={t._id}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 12,
                                            padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                                            border: `2px solid ${selectedTransmittalNumber === t.transmittalNumber ? '#2563eb' : 'var(--color-border-light)'}`,
                                            background: selectedTransmittalNumber === t.transmittalNumber ? 'rgba(37,99,235,0.06)' : 'var(--color-surface)',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="transmittalChoice"
                                            checked={selectedTransmittalNumber === t.transmittalNumber}
                                            onChange={() => setSelectedTransmittalNumber(t.transmittalNumber)}
                                            style={{ accentColor: '#2563eb', width: 16, height: 16, cursor: 'pointer' }}
                                        />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)' }}>
                                                Transmittal #{t.transmittalNumber}
                                                <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 12, color: 'var(--color-text-muted)' }}>
                                                    — {t.newCount + t.revisedCount} drawing{(t.newCount + t.revisedCount) !== 1 ? 's' : ''}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                                Created: {formatDate(t.createdAt)}
                                            </div>
                                        </div>
                                        {selectedTransmittalNumber === t.transmittalNumber && (
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="#2563eb" stroke="none"><path d="M20 6L9 17l-5-5" stroke="#2563eb" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                        )}
                                    </label>
                                ))}

                                {/* Create New Transmittal */}
                                <label
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 12,
                                        padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                                        border: `2px solid ${selectedTransmittalNumber === null ? '#059669' : 'var(--color-border-light)'}`,
                                        background: selectedTransmittalNumber === null ? 'rgba(5,150,105,0.06)' : 'var(--color-surface)',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <input
                                        type="radio"
                                        name="transmittalChoice"
                                        checked={selectedTransmittalNumber === null}
                                        onChange={() => setSelectedTransmittalNumber(null)}
                                        style={{ accentColor: '#059669', width: 16, height: 16, cursor: 'pointer' }}
                                    />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 700, fontSize: 14, color: '#059669', display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                                            Create New Transmittal
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                            Auto-assigns the next transmittal number
                                        </div>
                                    </div>
                                    {selectedTransmittalNumber === null && (
                                        <svg width="16" height="16" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" stroke="#059669" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    )}
                                </label>
                            </div>

                            {derivedSequences.length > 0 && (
                                <div style={{ marginBottom: 20, padding: '14px 16px', background: 'var(--color-background)', borderRadius: 10, border: '1px solid var(--color-border-light)' }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Target Sequences</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                                        {derivedSequences.map((seq: any, idx: number) => (
                                            <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500, userSelect: 'none' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSequences.includes(seq.name)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) setSelectedSequences(prev => [...prev, seq.name]);
                                                        else setSelectedSequences(prev => prev.filter(s => s !== seq.name));
                                                    }}
                                                    style={{ width: 17, height: 17, cursor: 'pointer', accentColor: '#2563eb' }}
                                                />
                                                {seq.name}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Fabrication or Approval Selection */}
                            <div style={{ marginBottom: 20, padding: '14px 16px', background: 'var(--color-background)', borderRadius: 10, border: '1px solid var(--color-border-light)' }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Purpose</div>
                                <div style={{ display: 'flex', gap: 20 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500 }}>
                                        <input
                                            type="radio"
                                            name="uploadPurposeProjView"
                                            value="Fabrication"
                                            checked={uploadPurpose === 'Fabrication'}
                                            onChange={(e) => setUploadPurpose(e.target.value as 'Fabrication' | 'Approval')}
                                            style={{ width: 17, height: 17, cursor: 'pointer', accentColor: '#2563eb' }}
                                        />
                                        Fabrication
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500 }}>
                                        <input
                                            type="radio"
                                            name="uploadPurposeProjView"
                                            value="Approval"
                                            checked={uploadPurpose === 'Approval'}
                                            onChange={(e) => setUploadPurpose(e.target.value as 'Fabrication' | 'Approval')}
                                            style={{ width: 17, height: 17, cursor: 'pointer', accentColor: '#2563eb' }}
                                        />
                                        Approval
                                    </label>
                                </div>
                            </div>

                            <div className="form-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setTransmittalSelectModal(false)}
                                >
                                    Cancel
                                </button>
                                {derivedSequences.length > 0 && selectedSequences.length === 0 && (
                                    <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 12, fontWeight: 700, textAlign: 'right' }}>
                                        * Please select at least one Sequence to continue
                                    </div>
                                )}
                                <button
                                    className="btn btn-primary"
                                    onClick={() => {
                                        if (derivedSequences.length > 0 && selectedSequences.length === 0) {
                                            showMessage('Sequence Required', 'Please select at least one Target Sequence / Scope of Work before continuing.', 'error');
                                            return;
                                        }
                                        setTransmittalSelectModal(false);
                                        setUploadModal(true);
                                    }}
                                    style={{
                                        cursor: 'pointer'
                                    }}
                                >
                                    Continue Upload →
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Upload Modal */}
            {uploadModal && (
                <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setUploadModal(false) }}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Upload Drawing</span>
                            <button className="modal-close" onClick={() => { setUploadModal(false); }}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            {/* Drop zone — folder upload */}
                            <div className="form-group" style={{ marginBottom: 16 }}>
                                <label className="form-label" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                                    PDF File
                                </label>
                                <input
                                    id="file-upload"
                                    type="file"
                                    accept=".pdf"
                                    multiple
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                        const files = e.target.files;
                                        if (files && files.length > 0) {
                                            setPendingFiles(Array.from(files));
                                        } else {
                                            setPendingFiles([]);
                                        }
                                    }}
                                />
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                    <label htmlFor="file-upload" className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                                        Choose File
                                    </label>
                                    <span style={{ fontSize: 13, color: pendingFiles.length > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                                        {pendingFiles.length > 0 ? `${pendingFiles.length} file(s) selected` : 'No file chosen'}
                                    </span>
                                </div>
                            </div>



                            <div className="form-actions">
                                <button className="btn btn-secondary" disabled={uploading} onClick={() => { setUploadModal(false); setPendingFiles([]); }}>Cancel</button>
                                <button
                                    className="btn btn-primary"
                                    disabled={pendingFiles.length === 0 || uploading || dupCheckLoading}
                                    onClick={async () => {
                                        if (pendingFiles.length === 0 || !id) return;
                                        // ── Pre-flight duplicate check ──
                                        setDupCheckLoading(true);
                                        try {
                                            const fileNames = pendingFiles.map(file => file.name);
                                            const result = await checkDuplicates(id, fileNames);
                                            if (result.hasDuplicates) {
                                                // Show duplicate confirmation modal
                                                setDupList(result.duplicates);
                                                setDupModal(true);
                                            } else {
                                                // No duplicates — upload immediately
                                                await doUpload(pendingFiles);
                                            }
                                        } catch {
                                            // If duplicate check fails, fall through to upload
                                            await doUpload(pendingFiles);
                                        } finally {
                                            setDupCheckLoading(false);
                                        }
                                    }}
                                >
                                    <IconUpload /> {dupCheckLoading ? 'Checking…' : uploading ? 'Uploading...' : 'Upload Drawing'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* ── Duplicate Detection Confirmation Modal ── */}
            {dupModal && (
                <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setDupModal(false) }}>
                    <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">⚠️ Duplicate Drawings Detected</span>
                            <button className="modal-close" onClick={() => setDupModal(false)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <p style={{ marginBottom: 12, color: 'var(--color-text-secondary)', fontSize: 13 }}>
                                <strong>{dupList.length}</strong> drawing{dupList.length !== 1 ? 's' : ''} with the same revision already
                                exist in this project. Do you want to continue uploading?
                            </p>
                            {dupList.length > 0 && (
                                <div className="table-wrapper" style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 16 }}>
                                    <table style={{ fontSize: 12 }}>
                                        <thead>
                                            <tr>
                                                <th>Filename</th>
                                                <th>Sheet No.</th>
                                                <th>Revision</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dupList.map((d, i) => (
                                                <tr key={i}>
                                                    <td className="text-muted font-mono" style={{ fontSize: 11 }}>{d.filename}</td>
                                                    <td>{d.sheetNumber || '—'}</td>
                                                    <td>{d.revision || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                                Selecting <strong>Continue</strong> will skip the duplicate drawing(s) and only upload new or updated revisions.
                            </p>
                            <div className="form-actions" style={{ flexDirection: 'row-reverse' }}>
                                <button
                                    autoFocus
                                    className="btn btn-primary"
                                    disabled={uploading}
                                    onClick={() => doUpload(pendingFiles)}
                                >
                                    {uploading ? 'Uploading...' : 'Continue'}
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    disabled={uploading}
                                    onClick={() => { setDupModal(false); setDupList([]); setPendingFiles([]); }}
                                >
                                    Cancel Upload
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Permission Legend */}
            <div className="perm-legend">
                <strong style={{ color: 'var(--color-text-primary)', flexShrink: 0 }}>Permission Guide:</strong>
                <span><span className="role-chip viewer">VIEWER</span>&nbsp; Read-only access</span>
                <span><span className="role-chip editor">EDITOR</span>&nbsp; Upload and edit drawings</span>
                <span><span className="role-chip admin">ADMIN</span>&nbsp; Full project control</span>
            </div>
        </div>
    );
}
