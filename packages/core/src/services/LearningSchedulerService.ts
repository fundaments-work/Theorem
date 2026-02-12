import {
    createEmptyCard,
    fsrs,
    Rating,
    type Card,
    type Grade,
} from "ts-fsrs";
import type {
    LearningReviewSchedulerState,
    ReviewGrade,
} from "@/types";

const scheduler = fsrs({
    enable_fuzz: true,
    enable_short_term: true,
});

function toDate(value: Date | string | number | undefined): Date | undefined {
    if (!value) {
        return undefined;
    }
    if (value instanceof Date) {
        return value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function serializeCard(card: Card): LearningReviewSchedulerState {
    return {
        due: card.due,
        stability: card.stability,
        difficulty: card.difficulty,
        elapsed_days: card.elapsed_days,
        scheduled_days: card.scheduled_days,
        learning_steps: card.learning_steps,
        reps: card.reps,
        lapses: card.lapses,
        state: card.state,
        last_review: card.last_review,
    };
}

function normalizeCard(state: LearningReviewSchedulerState): Card {
    return {
        due: toDate(state.due) ?? new Date(),
        stability: state.stability,
        difficulty: state.difficulty,
        elapsed_days: state.elapsed_days,
        scheduled_days: state.scheduled_days,
        learning_steps: state.learning_steps,
        reps: state.reps,
        lapses: state.lapses,
        state: state.state,
        last_review: toDate(state.last_review),
    };
}

function toGrade(grade: ReviewGrade): Grade {
    switch (grade) {
        case "again":
            return Rating.Again;
        case "hard":
            return Rating.Hard;
        case "good":
            return Rating.Good;
        case "easy":
            return Rating.Easy;
    }
}

export interface SchedulerReviewResult {
    scheduler: LearningReviewSchedulerState;
    dueAt: Date;
    sourceState: number;
    nextState: number;
}

/**
 * Creates a brand-new scheduler state for a newly enrolled review item.
 */
export function createInitialReviewSchedulerState(
    now: Date = new Date(),
): LearningReviewSchedulerState {
    const card = createEmptyCard(now);
    return serializeCard(card);
}

/**
 * Ensures persisted scheduler fields are converted back into runtime values.
 */
export function normalizeReviewSchedulerState(
    state: LearningReviewSchedulerState,
): LearningReviewSchedulerState {
    const normalized = normalizeCard(state);
    return serializeCard(normalized);
}

/**
 * Runs a single FSRS review transition for a review item.
 */
export function reviewItemSchedulerState(
    schedulerState: LearningReviewSchedulerState,
    grade: ReviewGrade,
    now: Date = new Date(),
): SchedulerReviewResult {
    const inputCard = normalizeCard(schedulerState);
    const result = scheduler.next(inputCard, now, toGrade(grade));

    return {
        scheduler: serializeCard(result.card),
        dueAt: result.card.due,
        sourceState: result.log.state,
        nextState: result.card.state,
    };
}
