import { createContext, useContext, useState, type ReactNode } from 'react';

export type MessageType = 'info' | 'success' | 'warning' | 'error';

interface MessageState {
    show: boolean;
    title: string;
    body: string;
    type: MessageType;
    isConfirm?: boolean;
}

interface MessageContextType {
    showMessage: (title: string, body: string, type?: MessageType) => void;
    showConfirm: (title: string, body: string, onConfirm: () => void) => void;
    hideMessage: () => void;
}

const MessageContext = createContext<MessageContextType | undefined>(undefined);

export function MessageProvider({ children }: { children: ReactNode }) {
    const [msg, setMsg] = useState<MessageState>({
        show: false,
        title: '',
        body: '',
        type: 'info',
        isConfirm: false
    });
    const [pendingConfirm, setPendingConfirm] = useState<(() => void) | null>(null);

    const showMessage = (title: string, body: string, type: MessageType = 'info') => {
        setMsg({ show: true, title, body, type, isConfirm: false });
        setPendingConfirm(null);
    };

    const showConfirm = (title: string, body: string, onConfirm: () => void) => {
        setMsg({ show: true, title, body, type: 'warning', isConfirm: true });
        setPendingConfirm(() => onConfirm);
    };

    const hideMessage = () => {
        setMsg(prev => ({ ...prev, show: false }));
        setPendingConfirm(null);
    };

    const handleConfirm = () => {
        if (pendingConfirm) pendingConfirm();
        hideMessage();
    };

    return (
        <MessageContext.Provider value={{ showMessage, showConfirm, hideMessage }}>
            {children}
            {msg.show && (
                <div 
                    className="modal-overlay" 
                    style={{ zIndex: 99999 }} 
                    onClick={hideMessage}
                    tabIndex={-1}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            hideMessage();
                        }
                        // Enter is naturally handled by the focused button's onClick.
                        // We only catch it here if for some reason the button isn't focused.
                        if (e.key === 'Enter' && e.target === e.currentTarget) {
                            if (msg.isConfirm) handleConfirm();
                            else hideMessage();
                        }
                    }}
                >
                    <div className="modal" style={{ maxWidth: 400, textAlign: 'center', padding: '32px 24px' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{
                            width: 60, height: 60, borderRadius: '50%',
                            background: 
                                msg.type === 'error' ? '#fee2e2' : 
                                msg.type === 'success' ? '#dcfce7' : 
                                msg.type === 'warning' ? '#fef3c7' : '#dbeafe',
                            color: 
                                msg.type === 'error' ? '#dc2626' : 
                                msg.type === 'success' ? '#16a34a' : 
                                msg.type === 'warning' ? '#d97706' : '#2563eb',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            margin: '0 auto 18px',
                            fontSize: 24, fontWeight: 'bold'
                        }}>
                            {msg.type === 'error' ? '!' : msg.type === 'success' ? '✓' : msg.type === 'warning' ? '⚠' : 'i'}
                        </div>
                        <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 10, color: 'var(--color-text-primary)' }}>{msg.title}</h3>
                        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.6, marginBottom: 24, whiteSpace: 'pre-wrap' }}>
                            {msg.body}
                        </p>
                        
                        <div style={{ display: 'flex', gap: 12, flexDirection: 'row-reverse' }}>
                            {msg.isConfirm ? (
                                <>
                                    <button
                                        autoFocus
                                        className="btn btn-primary"
                                        style={{ flex: 1, justifyContent: 'center', padding: '10px', background: msg.type === 'error' ? '#dc2626' : '' }}
                                        onClick={handleConfirm}
                                    >
                                        Confirm
                                    </button>
                                    <button
                                        className="btn btn-secondary"
                                        style={{ flex: 1, justifyContent: 'center', padding: '10px' }}
                                        onClick={hideMessage}
                                    >
                                        Cancel
                                    </button>
                                </>
                            ) : (
                                <button
                                    autoFocus
                                    className="btn btn-primary"
                                    style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
                                    onClick={hideMessage}
                                >
                                    Got it
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </MessageContext.Provider>
    );
}

export function useMessage() {
    const context = useContext(MessageContext);
    if (!context) {
        throw new Error('useMessage must be used within a MessageProvider');
    }
    return context;
}
