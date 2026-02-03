/**
 * Render Queue - Priority-based async rendering with cancellation
 * 
 * Based on Mozilla PDF.js techniques:
 * - Priority queue (visible pages first, then adjacent based on scroll direction)
 * - Holes detection (fill gaps in visible range)
 * - Concurrent render limiting (prevents UI blocking)
 * - Cancellation support (stale renders cancelled on scroll)
 * - Error handling with graceful degradation
 */

import type { RenderJob, RenderQueueStats } from "./types";

interface QueuedJob extends RenderJob {
    id: string;
    addedAt: number;
}

// PDF.js render task interface
interface PDFRenderTask {
    promise: Promise<void>;
    cancel(): void;
}

/**
 * Clamp value to safe range
 */
function clampSafe(value: number, min: number, max: number): number {
    if (!isFinite(value) || isNaN(value)) return min;
    return Math.max(min, Math.min(max, value));
}

export class RenderQueue {
    private queue: QueuedJob[] = [];
    private activeRenders: Map<number, RenderTask> = new Map();
    private maxConcurrent: number;
    private processing = false;
    private lastScrollDirection: "up" | "down" | "none" = "down";

    constructor(maxConcurrent = 2) {
        this.maxConcurrent = clampSafe(maxConcurrent, 1, 10);
    }

    /**
     * Add a job to the queue with automatic priority calculation
     */
    async add(job: RenderJob): Promise<void> {
        // Cancel any existing render for this page
        this.cancel(job.pageNumber);

        // Create queued job with unique ID
        const queuedJob: QueuedJob = {
            ...job,
            id: `${job.pageNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            addedAt: performance.now(),
        };

        // Add to queue and sort by priority
        this.queue.push(queuedJob);
        this.sortQueue();

        // Process queue
        await this.process();
    }

    /**
     * Update scroll direction for priority calculation
     */
    setScrollDirection(direction: "up" | "down" | "none"): void {
        this.lastScrollDirection = direction;
        // Re-sort queue with new direction
        if (this.queue.length > 1) {
            this.sortQueue();
        }
    }

    /**
     * Get the highest priority job based on visible pages and scroll direction
     * Similar to PDF.js's getHighestPriority
     */
    getHighestPriority(
        visiblePageIds: Set<number>,
        allPageIds: number[],
        scrolledDown: boolean
    ): QueuedJob | null {
        // Filter queue to only include relevant jobs
        const visibleJobs = this.queue.filter(job => visiblePageIds.has(job.pageNumber));
        const otherJobs = this.queue.filter(job => !visiblePageIds.has(job.pageNumber));

        // 1. Priority: visible pages with highest priority value
        if (visibleJobs.length > 0) {
            // Sort by priority and return highest
            visibleJobs.sort((a, b) => b.priority - a.priority);
            return visibleJobs[0];
        }

        // 2. Priority: pages adjacent to visible (based on scroll direction)
        if (allPageIds.length > 0 && otherJobs.length > 0) {
            const visibleArray = Array.from(visiblePageIds).sort((a, b) => a - b);
            const firstVisible = visibleArray[0];
            const lastVisible = visibleArray[visibleArray.length - 1];

            // Find holes in visible range and fill them
            if (firstVisible !== undefined && lastVisible !== undefined) {
                for (let i = firstVisible; i <= lastVisible; i++) {
                    if (!visiblePageIds.has(i)) {
                        const holeJob = otherJobs.find(j => j.pageNumber === i);
                        if (holeJob) return holeJob;
                    }
                }
            }

            // Then look for pages in scroll direction
            const adjacentPage = scrolledDown 
                ? (lastVisible !== undefined ? lastVisible + 1 : allPageIds[0])
                : (firstVisible !== undefined ? firstVisible - 1 : allPageIds[allPageIds.length - 1]);

            if (adjacentPage !== undefined && adjacentPage >= 1) {
                const adjacentJob = otherJobs.find(j => j.pageNumber === adjacentPage);
                if (adjacentJob) return adjacentJob;
            }
        }

        // 3. Priority: any job in queue (highest priority)
        if (otherJobs.length > 0) {
            otherJobs.sort((a, b) => b.priority - a.priority);
            return otherJobs[0];
        }

        return null;
    }

    /**
     * Cancel a specific page render
     */
    cancel(pageNumber: number): void {
        // Validate page number
        if (!isFinite(pageNumber)) return;

        // Remove from queue if pending
        this.queue = this.queue.filter(job => job.pageNumber !== pageNumber);

        // Cancel active render
        const active = this.activeRenders.get(pageNumber);
        if (active) {
            try {
                active.cancel();
            } catch (err) {
                // Ignore cancel errors
            }
            this.activeRenders.delete(pageNumber);
        }
    }

    /**
     * Cancel all renders
     */
    cancelAll(): void {
        // Clear queue
        this.queue = [];

        // Cancel all active
        for (const [pageNumber, task] of this.activeRenders) {
            try {
                task.cancel();
            } catch (err) {
                // Ignore cancel errors
            }
        }
        this.activeRenders.clear();
    }

    /**
     * Cancel renders for pages that are no longer visible
     */
    cancelInvisible(visiblePageIds: Set<number>): void {
        for (const [pageNumber, task] of this.activeRenders) {
            if (!visiblePageIds.has(pageNumber)) {
                try {
                    task.cancel();
                } catch (err) {
                    // Ignore cancel errors
                }
                this.activeRenders.delete(pageNumber);
            }
        }

        // Also remove invisible pages from queue
        this.queue = this.queue.filter(job => visiblePageIds.has(job.pageNumber));
    }

    /**
     * Get queue statistics
     */
    getStats(): RenderQueueStats {
        return {
            queueLength: this.queue.length,
            activeRenders: this.activeRenders.size,
            maxConcurrent: this.maxConcurrent,
        };
    }

    /**
     * Check if a page is currently being rendered
     */
    isRendering(pageNumber: number): boolean {
        return isFinite(pageNumber) && this.activeRenders.has(pageNumber);
    }

    /**
     * Check if a page has a pending render
     */
    isPending(pageNumber: number): boolean {
        if (!isFinite(pageNumber)) return false;
        return this.queue.some(job => job.pageNumber === pageNumber);
    }

    private sortQueue(): void {
        // Sort by priority (descending), with scroll direction affecting tie-breaking
        this.queue.sort((a, b) => {
            if (b.priority !== a.priority) {
                return b.priority - a.priority;
            }
            
            // If same priority, prefer pages in scroll direction
            if (this.lastScrollDirection === "down") {
                return a.pageNumber - b.pageNumber; // Lower page numbers first when scrolling down
            } else if (this.lastScrollDirection === "up") {
                return b.pageNumber - a.pageNumber; // Higher page numbers first when scrolling up
            }
            
            return a.addedAt - b.addedAt; // FCFS otherwise
        });
    }

    private async process(): Promise<void> {
        if (this.processing) return;
        if (this.activeRenders.size >= this.maxConcurrent) return;
        if (this.queue.length === 0) return;

        this.processing = true;

        try {
            while (
                this.activeRenders.size < this.maxConcurrent &&
                this.queue.length > 0
            ) {
                // Get highest priority job
                const job = this.getHighestPriority(
                    new Set(this.queue.map(j => j.pageNumber)),
                    this.queue.map(j => j.pageNumber),
                    this.lastScrollDirection === "down"
                );

                if (!job) break;

                // Remove from queue
                this.queue = this.queue.filter(j => j.id !== job.id);

                // Skip if already rendering this page
                if (this.activeRenders.has(job.pageNumber)) continue;

                // Start render
                await this.renderJob(job);
            }
        } finally {
            this.processing = false;
            // Check if more jobs can be processed
            if (this.queue.length > 0 && this.activeRenders.size < this.maxConcurrent) {
                this.process();
            }
        }
    }

    private async renderJob(job: QueuedJob): Promise<void> {
        const startTime = performance.now();

        try {
            const renderTask = job.page.render({
                canvasContext: job.ctx,
                viewport: job.viewport,
                background: "white",
                annotationMode: 1,
                intent: "display",
            } as unknown as Parameters<typeof job.page.render>[0]);

            this.activeRenders.set(job.pageNumber, renderTask);

            await renderTask.promise;

            const duration = performance.now() - startTime;
            if (duration > 100) {
                // Log slow renders for debugging
                console.debug(
                    `[PDF] Page ${job.pageNumber} rendered in ${duration.toFixed(1)}ms`
                );
            }

            job.onComplete?.();
        } catch (error) {
            this.handleRenderError(error, job);
        } finally {
            this.activeRenders.delete(job.pageNumber);
        }
    }

    private handleRenderError(error: unknown, job: QueuedJob): void {
        // Ignore cancellation errors
        if (error instanceof Error) {
            const msg = error.message.toLowerCase();
            if (msg.includes("cancelled") || msg.includes("aborted") || msg.includes("canceled")) {
                console.debug(`[PDF] Page ${job.pageNumber} render cancelled`);
                return;
            }
        }

        console.error(
            `[PDF] Page ${job.pageNumber} render error:`,
            error
        );
        job.onError?.(error as Error);
    }
}

// Type for render task (from pdf.js)
interface RenderTask {
    promise: Promise<void>;
    cancel(): void;
}
