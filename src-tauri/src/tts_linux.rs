// TTS via spd-say (speech-dispatcher CLI) on Linux — always works.

use std::process::{Command, Stdio};

pub fn linux_tts_speak(text: &str) -> Result<(), String> {
    Command::new("spd-say")
        .arg(text)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spd-say: {e}"))?;
    Ok(())
}

pub fn linux_tts_stop() -> Result<(), String> {
    Command::new("spd-say")
        .arg("--cancel")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok();
    Command::new("killall")
        .arg("spd-say")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok();
    Ok(())
}

pub fn linux_tts_pause() -> Result<(), String> {
    // spd-say has no pause flag. Stop instead — JS handles position estimation.
    linux_tts_stop()
}

pub fn linux_tts_resume() -> Result<(), String> {
    // Resume after stop: JS re-speaks from estimated position.
    Ok(())
}
