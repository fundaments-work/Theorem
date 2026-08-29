/**
 * Centralized back navigation registry.
 * Manages a LIFO stack of back action handlers for modals, drawers, and reader jump states.
 */

type BackHandler = () => boolean;

const backHandlers: BackHandler[] = [];

/**
 * Register a back navigation handler. Handlers are executed in LIFO order (last registered first).
 * If a handler returns `true`, it indicates the back action was consumed (e.g. closing an overlay),
 * preventing default route navigation.
 * 
 * Returns an unregister function.
 */
export function registerBackHandler(handler: BackHandler): () => void {
    backHandlers.push(handler);
    return () => {
        const index = backHandlers.lastIndexOf(handler);
        if (index !== -1) {
            backHandlers.splice(index, 1);
        }
    };
}

/**
 * Dispatch a back action to registered handlers.
 * Returns `true` if any handler consumed the event, `false` otherwise.
 */
export function dispatchBackAction(): boolean {
    for (let i = backHandlers.length - 1; i >= 0; i--) {
        const handler = backHandlers[i];
        if (handler && handler()) {
            return true;
        }
    }
    return false;
}
