// ============================================================
// SlideCanvas: Responsive, Vector Slide Renderer for PPTX
// Renders both full-resolution slide canvas and mini thumbnails
// ============================================================

import React from 'react';
import type { ParsedSlide, SlideElement } from './pptxParser';

interface SlideCanvasProps {
    slide: ParsedSlide;
    aspectRatio: number;
    isThumbnail?: boolean;
    className?: string;
    style?: React.CSSProperties;
}

export const SlideCanvas: React.FC<SlideCanvasProps> = React.memo(({
    slide,
    aspectRatio,
    isThumbnail = false,
    className = '',
    style = {},
}) => {
    return (
        <div
            className={`pptx-slide-canvas ${isThumbnail ? 'is-thumbnail' : 'is-main'} ${className}`}
            style={{
                aspectRatio: `${aspectRatio}`,
                backgroundColor: slide.bgColor || '#ffffff',
                backgroundImage: slide.bgImageUrl ? `url(${slide.bgImageUrl})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                position: 'relative',
                overflow: 'hidden',
                ...style,
            }}
        >
            {slide.elements.map((el: SlideElement) => {
                const elStyle: React.CSSProperties = {
                    position: 'absolute',
                    left: `${el.x}%`,
                    top: `${el.y}%`,
                    width: `${el.width}%`,
                    height: `${el.height}%`,
                    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                    backgroundColor: el.bg,
                    border: el.borderColor ? `${el.borderWidth || 1}px solid ${el.borderColor}` : undefined,
                    borderRadius: el.borderRadius || 0,
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                };

                // Render Image
                if (el.type === 'image' && el.imageUrl) {
                    return (
                        <div key={el.id} style={elStyle} className="pptx-element-image">
                            <img
                                src={el.imageUrl}
                                alt="Slide graphic"
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'contain',
                                    display: 'block',
                                    pointerEvents: 'none',
                                }}
                                loading={isThumbnail ? 'lazy' : 'eager'}
                            />
                        </div>
                    );
                }

                // Render Table
                if (el.type === 'table' && el.tableRows) {
                    return (
                        <div key={el.id} style={elStyle} className="pptx-element-table">
                            <table
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    borderCollapse: 'collapse',
                                    fontSize: isThumbnail ? '6px' : 'clamp(11px, 1.2vw, 15px)',
                                    lineHeight: 1.2,
                                }}
                            >
                                <tbody>
                                    {el.tableRows.map((row, rIdx) => (
                                        <tr key={rIdx}>
                                            {row.map((cell, cIdx) => (
                                                <td
                                                    key={cIdx}
                                                    style={{
                                                        padding: isThumbnail ? '1px 2px' : '4px 8px',
                                                        border: '1px solid #cbd5e1',
                                                        backgroundColor: cell.bg || '#ffffff',
                                                        fontWeight: cell.bold ? 700 : 400,
                                                        color: cell.color || '#1e293b',
                                                        textAlign: cell.align || 'left',
                                                    }}
                                                >
                                                    {cell.text}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );
                }

                // Render Text / Shape
                return (
                    <div
                        key={el.id}
                        style={{
                            ...elStyle,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'flex-start',
                            padding: isThumbnail ? '2px 4px' : '8px 12px',
                        }}
                        className={`pptx-element-text ${isThumbnail ? 'is-thumb-text' : ''}`}
                    >
                        {el.paragraphs?.map((p, pIdx) => {
                            const align = p.align || 'left';
                            const indent = p.level ? p.level * (isThumbnail ? 4 : 16) : 0;

                            return (
                                <div
                                    key={pIdx}
                                    style={{
                                        textAlign: align,
                                        paddingLeft: `${indent}px`,
                                        lineHeight: 1.25,
                                        marginBottom: isThumbnail ? '1px' : '4px',
                                        display: 'flex',
                                        alignItems: 'baseline',
                                        gap: p.bullet ? (isThumbnail ? '2px' : '6px') : 0,
                                    }}
                                >
                                    {p.bullet && (
                                        <span
                                            style={{
                                                fontSize: isThumbnail ? '5px' : '0.85em',
                                                color: '#64748b',
                                                userSelect: 'none',
                                            }}
                                        >
                                            •
                                        </span>
                                    )}
                                    <div style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                                        {p.runs.map((r, rIdx) => {
                                            // Scale font size proportionally for thumbnail vs main
                                            const baseSize = r.size || 14;
                                            const fontSize = isThumbnail
                                                ? Math.max(4, Math.round(baseSize * 0.22))
                                                : `clamp(11px, ${baseSize * 0.08}vw, ${baseSize * 1.3}px)`;

                                            return (
                                                <span
                                                    key={rIdx}
                                                    style={{
                                                        fontSize,
                                                        fontWeight: r.bold ? 700 : 400,
                                                        fontStyle: r.italic ? 'italic' : 'normal',
                                                        textDecoration: r.underline ? 'underline' : 'none',
                                                        color: r.color || '#1e293b',
                                                    }}
                                                >
                                                    {r.text}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
});
