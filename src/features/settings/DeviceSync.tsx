/**
 * DeviceSync – LAN Device Sync Settings Component
 *
 * Provides:
 * - Device identity display
 * - QR code pairing flow
 * - Manual pairing code entry
 * - Paired devices list with unpair + sync-now
 * - Sync server start/stop
 * - Live sync status + progress
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
    ChevronRight,
    Link2,
    ArrowDownUp,
    ShieldCheck,
    Signal,
    ScanLine,
} from "lucide-react";
import { cn, isMobile, isTauri } from "../../core";
import { Modal, ModalBody, ModalHeader } from "../../ui";
import {
    startSyncServer,
    stopSyncServer,
    generatePairingQr,
    submitPairingCode,
    getDeviceIdentity,
    getPairedDevices,
    unpairDevice,
} from "../../core/lib/device-sync";
import { runDeviceSync, provisionSyncData, initSyncEventListener } from "../../core/lib/sync-orchestrator";
import { useUIStore } from "../../core/store";
import type {
    PairedDevice,
    DeviceIdentityInfo,
    SyncServerInfo,
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
            <div className="space-y-3">{children}</div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const colors: Record<string, string> = {
        idle: "bg-gray-500/20 text-gray-400",
        hosting: "bg-green-500/20 text-green-400",
        syncing: "bg-blue-500/20 text-blue-400",
        synced: "bg-emerald-500/20 text-emerald-400",
        error: "bg-red-500/20 text-red-400",
        pairing: "bg-amber-500/20 text-amber-400",
        connecting: "bg-cyan-500/20 text-cyan-400",
    };

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider",
                colors[status] || colors.idle,
            )}
        >
            {status === "syncing" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
            {status === "hosting" && <Signal className="w-2.5 h-2.5" />}
            {status === "synced" && <Check className="w-2.5 h-2.5" />}
            {status}
        </span>
    );
}

// ─── Main Component ───

export function DeviceSyncSection() {
    const [identity, setIdentity] = useState<DeviceIdentityInfo | null>(null);
    const [serverInfo, setServerInfo] = useState<SyncServerInfo | null>(null);
    const [qrData, setQrData] = useState<PairingQrData | null>(null);
    const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
    const [pairingCode, setPairingCode] = useState("");
    const [isServerRunning, setIsServerRunning] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isPairing, setIsPairing] = useState(false);
    const [isQrModalOpen, setIsQrModalOpen] = useState(false);
    const [syncingDeviceId, setSyncingDeviceId] = useState<string | null>(null);
    const [syncProgress, setSyncProgress] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [copiedCode, setCopiedCode] = useState(false);
    const syncAbortRef = useRef(false);
    const syncEventUnlistenRef = useRef<(() => void) | null>(null);

    const syncStatus = useUIStore((state) => state.deviceSyncStatus);
    const syncMessage = useUIStore((state) => state.deviceSyncMessage);
    const setDeviceSyncStatus = useUIStore(
        (state) => state.setDeviceSyncStatus,
    );

    const available = isTauri();
    const mobilePlatform = isMobile();

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
                console.error("[DeviceSync] Init failed:", e);
            }
        })();
    }, [available]);

    // Auto-clear success message.
    useEffect(() => {
        if (successMessage) {
            const timer = setTimeout(() => setSuccessMessage(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);

    // Cleanup sync event listener on unmount.
    useEffect(() => {
        return () => {
            if (syncEventUnlistenRef.current) {
                syncEventUnlistenRef.current();
                syncEventUnlistenRef.current = null;
            }
        };
    }, []);

    const handleStartServer = useCallback(async () => {
        setError(null);
        setIsLoading(true);
        try {
            const info = await startSyncServer();
            setServerInfo(info);
            setIsServerRunning(true);
            setDeviceSyncStatus("hosting");
            // Provision data so the server can respond to sync requests
            try {
                await provisionSyncData();
            } catch (e) {
                console.warn("[DeviceSync] Failed to provision sync data:", e);
            }
            // Start listening for incoming sync events (responder mode)
            try {
                if (syncEventUnlistenRef.current) {
                    syncEventUnlistenRef.current();
                    syncEventUnlistenRef.current = null;
                }
                const unlisten = await initSyncEventListener();
                syncEventUnlistenRef.current = unlisten;
            } catch (e) {
                console.warn("[DeviceSync] Failed to init sync event listener:", e);
            }
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setIsLoading(false);
        }
    }, [setDeviceSyncStatus]);

    const handleStopServer = useCallback(async () => {
        try {
            // Tear down responder event listener
            if (syncEventUnlistenRef.current) {
                syncEventUnlistenRef.current();
                syncEventUnlistenRef.current = null;
            }
            await stopSyncServer();
            setIsServerRunning(false);
            setServerInfo(null);
            setQrData(null);
            setIsQrModalOpen(false);
            setDeviceSyncStatus("idle");
        } catch (e: any) {
            setError(e?.message || String(e));
        }
    }, [setDeviceSyncStatus]);

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
            setIsServerRunning(true);
            setDeviceSyncStatus("hosting");
            // Provision data after QR generation starts server
            try {
                await provisionSyncData();
            } catch (e) {
                console.warn("[DeviceSync] Failed to provision sync data:", e);
            }
            // Start listening for incoming sync events (responder mode)
            try {
                if (!syncEventUnlistenRef.current) {
                    const unlisten = await initSyncEventListener();
                    syncEventUnlistenRef.current = unlisten;
                }
            } catch (e) {
                console.warn("[DeviceSync] Failed to init sync event listener:", e);
            }
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setIsLoading(false);
        }
    }, [qrData, setDeviceSyncStatus]);

    const submitPairingCodeValue = useCallback(async (code: string) => {
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
            setDeviceSyncStatus("idle");
        } catch (e: any) {
            setError(e?.message || String(e));
            setDeviceSyncStatus("error", e?.message || String(e));
        } finally {
            setIsPairing(false);
        }
    }, [setDeviceSyncStatus]);

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
                setError("Camera permission is required to scan pairing QR codes.");
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

    const handleUnpair = useCallback(
        async (deviceId: string) => {
            try {
                await unpairDevice(deviceId);
                setPairedDevices((prev) =>
                    prev.filter((d) => d.deviceId !== deviceId),
                );
                setSuccessMessage("Device unpaired");
            } catch (e: any) {
                setError(e?.message || String(e));
            }
        },
        [],
    );

    const handleSyncNow = useCallback(
        async (deviceId: string) => {
            if (syncingDeviceId) return; // Already syncing
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
                    // Refresh paired devices to get updated lastSyncAt
                    const devices = await getPairedDevices();
                    setPairedDevices(devices);
                } else {
                    setError(result.error || "Sync failed");
                }
            } catch (e: any) {
                setError(e?.message || String(e));
            } finally {
                setSyncingDeviceId(null);
                setSyncProgress(null);
            }
        },
        [syncingDeviceId],
    );

    const handleCopyCode = useCallback(() => {
        if (qrData?.pairing_code) {
            navigator.clipboard.writeText(qrData.pairing_code);
            setCopiedCode(true);
            setTimeout(() => setCopiedCode(false), 2000);
        }
    }, [qrData]);

    const qrSvgDataUri = useMemo(() => {
        if (!qrData?.qr_svg) {
            return "";
        }
        return `data:image/svg+xml;utf8,${encodeURIComponent(qrData.qr_svg)}`;
    }, [qrData?.qr_svg]);

    if (!available) {
        return (
            <Section
                title="Device Sync"
                description="Real app-data sync between your devices over LAN"
                icon={<Smartphone className="w-5 h-5" />}
            >
                <div className="p-4 bg-[var(--color-surface-muted)] text-center">
                    <WifiOff className="w-8 h-8 mx-auto mb-2 text-[color:var(--color-text-muted)]" />
                    <p className="text-sm text-[color:var(--color-text-muted)]">
                        Device sync is only available in the desktop/mobile app.
                    </p>
                </div>
            </Section>
        );
    }

    return (
        <Section
            title="Device Sync"
            description="Real app-data sync between your devices over the local network"
            icon={<Smartphone className="w-5 h-5" />}
        >
            {/* Error / Success */}
            {error && (
                <div className="p-3 bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 text-sm text-[color:var(--color-error)]">
                    {error}
                    <button
                        onClick={() => setError(null)}
                        className="ml-2 underline text-xs"
                    >
                        dismiss
                    </button>
                </div>
            )}
            {successMessage && (
                <div className="p-3 bg-[var(--color-success,#22c55e)]/10 border border-[var(--color-success,#22c55e)]/20 text-sm text-[color:var(--color-success,#22c55e)]">
                    <Check className="inline w-4 h-4 mr-1" />
                    {successMessage}
                </div>
            )}

            {/* Sync Status Bar */}
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

            {/* Device Identity */}
            {identity && (
                <div className="flex items-center gap-3 p-4 bg-[var(--color-surface-muted)]">
                    <Monitor className="w-5 h-5 text-[color:var(--color-text-muted)]" />
                    <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-[color:var(--color-text-primary)] truncate">
                            {identity.device_name || "This Device"}
                        </p>
                        <p className="text-xs text-[color:var(--color-text-muted)] font-mono truncate">
                            ID: {identity.device_id}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-green-500" aria-label="End-to-end encrypted" />
                        {isServerRunning && serverInfo && (
                            <span className="text-xs text-[color:var(--color-accent)] font-mono whitespace-nowrap">
                                {serverInfo.ip}:{serverInfo.port}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Server Sharing */}
            <div className="flex items-center justify-between p-4 bg-[var(--color-surface-muted)]">
                <div className="flex items-center gap-3">
                    {isServerRunning ? (
                        <Wifi className="w-5 h-5 text-[color:var(--color-accent)]" />
                    ) : (
                        <WifiOff className="w-5 h-5 text-[color:var(--color-text-muted)]" />
                    )}
                    <div>
                        <p className="font-medium text-sm text-[color:var(--color-text-primary)]">
                            Share this device
                        </p>
                        <p className="text-xs text-[color:var(--color-text-muted)]">
                            {isServerRunning
                                ? "Other paired devices can connect and sync now"
                                : "Start only when you want this device to accept incoming sync"}
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => {
                        void (isServerRunning
                            ? handleStopServer()
                            : handleStartServer());
                    }}
                    disabled={isLoading}
                    className={cn(
                        "px-3 py-2 text-xs font-semibold border transition-colors",
                        isServerRunning
                            ? "border-[var(--color-error)]/30 text-[color:var(--color-error)] hover:bg-[var(--color-error)]/5"
                            : "border-[var(--color-accent)]/30 text-[color:var(--color-accent)] hover:bg-[var(--color-accent)]/10",
                        isLoading && "opacity-60 pointer-events-none",
                    )}
                >
                    {isLoading ? (
                        <span className="inline-flex items-center gap-1.5">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Working...
                        </span>
                    ) : isServerRunning ? (
                        "Stop sharing"
                    ) : (
                        "Start sharing"
                    )}
                </button>
            </div>

            {/* QR Pairing */}
            <div className="space-y-3">
                <button
                    onClick={handleGenerateQr}
                    disabled={isLoading}
                    className={cn(
                        "w-full flex items-center gap-3 p-4",
                        "border border-[var(--color-border)]",
                        "text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]",
                        "transition-colors text-left",
                        isLoading && "opacity-50 cursor-not-allowed",
                    )}
                >
                    <QrCode className="w-5 h-5 text-[color:var(--color-accent)]" />
                    <div className="flex-1">
                        <p className="font-medium text-sm">
                            Show Pairing QR Code
                        </p>
                        <p className="text-xs text-[color:var(--color-text-muted)]">
                            Scan from another Theorem device to pair
                        </p>
                    </div>
                    <ChevronRight className="w-4 h-4" />
                </button>

                {mobilePlatform && (
                    <button
                        onClick={() => {
                            void handleScanPairingQr();
                        }}
                        disabled={isPairing}
                        className={cn(
                            "w-full flex items-center gap-3 p-4",
                            "border border-[var(--color-border)]",
                            "text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]",
                            "transition-colors text-left",
                            isPairing && "opacity-50 cursor-not-allowed",
                        )}
                    >
                        <ScanLine className="w-5 h-5 text-[color:var(--color-accent)]" />
                        <div className="flex-1">
                            <p className="font-medium text-sm">
                                Scan Pairing QR Code
                            </p>
                            <p className="text-xs text-[color:var(--color-text-muted)]">
                                Use your camera to pair from another Theorem device
                            </p>
                        </div>
                        {isPairing ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <ChevronRight className="w-4 h-4" />
                        )}
                    </button>
                )}

                {qrData && (
                    <div className="flex flex-wrap items-center justify-between gap-3 p-3 border border-[var(--color-border)] bg-[var(--color-surface-muted)]">
                        <p className="text-xs text-[color:var(--color-text-muted)]">
                            Pairing QR is ready. Open the overlay or copy the manual
                            code.
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
                                    "flex items-center justify-center gap-2 px-3 py-2",
                                    "border border-[var(--color-border)]",
                                    "text-xs text-[color:var(--color-text-muted)]",
                                    "hover:bg-[var(--color-surface)] transition-colors",
                                )}
                            >
                                {copiedCode ? (
                                    <>
                                        <Check className="w-3 h-3" />
                                        Copied!
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-3 h-3" />
                                        Copy code
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Manual Pairing Code Entry */}
            <details className="border border-[var(--color-border)] bg-[var(--color-surface-muted)]">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-[color:var(--color-text-primary)]">
                    Manual pairing code
                </summary>
                <div className="flex gap-2 border-t border-[var(--color-border)] p-3">
                    <input
                        type="text"
                        value={pairingCode}
                        onChange={(e) => setPairingCode(e.target.value)}
                        placeholder="Paste pairing code from other device..."
                        className={cn(
                            "flex-1 px-3 py-2 text-sm",
                            "bg-[var(--color-surface)] border border-[var(--color-border)]",
                            "text-[color:var(--color-text-primary)]",
                            "placeholder:text-[color:var(--color-text-muted)]",
                            "focus:outline-none focus:border-[var(--color-accent)]",
                        )}
                    />
                    <button
                        onClick={handleSubmitPairingCode}
                        disabled={!pairingCode.trim() || isPairing}
                        className={cn(
                            "px-4 py-2 text-sm font-medium",
                            "bg-[var(--color-accent)] text-white",
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
            </details>

            {/* Paired Devices */}
            {pairedDevices.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs font-medium text-[color:var(--color-text-muted)] uppercase tracking-wider">
                        Paired Devices ({pairedDevices.length})
                    </p>
                    <div className="divide-y divide-[var(--color-border)]">
                        {pairedDevices.map((device) => {
                            const isSyncing = syncingDeviceId === device.deviceId;
                            return (
                                <div
                                    key={device.deviceId}
                                    className="flex items-center gap-3 p-3 bg-[var(--color-surface-muted)]"
                                >
                                    <Smartphone className="w-5 h-5 text-[color:var(--color-text-muted)]" />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-sm text-[color:var(--color-text-primary)] truncate">
                                            {device.deviceName || device.deviceId}
                                        </p>
                                        <p className="text-xs text-[color:var(--color-text-muted)]">
                                            {device.lastSyncAt
                                                ? `Last synced: ${new Date(device.lastSyncAt).toLocaleDateString()} ${new Date(device.lastSyncAt).toLocaleTimeString()}`
                                                : "Never synced"}
                                            {device.lastIp && device.lastPort > 0 && (
                                                <> {" • "} {device.lastIp}:{device.lastPort}</>
                                            )}
                                        </p>
                                        {isSyncing && syncProgress && (
                                            <p className="text-xs text-[color:var(--color-accent)] mt-0.5 flex items-center gap-1">
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                {syncProgress}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => handleSyncNow(device.deviceId)}
                                            disabled={!!syncingDeviceId}
                                            className={cn(
                                                "inline-flex items-center gap-1.5 border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--color-text-secondary)] transition-colors",
                                                "hover:text-[color:var(--color-accent)] hover:border-[var(--color-accent)]/30",
                                                "disabled:opacity-40 disabled:cursor-not-allowed",
                                            )}
                                        >
                                            {isSyncing ? (
                                                <>
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    Syncing
                                                </>
                                            ) : (
                                                <>
                                                    <ArrowDownUp className="w-3.5 h-3.5" />
                                                    Sync now
                                                </>
                                            )}
                                        </button>
                                        <button
                                            onClick={() =>
                                                handleUnpair(device.deviceId)
                                            }
                                            disabled={isSyncing}
                                            className={cn(
                                                "inline-flex items-center gap-1.5 border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--color-text-secondary)] transition-colors",
                                                "hover:text-[color:var(--color-error)] hover:border-[var(--color-error)]/30",
                                                "disabled:opacity-40 disabled:cursor-not-allowed",
                                            )}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            Unpair
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Security Note */}
            <div className="flex items-start gap-2 p-3 bg-[var(--color-surface-muted)] border border-[var(--color-border)]">
                <ShieldCheck className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-[color:var(--color-text-muted)] leading-relaxed">
                    All sync traffic is <strong>end-to-end encrypted</strong> using
                    ChaCha20-Poly1305 with keys established during QR pairing.
                    Data never leaves your local network.
                </p>
            </div>

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
                        Scan this QR code from the other device&apos;s Theorem app.
                    </p>
                    <button
                        onClick={handleCopyCode}
                        className={cn(
                            "w-full flex items-center justify-center gap-2 p-2",
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
