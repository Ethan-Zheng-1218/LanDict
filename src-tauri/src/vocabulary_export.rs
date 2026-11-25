//! Native "Save as" dialog for the vocabulary backup export.
//!
//! Exporting used to start a WebView download, which silently dropped the JSON
//! into the Downloads folder. This command opens the standard Windows save
//! dialog so the user picks the folder and file name, then writes the backup.

#[cfg(windows)]
use std::path::PathBuf;

#[cfg(windows)]
use windows::{
    core::{HSTRING, PCWSTR},
    Win32::{
        Foundation::RPC_E_CHANGED_MODE,
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
            },
            Threading::GetCurrentThreadId,
        },
        UI::{
            Shell::{
                Common::COMDLG_FILTERSPEC, FileSaveDialog, IFileSaveDialog, FOS_FORCEFILESYSTEM,
                FOS_OVERWRITEPROMPT, FOS_PATHMUSTEXIST, SIGDN_FILESYSPATH,
            },
            WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
        },
    },
};

/// HRESULT_FROM_WIN32(ERROR_CANCELLED): the user closed the dialog without saving.
#[cfg(windows)]
const CANCELLED_HRESULT: i32 = 0x8007_04C7u32 as i32;

#[cfg(windows)]
struct ComApartment {
    initialized_here: bool,
}

#[cfg(windows)]
impl ComApartment {
    fn enter() -> Result<Self, String> {
        let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if result.is_ok() {
            return Ok(Self { initialized_here: true });
        }
        // A thread that already joined another apartment can still host the
        // dialog through COM marshaling, so only give up on real failures.
        if result == RPC_E_CHANGED_MODE {
            return Ok(Self { initialized_here: false });
        }
        Err(format!("无法初始化系统对话框：{}", result.message()))
    }
}

#[cfg(windows)]
impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.initialized_here {
            unsafe { CoUninitialize() };
        }
    }
}

#[cfg(windows)]
fn choose_save_path(default_name: &str) -> Result<Option<PathBuf>, String> {
    let _apartment = ComApartment::enter()?;
    let dialog: IFileSaveDialog =
        unsafe { CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER) }
            .map_err(|error| format!("无法打开保存对话框：{}", error.message()))?;

    let file_name = HSTRING::from(default_name);
    let title = HSTRING::from("导出我的生词本");
    let filter_label = HSTRING::from("LanDict 生词本备份 (*.json)");
    let filter_pattern = HSTRING::from("*.json");
    let extension = HSTRING::from("json");
    let filters = [COMDLG_FILTERSPEC {
        pszName: PCWSTR(filter_label.as_ptr()),
        pszSpec: PCWSTR(filter_pattern.as_ptr()),
    }];

    unsafe {
        dialog
            .SetTitle(&title)
            .map_err(|error| error.message())?;
        dialog
            .SetFileTypes(&filters)
            .map_err(|error| error.message())?;
        dialog
            .SetFileTypeIndex(1)
            .map_err(|error| error.message())?;
        dialog
            .SetDefaultExtension(&extension)
            .map_err(|error| error.message())?;
        dialog
            .SetFileName(&file_name)
            .map_err(|error| error.message())?;
        let options = dialog.GetOptions().map_err(|error| error.message())?;
        dialog
            .SetOptions(options | FOS_OVERWRITEPROMPT | FOS_PATHMUSTEXIST | FOS_FORCEFILESYSTEM)
            .map_err(|error| error.message())?;
    }

    // A modal dialog can only be owned by a window on the calling thread; an
    // owner from another thread makes Show fail with E_FAIL. Keep the native
    // modality when we are on the app's UI thread and fall back otherwise.
    let foreground = unsafe { GetForegroundWindow() };
    let same_thread = !foreground.is_invalid()
        && unsafe { GetWindowThreadProcessId(foreground, None) } == unsafe { GetCurrentThreadId() };
    let owner = if same_thread { Some(foreground) } else { None };
    match unsafe { dialog.Show(owner) } {
        Ok(()) => {}
        Err(error) if error.code().0 == CANCELLED_HRESULT => return Ok(None),
        Err(error) => return Err(format!("保存对话框没有完成：{}", error.message())),
    }

    let item = unsafe { dialog.GetResult() }
        .map_err(|error| format!("无法读取保存位置：{}", error.message()))?;
    let raw_path = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }
        .map_err(|error| format!("无法读取保存位置：{}", error.message()))?;
    let path = unsafe { raw_path.to_string() }.map_err(|_| "保存路径包含无法识别的字符".to_string())?;
    unsafe { CoTaskMemFree(Some(raw_path.0 as *const core::ffi::c_void)) };
    Ok(Some(PathBuf::from(path)))
}

/// Opens the native save dialog and writes `contents` to the chosen path.
///
/// Returns `Ok(None)` when the user cancels, otherwise the absolute file path.
#[tauri::command]
pub fn export_vocabulary_backup(
    default_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        let Some(path) = choose_save_path(&default_name)? else {
            return Ok(None);
        };
        std::fs::write(&path, contents.as_bytes())
            .map_err(|error| format!("无法写入备份文件：{error}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }
    #[cfg(not(windows))]
    {
        let _ = (default_name, contents);
        Err("导出备份目前仅支持 Windows".to_string())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, GetForegroundWindow, PostMessageW, WM_CLOSE};

    #[test]
    #[ignore = "opens a real Windows save dialog; run with --ignored"]
    fn closing_the_save_dialog_reports_a_cancelled_export() {
        let (closed_tx, closed_rx) = mpsc::channel();
        std::thread::spawn(move || {
            for _ in 0..100 {
                if let Ok(handle) = unsafe { FindWindowW(PCWSTR::null(), w!("导出我的生词本")) } {
                    if !handle.is_invalid() {
                        std::thread::sleep(Duration::from_millis(250));
                        let _ = unsafe { PostMessageW(Some(handle), WM_CLOSE, WPARAM(0), LPARAM(0)) };
                        let _ = closed_tx.send(true);
                        return;
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            // The caption is localized by the system in some builds; close whatever is in front instead.
            let _ = unsafe { PostMessageW(Some(GetForegroundWindow()), WM_CLOSE, WPARAM(0), LPARAM(0)) };
            let _ = closed_tx.send(false);
        });

        let picked = choose_save_path("LanDict-生词本-2026-11-24.json");

        assert!(picked.is_ok(), "save dialog failed: {picked:?}");
        assert!(picked.unwrap().is_none(), "closing the dialog must not return a path");
        assert!(closed_rx.recv_timeout(Duration::from_secs(2)).unwrap_or(false), "the dialog window never appeared");
    }
}

