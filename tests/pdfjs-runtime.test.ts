import { describe, expect, it } from "vitest";
import { configurePdfJsWorker } from "../src/core/lib/pdfjs-runtime";

describe("pdfjs-runtime", () => {
    it("sets the shared worker source", () => {
        const module = {
            GlobalWorkerOptions: {
                workerSrc: "",
            },
        };

        configurePdfJsWorker(module);

        expect(module.GlobalWorkerOptions.workerSrc).toContain("pdf.worker.mjs");
    });
});
