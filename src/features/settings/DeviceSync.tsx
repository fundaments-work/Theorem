/**
 * DeviceSync – LAN Device Sync Settings Component
 *
 * Clean card layout with clear visual hierarchy:
 * - This Device card (identity + receiver status)
 * - Pair a Device card (QR / scan / manual code)
 * - Paired Devices list (large touch targets, stacked on mobile)
 * - Security footer
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
    Smartphone,
    QrCode,
    Wifi,
    WifiOff,
    Trash2,
    Copy,
    Check,
    Loader2,
    Monitor,
    Link2,
    ArrowDownUp,
    ScanLine,
    Signal,
    Lock,
} from "lucide-react";
import { cn } from "../../core/lib/utils";
import { isMobile, isTauri, isTauriDesktop } from "../../core/lib/env";
import {
    isDaemonRunning,
    getDaemonStatus,
    triggerDaemonSync,
} from "../../core/lib/device-sync-daemon";
import type { DaemonStatus } from "../../core/lib/device-sync-daemon";
import { Modal, ModalBody, ModalHeader } from "../../ui";
import {
    irohStart,
    generatePairingQr,
    submitPairingCode,
    getDeviceIdentity,
    getPairedDevices,
    unpairDevice,
} from "../../core/lib/device-sync";
import {
    runDeviceSync,
    provisionSyncData,
    ensureResponderSyncReady,
} from "../../core/lib/sync-orchestrator";
import { useUIStore, useSettingsStore } from "../../core/store";
import type { IrohNodeIdResponse } from "../../core/lib/device-sync";
import type {
    PairedDevice,
    DeviceIdentityInfo,
    PairingQrData,
} from "../../core/types";

// ─── Sub-components ───

function Section({
    title,
    description,
    icon,
    children,
}: {
    title: string;
    description?: string;
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3">
                <div className="p-2 bg-[var(--color-surface-muted)] text-[color:var(--color-text-muted)]">
                    {icon}
                </div>
                <div>
                    <h3 className="font-semibold text-[color:var(--color-text-primary)]">
                        {title}
                    </h3>
                    {description && (
                        <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
                            {description}
                        </p>
                    )}
                </div>
            </div>
            <div className="space-y-4">{children}</div>
        </div>
    );
}

/** Grouping card for related content within the section. */
function Card({
    label,
    children,
    className,
}: {
    label?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "border border-[var(--color-border)] bg-[var(--color-surface)]",
                className,
            )}
        >
            {label && (
                <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-text-muted)]">
                        {label}
                    </p>
                </div>
            )}
            {children}
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const styles: Record<string, string> = {
        idle: "bg-[color:color-mix(in_srgb,var(--color-text-muted)_15%,transparent)] text-[color:var(--color-text-muted)]",
        hosting:
            "bg-[color:color-mix(in_srgb,var(--color-success,#22c55e)_15%,transparent)] text-[color:var(--color-success,#22c55e)]",
        syncing:
            "bg-[color:color-mix(in_srgb,var(--color-accent)_15%,transparent)] text-[color:var(--color-accent)]",
        synced:
            "bg-[color:color-mix(in_srgb,var(--color-success,#22c55e)_15%,transparent)] text-[color:var(--color-success,#22c55e)]",
        error:
            "bg-[color:color-mix(in_srgb,var(--color-error)_15%,transparent)] text-[color:var(--color-error)]",
        pairing:
            "bg-[color:color-mix(in_srgb,var(--color-warning,#f59e0b)_15%,transparent)] text-[color:var(--color-warning,#f59e0b)]",
        connecting:
            "bg-[color:color-mix(in_srgb,var(--color-accent)_15%,transparent)] text-[color:var(--color-accent)]",
    };

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                styles[status] || styles.idle,
            )}
        >
            {status === "syncing" && (
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
            )}
            {status === "hosting" && <Signal className="w-2.5 h-2.5" />}
            {status === "synced" && <Check className="w-2.5 h-2.5" />}
            {status}
        </span>
    );
}

/** Inline status dot for the receiver. */
function ReceiverDot({ active }: { active: boolean }) {
    return (
        <span
            className={cn(
                "inline-block w-2 h-2 shrink-0",
                active
                    ? "bg-[var(--color-success,#22c55e)]"
                    : "bg-[var(--color-text-muted)] opacity-40",
            )}
            style={{ borderRadius: "50%" }}
            title={active ? "Receiver active" : "Receiver inactive"}
        />
    );
}

// ─── Main Component ───

export function DeviceSyncSection() {
    const [identity, setIdentity] = useState<DeviceIdentityInfo | null>(null);
    const [nodeInfo, setNodeInfo] = useState<IrohNodeIdResponse | null>(null);
    const [qrData, setQrData] = useState<PairingQrData | null>(null);
    const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
    const [pairingCode, setPairingCode] = useState("");
    const [isIrohRunning, setIsIrohRunning] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isPairing, setIsPairing] = useState(false);
    const [isQrModalOpen, setIsQrModalOpen] = useState(false);
    const [syncingDeviceId, setSyncingDeviceId] = useState<string | null>(null);
    const [syncProgress, setSyncProgress] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [copiedCode, setCopiedCode] = useState(false);
    const syncAbortRef = useRef(false);

    const [daemonAvailable, setDaemonAvailable] = useState(false);
    const [daemonStatus, setDaemonStatus] = useState<DaemonStatus | null>(null);
    const [checkingDaemon, setCheckingDaemon] = useState(true);

    const syncStatus = useUIStore((state) => state.deviceSyncStatus);
    const syncMessage = useUIStore((state) => state.deviceSyncMessage);
    const setDeviceSyncStatus = useUIStore(
        (state) => state.setDeviceSyncStatus,
    );

    const deviceSyncSettings = useSettingsStore((state) => state.settings.deviceSync);
    const updateSettings = useSettingsStore((state) => state.updateSettings);

    const available = isTauri();
    const mobilePlatform = isMobile();
    const desktopPlatform = isTauriDesktop();

    // Load identity + paired devices on mount.
    useEffect(() => {
        if (!available) return;

        (async () => {
            try {
                const id = await getDeviceIdentity();
                setIdentity(id);

                const devices = await getPairedDevices();
                setPairedDevices(devices);
            } catch (e) {
            }
        })();
    }, [available]);

    // Poll daemon status on desktop (background sync sidecar).
    useEffect(() => {
        if (!available || !desktopPlatform) {
            setCheckingDaemon(false);
            return;
        }

        let cancelled = false;
        const check = async () => {
            const running = await isDaemonRunning();
            if (cancelled) return;
            setDaemonAvailable(running);
            if (running) {
                const status = await getDaemonStatus();
                if (!cancelled) setDaemonStatus(status);
            } else {
                setDaemonStatus(null);
            }
            setCheckingDaemon(false);
        };

        void check();

        // Re-check every 30s in case daemon starts/stops.
        const interval = setInterval(() => {
            void check();
        }, 30000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [available, desktopPlatform]);

    // Auto-manage incoming sync receiver once at least one device is paired.
    // Only runs once when the first device is paired — avoids re-syncing on
    // every poll interval (pairedDevices is a new array reference each time).
    const hasPairedDevices = pairedDevices.length > 0;
    useEffect(() => {
        if (!available || !hasPairedDevices) {
            return;
        }

        let cancelled = false;
        const ensureReceiverReady = async () => {
            try {
                await ensureResponderSyncReady();
                const info = await irohStart();
                if (!cancelled) {
                    setNodeInfo(info);
                    setIsIrohRunning(true);
                }
                await provisionSyncData();
            } catch (e) {
                if (!cancelled) {
                }
            }
        };

        void ensureReceiverReady();
        return () => {
            cancelled = true;
        };
    }, [available, hasPairedDevices]);

    // Auto-clear success message.
    useEffect(() => {
        if (successMessage) {
            const timer = setTimeout(() => setSuccessMessage(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);

    const handleGenerateQr = useCallback(async () => {
        if (qrData) {
            setIsQrModalOpen(true);
            return;
        }
        setError(null);
        setIsLoading(true);
        try {
            const data = await generatePairingQr();
            setQrData(data);
            setIsQrModalOpen(true);
            setIsIrohRunning(true);
            setDeviceSyncStatus("hosting");
            // Provision data after QR generation starts iroh
            try {
                await provisionSyncData();
            } catch (e) {
            }
            try {
                await ensureResponderSyncReady();
                const info = await irohStart();
                setNodeInfo(info);
            } catch (e) {
            }
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setIsLoading(false);
        }
    }, [qrData, setDeviceSyncStatus]);

    const submitPairingCodeValue = useCallback(
        async (code: string) => {
            const trimmedCode = code.trim();
            if (!trimmedCode) return;
            setError(null);
            setIsPairing(true);
            setDeviceSyncStatus("pairing");
            try {
                const device = await submitPairingCode(trimmedCode);
                setPairedDevices((prev) => [...prev, device]);
                setPairingCode("");
                setSuccessMessage(
                    `Paired with ${device.deviceName || device.deviceId}`,
                );
                try {
                    await ensureResponderSyncReady();
                } catch (e) {
                }
                setDeviceSyncStatus("idle");
            } catch (e: any) {
                setError(e?.message || String(e));
                setDeviceSyncStatus("error", e?.message || String(e));
            } finally {
                setIsPairing(false);
            }
        },
        [setDeviceSyncStatus],
    );

    const handleSubmitPairingCode = useCallback(async () => {
        if (!pairingCode.trim()) return;
        await submitPairingCodeValue(pairingCode);
    }, [pairingCode, submitPairingCodeValue]);

    const handleScanPairingQr = useCallback(async () => {
        if (!available || !mobilePlatform) {
            setError("QR scanning is only available in the mobile app.");
            return;
        }

        setError(null);
        setIsPairing(true);
        try {
            const {
                checkPermissions,
                requestPermissions,
                scan,
                Format,
            } = await import("@tauri-apps/plugin-barcode-scanner");

            let permission = await checkPermissions();
            if (permission !== "granted") {
                permission = await requestPermissions();
            }
            if (permission !== "granted") {
                setError(
                    "Camera permission is required to scan pairing QR codes.",
                );
                return;
            }

            const result = await scan({
                windowed: false,
                formats: [Format.QRCode],
            });
            const scannedCode = result?.content?.trim();
            if (!scannedCode) {
                setError("No QR code data detected.");
                return;
            }

            setPairingCode(scannedCode);
            await submitPairingCodeValue(scannedCode);
        } catch (e: any) {
            const msg = e?.message || String(e);
            // User-cancelled scanner should not surface as an error state.
            if (!/cancel|closed|dismiss/i.test(msg)) {
                setError(msg);
            }
        } finally {
            setIsPairing(false);
        }
    }, [available, mobilePlatform, submitPairingCodeValue]);

    const handleUnpair = useCallback(async (deviceId: string) => {
        // Confirm before unpairing
        if (!window.confirm("Are you sure you want to unpair this device? It will need to be paired again to sync.")) {
            return;
        }
        try {
            const { cancelRunningSync } = await import("../../core/lib/sync-orchestrator");
            cancelRunningSync();
            useUIStore.getState().setDeviceSyncStatus("idle");
            await unpairDevice(deviceId);
            setPairedDevices((prev) =>
                prev.filter((d) => d.deviceId !== deviceId),
            );
            setSuccessMessage("Device unpaired");
        } catch (e: any) {
            setError(e?.message || String(e));
        }
    }, []);

    const handleSyncNow = useCallback(
        async (deviceId: string) => {
            if (syncingDeviceId) return;
            setError(null);
            setSyncingDeviceId(deviceId);
            setSyncProgress("Starting...");
            syncAbortRef.current = false;

            try {
                const result = await runDeviceSync(deviceId, (msg) => {
                    if (!syncAbortRef.current) {
                        setSyncProgress(msg);
                    }
                });

                if (result.success) {
                    setSuccessMessage(
                        result.domainsUpdated.length > 0
                            ? `Synced ${result.domainsUpdated.length} domain(s)`
                            : "Already in sync — no changes needed",
                    );
                    const devices = await getPairedDevices();
                    setPairedDevices(devices);
                } else if (result.error === "Sync cancelled") {
                    setSuccessMessage("Sync cancelled");
                } else {
                    setError(result.error || "Sync failed");
                }
            } catch (e: any) {
                const msg = e?.message || String(e);
                if (msg === "Sync cancelled") {
                    setSuccessMessage("Sync cancelled");
                } else {
                    setError(msg);
                }
            } finally {
                setSyncingDeviceId(null);
                setSyncProgress(null);
            }
        },
        [syncingDeviceId],
    );

    const handleCancelSync = useCallback(() => {
        syncAbortRef.current = true;
        setSyncProgress("Cancelling...");
        import("../../core/lib/sync-orchestrator").then(m => m.cancelRunningSync());
    }, []);

    const handleCopyCode = useCallback(() => {
        if (qrData?.pairingCode) {
            navigator.clipboard.writeText(qrData.pairingCode);
            setCopiedCode(true);
            setTimeout(() => setCopiedCode(false), 2000);
        }
    }, [qrData]);

    const qrSvgDataUri = useMemo(() => {
        if (!qrData?.qrSvg) {
            return "";
        }
        return `data:image/svg+xml;utf8,${encodeURIComponent(qrData.qrSvg)}`;
    }, [qrData?.qrSvg]);

    // ─── Not available in browser ───
    if (!available) {
        return (
            <Section
                title="Device Sync"
                description="Real app-data sync between your devices over LAN"
                icon={<Smartphone className="w-5 h-5" />}
            >
                <div className="p-6 bg-[var(--color-surface-muted)] text-center">
                    <WifiOff className="w-8 h-8 mx-auto mb-2 text-[color:var(--color-text-muted)]" />
                    <p className="text-sm text-[color:var(--color-text-muted)]">
                        Device sync is only available in the desktop/mobile app.
                    </p>
                </div>
            </Section>
        );
    }

    // ─── Main render ───
    return (
        <Section
            title="Device Sync"
            description="Sync your library, annotations, and settings between devices on the same network"
            icon={<Smartphone className="w-5 h-5" />}
        >
            {/* ── Notifications ── */}
            {error && (
                <div className="flex items-start gap-2.5 p-3 border border-[color:color-mix(in_srgb,var(--color-error)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--color-error)_8%,transparent)]">
                    <span className="text-sm text-[color:var(--color-error)] flex-1">
                        {error}
                    </span>
                    <button
                        onClick={() => setError(null)}
                        className="text-xs text-[color:var(--color-error)] underline underline-offset-2 shrink-0"
                    >
                        dismiss
                    </button>
                </div>
            )}
            {successMessage && (
                <div className="flex items-center gap-2 p-3 border border-[color:color-mix(in_srgb,var(--color-success,#22c55e)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--color-success,#22c55e)_8%,transparent)]">
                    <Check className="w-4 h-4 text-[color:var(--color-success,#22c55e)] shrink-0" />
                    <span className="text-sm text-[color:var(--color-success,#22c55e)]">
                        {successMessage}
                    </span>
                </div>
            )}

            {/* ── Global sync status bar ── */}
            {syncStatus !== "idle" && (
                <div className="flex items-center gap-3 p-3 bg-[var(--color-surface-muted)] border border-[var(--color-border)]">
                    <StatusBadge status={syncStatus} />
                    {syncMessage && (
                        <span className="text-xs text-[color:var(--color-text-muted)] truncate flex-1">
                            {syncMessage}
                        </span>
                    )}
                </div>
            )}

            {/* ════════════════════════════════════════════
                CARD 1 — This Device
            ════════════════════════════════════════════ */}
            <Card label="This Device">
                <div className="p-4 space-y-3">
                    {/* Identity row */}
                    {identity && (
                        <div className="flex items-center gap-3">
                            <Monitor className="w-5 h-5 text-[color:var(--color-text-muted)] shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm text-[color:var(--color-text-primary)] truncate">
                                    {identity.deviceName || "This Device"}
                                </p>
                                <p className="text-[11px] text-[color:var(--color-text-muted)] font-mono truncate">
                                    {identity.deviceId}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Receiver status row */}
                    <div className="flex items-center gap-3 pt-3 border-t border-[var(--color-border)]">
                        <ReceiverDot active={isIrohRunning} />
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-[color:var(--color-text-secondary)]">
                                {isIrohRunning ? (
                                    <>
                                        Receiver active
                                        {nodeInfo?.nodeId && (
                                            <span className="ml-1.5 font-mono text-[10px] text-[color:var(--color-accent)]">
                                                {nodeInfo.nodeId.slice(0, 12)}...
                                            </span>
                                        )}
                                    </>
                                ) : pairedDevices.length > 0 ? (
                                    "Receiver starting..."
                                ) : (
                                    "Pair a device to enable incoming sync"
                                )}
                            </p>
                        </div>
                        {isIrohRunning ? (
                            <Wifi className="w-4 h-4 text-[color:var(--color-accent)] shrink-0" />
                        ) : (
                            <WifiOff className="w-4 h-4 text-[color:var(--color-text-muted)] shrink-0 opacity-40" />
                        )}
                    </div>

                    {/* Daemon status row (desktop only) */}
                    {desktopPlatform && (
                        <div className="flex items-center gap-3 pt-3 border-t border-[var(--color-border)]">
                            <ReceiverDot active={daemonAvailable} />
                            <div className="flex-1 min-w-0">
                                {checkingDaemon ? (
                                    <p className="text-xs text-[color:var(--color-text-muted)]">
                                        Checking daemon...
                                    </p>
                                ) : daemonAvailable ? (
                                    <div className="flex items-center gap-2">
                                        <p className="text-xs text-[color:var(--color-text-secondary)]">
                                            Daemon running
                                            {daemonStatus?.last_sync_at && (
                                                <span className="ml-1.5 text-[color:var(--color-text-muted)]">
                                                    &middot; Last sync{" "}
                                                    {new Date(daemonStatus.last_sync_at).toLocaleTimeString()}
                                                </span>
                                            )}
                                        </p>
                                        <button
                                            onClick={() => void triggerDaemonSync()}
                                            className="ml-auto text-[10px] uppercase tracking-wider font-medium text-[color:var(--color-accent)] hover:underline shrink-0"
                                        >
                                            Sync Now
                                        </button>
                                    </div>
                                ) : (
                                    <p className="text-xs text-[color:var(--color-text-muted)]">
                                        Daemon not running — background sync uses in-app scheduling
                                    </p>
                                )}
                            </div>
                            {daemonAvailable ? (
                                <ArrowDownUp className="w-4 h-4 text-[color:var(--color-accent)] shrink-0" />
                            ) : (
                                <WifiOff className="w-4 h-4 text-[color:var(--color-text-muted)] shrink-0 opacity-40" />
                            )}
                        </div>
                    )}
                </div>
            </Card>

            {/* ════════════════════════════════════════════
                CARD 2 — Sync Settings
            ════════════════════════════════════════════ */}
            <Card label="Sync Settings">
                <div className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-medium text-sm text-[color:var(--color-text-primary)]">
                                Auto-sync
                            </p>
                            <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
                                Periodically sync with paired devices in the background
                            </p>
                        </div>
                        <button
                            onClick={async () => {
                                const newValue = !deviceSyncSettings.autoSyncEnabled;
                                updateSettings({
                                    deviceSync: {
                                        ...deviceSyncSettings,
                                        autoSyncEnabled: newValue,
                                    },
                                });
                                // If daemon is running, sync the setting.
                                if (daemonAvailable) {
                                    const { configureDaemon } = await import("../../core/lib/device-sync-daemon");
                                    await configureDaemon({ auto_sync_enabled: newValue }).catch(() => {});
                                }
                            }}
                            className={cn(
                                "px-3 py-1.5 text-[11px] font-medium border transition-colors shrink-0",
                                deviceSyncSettings.autoSyncEnabled
                                    ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] border-[var(--color-accent)]"
                                    : "text-[color:var(--color-text-secondary)] border-[var(--color-border)]",
                            )}
                        >
                            {deviceSyncSettings.autoSyncEnabled ? "On" : "Off"}
                        </button>
                    </div>
                </div>
            </Card>

            {/* ════════════════════════════════════════════
                CARD 3 — Pair a Device
            ════════════════════════════════════════════ */}
            <Card label="Pair a Device">
                <div className="divide-y divide-[var(--color-border)]">
                    {/* Show QR button */}
                    <button
                        onClick={handleGenerateQr}
                        disabled={isLoading}
                        className={cn(
                            "w-full flex items-center gap-3 p-4 min-h-[3.5rem]",
                            "text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]",
                            "transition-colors text-left",
                            isLoading && "opacity-50 cursor-not-allowed",
                        )}
                    >
                        <QrCode className="w-5 h-5 text-[color:var(--color-accent)] shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">Show Pairing QR</p>
                            <p className="text-xs text-[color:var(--color-text-muted)]">
                                Display a code for the other device to scan
                            </p>
                        </div>
                        {isLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        ) : (
                            <span className="text-[color:var(--color-text-muted)] text-xs shrink-0">&rsaquo;</span>
                        )}
                    </button>

                    {/* Scan QR (mobile only) */}
                    {mobilePlatform && (
                        <button
                            onClick={() => {
                                void handleScanPairingQr();
                            }}
                            disabled={isPairing}
                            className={cn(
                                "w-full flex items-center gap-3 p-4 min-h-[3.5rem]",
                                "text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]",
                                "transition-colors text-left",
                                isPairing && "opacity-50 cursor-not-allowed",
                            )}
                        >
                            <ScanLine className="w-5 h-5 text-[color:var(--color-accent)] shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm">Scan QR Code</p>
                                <p className="text-xs text-[color:var(--color-text-muted)]">
                                    Use your camera to scan another device&apos;s code
                                </p>
                            </div>
                            {isPairing ? (
                                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                            ) : (
                                <span className="text-[color:var(--color-text-muted)] text-xs shrink-0">&rsaquo;</span>
                            )}
                        </button>
                    )}

                    {/* QR ready banner */}
                    {qrData && (
                        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                            <p className="text-xs text-[color:var(--color-text-muted)]">
                                QR code ready — show it or copy the manual code.
                            </p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setIsQrModalOpen(true)}
                                    className="ui-btn"
                                >
                                    Open QR
                                </button>
                                <button
                                    onClick={handleCopyCode}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 px-3 py-2 min-h-[2.25rem]",
                                        "border border-[var(--color-border)]",
                                        "text-xs text-[color:var(--color-text-muted)]",
                                        "hover:bg-[var(--color-surface-muted)] transition-colors",
                                    )}
                                >
                                    {copiedCode ? (
                                        <>
                                            <Check className="w-3 h-3" /> Copied
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="w-3 h-3" /> Copy code
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Manual pairing code entry */}
                    <div className="p-4 space-y-2">
                        <p className="text-xs font-medium text-[color:var(--color-text-muted)]">
                            Or enter a pairing code manually
                        </p>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={pairingCode}
                                onChange={(e) => setPairingCode(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        void handleSubmitPairingCode();
                                    }
                                }}
                                placeholder="Paste code from other device..."
                                className={cn(
                                    "flex-1 px-3 py-2.5 text-sm min-h-[2.75rem]",
                                    "bg-[var(--color-surface-muted)] border border-[var(--color-border)]",
                                    "text-[color:var(--color-text-primary)]",
                                    "placeholder:text-[color:var(--color-text-muted)]",
                                    "focus:outline-none focus:border-[var(--color-accent)]",
                                    "transition-colors",
                                )}
                            />
                            <button
                                onClick={handleSubmitPairingCode}
                                disabled={!pairingCode.trim() || isPairing}
                                className={cn(
                                    "inline-flex items-center justify-center gap-2 px-4 min-h-[2.75rem] min-w-[2.75rem]",
                                    "bg-[var(--color-accent)] text-white text-sm font-medium",
                                    "hover:opacity-90 transition-opacity",
                                    "disabled:opacity-40 disabled:cursor-not-allowed",
                                )}
                            >
                                {isPairing ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Link2 className="w-4 h-4" />
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </Card>

            {/* ════════════════════════════════════════════
                CARD 3 — Paired Devices
            ════════════════════════════════════════════ */}
            {pairedDevices.length > 0 && (
                <Card label={`Paired Devices (${pairedDevices.length})`}>
                    <div className="divide-y divide-[var(--color-border)]">
                        {pairedDevices.map((device) => {
                            const isSyncing =
                                syncingDeviceId === device.deviceId;
                            return (
                                <div
                                    key={device.deviceId}
                                    className="p-4 space-y-3"
                                >
                                    {/* Device info row */}
                                    <div className="flex items-center gap-3">
                                        <Smartphone className="w-5 h-5 text-[color:var(--color-text-muted)] shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-sm text-[color:var(--color-text-primary)] truncate">
                                                {device.deviceName ||
                                                    device.deviceId}
                                            </p>
                                            <p className="text-[11px] text-[color:var(--color-text-muted)]">
                                                {device.lastSyncAt
                                                    ? `Synced ${new Date(device.lastSyncAt).toLocaleDateString()} ${new Date(device.lastSyncAt).toLocaleTimeString()}`
                                                    : "Never synced"}
                                                {device.lastIp &&
                                                    device.lastPort > 0 && (
                                                        <>
                                                            {" "}
                                                            &middot;{" "}
                                                            {device.lastIp}:
                                                            {device.lastPort}
                                                        </>
                                                    )}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Sync progress */}
                                    {isSyncing && syncProgress && (
                                        <div className="flex items-center gap-2 px-1">
                                            <Loader2 className="w-3 h-3 animate-spin text-[color:var(--color-accent)]" />
                                            <span className="text-xs text-[color:var(--color-accent)]">
                                                {syncProgress}
                                            </span>
                                        </div>
                                    )}

                                    {/* Action buttons — stacked on mobile, inline on desktop */}
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <button
                                            onClick={() =>
                                                handleSyncNow(device.deviceId)
                                            }
                                            disabled={!!syncingDeviceId}
                                            className={cn(
                                                "inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[2.75rem]",
                                                "border border-[var(--color-border)]",
                                                "text-sm font-medium text-[color:var(--color-text-secondary)]",
                                                "hover:text-[color:var(--color-accent)] hover:border-[color:color-mix(in_srgb,var(--color-accent)_40%,var(--color-border))]",
                                                "transition-colors",
                                                "disabled:opacity-40 disabled:cursor-not-allowed",
                                                "sm:flex-1",
                                            )}
                                        >
                                            {isSyncing ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Syncing...
                                                </>
                                            ) : (
                                                <>
                                                    <ArrowDownUp className="w-4 h-4" />
                                                    Sync Now
                                                </>
                                            )}
                                        </button>
                                        {isSyncing && (
                                            <button
                                                onClick={handleCancelSync}
                                                className={cn(
                                                    "inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[2.75rem]",
                                                    "border border-[var(--color-border)]",
                                                    "text-sm font-medium text-[color:var(--color-text-secondary)]",
                                                    "hover:text-[color:var(--color-error)] hover:border-[color:color-mix(in_srgb,var(--color-error)_40%,var(--color-border))]",
                                                    "transition-colors",
                                                    "sm:w-auto",
                                                )}
                                            >
                                                Cancel
                                            </button>
                                        )}
                                        <button
                                            onClick={() =>
                                                handleUnpair(device.deviceId)
                                            }
                                            disabled={isSyncing}
                                            className={cn(
                                                "inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[2.75rem]",
                                                "border border-[var(--color-border)]",
                                                "text-sm font-medium text-[color:var(--color-text-secondary)]",
                                                "hover:text-[color:var(--color-error)] hover:border-[color:color-mix(in_srgb,var(--color-error)_40%,var(--color-border))]",
                                                "transition-colors",
                                                "disabled:opacity-40 disabled:cursor-not-allowed",
                                                "sm:w-auto",
                                            )}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            Unpair
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}

            {/* ── Security footer ── */}
            <div className="flex items-center gap-2.5 py-2">
                <Lock className="w-3.5 h-3.5 text-[color:var(--color-text-muted)] shrink-0 opacity-60" />
                <p className="text-[11px] text-[color:var(--color-text-muted)] leading-relaxed">
                    End-to-end encrypted (ChaCha20-Poly1305). Data never leaves your local network.
                </p>
            </div>

            {/* ── QR Modal ── */}
            <Modal
                isOpen={isQrModalOpen && !!qrData}
                onClose={() => setIsQrModalOpen(false)}
                size="sm"
            >
                <ModalHeader
                    title="Pair Device"
                    onClose={() => setIsQrModalOpen(false)}
                />
                <ModalBody className="space-y-4 overflow-x-hidden">
                    <div className="mx-auto w-full max-w-[18rem]">
                        <div className="aspect-square w-full overflow-hidden border border-[var(--color-border)] bg-white p-3">
                            {qrSvgDataUri && (
                                <img
                                    src={qrSvgDataUri}
                                    alt="Pairing QR code"
                                    className="h-full w-full object-contain"
                                />
                            )}
                        </div>
                    </div>
                    <p className="text-sm text-center text-[color:var(--color-text-muted)]">
                        Scan this QR code from the other device&apos;s Theorem
                        app.
                    </p>
                    <button
                        onClick={handleCopyCode}
                        className={cn(
                            "w-full flex items-center justify-center gap-2 p-2.5 min-h-[2.75rem]",
                            "border border-[var(--color-border)]",
                            "text-sm text-[color:var(--color-text-primary)]",
                            "hover:bg-[var(--color-surface-muted)] transition-colors",
                        )}
                    >
                        {copiedCode ? (
                            <>
                                <Check className="w-3.5 h-3.5" />
                                Copied pairing code
                            </>
                        ) : (
                            <>
                                <Copy className="w-3.5 h-3.5" />
                                Copy pairing code (for manual entry)
                            </>
                        )}
                    </button>
                </ModalBody>
            </Modal>
        </Section>
    );
}
