/**
 * ============================================================
 * Chat Module: Floating Launcher Component (Main Widget Export)
 * ============================================================
 * Circular message icon fixed at bottom-right corner.
 * Shows unread badge, toggles Zoho Cliq style chat panel,
 * and hides automatically on login/public routes or when unauthenticated.
 */
import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ChatWidgetPanel } from './ChatWidgetPanel';
import './ChatWidget.css';

export const ChatWidgetLauncher: React.FC = () => {
    // Feature Flag Check
    const isEnabled = import.meta.env.VITE_ENABLE_CHAT_WIDGET !== 'false';
    if (!isEnabled) {
        return null;
    }

    const { user, isAuthenticated } = useAuth();
    const location = useLocation();
    const [isOpen, setIsOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);

    // Hide on login / public page or if user is not authenticated
    const isPublicPage = location.pathname === '/login' || location.pathname === '/';
    const shouldRender = isAuthenticated && Boolean(user) && !isPublicPage;

    // Handle ESC key to close
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape' && isOpen) {
                setIsOpen(false);
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    if (!shouldRender || !user) {
        return null;
    }

    const userId = user.id || (user as unknown as { _id?: string })._id;
    if (!userId) {
        return null;
    }

    return (
        <>
            {/* Floating Circular Launcher Button */}
            <button
                type="button"
                className="cw-launcher"
                onClick={() => setIsOpen(prev => !prev)}
                title={isOpen ? 'Close messages' : 'Messages'}
                aria-label="Toggle Messages Widget"
                aria-expanded={isOpen}
            >
                {isOpen ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="22" height="22">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="24" height="24">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                )}

                {/* Unread badge on the launcher */}
                {unreadCount > 0 && !isOpen && (
                    <span className="cw-launcher-badge">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Chat Panel */}
            <ChatWidgetPanel
                currentUserId={userId}
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                onMinimize={() => setIsOpen(false)}
                onUnreadCountChange={setUnreadCount}
            />
        </>
    );
};

export default ChatWidgetLauncher;
