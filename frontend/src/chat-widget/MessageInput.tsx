/**
 * ============================================================
 * Chat Module: Message Input Component
 * ============================================================
 * Supports text messages, single or multiple attachments of all types
 * (PDF, images, Excel, Word, CAD, ZIP, text, etc.), sending attachments alone,
 * or sending message with attachments.
 */
import React, { useState, useRef, useEffect } from 'react';
import type { ChatAttachment } from './chatTypes';
import { uploadAttachment } from './chatApi';

interface MessageInputProps {
    onSendMessage: (content: string, attachments: ChatAttachment[]) => Promise<void>;
    onTyping: () => void;
    onStopTyping: () => void;
    disabled?: boolean;
}

const COMMON_EMOJIS = ['😀', '😂', '😍', '👍', '🎉', '🔥', '❤️', '🚀', '👏', '🙌', '👀', '💡', '✅', '❌', '😊', '🙏', '💯', '✨'];

function getFileTypeBadge(filename: string): { label: string; className: string } {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) {
        return { label: ext, className: 'cw-badge-img' };
    }
    if (ext === 'pdf') {
        return { label: 'PDF', className: 'cw-badge-pdf' };
    }
    if (['xls', 'xlsx', 'csv', 'xlsm', 'xlsb'].includes(ext)) {
        return { label: ext.toUpperCase(), className: 'cw-badge-xls' };
    }
    if (['doc', 'docx', 'rtf'].includes(ext)) {
        return { label: ext.toUpperCase(), className: 'cw-badge-doc' };
    }
    if (['ppt', 'pptx'].includes(ext)) {
        return { label: ext.toUpperCase(), className: 'cw-badge-ppt' };
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
        return { label: ext.toUpperCase(), className: 'cw-badge-zip' };
    }
    if (['dwg', 'dxf', 'dwf', 'ifc'].includes(ext)) {
        return { label: ext.toUpperCase(), className: 'cw-badge-cad' };
    }
    return { label: ext ? ext.toUpperCase() : 'FILE', className: 'cw-badge-file' };
}

function formatSize(bytes: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MessageInput: React.FC<MessageInputProps> = ({
    onSendMessage,
    onTyping,
    onStopTyping,
    disabled = false,
}) => {
    const [text, setText] = useState('');
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [isSending, setIsSending] = useState(false);

    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setText(e.target.value);

        onTyping();
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            onStopTyping();
        }, 1500);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const handleEmojiClick = (emoji: string) => {
        setText(prev => prev + emoji);
        setShowEmojiPicker(false);
        textareaRef.current?.focus();
    };

    const uploadFiles = async (files: File[]) => {
        if (files.length === 0) return;

        const MAX_SIZE = 50 * 1024 * 1024; // 50MB
        const oversized = files.filter(f => f.size > MAX_SIZE);
        if (oversized.length > 0) {
            alert(`File(s) exceed the 50MB limit: ${oversized.map(f => f.name).join(', ')}`);
            return;
        }

        setIsUploading(true);
        try {
            const uploadedList: ChatAttachment[] = [];
            for (const file of files) {
                const uploaded = await uploadAttachment(file);
                uploadedList.push(uploaded);
            }
            setAttachments(prev => [...prev, ...uploadedList]);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Upload failed';
            alert(`Upload failed: ${msg}`);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        await uploadFiles(files);
    };

    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                const file = items[i].getAsFile();
                if (file) files.push(file);
            }
        }
        if (files.length > 0) {
            e.preventDefault();
            await uploadFiles(files);
        }
    };

    const handleRemoveAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async () => {
        if ((!text.trim() && attachments.length === 0) || isSending || isUploading || disabled) return;

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        onStopTyping();

        const content = text;
        const currentAttachments = [...attachments];

        setText('');
        setAttachments([]);
        setShowEmojiPicker(false);
        setIsSending(true);

        try {
            await onSendMessage(content, currentAttachments);
        } catch (err) {
            console.error('Failed to send message:', err);
            // Restore draft if failed
            setText(content);
            setAttachments(currentAttachments);
        } finally {
            setIsSending(false);
            setTimeout(() => {
                textareaRef.current?.focus();
            }, 50);
        }
    };

    useEffect(() => {
        return () => {
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        };
    }, []);

    const canSend = (text.trim().length > 0 || attachments.length > 0) && !isSending && !isUploading;

    const sendTooltip = attachments.length > 0 && text.trim().length > 0
        ? 'Send message with attachments (Enter)'
        : attachments.length > 0
        ? 'Send attachments alone (Enter)'
        : 'Send message (Enter)';

    const placeholderText = attachments.length > 0
        ? 'Add a message (optional), or press Enter to send attachments alone...'
        : 'Type a message (Enter to send, Shift+Enter for new line)...';

    return (
        <div className="cw-input-bar">
            {/* Attachments Preview */}
            {attachments.length > 0 && (
                <div className="cw-attach-preview-container">
                    {attachments.map((att, idx) => {
                        const badge = getFileTypeBadge(att.originalName || att.filename);
                        return (
                            <div key={idx} className="cw-attach-preview-chip">
                                <span className={`cw-attach-badge ${badge.className}`}>{badge.label}</span>
                                <span
                                    style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    title={att.originalName || att.filename}
                                >
                                    {att.originalName || att.filename}
                                </span>
                                {att.size > 0 && (
                                    <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                                        ({formatSize(att.size)})
                                    </span>
                                )}
                                <button
                                    type="button"
                                    className="cw-attach-remove-btn"
                                    onClick={() => handleRemoveAttachment(idx)}
                                    title="Remove attachment"
                                >
                                    ✕
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {isUploading && (
                <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="cw-typing-dot" style={{ background: 'var(--color-primary, #1e4fd8)' }} />
                    Uploading attachment(s)...
                </div>
            )}

            {/* Emoji Picker Popup */}
            {showEmojiPicker && (
                <div className="cw-emoji-popup">
                    {COMMON_EMOJIS.map(em => (
                        <button
                            key={em}
                            type="button"
                            className="cw-emoji-btn"
                            onClick={() => handleEmojiClick(em)}
                        >
                            {em}
                        </button>
                    ))}
                </div>
            )}

            {/* Input Controls */}
            <div className="cw-input-controls">
                {/* Hidden File Input allowing all file types and multiple selection */}
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                    multiple
                />

                {/* Attachment Button */}
                <button
                    type="button"
                    className="cw-action-icon-btn"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach files (PDF, image, Excel, Word, CAD, ZIP, etc. max 50MB)"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                </button>

                {/* Emoji Toggle */}
                <button
                    type="button"
                    className="cw-action-icon-btn"
                    onClick={() => setShowEmojiPicker(prev => !prev)}
                    title="Insert emoji"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                        <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3" />
                        <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3" />
                    </svg>
                </button>

                {/* Textarea with paste support */}
                <textarea
                    ref={textareaRef}
                    className="cw-input-textarea"
                    rows={1}
                    placeholder={placeholderText}
                    value={text}
                    onChange={handleTextChange}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    disabled={disabled || isSending}
                />

                {/* Send Button */}
                <button
                    type="button"
                    className="cw-send-btn"
                    onClick={handleSubmit}
                    disabled={!canSend}
                    title={sendTooltip}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" />
                    </svg>
                </button>
            </div>
        </div>
    );
};
