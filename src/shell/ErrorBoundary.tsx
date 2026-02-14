import { Component, ReactNode } from "react";
import { UI_BUTTON_PRIMARY_CLASS } from "@theorem/core";

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
    errorInfo?: React.ErrorInfo;
}

/**
 * Error Boundary component to catch and display runtime errors
 * instead of showing a blank white screen
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("React Error Boundary caught an error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] p-8">
                    <div className="border border-[var(--color-border)] bg-[var(--color-surface)] w-full max-w-4xl p-8">
                        <h1 className="text-2xl font-bold text-[color:var(--color-error)] mb-4">
                            Application Error
                        </h1>
                        <p className="text-[color:var(--color-text-secondary)] mb-4">
                            The application encountered an unexpected error.
                        </p>
                        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-error)_26%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-error)_8%,var(--color-surface))] p-4 mb-4 overflow-auto">
                            <p className="font-mono text-sm text-[color:var(--color-error)] whitespace-pre-wrap break-words">
                                <strong>Error:</strong> {this.state.error?.message}
                            </p>
                        </div>
                        {this.state.error?.stack && (
                            <pre className="rounded-lg bg-[var(--color-surface-muted)] text-[color:var(--color-error)] p-4 overflow-auto text-xs max-h-[var(--layout-error-stack-max-height)] mb-4">
                                {this.state.error.stack}
                            </pre>
                        )}
                        {this.state.errorInfo?.componentStack && (
                            <div className="mb-4">
                                <p className="font-semibold mb-2 text-[color:var(--color-text-primary)]">Component Stack:</p>
                                <pre className="rounded-lg bg-[var(--color-surface-muted)] text-[color:var(--color-warning)] p-4 overflow-auto text-xs max-h-[var(--layout-error-component-stack-max-height)]">
                                    {this.state.errorInfo.componentStack}
                                </pre>
                            </div>
                        )}
                        <button
                            onClick={() => window.location.reload()}
                            className={UI_BUTTON_PRIMARY_CLASS}
                        >
                            Reload Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
