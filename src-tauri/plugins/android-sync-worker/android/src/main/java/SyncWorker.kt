package work.fundamentals.theorem.syncworker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * WorkManager worker that runs periodic background sync even when the
 * app is killed. WorkManager is system-managed and survives process
 * death, OEM battery optimization (with exemption), and device reboots.
 *
 * The worker calls into the Rust native library (libtheorem_lib.so)
 * via JNI to run a standalone sync round that:
 * 1. Loads the sync identity from the app data directory
 * 2. Starts the sync HTTP server
 * 3. Waits for incoming sync requests from paired peers
 * 4. Shuts down after 3 minutes
 *
 * Minimum interval is 15 minutes (Android WorkManager restriction).
 */
class SyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    companion object {
        private const val TAG = "SyncWorker"
        private const val CHANNEL_ID = "theorem-sync-worker"
        private const val NOTIFICATION_ID = 1001
        private const val WORK_NAME = "theorem-sync-periodic"

        /**
         * Schedule periodic background sync every 15 minutes.
         * Call this when the user enables auto-sync.
         */
        fun schedulePeriodicSync(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(
                15, TimeUnit.MINUTES
            ).build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                androidx.work.ExistingPeriodicWorkPolicy.KEEP,
                request
            )
            Log.i(TAG, "Scheduled periodic sync every 15 min")
        }

        /**
         * Cancel periodic background sync.
         * Call this when the user disables auto-sync.
         */
        fun cancelPeriodicSync(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            Log.i(TAG, "Cancelled periodic sync")
        }
    }

    override suspend fun doWork(): Result {
        try {
            // Become a foreground service so the system doesn't kill us
            setForeground(createForegroundInfo())
            Log.i(TAG, "Starting background sync round")

            // Get app data directory
            val dataDir = applicationContext.filesDir.absolutePath
            Log.i(TAG, "Data dir: $dataDir")

            // Call into Rust native library to run standalone sync
            val success = runBackgroundSync(dataDir)
            Log.i(TAG, "Background sync round result: $success")

            return Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Background sync failed: ${e.message}")
            return Result.retry()
        }
    }

    private fun createForegroundInfo(): ForegroundInfo {
        // Ensure notification channel exists
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE)
                as? NotificationManager
            if (manager?.getNotificationChannel(CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Theorem Sync",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "Background sync keeps your data up to date"
                }
                manager?.createNotificationChannel(channel)
            }
        }

        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setContentTitle("Theorem Sync Active")
            .setContentText("Background sync running...")
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setOngoing(true)
            .setSilent(true)
            .build()

        val serviceType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        } else 0

        return if (serviceType != 0) {
            ForegroundInfo(NOTIFICATION_ID, notification, serviceType)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    /**
     * JNI bridge to Rust's run_background_sync function in libtheorem_lib.so.
     * Runs a standalone sync round without the Tauri runtime.
     */
    private external fun runBackgroundSync(dataDir: String): Boolean

    companion object {
        init {
            System.loadLibrary("theorem_lib")
        }
    }
}
