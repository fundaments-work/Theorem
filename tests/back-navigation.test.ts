import { describe, expect, it, vi } from "vitest";
import { registerBackHandler, dispatchBackAction } from "../src/core/lib/back-navigation";

describe("back-navigation registry", () => {
    it("returns false when no handlers are registered", () => {
        expect(dispatchBackAction()).toBe(false);
    });

    it("executes registered handlers in LIFO order and stops when consumed", () => {
        const order: string[] = [];

        const unregister1 = registerBackHandler(() => {
            order.push("handler1");
            return false;
        });

        const unregister2 = registerBackHandler(() => {
            order.push("handler2");
            return true; // consumed!
        });

        const unregister3 = registerBackHandler(() => {
            order.push("handler3");
            return false;
        });

        // Handler 3 runs first (returns false), then Handler 2 runs (returns true and stops)
        const handled = dispatchBackAction();
        expect(handled).toBe(true);
        expect(order).toEqual(["handler3", "handler2"]);

        // Cleanup
        unregister1();
        unregister2();
        unregister3();
    });

    it("correctly unregisters handlers", () => {
        const fn = vi.fn().mockReturnValue(true);
        const unregister = registerBackHandler(fn);

        expect(dispatchBackAction()).toBe(true);
        expect(fn).toHaveBeenCalledTimes(1);

        unregister();

        expect(dispatchBackAction()).toBe(false);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
