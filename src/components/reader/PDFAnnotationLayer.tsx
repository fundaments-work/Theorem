import React, { useRef, useState } from 'react';
import { Annotation } from '@/types';
import { cn } from '@/lib/utils';

interface PDFAnnotationLayerProps {
    pageNumber: number;
    annotations: Annotation[];
    mode: 'none' | 'highlight' | 'pen' | 'text' | 'erase';
    scale: number;
    onAnnotationAdd: (annotation: Partial<Annotation>) => void;
    onAnnotationRemove: (id: string) => void;
}

export const PDFAnnotationLayer: React.FC<PDFAnnotationLayerProps> = ({
    pageNumber,
    annotations,
    mode,
    scale,
    onAnnotationAdd,
    onAnnotationRemove
}) => {
    const layerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const currentPathRef = useRef<{ x: number; y: number }[]>([]);

    // Filter annotations for this page
    const pageAnnotations = annotations.filter(a => a.pageNumber === pageNumber);

    // Drawing handlers
    const handlePointerDown = (e: React.PointerEvent) => {
        if (mode !== 'pen') return;
        // console.log('[PDFAnnotationLayer] Pointer down');
        e.preventDefault(); // Prevent scrolling
        e.stopPropagation();

        setIsDrawing(true);
        const rect = layerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = (e.clientX - rect.left) / scale;
        const y = (e.clientY - rect.top) / scale;
        currentPathRef.current = [{ x, y }];

        // Start path on temp canvas
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
            ctx.beginPath();
            ctx.moveTo(x * scale, y * scale);
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDrawing || mode !== 'pen') return;
        e.preventDefault();

        const rect = layerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = (e.clientX - rect.left) / scale;
        const y = (e.clientY - rect.top) / scale;
        currentPathRef.current.push({ x, y });

        // Draw real-time feedback
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
            ctx.lineWidth = 2 * scale;
            ctx.lineCap = 'round';
            ctx.strokeStyle = 'red'; // Default pen color
            ctx.lineTo(x * scale, y * scale);
            ctx.stroke();
        }
    };

    const handlePointerUp = () => {
        if (!isDrawing) return;
        setIsDrawing(false);

        if (currentPathRef.current.length > 1) {
            // Save annotation
            onAnnotationAdd({
                type: 'note', // Using generic note type with pdf subtype
                pdfAnnotationType: 'drawing',
                drawingData: JSON.stringify(currentPathRef.current),
                pageNumber: pageNumber,
                color: 'red',
            });
        }
        currentPathRef.current = [];

        // Clear temp canvas (real annotation will render via props)
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.beginPath(); // Reset path
        }
    };

    // Render existing drawing annotations as SVGs
    const renderDrawing = (annotation: Annotation) => {
        if (!annotation.drawingData) return null;
        try {
            const points = JSON.parse(annotation.drawingData) as { x: number, y: number }[];
            if (!points || points.length < 2) return null;

            const pathData = points.map((p, i) =>
                `${i === 0 ? 'M' : 'L'} ${p.x * scale} ${p.y * scale}`
            ).join(' ');

            return (
                <svg key={annotation.id} className="absolute inset-0 w-full h-full pointer-events-none">
                    <path
                        d={pathData}
                        stroke={annotation.color || 'red'}
                        strokeWidth={2 * scale}
                        fill="none"
                        strokeLinecap="round"
                    />
                </svg>
            );
        } catch (e) {
            console.error('Failed to parse drawing data', e);
            return null;
        }
    };

    return (
        <div
            ref={layerRef}
            className={cn(
                "absolute inset-0 z-20",
                mode === 'pen' ? "cursor-crosshair touch-none" : "pointer-events-none"
            )}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
        >
            {/* Drawing Interface Canvas (Temp while drawing) */}
            {mode === 'pen' && (
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    width={layerRef.current?.clientWidth || 0}
                    height={layerRef.current?.clientHeight || 0}
                />
            )}

            {/* Render Annotations */}
            {pageAnnotations.map(annotation => (
                <div key={annotation.id} className="absolute inset-0 pointer-events-none">
                    {annotation.pdfAnnotationType === 'drawing' && renderDrawing(annotation)}

                    {annotation.type === 'highlight' && (
                        // Highlights need text selection rects - complex, skipping for now
                        // Placeholder
                        <div className="hidden" />
                    )}

                    {annotation.type === 'bookmark' && (
                        // Bookmarks are page-level, typically shown in UI not on page, but we could add an icon
                        <div className="absolute top-0 right-0 p-2 opacity-50">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="red">
                                <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" />
                            </svg>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};
