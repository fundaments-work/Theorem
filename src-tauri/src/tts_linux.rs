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
