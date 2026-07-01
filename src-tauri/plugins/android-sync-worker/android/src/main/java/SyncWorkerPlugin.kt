package work.fundamentals.theorem.syncworker

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
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

@InvokeArg
class UpdateNotificationArgs {
    var text: String = ""
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

            // Check POST_NOTIFICATIONS on Android 13+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (ContextCompat.checkSelfPermission(
                        activity, Manifest.permission.POST_NOTIFICATIONS
                    ) != PackageManager.PERMISSION_GRANTED
                ) {
                    Log.w(TAG, "POST_NOTIFICATIONS not granted")
                }
            }

            // Request battery optimization exemption — this is the KEY
            // fix for MIUI/Xiaomi. Without this, MIUI kills the process
            // when the user swipes the app from recents, and Android 12+
            // blocks AlarmManager restarts ("Background start not allowed").
            // With this exemption, the system treats the app as exempt
            // from Doze mode and App Standby, so the ForegroundService
            // survives task removal.
            requestBatteryOptimizationExemption()

            val intent = Intent(activity, SyncForegroundService::class.java)
            activity.startForegroundService(intent)

            val response = JSObject()
            response.put("running", true)
            invoke.resolve(response)
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to start sync worker")
        }
    }

    /**
     * Request exemption from battery optimization. Shows a system dialog
     * asking the user to allow Theorem to run in the background without
     * being killed by Doze mode or MIUI's aggressive battery management.
     *
     * This is the standard approach used by Syncthing, KDE Connect, and
     * all other Android apps that need reliable background sync.
     */
    private fun requestBatteryOptimizationExemption() {
        try {
            val powerManager = activity.getSystemService(Activity.POWER_SERVICE)
                as? PowerManager ?: return

            val packageName = activity.packageName

            // Check if the app is already exempt
            if (powerManager.isIgnoringBatteryOptimizations(packageName)) {
                Log.i(TAG, "Already exempt from battery optimization")
                return
            }

            // Show the system dialog to request exemption
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            activity.startActivity(intent)
            Log.i(TAG, "Requested battery optimization exemption")
        } catch (e: Exception) {
            Log.w(TAG, "Could not request battery optimization exemption: ${e.message}")
            // Fallback: open the app's battery settings page directly
            try {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:${activity.packageName}")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                activity.startActivity(intent)
            } catch (e2: Exception) {
                Log.e(TAG, "Could not open battery settings either: ${e2.message}")
            }
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

    @Command
    fun updateNotification(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(UpdateNotificationArgs::class.java)
            SyncForegroundService.updateStatusText(activity, args.text)
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to update notification")
        }
    }

    @Command
    fun schedulePeriodicSync(invoke: Invoke) {
        try {
            SyncWorker.schedulePeriodicSync(activity)
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to schedule periodic sync")
        }
    }

    @Command
    fun cancelPeriodicSync(invoke: Invoke) {
        try {
            SyncWorker.cancelPeriodicSync(activity)
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to cancel periodic sync")
        }
    }
}
