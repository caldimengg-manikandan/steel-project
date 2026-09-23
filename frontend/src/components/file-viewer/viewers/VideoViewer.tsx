import React, { useRef, useState } from 'react';
import type { SubViewerProps } from '../types';

export default function VideoViewer({ file }: SubViewerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [speed, setSpeed] = useState<number>(1);
    const [error, setError] = useState(false);

    function handleSpeedChange(newSpeed: number) {
        setSpeed(newSpeed);
        if (videoRef.current) {
            videoRef.current.playbackRate = newSpeed;
        }
    }

    if (error) {
        return (
            <div className="m365-error-state">
                <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Unable to play video</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                    The video format might not be supported by your browser or the file is corrupted.
                </div>
            </div>
        );
    }

    return (
        <div className="m365-media-canvas" style={{ gap: 14 }}>
            <video
                ref={videoRef}
                src={file.url}
                controls
                autoPlay={false}
                className="m365-video-player"
                onError={() => setError(true)}
            >
                Your browser does not support HTML5 video playback.
            </video>

            {/* Sub-bar for playback speed control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#ffffff', padding: '4px 12px', borderRadius: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <span style={{ fontSize: 12, color: '#605e5c', fontWeight: 600 }}>Speed:</span>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                    <button
                        key={s}
                        type="button"
                        onClick={() => handleSpeedChange(s)}
                        style={{
                            border: 'none',
                            background: speed === s ? '#0078d4' : 'transparent',
                            color: speed === s ? '#ffffff' : '#323130',
                            borderRadius: 12,
                            padding: '2px 8px',
                            fontSize: 11.5,
                            fontWeight: speed === s ? 700 : 500,
                            cursor: 'pointer',
                        }}
                    >
                        {s}x
                    </button>
                ))}
            </div>
        </div>
    );
}
