package work.fundamentals.theorem.syncworker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Android ForegroundService that keeps the Theorem sync process alive
 * while the app is backgrounded. Shows a persistent notification.
 *
 * The Rust background sync scheduler runs independently as a tokio task;
 * this service merely prevents Android from killing the process.
 */
class SyncForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "theorem-sync-worker"
        const val NOTIFICATION_ID = 1001
        const val ACTION_STOP = "work.fundamentals.theorem.syncworker.STOP"
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            releaseWakeLock()
            return START_NOT_STICKY
        }

        try {
            val notification = buildNotification()
            startForeground(NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            // SecurityException on Android 14+ if FOREGROUND_SERVICE_DATA_SYNC
            // permission is missing, or IllegalStateException if the service
            // is not allowed to start in the foreground. Either way, don't
            // crash the app — the Rust background sync scheduler still runs
            // as a tokio task without the foreground service.
            Log.e("SyncForegroundService", "Failed to start foreground: ${e.message}")
            stopSelf()
            return START_NOT_STICKY
        }

        // Acquire partial wake lock so the process isn't suspended
        // while the Rust sync scheduler runs.
        acquireWakeLock()

        // Returning START_STICKY ensures Android restarts the service
        // if it's killed (though foreground services rarely are).
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

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
}
