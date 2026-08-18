import { describe, it, expect } from "vitest";
import {
    encodeWorkbenchViewState,
    decodeWorkbenchViewState,
    resolveWorkbenchPosition,
    WORKBENCH_VIEW_STATE_KEY,
} from "../src/core/lib/workbench-state";
import type { WorkbenchGroupLike } from "../src/core/lib/workbench-state";

describe("workbench view state", () => {
    const groups: WorkbenchGroupLike[] = [
        { bookId: "b1", annotations: [{ id: "a1" }, { id: "a2" }] },
        { bookId: "b2", annotations: [{ id: "a3" }, { id: "a4" }, { id: "a5" }] },
    ];

    it("round-trips through encode/decode", () => {
        const raw = encodeWorkbenchViewState({
            viewMode: "cards",
            activeFilter: "highlights",
            sortBy: "oldest",
            bookId: "b2",
            cardId: "a4",
        });
        expect(decodeWorkbenchViewState(raw)).toEqual({
            viewMode: "cards",
            activeFilter: "highlights",
            sortBy: "oldest",
            bookId: "b2",
            cardId: "a4",
        });
    });

    it("returns empty object for null or garbage", () => {
        expect(decodeWorkbenchViewState(null)).toEqual({});
        expect(decodeWorkbenchViewState("")).toEqual({});
        expect(decodeWorkbenchViewState("{not-json")).toEqual({});
        expect(decodeWorkbenchViewState('"just-a-string"')).toEqual({});
    });

    it("resolves a saved position to group/card indices", () => {
        const position = resolveWorkbenchPosition(groups, { bookId: "b2", cardId: "a4" });
        expect(position).toEqual({ groupIndex: 1, cardIndex: 1 });
    });

    it("returns null when the card is missing", () => {
        expect(resolveWorkbenchPosition(groups, { bookId: "b1", cardId: "does-not-exist" })).toBeNull();
    });

    it("returns null when the book deck is missing", () => {
        expect(resolveWorkbenchPosition(groups, { bookId: "gone", cardId: "a1" })).toBeNull();
    });

    it("returns null when no position data", () => {
        expect(resolveWorkbenchPosition(groups, {})).toBeNull();
        expect(resolveWorkbenchPosition(groups, { viewMode: "cards" })).toBeNull();
    });

    it("uses the expected session key", () => {
        expect(WORKBENCH_VIEW_STATE_KEY).toBe("theorem-workbench:view-state");
    });
});