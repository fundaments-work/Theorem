package work.fundamentals.theorem.ttsaudio

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

@InvokeArg
class SpeakArgs {
    var text: String = ""
    var voice: String = ""
}

@TauriPlugin
class TtsAudioPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        private const val TAG = "TtsAudioPlugin"
        private const val UTTERANCE_ID = "theorem-tts"
    }

    @Volatile
    private var tts: TextToSpeech? = null
    @Volatile
    private var isInitialized = false

    private val mainHandler = Handler(Looper.getMainLooper())

    private fun runOnUiThread(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            mainHandler.post(block)
        }
    }

    private fun initTts(callback: (Boolean) -> Unit) {
        runOnUiThread {
            try {
                tts = TextToSpeech(activity) { status ->
                    isInitialized = status == TextToSpeech.SUCCESS
                    Log.i(TAG, "TextToSpeech init: status=$status")
                    if (isInitialized) {
                        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                            override fun onStart(id: String?) {}
                            override fun onDone(id: String?) {
                                Log.d(TAG, "utterance done: $id")
                            }
                            override fun onError(id: String?) {
                                Log.e(TAG, "utterance error: $id")
                            }
                            @Deprecated("Deprecated in Java")
                            override fun onError(id: String?, code: Int) {}
                        })
                        tts?.language = Locale.getDefault()
                    }
                    callback(isInitialized)
                }
            } catch (e: Exception) {
                Log.e(TAG, "TTS init failed: ${e.message}", e)
                isInitialized = false
                callback(false)
            }
        }
    }

    private fun doSpeak(text: String, voiceName: String, callback: (Boolean) -> Unit) {
        val currentTts = tts
        if (currentTts == null || !isInitialized) {
            initTts { ok ->
                if (ok) {
                    doSpeak(text, voiceName, callback)
                } else {
                    callback(false)
                }
            }
            return
        }

        runOnUiThread {
            try {
                if (voiceName.isNotEmpty()) {
                    for (voice in currentTts.voices) {
                        if (voice.name == voiceName) {
                            currentTts.voice = voice
                            break
                        }
                    }
                }
                val result = currentTts.speak(text, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_ID)
                callback(result == TextToSpeech.SUCCESS)
            } catch (e: Exception) {
                Log.e(TAG, "speak failed: ${e.message}", e)
                callback(false)
            }
        }
    }

    @Command
    fun speak(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SpeakArgs::class.java)
            if (args.text.isBlank()) {
                invoke.resolve()
                return
            }
            doSpeak(args.text, args.voice) { ok ->
                if (ok) invoke.resolve() else invoke.reject("TTS speak failed")
            }
        } catch (error: Exception) {
            Log.e(TAG, "speak: ${error.message}")
            invoke.reject(error.message ?: "Failed to speak")
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        try {
            runOnUiThread {
                tts?.stop()
            }
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to stop")
        }
    }

    @Command
    fun getVoices(invoke: Invoke) {
        try {
            val currentTts = tts
            if (currentTts == null || !isInitialized) {
                initTts { ok ->
                    if (ok) getVoices(invoke) else {
                        val result = JSObject()
                        result.put("voicesJson", "[]")
                        invoke.resolve(result)
                    }
                }
                return
            }

            runOnUiThread {
                try {
                    val jsonArray = JSONArray()
                    for (v in currentTts.voices) {
                        val obj = JSONObject()
                        obj.put("name", v.name)
                        obj.put("locale", v.locale?.toLanguageTag() ?: "")
                        jsonArray.put(obj)
                    }
                    val result = JSObject()
                    result.put("voicesJson", jsonArray.toString())
                    invoke.resolve(result)
                } catch (e: Exception) {
                    val result = JSObject()
                    result.put("voicesJson", "[]")
                    invoke.resolve(result)
                }
            }
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to get voices")
        }
    }

    override fun onDestroy() {
        runOnUiThread {
            tts?.stop()
            tts?.shutdown()
        }
        tts = null
        isInitialized = false
        super.onDestroy()
    }
}
