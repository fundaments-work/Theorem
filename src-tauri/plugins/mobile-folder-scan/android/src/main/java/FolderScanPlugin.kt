package work.fundamentals.theorem.libraryscan

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import app.tauri.Logger
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.ArrayDeque
import java.util.Locale
import java.util.concurrent.Executors

@InvokeArg
class ScanFolderArgs {
  lateinit var treeUri: String
  var recursive: Boolean? = true
}

@TauriPlugin
class FolderScanPlugin(private val activity: Activity) : Plugin(activity) {
  private val supportedSuffixes = arrayOf(
    ".epub",
    ".mobi",
    ".azw3",
    ".azw",
    ".fb2.zip",
    ".fb2",
    ".fbz",
    ".cbz",
    ".pdf"
  )
  private val scanExecutor = Executors.newSingleThreadExecutor()

  @Command
  fun pickFolder(invoke: Invoke) {
    try {
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(
          Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        )
      }
      startActivityForResult(invoke, intent, "pickFolderResult")
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Failed to open folder picker")
    }
  }

  @ActivityCallback
  fun pickFolderResult(invoke: Invoke, result: ActivityResult) {
    val response = JSObject()
    when (result.resultCode) {
      Activity.RESULT_OK -> {
        val uri = result.data?.data
        if (uri != null) {
          val requestedFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION
          val grantFlags =
            (result.data?.flags ?: 0) and
              requestedFlags
          val persistFlags = if (grantFlags == 0) Intent.FLAG_GRANT_READ_URI_PERMISSION else grantFlags
          try {
            activity.contentResolver.takePersistableUriPermission(uri, persistFlags)
          } catch (error: SecurityException) {
            Logger.warn("Failed to persist folder permission: ${error.message}")
          }
          response.put("uri", uri.toString())
        } else {
          response.put("uri", null)
        }
        invoke.resolve(response)
      }
      Activity.RESULT_CANCELED -> {
        response.put("uri", null)
        invoke.resolve(response)
      }
      else -> invoke.reject("Failed to pick folder")
    }
  }

  @Command
  fun scanFolder(invoke: Invoke) {
    scanExecutor.execute {
      try {
        val args = invoke.parseArgs(ScanFolderArgs::class.java)
        val treeUriValue = args.treeUri.trim()
        if (treeUriValue.isEmpty()) {
          invoke.reject("Folder URI is empty.")
          return@execute
        }

        val treeUri = Uri.parse(treeUriValue)
        val root = DocumentFile.fromTreeUri(activity, treeUri)
        if (root == null || !root.isDirectory || !root.canRead()) {
          invoke.reject("Selected folder is not accessible.")
          return@execute
        }

        val files = collectBookUris(root, args.recursive != false)

        val result = JSObject()
        result.put("files", JSArray.from(files.toTypedArray()))
        invoke.resolve(result)
      } catch (error: Exception) {
        invoke.reject(error.message ?: "Failed to scan folder")
      }
    }
  }

  private fun collectBookUris(root: DocumentFile, recursive: Boolean): List<String> {
    val queue = ArrayDeque<DocumentFile>()
    val results = LinkedHashSet<String>()
    queue.add(root)

    while (queue.isNotEmpty()) {
      val directory = queue.removeFirst()
      if (!directory.canRead()) {
        continue
      }

      val entries = try {
        directory.listFiles()
      } catch (_: Exception) {
        continue
      }

      for (entry in entries) {
        if (!entry.canRead()) {
          continue
        }

        if (entry.isDirectory) {
          if (recursive) {
            queue.addLast(entry)
          }
          continue
        }

        if (entry.isFile && isSupportedBookFile(entry)) {
          results.add(entry.uri.toString())
        }
      }
    }

    return results.toList()
  }

  private fun isSupportedBookFile(entry: DocumentFile): Boolean {
    val name = entry.name?.lowercase(Locale.ROOT)
    if (name != null && supportedSuffixes.any { suffix -> name.endsWith(suffix) }) {
      return true
    }

    val mimeType = entry.type?.lowercase(Locale.ROOT) ?: return false
    return mimeType == "application/epub+zip" ||
      mimeType == "application/x-mobipocket-ebook" ||
      mimeType == "application/x-fictionbook+xml" ||
      mimeType == "application/vnd.comicbook+zip" ||
      mimeType == "application/pdf"
  }
}
