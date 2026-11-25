use crate::capture_logic::{popup_position, PopupInteraction, ScreenRect};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State};

#[derive(Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LookupSettings {
    enabled: bool,
    delay_ms: u64,
    ocr_enabled: bool,
}
impl Default for LookupSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            delay_ms: 500,
            ocr_enabled: true,
        }
    }
}

#[derive(Clone, Serialize)]
pub struct HoverSample {
    id: u64,
    word: String,
    context: String,
    source: String,
}
#[derive(Clone, Default, Serialize)]
pub struct HoverSnapshot {
    revision: u64,
    sample: Option<HoverSample>,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    error: Option<String>,
    ocr_available: bool,
}

#[derive(Default)]
struct Runtime {
    settings: LookupSettings,
    configuration: u64,
    ready: bool,
    snapshot: HoverSnapshot,
    status: CaptureStatus,
    popup: PopupInteraction,
    anchor: Option<(i32, i32)>,
}
#[derive(Default, Clone)]
pub struct MouseLookupState(Arc<Mutex<Runtime>>);
struct TrayControls {
    enabled: CheckMenuItem<tauri::Wry>,
}

fn refresh_tray(app: &tauri::AppHandle) {
    let state = app.state::<MouseLookupState>();
    let (enabled, error) = {
        let runtime = state.0.lock().unwrap();
        (runtime.settings.enabled, runtime.status.error.clone())
    };
    if let Some(tray) = app.tray_by_id("landict") {
        let tooltip = if let Some(error) = error {
            format!("LanDict · {error}")
        } else if enabled {
            "LanDict · 鼠标取词运行中".into()
        } else {
            "LanDict · 鼠标取词已暂停".into()
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
    if let Some(controls) = app.try_state::<TrayControls>() {
        let _ = controls.enabled.set_checked(enabled);
    }
}

fn clear(app: &tauri::AppHandle, state: &MouseLookupState) {
    let snapshot = {
        let mut runtime = state.0.lock().unwrap();
        runtime.popup.bounds = None;
        if runtime.snapshot.sample.is_none() {
            return;
        }
        runtime.snapshot.revision += 1;
        runtime.snapshot.sample = None;
        runtime.snapshot.clone()
    };
    let _ = app.emit_to("mouse-lookup", "mouse-lookup", &snapshot);
    if let Some(window) = app.get_webview_window("mouse-lookup") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn configure_mouse_lookup(
    app: tauri::AppHandle,
    mut settings: LookupSettings,
    state: State<'_, MouseLookupState>,
) -> CaptureStatus {
    settings.delay_ms = settings.delay_ms.clamp(100, 3000);
    let status = {
        let mut runtime = state.0.lock().unwrap();
        if runtime.settings != settings {
            runtime.configuration += 1;
            runtime.settings = settings;
        }
        runtime.status.clone()
    };
    if !state.0.lock().unwrap().settings.enabled {
        clear(&app, &state);
    }
    refresh_tray(&app);
    status
}

#[tauri::command]
pub fn mouse_lookup_snapshot(state: State<'_, MouseLookupState>) -> HoverSnapshot {
    state.0.lock().unwrap().snapshot.clone()
}

#[tauri::command]
pub fn mouse_lookup_ready(state: State<'_, MouseLookupState>) {
    state.0.lock().unwrap().ready = true;
}

#[tauri::command]
pub fn dismiss_mouse_lookup(app: tauri::AppHandle, id: u64, state: State<'_, MouseLookupState>) {
    {
        let mut runtime = state.0.lock().unwrap();
        if runtime.snapshot.sample.as_ref().map(|sample| sample.id) != Some(id) {
            return;
        }
        #[cfg(windows)]
        if let Some(point) = crate::windows_capture::cursor() {
            runtime.popup.dismiss((point.x, point.y));
        }
    }
    clear(&app, &state);
}

#[tauri::command]
pub fn activate_mouse_lookup(
    app: tauri::AppHandle,
    id: u64,
    state: State<'_, MouseLookupState>,
) -> tauri::Result<()> {
    let runtime = state.0.lock().unwrap();
    if runtime.snapshot.sample.as_ref().map(|sample| sample.id) != Some(id) {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window("mouse-lookup") {
        window.set_focusable(true)?;
        window.set_focus()?;
    }
    Ok(())
}

#[tauri::command]
pub fn resize_mouse_lookup(
    app: tauri::AppHandle,
    id: u64,
    width: u32,
    height: u32,
) -> tauri::Result<()> {
    position_popup(&app, id, width.clamp(228, 480), height.clamp(180, 360))
}

#[tauri::command]
pub fn copy_mouse_lookup_content(app: tauri::AppHandle, text: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let window = app
            .get_webview_window("mouse-lookup")
            .ok_or("取词窗口不可用")?;
        let handle = window.hwnd().map_err(|_| "取词窗口不可用")?;
        crate::windows_input::copy_text(windows::Win32::Foundation::HWND(handle.0), &text)
            .map_err(|_| "剪贴板暂时不可用，请稍后重试".into())
    }
    #[cfg(not(windows))]
    Err("鼠标取词仅支持 Windows".into())
}

fn position_popup(app: &tauri::AppHandle, id: u64, width: u32, height: u32) -> tauri::Result<()> {
    let state = app.state::<MouseLookupState>();
    let (anchor, old_bounds) = {
        let runtime = state.0.lock().unwrap();
        if runtime.snapshot.sample.as_ref().map(|sample| sample.id) != Some(id) {
            return Ok(());
        }
        (runtime.anchor, runtime.popup.bounds)
    };
    let Some(anchor) = anchor else {
        return Ok(());
    };
    let Some(window) = app.get_webview_window("mouse-lookup") else {
        return Ok(());
    };
    let Some(monitor) = app.monitor_from_point(anchor.0 as f64, anchor.1 as f64)? else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let size = (
        (width as f64 * scale).round() as i32,
        (height as f64 * scale).round() as i32,
    );
    let bounds = (
        work.position.x,
        work.position.y,
        work.position.x + work.size.width as i32,
        work.position.y + work.size.height as i32,
    );
    // Preserve the interactive window's top-left corner while content finishes loading.
    let (x, y) = if let Some(old) = old_bounds {
        (
            old.x.clamp(bounds.0, (bounds.2 - size.0).max(bounds.0)),
            old.y.clamp(bounds.1, (bounds.3 - size.1).max(bounds.1)),
        )
    } else {
        popup_position(anchor, bounds, size, (12.0 * scale) as i32)
    };
    if old_bounds.is_some_and(|old| old.x == x && old.y == y && old.width == size.0 && old.height == size.1) {
        return Ok(());
    }
    window.set_size(tauri::PhysicalSize::new(size.0 as u32, size.1 as u32))?;
    window.set_position(tauri::PhysicalPosition::new(x, y))?;
    let mut runtime = state.0.lock().unwrap();
    if runtime.snapshot.sample.as_ref().map(|sample| sample.id) == Some(id) {
        runtime.popup.open(ScreenRect {
            x,
            y,
            width: size.0,
            height: size.1,
        });
    }
    Ok(())
}

pub(crate) fn open_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开 LanDict", true, None::<&str>)?;
    let enabled = CheckMenuItem::with_id(app, "enabled", "鼠标取词", true, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 LanDict", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &enabled, &quit])?;
    app.manage(TrayControls { enabled });
    let mut tray = TrayIconBuilder::with_id("landict")
        .menu(&menu)
        .tooltip("LanDict · 正在初始化")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_main(app),
            "quit" => app.exit(0),
            "enabled" => {
                let state = app.state::<MouseLookupState>();
                let enabled = {
                    let mut runtime = state.0.lock().unwrap();
                    runtime.settings.enabled = !runtime.settings.enabled;
                    runtime.configuration += 1;
                    runtime.settings.enabled
                };
                if !enabled {
                    clear(app, &state);
                }
                refresh_tray(app);
                let _ = app.emit_to("main", "mouse-lookup-enabled", enabled);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                open_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        let transparent_icon = tauri::image::Image::new_owned(
            crate::tray_icon::transparent_background(
                icon.rgba(),
                icon.width() as usize,
                icon.height() as usize,
            ),
            icon.width(),
            icon.height(),
        );
        if let Some(window) = app.get_webview_window("main") {
            window.set_icon(transparent_icon.clone())?;
        }
        tray = tray.icon(transparent_icon);
    }
    tray.build(app)?;

    let popup = tauri::WebviewWindowBuilder::new(
        app,
        "mouse-lookup",
        tauri::WebviewUrl::App("index.html?window=mouse-lookup".into()),
    )
    .title("LanDict 鼠标取词")
    .inner_size(320.0, 230.0)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .focusable(true)
    .transparent(true)
    .shadow(false)
    .build()?;
    popup.set_ignore_cursor_events(false)?;
    let state = app.state::<MouseLookupState>().inner().clone();
    let handle = app.handle().clone();
    #[cfg(windows)]
    std::thread::Builder::new()
        .name("landict-mouse-lookup".into())
        .spawn(move || worker(handle, state))
        .map_err(tauri::Error::Io)?;
    #[cfg(not(windows))]
    {
        state.0.lock().unwrap().status.error = Some("鼠标取词仅支持 Windows 桌面版".into());
        refresh_tray(&handle);
    }
    Ok(())
}

#[cfg(windows)]
fn worker(app: tauri::AppHandle, state: MouseLookupState) {
    use crate::{
        capture_logic::{HoverTracker, PointerAction},
        windows_capture::*,
    };
    let clicks = match crate::windows_input::MouseClickMonitor::start() {
        Ok(clicks) => clicks,
        Err(error) => {
            state.0.lock().unwrap().status.error = Some(error);
            refresh_tray(&app);
            let _ = app.emit_to(
                "main",
                "mouse-lookup-status",
                &state.0.lock().unwrap().status,
            );
            return;
        }
    };
    use std::time::{Duration, Instant};
    let engine = match CaptureEngine::new() {
        Ok(engine) => engine,
        Err(error) => {
            state.0.lock().unwrap().status.error = Some(error);
            refresh_tray(&app);
            let _ = app.emit_to(
                "main",
                "mouse-lookup-status",
                &state.0.lock().unwrap().status,
            );
            return;
        }
    };
    state.0.lock().unwrap().status.ocr_available = engine.ocr_available();
    refresh_tray(&app);
    let mut tracker = HoverTracker::default();
    let mut configuration = 0;
    let origin = Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(40));
        let (settings, ready, generation) = {
            let runtime = state.0.lock().unwrap();
            (
                runtime.settings.clone(),
                runtime.ready,
                runtime.configuration,
            )
        };
        if generation != configuration {
            configuration = generation;
            tracker = HoverTracker::default();
            clear(&app, &state);
        }
        let Some(point) = cursor() else {
            continue;
        };
        let position = (point.x, point.y);
        for clicked_point in clicks.clicks() {
            let action = state.0.lock().unwrap().popup.action(clicked_point, true);
            if action == PointerAction::Dismiss {
                clear(&app, &state);
                tracker = HoverTracker::default();
            }
        }
        let marker = input_marker();
        tracker.on_input(marker);
        if !settings.enabled || !ready {
            clear(&app, &state);
            tracker = HoverTracker::default();
            continue;
        }
        if escape_pressed() {
            state.0.lock().unwrap().popup.dismiss(position);
            clear(&app, &state);
            tracker.dismiss();
            continue;
        }
        if state.0.lock().unwrap().popup.action(position, false) == PointerAction::Keep
            || selecting()
            || own_window(point)
        {
            tracker = HoverTracker::default();
            continue;
        }
        let triggered = tracker.tick(
            position,
            origin.elapsed().as_millis() as u64,
            settings.delay_ms,
        );
        if !triggered {
            continue;
        }
        let Some(captured) = engine.capture(point, settings.ocr_enabled) else {
            continue;
        };
        // UIA/OCR can finish after movement or a settings change. Never display stale text.
        if cursor().is_none_or(|current| {
            (current.x - point.x).abs() > 4 || (current.y - point.y).abs() > 4
        }) || input_marker() != marker
            || selecting()
            || escape_pressed()
        {
            continue;
        }
        let handle = app.clone();
        let shared = state.clone();
        let _ = app.run_on_main_thread(move || {
            // Commit the sample only when the UI can show it. A pending capture must not
            // invalidate the close/resize actions of the card that is still on screen.
            if input_marker() != marker
                || escape_pressed()
                || cursor().is_none_or(|current| {
                    (current.x - point.x).abs() > 4 || (current.y - point.y).abs() > 4
                })
            {
                return;
            }
            let Some(window) = handle.get_webview_window("mouse-lookup") else {
                return;
            };
            let snapshot = {
                let mut runtime = shared.0.lock().unwrap();
                if runtime.configuration != generation || !runtime.settings.enabled {
                    return;
                }
                // LASTINPUTINFO can change on sub-threshold pointer jitter. Keep the
                // visible target and its AI state instead of remounting/resetting its size.
                if runtime.popup.bounds.is_some()
                    && runtime.anchor.is_some_and(|old| (old.0 - position.0).abs() <= 4 && (old.1 - position.1).abs() <= 4)
                    && runtime.snapshot.sample.as_ref().is_some_and(|sample| {
                        sample.word == captured.word && sample.context == captured.context && sample.source == captured.source
                    })
                {
                    return;
                }
                runtime.snapshot.revision += 1;
                runtime.anchor = Some(position);
                runtime.popup = PopupInteraction::default();
                runtime.snapshot.sample = Some(HoverSample {
                    id: runtime.snapshot.revision,
                    word: captured.word,
                    context: captured.context,
                    source: captured.source.into(),
                });
                runtime.snapshot.clone()
            };
            let word_length = snapshot
                .sample
                .as_ref()
                .map(|sample| sample.word.len())
                .unwrap_or(0) as u32;
            let _ = position_popup(
                &handle,
                snapshot.revision,
                (word_length * 13 + 120).clamp(228, 480),
                230,
            );
            let runtime = shared.0.lock().unwrap();
            if runtime.snapshot.revision != snapshot.revision {
                return;
            }
            let _ = handle.emit_to("mouse-lookup", "mouse-lookup", &snapshot);
            let _ = crate::windows_input::show_without_activation(&window);
        });
    }
}
