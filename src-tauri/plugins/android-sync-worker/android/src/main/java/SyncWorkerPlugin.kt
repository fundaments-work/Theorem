package work.fundamentals.theorem.syncworker

import android.app.Activity
import android.content.Intent
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

    @Command
    fun startWorker(invoke: Invoke) {
        try {
            invoke.parseArgs(StartWorkerArgs::class.java)
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
