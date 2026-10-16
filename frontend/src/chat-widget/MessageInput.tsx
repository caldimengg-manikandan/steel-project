/**
 * ============================================================
 * Chat Module: Message Input Component
 * ============================================================
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

export const MessageInput: React.FC<MessageInputProps> = ({
    onSendMessage,
    onTyping,
    onStopTyping,
    disabled = false,
}) => {
    const [text, setText] = useState('');
    const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
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

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 10 * 1024 * 1024) {
            alert('File size exceeds the 10MB limit.');
            return;
        }

        setIsUploading(true);
        try {
            const uploaded = await uploadAttachment(file);
            setAttachment(uploaded);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Upload failed';
            alert(`Upload failed: ${msg}`);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleSubmit = async () => {
        if ((!text.trim() && !attachment) || isSending || isUploading || disabled) return;

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        onStopTyping();

        const content = text;
        const currentAttachment = attachment ? [attachment] : [];

        setText('');
        setAttachment(null);
        setShowEmojiPicker(false);
        setIsSending(true);

        try {
            await onSendMessage(content, currentAttachment);
        } catch (err) {
            console.error('Failed to send message:', err);
            // Restore draft if failed
            setText(content);
            if (currentAttachment.length > 0) setAttachment(currentAttachment[0]);
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

    const canSend = (text.trim().length > 0 || attachment !== null) && !isSending && !isUploading;

    return (
        <div className="cw-input-bar">
            {/* Attachment Preview */}
            {attachment && (
                <div className="cw-attach-preview-box">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                    <span style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {attachment.originalName || attachment.filename}
                    </span>
                    <button
                        className="cw-attach-remove-btn"
                        onClick={() => setAttachment(null)}
                        title="Remove attachment"
                    >
                        ✕
                    </button>
                </div>
            )}

            {isUploading && (
                <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="cw-typing-dot" style={{ background: 'var(--color-primary, #1e4fd8)' }} />
                    Uploading attachment...
                </div>
            )}

            {/* Emoji Picker Popup */}
            {showEmojiPicker && (
                <div className="cw-emoji-popup">
                    {COMMON_EMOJIS.map(em => (
                        <button
                            key={em}
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
                {/* Hidden File Input */}
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                />

                {/* Attachment Button */}
                <button
                    type="button"
                    className="cw-action-icon-btn"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach file or image (max 10MB)"
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

                {/* Textarea */}
                <textarea
                    ref={textareaRef}
                    className="cw-input-textarea"
                    rows={1}
                    placeholder="Type a message (Enter to send, Shift+Enter for new line)..."
                    value={text}
                    onChange={handleTextChange}
                    onKeyDown={handleKeyDown}
                    disabled={disabled || isSending}
                />

                {/* Send Button */}
                <button
                    type="button"
                    className="cw-send-btn"
                    onClick={handleSubmit}
                    disabled={!canSend}
                    title="Send message"
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
