import React, { useRef, useState } from 'react';
import type { SubViewerProps } from '../types';

export default function AudioViewer({ file, fileBlobUrl }: SubViewerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [speed, setSpeed] = useState<number>(1);
    const [error, setError] = useState(false);

    function handleSpeedChange(newSpeed: number) {
        setSpeed(newSpeed);
        if (audioRef.current) {
            audioRef.current.playbackRate = newSpeed;
        }
    }

    if (error) {
        return (
            <div className="m365-error-state">
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Unable to play audio</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                    The audio format might not be supported or the file is corrupted.
                </div>
            </div>
        );
    }

    return (
        <div className="m365-media-canvas">
            <div className="m365-audio-card">
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                    </svg>
                </div>

                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#000000', marginBottom: 4 }}>
                        {file.filename}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Audio File Preview</div>
                </div>

                <audio
                    ref={audioRef}
                    src={fileBlobUrl || file.url}
                    controls
                    style={{ width: '100%' }}
                    onError={() => setError(true)}
                >
                    Your browser does not support HTML5 audio playback.
                </audio>

                {/* Speed selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: '#605e5c', fontWeight: 600 }}>Speed:</span>
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => handleSpeedChange(s)}
                            style={{
                                border: 'none',
                                background: speed === s ? '#0078d4' : '#f3f2f1',
                                color: speed === s ? '#ffffff' : '#323130',
                                borderRadius: 10,
                                padding: '2px 7px',
                                fontSize: 11,
                                fontWeight: speed === s ? 700 : 500,
                                cursor: 'pointer',
                            }}
                        >
                            {s}x
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
