import { useEffect, useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { Modal } from "@theorem/ui";
import { normalizeCardTextForDisplay } from "@theorem/core";
import { useLearningStore, useSettingsStore } from "@theorem/core";
import type { ReviewGrade, ReviewLaunchScope } from "@theorem/core";

const REVIEW_GRADES: Array<{ key: ReviewGrade; label: string; shortcut: string }> = [
    { key: "again", label: "Again", shortcut: "1" },
    { key: "hard", label: "Hard", shortcut: "2" },
    { key: "good", label: "Good", shortcut: "3" },
    { key: "easy", label: "Easy", shortcut: "4" },
];

const GRADE_BUTTON_CLASSES: Record<ReviewGrade, string> = {
    again: "border-[var(--color-error)]/30 bg-[var(--color-error)]/8 text-[color:var(--color-error)]",
    hard: "border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 text-[color:var(--color-warning)]",
    good: "border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 text-[color:var(--color-accent)]",
    easy: "border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[color:var(--color-success)]",
};

const SCOPE_LABELS: Record<ReviewLaunchScope, string> = {
    all: "All Sources",
    vocabulary: "Vocabulary",
    highlight: "Highlights",
};

/**
 * Shared review session modal mounted globally and launched from multiple pages.
 */
export function ReviewSessionModal() {
    const reviewRecords = useLearningStore((state) => state.reviewRecords);
    const reviewSessionState = useLearningStore((state) => state.reviewSessionState);
    const getDueReviewItems = useLearningStore((state) => state.getDueReviewItems);
    const reviewItem = useLearningStore((state) => state.reviewItem);
    const markDailyReviewCompleted = useLearningStore((state) => state.markDailyReviewCompleted);
    const openReviewSession = useLearningStore((state) => state.openReviewSession);
    const closeReviewSession = useLearningStore((state) => state.closeReviewSession);
    const updateReviewSessionState = useLearningStore((state) => state.updateReviewSessionState);
    const dailyGoal = useSettingsStore((state) => state.settings.learning.dailyReviewGoal);

    const dueReviewItems = useMemo(
        () => getDueReviewItems(new Date(), reviewSessionState.scope),
        [getDueReviewItems, reviewRecords, reviewSessionState.scope],
    );
    const reviewItemMap = useMemo(
        () => new Map(dueReviewItems.map((item) => [item.id, item])),
        [dueReviewItems],
    );

    const sessionLength = reviewSessionState.sessionItemIds.length;
    const isSessionOpen = reviewSessionState.isOpen;
    const isSessionComplete = isSessionOpen && reviewSessionState.cursor >= sessionLength;
    const activeItem = useMemo(() => {
        if (!isSessionOpen || isSessionComplete) {
            return null;
        }

        const currentId = reviewSessionState.sessionItemIds[reviewSessionState.cursor];
        if (!currentId) {
            return null;
        }

        return reviewItemMap.get(currentId) || null;
    }, [isSessionComplete, isSessionOpen, reviewItemMap, reviewSessionState.cursor, reviewSessionState.sessionItemIds]);

    const goalProgress = Math.min(
        100,
        Math.round((reviewSessionState.reviewedCount / Math.max(1, dailyGoal)) * 100),
    );
    const reviewFaceText = activeItem
        ? normalizeCardTextForDisplay(
            reviewSessionState.revealed
                ? (activeItem.back || "(No answer)")
                : activeItem.front,
        )
        : "";

    function handleGrade(grade: ReviewGrade) {
        if (!activeItem) {
            return;
        }

        reviewItem(activeItem.sourceType, activeItem.sourceId, grade);
        updateReviewSessionState({
            gradeTally: {
                ...reviewSessionState.gradeTally,
                [grade]: reviewSessionState.gradeTally[grade] + 1,
            },
            reviewedCount: reviewSessionState.reviewedCount + 1,
            cursor: reviewSessionState.cursor + 1,
            revealed: false,
        });
    }

    useEffect(() => {
        if (isSessionComplete && reviewSessionState.reviewedCount > 0) {
            markDailyReviewCompleted();
        }
    }, [isSessionComplete, markDailyReviewCompleted, reviewSessionState.reviewedCount]);

    useEffect(() => {
        if (!isSessionOpen || isSessionComplete || activeItem) {
            return;
        }
        if (reviewSessionState.cursor >= sessionLength) {
            return;
        }
        updateReviewSessionState({
            cursor: reviewSessionState.cursor + 1,
            revealed: false,
        });
    }, [
        activeItem,
        isSessionComplete,
        isSessionOpen,
        reviewSessionState.cursor,
        sessionLength,
        updateReviewSessionState,
    ]);

    useEffect(() => {
        if (!isSessionOpen) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeReviewSession();
                return;
            }
            if (isSessionComplete || !activeItem) {
                return;
            }
            if (!reviewSessionState.revealed && event.key === " ") {
                event.preventDefault();
                updateReviewSessionState({ revealed: true });
                return;
            }

            const matched = REVIEW_GRADES.find((item) => item.shortcut === event.key);
            if (!matched || !reviewSessionState.revealed) {
                return;
            }
            event.preventDefault();
            handleGrade(matched.key);
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [
        activeItem,
        closeReviewSession,
        handleGrade,
        isSessionComplete,
        isSessionOpen,
        reviewSessionState.revealed,
        updateReviewSessionState,
    ]);

    return (
        <Modal
            isOpen={isSessionOpen}
            onClose={closeReviewSession}
            size="fullscreen"
            className="bg-[var(--color-background)]"
        >
            <div className="flex h-full flex-col">
                <header className="border-b border-[var(--color-border)] px-6 py-4">
                    <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-semibold text-[color:var(--color-text-primary)]">
                                Review
                            </h3>
                            <p className="text-xs text-[color:var(--color-text-muted)]">
                                {SCOPE_LABELS[reviewSessionState.scope]} • Item {Math.min(reviewSessionState.cursor + 1, Math.max(1, sessionLength))} of {sessionLength}
                            </p>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="w-48">
                                <p className="mb-1 text-right text-xs text-[color:var(--color-text-muted)]">
                                    Goal {Math.min(reviewSessionState.reviewedCount, dailyGoal)} / {dailyGoal}
                                </p>
                                <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
                                    <div
                                        className="h-full rounded-full bg-[var(--color-accent)] transition-all"
                                        style={{ width: `${goalProgress}%` }}
                                    />
                                </div>
                            </div>
                            <button onClick={closeReviewSession} className="ui-btn ui-btn-ghost">
                                Exit
                            </button>
                        </div>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto px-6 py-8">
                    <div className="mx-auto flex h-full w-full max-w-6xl flex-col items-center justify-center">
                        {isSessionComplete ? (
                            <div className="ui-card w-full  space-y-4 p-8 text-center">
                                <h4 className="text-xl font-semibold text-[color:var(--color-text-primary)]">
                                    Session Complete
                                </h4>
                                <p className="text-sm text-[color:var(--color-text-secondary)]">
                                    Reviewed {reviewSessionState.reviewedCount} item{reviewSessionState.reviewedCount === 1 ? "" : "s"}.
                                </p>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {REVIEW_GRADES.map((item) => (
                                        <div
                                            key={item.key}
                                            className="rounded-lg bg-[var(--color-surface-muted)] px-3 py-2 text-sm"
                                        >
                                            <span className="font-medium text-[color:var(--color-text-primary)]">
                                                {item.label}
                                            </span>
                                            <span className="ml-2 text-[color:var(--color-text-secondary)]">
                                                {reviewSessionState.gradeTally[item.key]}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center justify-center gap-2">
                                    <button
                                        onClick={() => openReviewSession(reviewSessionState.scope)}
                                        className="ui-btn ui-btn-ghost"
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                        Review Remaining
                                    </button>
                                    <button onClick={closeReviewSession} className="ui-btn ui-btn-primary">
                                        Close Session
                                    </button>
                                </div>
                            </div>
                        ) : activeItem ? (
                            <div className="flex w-full flex-col items-center gap-8">
                                <article className="w-full max-w-5xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-10 shadow-[var(--shadow-md)]">
                                    <p className="mb-5 text-center text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--color-text-muted)]">
                                        {reviewSessionState.revealed ? "Back" : "Front"}
                                    </p>
                                    <div className="flex min-h-[300px] w-full items-center justify-center px-4">
                                        <div className="w-full">
                                            <p className="block w-full break-words whitespace-pre-wrap text-center text-3xl leading-relaxed text-[color:var(--color-text-primary)]">
                                                {reviewFaceText}
                                            </p>
                                        </div>
                                    </div>
                                </article>
                            </div>
                        ) : (
                            <div className="text-sm text-[color:var(--color-text-secondary)]">
                                Preparing review queue...
                            </div>
                        )}
                    </div>
                </main>

                {!isSessionComplete && activeItem && (
                    <footer className="border-t border-[var(--color-border)] px-6 py-4">
                        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3">
                            {!reviewSessionState.revealed ? (
                                <>
                                    <p className="text-xs text-[color:var(--color-text-muted)]">
                                        Press Space to reveal answer.
                                    </p>
                                    <button
                                        onClick={() => updateReviewSessionState({ revealed: true })}
                                        className="ui-btn ui-btn-primary min-w-52"
                                    >
                                        Show Answer
                                    </button>
                                </>
                            ) : (
                                <>
                                    <p className="text-xs text-[color:var(--color-text-muted)]">
                                        Rate your recall (1/2/3/4 shortcuts).
                                    </p>
                                    <div className="grid w-full max-w-5xl grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                        {REVIEW_GRADES.map((item) => (
                                            <button
                                                key={item.key}
                                                onClick={() => handleGrade(item.key)}
                                                className={[
                                                    "w-full min-h-12 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors",
                                                    "hover:opacity-90",
                                                    GRADE_BUTTON_CLASSES[item.key],
                                                ].join(" ")}
                                            >
                                                {item.label} ({item.shortcut})
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </footer>
                )}
            </div>
        </Modal>
    );
}
