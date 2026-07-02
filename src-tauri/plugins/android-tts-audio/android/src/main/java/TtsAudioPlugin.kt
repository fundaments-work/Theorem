package work.fundamentals.theorem.ttsaudio

import android.app.Activity
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class PrepareAudioArgs {
    var sampleRate: Int = 24000
}

@InvokeArg
class WriteAudioArgs {
    /** Float array of audio samples, normalized to [-1.0, 1.0]. */
    var samples: List<Double> = emptyList()
    var sampleRate: Int = 24000
    var generationId: Long = 0
    var chunkIndex: Int = 0
}

@TauriPlugin
class TtsAudioPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        private const val TAG = "TtsAudioPlugin"
    }

    @Volatile
    private var audioTrack: AudioTrack? = null
    private var currentGenId: Long = -1L

    @Command
    fun prepareAudio(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(PrepareAudioArgs::class.java)
            releaseAudioTrack()

            val sampleRate = if (args.sampleRate > 0) args.sampleRate else 24000
            val bufferSize = AudioTrack.getMinBufferSize(
                sampleRate,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_FLOAT,
            )

            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()

            val format = AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                .setSampleRate(sampleRate)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build()

            audioTrack = AudioTrack.Builder()
                .setAudioAttributes(attrs)
                .setAudioFormat(format)
                .setBufferSizeInBytes(bufferSize.coerceAtLeast(4096))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()

            audioTrack?.play()
            Log.i(TAG, "AudioTrack prepared: sampleRate=$sampleRate bufferSize=$bufferSize")
            invoke.resolve()
        } catch (error: Exception) {
            Log.e(TAG, "prepareAudio failed: ${error.message}")
            invoke.reject(error.message ?: "Failed to prepare audio")
        }
    }

    @Command
    fun writeAudio(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(WriteAudioArgs::class.java)
            val track = audioTrack
            if (track == null) {
                // Auto-prepare if needed
                invoke.reject("AudioTrack not prepared. Call prepareAudio first.")
                return
            }

            if (track.state != AudioTrack.STATE_INITIALIZED) {
                invoke.reject("AudioTrack not initialized")
                return
            }

            val samples = FloatArray(args.samples.size) { args.samples[it].toFloat() }

            val written = track.write(samples, 0, samples.size, AudioTrack.WRITE_BLOCKING)
            if (written != samples.size) {
                Log.w(TAG, "Partial write: $written / ${samples.size}")
            }

            currentGenId = args.generationId
            invoke.resolve()
        } catch (error: Exception) {
            Log.e(TAG, "writeAudio failed: ${error.message}")
            invoke.reject(error.message ?: "Failed to write audio")
        }
    }

    @Command
    fun stopAudio(invoke: Invoke) {
        try {
            releaseAudioTrack()
            currentGenId = -1L
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to stop audio")
        }
    }

    @Command
    fun pauseAudio(invoke: Invoke) {
        try {
            val track = audioTrack
            if (track != null && track.playState == AudioTrack.PLAYSTATE_PLAYING) {
                track.pause()
            }
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to pause audio")
        }
    }

    @Command
    fun resumeAudio(invoke: Invoke) {
        try {
            val track = audioTrack
            if (track != null && track.playState == AudioTrack.PLAYSTATE_PAUSED) {
                track.play()
            }
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to resume audio")
        }
    }

    private fun releaseAudioTrack() {
        try {
            audioTrack?.let { track ->
                if (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
                    track.stop()
                }
                track.release()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error releasing AudioTrack: ${e.message}")
        }
        audioTrack = null
    }
}
