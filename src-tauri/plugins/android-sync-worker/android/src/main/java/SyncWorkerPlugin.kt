package work.fundamentals.theorem.syncworker

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class StartWorkerArgs {
    var notificationTitle: String = "Theorem Sync Active"
    var notificationText: String = "Syncing data with paired devices"
    var syncIntervalSecs: Long = 300
}

@TauriPlugin
class SyncWorkerPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        private const val TAG = "SyncWorkerPlugin"
    }

    @Command
    fun startWorker(invoke: Invoke) {
        try {
            invoke.parseArgs(StartWorkerArgs::class.java)

            // On Android 13+ (API 33), POST_NOTIFICATIONS is a runtime
            // permission. Without it the foreground service notification
            // won't appear, but the service itself still runs.
            // The user can grant it in Settings → Apps → Theorem →
            // Notifications.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (ContextCompat.checkSelfPermission(
                        activity, Manifest.permission.POST_NOTIFICATIONS
                    ) != PackageManager.PERMISSION_GRANTED
                ) {
                    Log.w(
                        TAG,
                        "POST_NOTIFICATIONS not granted — notification will not appear. " +
                        "Grant in Settings > Apps > Theorem > Notifications."
                    )
                }
            }

            val intent = Intent(activity, SyncForegroundService::class.java)
            activity.startForegroundService(intent)

            val response = JSObject()
            response.put("running", true)
            invoke.resolve(response)
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to start sync worker")
        }
    }

    @Command
    fun stopWorker(invoke: Invoke) {
        try {
            val intent = Intent(activity, SyncForegroundService::class.java).apply {
                action = SyncForegroundService.ACTION_STOP
            }
            activity.startService(intent)

            val response = JSObject()
            response.put("running", false)
            invoke.resolve(response)
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to stop sync worker")
        }
    }
}
