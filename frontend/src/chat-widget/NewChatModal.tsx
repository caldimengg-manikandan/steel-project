/**
 * ============================================================
 * Chat Module: New Chat / Group Chat Component
 * ============================================================
 */
import React, { useState, useEffect } from 'react';
import type { PeerUser, Conversation } from './chatTypes';
import { searchUsers, createConversation } from './chatApi';

interface NewChatModalProps {
    onBack: () => void;
    onConversationCreated: (conversation: Conversation) => void;
}

export const NewChatModal: React.FC<NewChatModalProps> = ({
    onBack,
    onConversationCreated,
}) => {
    const [mode, setMode] = useState<'direct' | 'group'>('direct');
    const [searchQuery, setSearchQuery] = useState('');
    const [groupName, setGroupName] = useState('');
    const [users, setUsers] = useState<PeerUser[]>([]);
    const [selectedUsers, setSelectedUsers] = useState<PeerUser[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const loadUsers = (query: string) => {
        setIsLoading(true);
        setErrorMessage('');
        searchUsers(query)
            .then(data => {
                const sorted = (data || []).slice().sort((a, b) => {
                    const nameA = (a.displayName || a.username || '').trim().toLowerCase();
                    const nameB = (b.displayName || b.username || '').trim().toLowerCase();
                    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
                });
                setUsers(sorted);
                setIsLoading(false);
            })
            .catch(err => {
                console.error('Failed to search users:', err);
                setErrorMessage(err.message || 'Failed to load users');
                setIsLoading(false);
            });
    };

    useEffect(() => {
        if (!searchQuery.trim()) {
            loadUsers('');
            return;
        }

        const timer = setTimeout(() => {
            loadUsers(searchQuery);
        }, 250);

        return () => clearTimeout(timer);
    }, [searchQuery]);

    const handleSelectDirect = async (user: PeerUser) => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            const conv = await createConversation({
                type: 'direct',
                participantIds: [user.id],
            });
            onConversationCreated(conv);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to start conversation';
            alert(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleToggleGroupUser = (user: PeerUser) => {
        setSelectedUsers(prev => {
            const exists = prev.some(u => u.id === user.id);
            if (exists) {
                return prev.filter(u => u.id !== user.id);
            }
            return [...prev, user];
        });
    };

    const handleCreateGroup = async () => {
        if (!groupName.trim() || selectedUsers.length === 0 || isSubmitting) return;

        setIsSubmitting(true);
        try {
            const conv = await createConversation({
                type: 'group',
                name: groupName.trim(),
                participantIds: selectedUsers.map(u => u.id),
            });
            onConversationCreated(conv);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to create group';
            alert(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="cw-new-chat-view">
            {/* Header */}
            <div className="cw-chat-view-header">
                <button
                    className="cw-back-btn"
                    onClick={onBack}
                    title="Back to conversations"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                </button>
                <div className="cw-chat-view-info">
                    <div className="cw-chat-view-title">New Conversation</div>
                </div>
            </div>

            {/* Mode Toggle */}
            <div className="cw-new-chat-mode-toggle">
                <button
                    className={`cw-mode-pill ${mode === 'direct' ? 'active' : ''}`}
                    onClick={() => {
                        setMode('direct');
                        setSelectedUsers([]);
                    }}
                >
                    Direct Message
                </button>
                <button
                    className={`cw-mode-pill ${mode === 'group' ? 'active' : ''}`}
                    onClick={() => setMode('group')}
                >
                    Group Chat
                </button>
            </div>

            {/* Group Name input if in group mode */}
            {mode === 'group' && (
                <>
                    <input
                        type="text"
                        className="cw-group-name-input"
                        placeholder="Enter group name (e.g. Tekla Team Alpha)..."
                        value={groupName}
                        onChange={e => setGroupName(e.target.value)}
                    />

                    {selectedUsers.length > 0 && (
                        <div className="cw-selected-chips">
                            {selectedUsers.map(u => (
                                <span key={u.id} className="cw-chip">
                                    {u.displayName || u.username}
                                    <button
                                        type="button"
                                        className="cw-chip-remove"
                                        onClick={() => handleToggleGroupUser(u)}
                                    >
                                        ✕
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* Search Input */}
            <div className="cw-search-wrap">
                <div className="cw-search-input-box">
                    <svg
                        className="cw-search-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        width="14"
                        height="14"
                    >
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        type="text"
                        className="cw-search-input"
                        placeholder="Search colleagues by name, email, department..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        autoFocus
                    />
                </div>
            </div>

            {/* User List */}
            <div className="cw-user-search-list">
                {isLoading ? (
                    <div className="cw-empty-state">
                        <div className="cw-typing-dots">
                            <span className="cw-typing-dot" />
                            <span className="cw-typing-dot" />
                            <span className="cw-typing-dot" />
                        </div>
                        <div className="cw-empty-sub" style={{ marginTop: '8px' }}>Loading team members...</div>
                    </div>
                ) : errorMessage ? (
                    <div className="cw-empty-state">
                        <div className="cw-empty-title" style={{ color: '#ef4444' }}>Unable to load colleagues</div>
                        <div className="cw-empty-sub">{errorMessage}</div>
                        <button
                            className="cw-btn-primary"
                            style={{ marginTop: '8px' }}
                            onClick={() => loadUsers(searchQuery)}
                        >
                            Retry
                        </button>
                    </div>
                ) : users.length === 0 ? (
                    <div className="cw-empty-state">
                        <div className="cw-empty-title">No colleagues found</div>
                        <div className="cw-empty-sub">Try searching with a different keyword</div>
                    </div>
                ) : (
                    users.map(u => {
                        const isSelected = selectedUsers.some(sel => sel.id === u.id);
                        const initials = (u.displayName || u.username).slice(0, 2).toUpperCase();

                        return (
                            <div
                                key={u.id}
                                className={`cw-user-row ${isSelected ? 'selected' : ''}`}
                                onClick={() => {
                                    if (mode === 'direct') {
                                        handleSelectDirect(u);
                                    } else {
                                        handleToggleGroupUser(u);
                                    }
                                }}
                            >
                                <div
                                    className="cw-avatar"
                                    style={{
                                        width: '36px',
                                        height: '36px',
                                        fontSize: '13px',
                                        background: u.userModel === 'Admin' ? '#fef3c7' : '#f1f5f9',
                                        color: u.userModel === 'Admin' ? '#b45309' : '#1e293b',
                                    }}
                                >
                                    {initials}
                                </div>

                                <div className="cw-user-info">
                                    <div className="cw-user-name">
                                        <span>{u.displayName || u.username}</span>
                                        <span className="cw-user-role-badge">
                                            {u.role ? u.role.replace(/_/g, ' ') : 'User'}
                                        </span>
                                    </div>
                                    <div className="cw-user-sub">
                                        {u.email || u.division || (u.employeeId ? `ID: ${u.employeeId}` : '')}
                                    </div>
                                </div>

                                {mode === 'group' && (
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => {}}
                                        style={{ cursor: 'pointer' }}
                                    />
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Group Create Footer */}
            {mode === 'group' && (
                <div className="cw-create-group-footer">
                    <button
                        className="cw-btn-primary"
                        onClick={handleCreateGroup}
                        disabled={!groupName.trim() || selectedUsers.length === 0 || isSubmitting}
                    >
                        {isSubmitting ? 'Creating...' : `Create Group (${selectedUsers.length})`}
                    </button>
                </div>
            )}
        </div>
    );
};
