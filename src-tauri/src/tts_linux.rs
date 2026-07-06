// TTS via direct libspeechd FFI on Linux. No external crates, no shell commands.

use std::ffi::CString;
use std::sync::Mutex;

type SPDConnection = std::ffi::c_void;

#[repr(i32)]
#[allow(non_camel_case_types, dead_code)]
enum SPDPriority {
    Text = 3,
}

extern "C" {
    fn spd_open(
        client_name: *const std::os::raw::c_char,
        connection_name: *const std::os::raw::c_char,
        user: *const std::os::raw::c_char,
        mode: i32,
    ) -> *mut SPDConnection;

    fn spd_close(connection: *mut SPDConnection);
    fn spd_say(
        connection: *mut SPDConnection,
        priority: SPDPriority,
        text: *const std::os::raw::c_char,
    ) -> i32;
    fn spd_stop(connection: *mut SPDConnection) -> i32;
    fn spd_stop_all(connection: *mut SPDConnection) -> i32;
    fn spd_cancel_all(connection: *mut SPDConnection) -> i32;
    fn spd_pause(connection: *mut SPDConnection) -> i32;
    fn spd_resume(connection: *mut SPDConnection) -> i32;
}

#[link(name = "speechd")]
extern "C" {}

struct Conn(*mut SPDConnection);
unsafe impl Send for Conn {}
impl Drop for Conn {
    fn drop(&mut self) {
        unsafe {
            spd_close(self.0);
        }
    }
}

static CONNECTION: Mutex<Option<Conn>> = Mutex::new(None);

fn ensure_connection() -> Result<(), String> {
    let mut guard = CONNECTION.lock().map_err(|e| format!("lock: {e}"))?;
    if guard.is_none() {
        let name = CString::new("theorem").unwrap();
        unsafe {
            let conn = spd_open(name.as_ptr(), std::ptr::null(), std::ptr::null(), 0);
            if conn.is_null() {
                return Err("spd_open returned null — is speech-dispatcher running? Try: systemctl --user status speech-dispatcher".into());
            }
            *guard = Some(Conn(conn));
        }
    }
    Ok(())
}

pub fn linux_tts_speak(text: &str) -> Result<(), String> {
    ensure_connection()?;
    let guard = CONNECTION.lock().map_err(|e| format!("lock: {e}"))?;
    let conn = guard.as_ref().ok_or("no connection")?;
    let c_text = CString::new(text).map_err(|e| format!("text: {e}"))?;
    let ret = unsafe { spd_say(conn.0, SPDPriority::Text, c_text.as_ptr()) };
    if ret == 0 {
        Err("spd_say failed — speech-dispatcher rejected the text".into())
    } else {
        Ok(())
    }
}

pub fn linux_tts_stop() -> Result<(), String> {
    let guard = CONNECTION.lock().map_err(|e| format!("lock: {e}"))?;
    if let Some(conn) = guard.as_ref() {
        // stop_all + cancel_all: stops current and clears queue
        unsafe {
            spd_stop_all(conn.0);
        }
        unsafe {
            spd_cancel_all(conn.0);
        }
    }
    Ok(())
}

pub fn linux_tts_pause() -> Result<(), String> {
    let guard = CONNECTION.lock().map_err(|e| format!("lock: {e}"))?;
    if let Some(conn) = guard.as_ref() {
        let ret = unsafe { spd_pause(conn.0) };
        if ret != 0 {
            // espeak-ng backend doesn't support pause — stop instead
            unsafe {
                spd_stop(conn.0);
            }
        }
    }
    Ok(())
}

pub fn linux_tts_resume() -> Result<(), String> {
    let guard = CONNECTION.lock().map_err(|e| format!("lock: {e}"))?;
    if let Some(conn) = guard.as_ref() {
        let ret = unsafe { spd_resume(conn.0) };
        if ret != 0 {
            // Can't resume — JS will re-speak from estimated position
        }
    }
    Ok(())
}
