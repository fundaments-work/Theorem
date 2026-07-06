package work.fundamentals.theorem.ttsaudio

import android.app.Activity
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
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
    private var isInitialized = false
    private var pendingSpeakText: String? = null
    private var pendingSpeakVoice: String? = null

    private val initListener = TextToSpeech.OnInitListener { status ->
        if (status == TextToSpeech.SUCCESS) {
            isInitialized = true
            Log.i(TAG, "TextToSpeech initialized successfully")
            pendingSpeakText?.let { text ->
                val voice = pendingSpeakVoice
                pendingSpeakText = null
                pendingSpeakVoice = null
                doSpeak(text, voice ?: "")
            }
        } else {
            Log.e(TAG, "TextToSpeech initialization failed: status=$status")
            isInitialized = false
        }
    }

    private fun getTts(): TextToSpeech {
        var instance = tts
        if (instance == null || !isInitialized) {
            instance = TextToSpeech(activity, initListener)
            instance.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    Log.d(TAG, "onStart: $utteranceId")
                }
                override fun onDone(utteranceId: String?) {
                    Log.d(TAG, "onDone: $utteranceId")
                }
                override fun onError(utteranceId: String?) {
                    Log.e(TAG, "onError: $utteranceId")
                }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?, errorCode: Int) {
                    Log.e(TAG, "onError: $utteranceId, code=$errorCode")
                }
            })
            tts = instance
        }
        return instance
    }

    private fun doSpeak(text: String, voiceName: String) {
        val tts = getTts()
        if (!isInitialized) {
            pendingSpeakText = text
            pendingSpeakVoice = voiceName
            return
        }

        if (voiceName.isNotEmpty()) {
            for (voice in tts.voices) {
                if (voice.name == voiceName) {
                    tts.voice = voice
                    break
                }
            }
        }

        val result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_ID)
        if (result == TextToSpeech.SUCCESS) {
            Log.i(TAG, "speak success: ${text.take(50)}...")
        } else {
            Log.e(TAG, "speak failed: result=$result")
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
            // Stop any current speech first
            tts?.stop()
            doSpeak(args.text, args.voice)
            invoke.resolve()
        } catch (error: Exception) {
            Log.e(TAG, "speak failed: ${error.message}")
            invoke.reject(error.message ?: "Failed to speak")
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        try {
            tts?.stop()
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to stop")
        }
    }

    @Command
    fun getVoices(invoke: Invoke) {
        try {
            val tts = getTts()
            if (!isInitialized) {
                val empty = JSObject()
                empty.put("voices", emptyList<Map<String, String>>())
                invoke.resolve(empty)
                return
            }
            val voices = tts.voices.map { v ->
                mapOf(
                    "name" to v.name,
                    "locale" to (v.locale?.toLanguageTag() ?: ""),
                    "quality" to v.quality.toString(),
                )
            }
            val result = JSObject()
            result.put("voices", voices)
            invoke.resolve(result)
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to get voices")
        }
    }

    override fun onDestroy() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        isInitialized = false
        super.onDestroy()
    }
}
