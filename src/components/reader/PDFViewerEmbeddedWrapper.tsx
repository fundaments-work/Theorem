/**
 * PDFViewerEmbeddedWrapper - Wrapper around PDFViewerEmbedded that exposes the same interface as PDFViewer
 *
 * This allows seamless integration with Reader.tsx without changing the consuming code.
 */

import {
    forwardRef,
    useRef,
    useImperativeHandle,
    useCallback,
    useState,
} from "react";
import {
    PDFViewerEmbedded,
    type PDFViewerHandle as EmbeddedHandle,
} from "./PDFViewerEmbedded";
import type { PDFViewerProps, PDFViewerHandle } from "./PDFViewer";
import type { DocMetadata, DocLocation, TocItem } from "@/types";

export const PDFViewerEmbeddedWrapper = forwardRef<
    PDFViewerHandle,
    PDFViewerProps
>(
    (
        {
            file,
            scale = 1.0,
            initialPage,
            initialLocation,
            onReady,
            onLocationChange,
            onError,
            onPageChange,
            onZoomChange,
            className,
        },
        ref
    ) => {
        const innerRef = useRef<EmbeddedHandle>(null);
        const [metadata, setMetadata] = useState<DocMetadata | null>(null);
        const [toc, setToc] = useState<TocItem[]>([]);

        // Convert initialLocation (cfi format like "pdf:page=5") to page number
        const computedInitialPage = (() => {
            if (initialPage !== undefined) return initialPage;
            if (!initialLocation) return 1;
            const match = initialLocation.match(/page=(\d+)/);
            return match ? parseInt(match[1], 10) : 1;
        })();

        // Handle ready from embedded viewer
        const handleReady = useCallback(() => {
            // PDF.js viewer doesn't expose metadata directly, so we create minimal metadata
            const meta: DocMetadata = {
                title: file instanceof File ? file.name : "PDF Document",
                author: "",
            };
            setMetadata(meta);

            // Create minimal TOC with just page numbers (will be populated when we know total pages)
            const minimalToc: TocItem[] = [];
            setToc(minimalToc);

            onReady?.(meta, minimalToc);
        }, [file, onReady]);

        // Handle page change
        const handlePageChange = useCallback(
            (page: number, totalPages: number) => {
                onPageChange?.(page);

                // Also call location change with proper format
                const location: DocLocation = {
                    cfi: `pdf:page=${page}`,
                    percentage: totalPages > 0 ? (page - 1) / totalPages : 0,
                    pageInfo: {
                        currentPage: page,
                        totalPages: totalPages,
                        endPage: totalPages,
                        range: `${page}`,
                    },
                };
                onLocationChange?.(location);

                // Update TOC once we know total pages
                if (totalPages > 0 && toc.length === 0) {
                    const pageToc: TocItem[] = Array.from(
                        { length: Math.min(totalPages, 50) },
                        (_, i) => ({
                            id: `page-${i + 1}`,
                            label: `Page ${i + 1}`,
                            href: `#page=${i + 1}`,
                        })
                    );
                    setToc(pageToc);
                }
            },
            [onPageChange, onLocationChange, toc.length]
        );

        // Expose imperative handle
        useImperativeHandle(
            ref,
            () => ({
                goTo: (location: string) => {
                    const match = location.match(/page=(\d+)/);
                    if (match) {
                        innerRef.current?.goToPage(parseInt(match[1], 10));
                    }
                },
                goToPage: (pageNumber: number) => {
                    innerRef.current?.goToPage(pageNumber);
                },
                goToFraction: (fraction: number) => {
                    const totalPages = innerRef.current?.getTotalPages() || 1;
                    const page = Math.max(1, Math.round(fraction * totalPages));
                    innerRef.current?.goToPage(page);
                },
                getCurrentPage: () => {
                    return innerRef.current?.getCurrentPage() || 1;
                },
                zoomIn: () => {
                    innerRef.current?.zoomIn();
                },
                zoomOut: () => {
                    innerRef.current?.zoomOut();
                },
                setZoom: (scaleValue: number) => {
                    innerRef.current?.setZoom(scaleValue);
                },
                fitPage: () => {
                    innerRef.current?.fitPage();
                },
                fitWidth: () => {
                    innerRef.current?.fitWidth();
                },
                rotate: () => {
                    // Rotation not directly supported in iframe viewer
                    // Could implement via postMessage if needed
                    console.warn("Rotate not supported in embedded viewer");
                },
            }),
            []
        );

        return (
            <PDFViewerEmbedded
                ref={innerRef}
                file={file}
                initialPage={computedInitialPage}
                scale={scale}
                onReady={handleReady}
                onPageChange={handlePageChange}
                onZoomChange={onZoomChange}
                onError={onError}
                className={className}
            />
        );
    }
);

PDFViewerEmbeddedWrapper.displayName = "PDFViewerEmbeddedWrapper";
