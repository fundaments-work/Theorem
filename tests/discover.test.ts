import { describe, expect, it } from "vitest";
import { DiscoverService } from "../src/core/services/DiscoverService";

describe("DiscoverService", () => {
    it("should export DiscoverService with core methods", () => {
        expect(typeof DiscoverService.loadCuratedSections).toBe("function");
        expect(typeof DiscoverService.search).toBe("function");
        expect(typeof DiscoverService.downloadBook).toBe("function");
    });
});
