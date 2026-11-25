//! Native popup actions and click notifications. The hook thread never reads text or blocks on UI.
use std::sync::{mpsc, OnceLock};
use windows::{
    core::Result,
    Win32::{
        Foundation::{GlobalFree, HANDLE, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM},
        System::{
            DataExchange::*, LibraryLoader::GetModuleHandleW, Memory::*, Ole::CF_UNICODETEXT,
        },
        UI::WindowsAndMessaging::*,
    },
};

static CLICK_SENDER: OnceLock<mpsc::Sender<(i32, i32)>> = OnceLock::new();

pub struct MouseClickMonitor(mpsc::Receiver<(i32, i32)>);
impl MouseClickMonitor {
    pub fn start() -> std::result::Result<Self, String> {
        let (sender, receiver) = mpsc::channel();
        CLICK_SENDER.set(sender).map_err(|_| "鼠标点击监听已启动")?;
        let (ready_tx, ready_rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("landict-mouse-clicks".into())
            .spawn(move || unsafe {
                let hook = GetModuleHandleW(None).and_then(|module| {
                    SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), Some(HINSTANCE(module.0)), 0)
                });
                let hook = match hook {
                    Ok(hook) => {
                        let _ = ready_tx.send(Ok(()));
                        hook
                    }
                    Err(_) => {
                        let _ = ready_tx.send(Err("无法监听窗口外的鼠标点击".to_string()));
                        return;
                    }
                };
                let mut message = MSG::default();
                while GetMessageW(&mut message, None, 0, 0).0 > 0 {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
                let _ = UnhookWindowsHookEx(hook);
            })
            .map_err(|_| "无法启动鼠标点击监听")?;
        ready_rx.recv().map_err(|_| "鼠标点击监听初始化失败")??;
        Ok(Self(receiver))
    }

    pub fn clicks(&self) -> impl Iterator<Item = (i32, i32)> + '_ {
        self.0.try_iter()
    }
}

unsafe extern "system" fn mouse_hook(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
    if code >= 0
        && matches!(
            message.0 as u32,
            WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN
        )
    {
        let point = unsafe { (*(data.0 as *const MSLLHOOKSTRUCT)).pt };
        if let Some(sender) = CLICK_SENDER.get() {
            let _ = sender.send((point.x, point.y));
        }
    }
    unsafe { CallNextHookEx(None, code, message, data) }
}

pub fn show_without_activation(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    // Keep NOACTIVATE until an explicit pointer press activates the card.
    window.set_focusable(false)?;
    window.show()
}

pub fn copy_text(owner: HWND, text: &str) -> Result<()> {
    let text: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, text.len() * std::mem::size_of::<u16>())?;
        let destination = GlobalLock(memory);
        if destination.is_null() {
            let _ = GlobalFree(Some(memory));
            return Err(windows::core::Error::from_win32());
        }
        std::ptr::copy_nonoverlapping(text.as_ptr(), destination.cast::<u16>(), text.len());
        let _ = GlobalUnlock(memory);
        if let Err(error) = OpenClipboard(Some(owner)) {
            let _ = GlobalFree(Some(memory));
            return Err(error);
        }
        let result = EmptyClipboard()
            .and_then(|_| SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(memory.0))));
        let _ = CloseClipboard();
        if let Err(error) = result {
            let _ = GlobalFree(Some(memory));
            return Err(error);
        }
        // Clipboard owns the memory after a successful SetClipboardData.
        Ok(())
    }
}
