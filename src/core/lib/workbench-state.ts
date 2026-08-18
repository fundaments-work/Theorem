export type WorkbenchFilter = "all" | "highlights" | "notes" | "vocabulary";
export type WorkbenchSort = "newest" | "oldest" | "book";
export type WorkbenchViewMode = "list" | "cards";

export interface WorkbenchViewState {
    viewMode?: WorkbenchViewMode;
    activeFilter?: WorkbenchFilter;
    sortBy?: WorkbenchSort;
    bookId?: string;
    cardId?: string;
}

export interface WorkbenchGroupLike {
    bookId: string;
    annotations: { id: string }[];
}

export const WORKBENCH_VIEW_STATE_KEY = "theorem-workbench:view-state";

export function encodeWorkbenchViewState(state: WorkbenchViewState): string {
    return JSON.stringify(state);
}

export function decodeWorkbenchViewState(raw: string | null): WorkbenchViewState {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as WorkbenchViewState;
        if (typeof parsed !== "object" || parsed === null) return {};
        return parsed;
    } catch {
        return {};
    }
}

export function resolveWorkbenchPosition(
    groups: WorkbenchGroupLike[],
    state: WorkbenchViewState,
): { groupIndex: number; cardIndex: number } | null {
    if (!state.bookId || !state.cardId) return null;
    const groupIndex = groups.findIndex((g) => g.bookId === state.bookId);
    if (groupIndex === -1) return null;
    const cardIndex = groups[groupIndex].annotations.findIndex((a) => a.id === state.cardId);
    if (cardIndex === -1) return null;
    return { groupIndex, cardIndex };
}