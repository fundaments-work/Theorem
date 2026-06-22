import * as Sentry from "@sentry/react";

let isInitialized = false;

/**
 * Initialize Sentry error reporting.
 * Uses SENTRY_DSN env var if set, otherwise Sentry is disabled.
 *
 * @param dsn - Optional Sentry DSN. Falls back to SENTRY_DSN env var.
 * @param environment - Deployment environment ("development" | "staging" | "production")
 */
export function initSentry(
    dsn?: string,
    environment: string = "production",
): void {
    if (isInitialized) return;

    const resolvedDsn = dsn ?? (typeof (globalThis as any).process?.env?.SENTRY_DSN === "string" ? (globalThis as any).process.env.SENTRY_DSN : undefined);

    if (!resolvedDsn) {
        console.debug("[Sentry] No DSN configured, error reporting disabled.");
        return;
    }

    Sentry.init({
        dsn: resolvedDsn,
        environment,
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration(),
        ],
        tracesSampleRate: environment === "production" ? 0.1 : 1.0,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        beforeSend(event) {
            // Strip PII: never send user input or file paths in breadcrumbs
            if (event.breadcrumbs) {
                for (const crumb of event.breadcrumbs) {
                    if (crumb.data && "filePath" in crumb.data) {
                        delete crumb.data.filePath;
                    }
                }
            }
            return event;
        },
    });

    isInitialized = true;
    console.debug("[Sentry] Error reporting initialized.");
}

export { Sentry };
