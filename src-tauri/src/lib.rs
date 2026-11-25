mod capture_logic;
mod desktop_queries;
mod local_translation;
mod mouse_lookup;
mod reading_source;
mod tray_icon;
mod vocabulary_export;
#[cfg(windows)]
mod windows_capture;
#[cfg(windows)]
mod windows_input;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        mouse_lookup::open_main(app);
    }));
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_autostart::Builder::new().app_name("LanDict").build());
    builder
        .manage(mouse_lookup::MouseLookupState::default())
        .manage(desktop_queries::DictionaryState::default())
        .manage(desktop_queries::HttpState::default())
        .manage(desktop_queries::LookupState::default())
        .manage(local_translation::LocalTranslationState::default())
        .invoke_handler(tauri::generate_handler![
            mouse_lookup::configure_mouse_lookup,
            mouse_lookup::mouse_lookup_snapshot,
            mouse_lookup::mouse_lookup_ready,
            mouse_lookup::dismiss_mouse_lookup,
            mouse_lookup::activate_mouse_lookup,
            mouse_lookup::resize_mouse_lookup,
            mouse_lookup::copy_mouse_lookup_content,
            desktop_queries::desktop_dictionary,
            desktop_queries::dictionary_lookup,
            desktop_queries::dictionary_suggest,
            desktop_queries::dictionary_reverse,
            desktop_queries::dictionary_lemmas,
            desktop_queries::youdao_ipa,
            desktop_queries::youdao_dictionary,
            desktop_queries::desktop_ai_request,
            desktop_queries::cancel_desktop_ai,
            local_translation::desktop_local_translate,
            reading_source::reading_source,
            vocabulary_export::export_vocabulary_backup,
        ])
        .setup(|app| {
            mouse_lookup::setup(app)?;
            local_translation::prepare_in_background(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building LanDict")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<local_translation::LocalTranslationState>().stop();
            }
        });
}

