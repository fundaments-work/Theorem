import { Component, ReactNode } from "react";

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
                <div style={{ 
                    minHeight: "100vh", 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center",
                    backgroundColor: "#f3f4f6",
                    padding: "2rem",
                    fontFamily: "system-ui, -apple-system, sans-serif"
                }}>
                    <div style={{
                        maxWidth: "800px",
                        width: "100%",
                        backgroundColor: "white",
                        borderRadius: "12px",
                        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1)",
                        padding: "2rem"
                    }}>
                        <h1 style={{ 
                            fontSize: "1.5rem", 
                            fontWeight: "bold", 
                            color: "#dc2626",
                            marginBottom: "1rem"
                        }}>
                            ⚠️ Something went wrong
                        </h1>
                        <p style={{ color: "#4b5563", marginBottom: "1rem" }}>
                            The application encountered an unexpected error.
                        </p>
                        <div style={{ 
                            backgroundColor: "#fee2e2",
                            border: "1px solid #fecaca",
                            borderRadius: "8px",
                            padding: "1rem",
                            marginBottom: "1rem",
                            overflow: "auto"
                        }}>
                            <p style={{ 
                                fontFamily: "monospace", 
                                fontSize: "0.875rem",
                                color: "#991b1b",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word"
                            }}>
                                <strong>Error:</strong> {this.state.error?.message}
                            </p>
                        </div>
                        {this.state.error?.stack && (
                            <pre style={{
                                backgroundColor: "#1f2937",
                                color: "#f87171",
                                padding: "1rem",
                                borderRadius: "8px",
                                overflow: "auto",
                                fontSize: "0.75rem",
                                maxHeight: "300px",
                                marginBottom: "1rem"
                            }}>
                                {this.state.error.stack}
                            </pre>
                        )}
                        {this.state.errorInfo?.componentStack && (
                            <div style={{ marginBottom: "1rem" }}>
                                <p style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>Component Stack:</p>
                                <pre style={{
                                    backgroundColor: "#374151",
                                    color: "#fbbf24",
                                    padding: "1rem",
                                    borderRadius: "8px",
                                    overflow: "auto",
                                    fontSize: "0.75rem",
                                    maxHeight: "200px"
                                }}>
                                    {this.state.errorInfo.componentStack}
                                </pre>
                            </div>
                        )}
                        <button
                            onClick={() => window.location.reload()}
                            style={{
                                padding: "0.75rem 1.5rem",
                                backgroundColor: "#2563eb",
                                color: "white",
                                border: "none",
                                borderRadius: "8px",
                                cursor: "pointer",
                                fontSize: "1rem",
                                fontWeight: "500"
                            }}
                            onMouseOver={(e) => e.currentTarget.style.backgroundColor = "#1d4ed8"}
                            onMouseOut={(e) => e.currentTarget.style.backgroundColor = "#2563eb"}
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
