use serde::Serialize;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::State;
#[cfg(not(debug_assertions))]
use tauri::Manager;

const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct LocalTranslationState(Arc<Mutex<Option<LocalWorker>>>, Mutex<Option<Child>>, AtomicBool);

impl LocalTranslationState {
    pub fn stop(&self) {
        self.2.store(true, Ordering::Release);
        // Never hold up application exit behind an active translation. The worker also watches its parent.
        if let Ok(mut worker) = self.0.try_lock() { *worker = None; }
        if let Ok(mut preparation) = self.1.lock() {
            if let Some(mut child) = preparation.take() { let _ = child.kill(); let _ = child.wait(); }
        }
    }
}

#[cfg(not(debug_assertions))]
fn complete_payload(root: &Path) -> bool {
    ["runtime/python.exe", "runtime/python312.zip", "runtime/msvcp140.dll", "worker.py",
     "runtime/deps/ctranslate2/_ext.cp312-win_amd64.pyd",
     "models/translate-en_zh-1_9/model/model.bin", "models/translate-en_zh-1_9/sentencepiece.model",
     "models/translate-zh_en-1_9/model/model.bin", "models/translate-zh_en-1_9/sentencepiece.model"]
        .iter().all(|file| root.join(file).is_file())
}

fn translation_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        Ok(Path::new(env!("CARGO_MANIFEST_DIR")).join("target/local-translation"))
    }
    #[cfg(not(debug_assertions))]
    {
        // Existing complete installs stay offline and do not download a second copy.
        let bundled = app.path().resource_dir().map_err(|_| "无法定位翻译资源。")?.join("local-translation");
        if complete_payload(&bundled) { return Ok(bundled); }
        let downloaded = app.path().app_local_data_dir().map_err(|_| "无法定位翻译资源。")?
            .join("local-translation/v1");
        if downloaded.join("ready.json").is_file() && complete_payload(&downloaded) { return Ok(downloaded); }
        Err("离线翻译正在准备，请稍后重试。".into())
    }
}

pub fn prepare_in_background(app: tauri::AppHandle) {
    #[cfg(all(windows, not(debug_assertions)))]
    std::thread::spawn(move || {
        use std::os::windows::process::CommandExt;
        // Give the main window time to appear before doing any preparation work.
        std::thread::sleep(Duration::from_secs(3));
        if translation_root(&app).is_ok() { return; }
        let Ok(resources) = app.path().resource_dir() else { return; };
        let Ok(data) = app.path().app_local_data_dir() else { return; };
        let Some(system_root) = std::env::var_os("SystemRoot") else { return; };
        let powershell = PathBuf::from(system_root).join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let state = app.state::<LocalTranslationState>();
        let Ok(mut preparation) = state.1.lock() else { return; };
        if state.2.load(Ordering::Acquire) { return; }
        *preparation = Command::new(powershell)
            // A PowerShell 7 developer shell may export incompatible module paths.
            // Let Windows PowerShell construct its own standard cmdlet search path.
            .env_remove("PSModulePath")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(resources.join("local-translation-bootstrap/prepare.ps1"))
            .arg("-Root").arg(data.join("local-translation"))
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .creation_flags(0x08000000).spawn().ok();
    });
    #[cfg(any(not(windows), debug_assertions))]
    let _ = app;
}

#[derive(Serialize)]
pub struct LocalTranslationResponse {
    translation: String,
    source: String,
    target: String,
}

fn validate_request(text: &str, source: &str, target: &str) -> Result<(), String> {
    if !matches!((source, target), ("en", "zh") | ("zh", "en")) {
        return Err("本地翻译仅支持英语与简体中文互译。".into());
    }
    if text.trim().is_empty() { return Err("请输入要翻译的文本。".into()); }
    if text.chars().count() > 20_000 { return Err("文本过长，请分段翻译（每次最多20,000字符）。".into()); }
    Ok(())
}

struct LocalWorker {
    child: Child,
    stdin: ChildStdin,
    responses: mpsc::Receiver<String>,
}

impl Drop for LocalWorker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl LocalWorker {
    fn spawn(root: &Path) -> Result<Self, String> {
        let python = root.join("runtime/python.exe");
        if !python.is_file() || !root.join("worker.py").is_file() {
            return Err("本地翻译组件缺失，请重新安装完整版本。".into());
        }
        let mut command = Command::new(python);
        command.arg("-B").arg("-u").arg(root.join("worker.py"))
            .arg("--models").arg(root.join("models"))
            .arg("--parent-pid").arg(std::process::id().to_string())
            .env("PYTHONUTF8", "1").env("PYTHONDONTWRITEBYTECODE", "1")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW; no console flashes.
        }
        let mut child = command.spawn().map_err(|_| "本地翻译无法启动，请检查组件是否被安全软件拦截。")?;
        let stdin = child.stdin.take().ok_or("本地翻译输入管道无法打开。")?;
        let stdout = child.stdout.take().ok_or("本地翻译输出管道无法打开。")?;
        let (sender, responses) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => { if sender.send(line).is_err() { break; } },
                    _ => break,
                }
            }
        });
        let worker = Self { child, stdin, responses };
        let ready = worker.receive(STARTUP_TIMEOUT)?;
        if ready.get("ready").and_then(Value::as_bool) != Some(true) {
            return Err("本地翻译初始化失败，请重新安装完整版本。".into());
        }
        Ok(worker)
    }

    fn receive(&self, timeout: Duration) -> Result<Value, String> {
        let line = self.responses.recv_timeout(timeout).map_err(|error| match error {
            mpsc::RecvTimeoutError::Timeout => "本地翻译超时，请重试或缩短文本。".to_string(),
            mpsc::RecvTimeoutError::Disconnected => "本地翻译进程已退出，请重试；若仍失败，请检查运行环境或安全软件。".to_string(),
        })?;
        serde_json::from_str(&line).map_err(|_| "本地翻译返回内容格式无效。".into())
    }

    fn translate(&mut self, text: &str, source: &str, target: &str, id: &str) -> Result<String, String> {
        let request = json!({"id": id, "text": text, "source": source, "target": target});
        writeln!(self.stdin, "{request}").and_then(|_| self.stdin.flush()).map_err(|_| "本地翻译进程不可用，请重试。")?;
        let response = self.receive(REQUEST_TIMEOUT)?;
        if response.get("id").and_then(Value::as_str) != Some(id) { return Err("本地翻译请求与返回内容不匹配。".into()); }
        if let Some(error) = response.get("error").and_then(Value::as_str) { return Err(error.to_string()); }
        response.get("translation").and_then(Value::as_str).filter(|text| !text.trim().is_empty())
            .map(str::to_string).ok_or_else(|| "本地翻译没有返回译文，请重试。".into())
    }
}

#[tauri::command]
pub async fn desktop_local_translate(
    app: tauri::AppHandle,
    state: State<'_, LocalTranslationState>,
    text: String, source: String, target: String, request_id: String,
) -> Result<LocalTranslationResponse, String> {
    validate_request(&text, &source, &target)?;
    let root = translation_root(&app)?;
    let state = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || {
        let mut current = state.lock().map_err(|_| "本地翻译状态不可用，请重启 LanDict。")?;
        if current.as_mut().is_some_and(|worker| worker.child.try_wait().ok().flatten().is_some()) { *current = None; }
        if current.is_none() { *current = Some(LocalWorker::spawn(&root)?); }
        let result = current.as_mut().unwrap().translate(&text, &source, &target, &request_id);
        if result.is_err() { *current = None; }
        result.map(|translation| LocalTranslationResponse { translation, source, target })
    }).await.map_err(|_| "本地翻译任务中断，请重试。".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsupported_direction_empty_and_oversized_text() {
        assert!(validate_request("", "en", "zh").is_err());
        assert!(validate_request("hello", "en", "en").is_err());
        assert!(validate_request("hello", "fr", "zh").is_err());
        assert!(validate_request(&"a".repeat(20_001), "en", "zh").is_err());
        assert!(validate_request("期待与你见面", "zh", "en").is_ok());
    }

    #[test]
    fn worker_translates_and_preserves_local_error_without_ai() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/local-translation");
        let mut worker = LocalWorker::spawn(&root).unwrap();
        assert_eq!(worker.translate("phase out", "en", "zh", "one").unwrap(), "逐步淘汰");
        assert!(worker.translate("", "en", "zh", "bad").is_err());
        let translated = worker.translate("会议推迟到了星期五。", "zh", "en", "two").unwrap();
        assert!(translated.contains("Friday"));
        assert!(!translated.contains('▁'));
    }

    #[test]
    fn missing_runtime_has_an_actionable_error() {
        assert!(LocalWorker::spawn(Path::new("missing-runtime")).err().unwrap().contains("组件缺失"));
    }

    #[cfg(windows)]
    #[test]
    fn timeout_is_actionable_and_dropping_worker_terminates_process() {
        use windows::Win32::{
            Foundation::{CloseHandle, WAIT_OBJECT_0},
            System::Threading::{OpenProcess, PROCESS_ACCESS_RIGHTS, WaitForSingleObject},
        };
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/local-translation");
        let worker = LocalWorker::spawn(&root).unwrap();
        let handle = unsafe { OpenProcess(PROCESS_ACCESS_RIGHTS(0x00100000), false, worker.child.id()).unwrap() };
        assert!(worker.receive(Duration::from_millis(10)).unwrap_err().contains("超时"));
        drop(worker);
        unsafe {
            assert_eq!(WaitForSingleObject(handle, 1000), WAIT_OBJECT_0);
            CloseHandle(handle).unwrap();
        }
    }
}
