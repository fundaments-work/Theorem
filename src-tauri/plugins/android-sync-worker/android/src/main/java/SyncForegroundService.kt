package work.fundamentals.theorem.syncworker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Android ForegroundService that keeps the Theorem sync process alive
 * while the app is backgrounded. Shows a persistent notification.
 *
 * Uses the "connectedDevice" foreground service type on Android 14+
 * (API 34+) — the same type KDE Connect uses. This type is specifically
 * designed for companion-device communication and is not aggressively
 * blocked by OEM skins like MIUI/Xiaomi, unlike "dataSync".
 *
 * On Android 10-13 (API 29-33), falls back to "dataSync" type.
 * On Android < 10, no type is required.
 *
 * The Rust background sync scheduler (tokio task) runs independently;
 * this service merely prevents Android from killing the process.
 * Returns START_STICKY so Android restarts the service if killed.
 */
class SyncForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "theorem-sync-worker"
        const val NOTIFICATION_ID = 1001
        const val ACTION_STOP = "work.fundamentals.theorem.syncworker.STOP"
        private const val TAG = "SyncForegroundService"
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        registerNetworkCallback()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            releaseWakeLock()
            return START_NOT_STICKY
        }

        val notification = buildNotification()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                // Android 14+ — use connectedDevice type (KDE Connect pattern).
                // This type is for companion-device communication and is not
                // aggressively blocked by MIUI/Xiaomi like dataSync is.
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
                )
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10-13 — connectedDevice type not available, use dataSync.
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                )
            } else {
                // Android < 10 — no type parameter.
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            // SecurityException or ForegroundServiceStartNotAllowedException.
            // Don't crash — the Rust background sync scheduler still runs
            // as a tokio task without the foreground service.
            Log.e(TAG, "Failed to start foreground service: ${e.message}")
            stopSelf()
            return START_NOT_STICKY
        }

        acquireWakeLock()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        unregisterNetworkCallback()
        releaseWakeLock()
        super.onDestroy()
    }

    // ─── Notification ───

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Theorem Sync",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Background sync keeps your data up to date"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): android.app.Notification {
        val stopIntent = Intent(this, SyncForegroundService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Theorem Sync Active")
            .setContentText("Syncing data with paired devices")
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setOngoing(true)
            .setSilent(true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            builder.addAction(
                android.R.drawable.ic_media_pause,
                "Stop",
                stopPendingIntent
            )
        }

        return builder.build()
    }

    // ─── Wake Lock ───

    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "theorem:sync_worker"
            ).apply {
                acquire(30 * 60 * 1000L) // 30 min max to prevent battery drain
            }
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
            }
            wakeLock = null
        }
    }

    // ─── Network Change Listener (KDE Connect pattern) ───
    //
    // When WiFi reconnects, the sync server needs to rebind to the new
    // IP address. We fire a broadcast intent that the Rust side can
    // listen for, or the frontend can pick up via Tauri events.

    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private fun registerNetworkCallback() {
        val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE)
            as? ConnectivityManager ?: return

        val networkRequest = NetworkRequest.Builder().apply {
            addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
            addTransportType(NetworkCapabilities.TRANSPORT_VPN)
        }.build()

        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.i(TAG, "Network available — sync will resume")
            }

            override fun onLost(network: Network) {
                Log.i(TAG, "Network lost — sync paused")
            }
        }
        networkCallback = cb
        connectivityManager.registerNetworkCallback(networkRequest, cb)
    }

    private fun unregisterNetworkCallback() {
        val callback = networkCallback ?: return
        val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE)
            as? ConnectivityManager
        connectivityManager?.unregisterNetworkCallback(callback)
        networkCallback = null
    }
}
