import { Component, type ReactNode } from "react";

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onReset?: () => void;
}

interface State {
    hasError: boolean;
    error?: Error;
}

/**
 * Per-route error boundary.
 * Catches render errors within a single page/route and shows a recovery UI
 * instead of crashing the entire application to the root ErrorBoundary.
 */
export class RouteErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error(
            `[RouteErrorBoundary] Caught error in route:`,
            error,
            info.componentStack,
        );
    }

    componentDidUpdate(prevProps: Props) {
        if (prevProps.children !== this.props.children && this.state.hasError) {
            this.setState({ hasError: false, error: undefined });
        }
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: undefined });
        this.props.onReset?.();
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="flex min-h-[400px] items-center justify-center p-8">
                    <div className="max-w-lg text-center">
                        <div className="mb-3 text-3xl select-none">~</div>
                        <h2 className="text-lg font-bold text-[color:var(--color-error)] mb-2">
                            This page encountered an error
                        </h2>
                        <p className="text-sm text-[color:var(--color-text-secondary)] mb-4">
                            {this.state.error?.message ?? "An unexpected error occurred."}
                        </p>
                        <button
                            onClick={this.handleRetry}
                            className="px-4 py-2 text-xs font-bold uppercase tracking-wider border border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] transition-colors"
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
