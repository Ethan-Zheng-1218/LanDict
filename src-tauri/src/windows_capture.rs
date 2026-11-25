//! All COM/WinRT objects stay on the capture thread. Screen coordinates are physical pixels.
use crate::capture_logic::{context_for_word, normalize_word};
use windows::{
    core::{Interface, HSTRING},
    Globalization::Language,
    Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap},
    Media::Ocr::OcrEngine,
    Storage::Streams::DataWriter,
    Win32::{
        Foundation::POINT,
        Graphics::Gdi::*,
        System::{
            Com::{CoCreateInstance, CLSCTX_INPROC_SERVER},
            Ole::*,
            WinRT::*,
        },
        UI::{Accessibility::*, Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
    },
};

pub struct CapturedText {
    pub word: String,
    pub context: String,
    pub source: &'static str,
}
pub struct CaptureEngine {
    automation: IUIAutomation,
    ocr: Option<OcrEngine>,
    _apartment: Apartment,
}
struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            RoUninitialize();
        }
    }
}

pub fn cursor() -> Option<POINT> {
    let mut point = POINT::default();
    unsafe {
        GetCursorPos(&mut point).ok()?;
    }
    Some(point)
}

pub fn escape_pressed() -> bool {
    unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) < 0 }
}
pub fn selecting() -> bool {
    unsafe {
        GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0 || GetAsyncKeyState(VK_RBUTTON.0 as i32) < 0
    }
}

pub fn input_marker() -> (u32, isize) {
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        ..Default::default()
    };
    unsafe {
        let _ = GetLastInputInfo(&mut info);
        (info.dwTime, GetForegroundWindow().0 as isize)
    }
}

pub fn own_window(point: POINT) -> bool {
    unsafe {
        let window = GetAncestor(WindowFromPoint(point), GA_ROOT);
        let mut pid = 0;
        GetWindowThreadProcessId(window, Some(&mut pid));
        pid == std::process::id()
    }
}

impl CaptureEngine {
    pub fn new() -> Result<Self, String> {
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED).map_err(|_| "Windows 取词初始化失败")?;
        }
        let apartment = Apartment;
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER) }
                .map_err(|_| "Windows 文字读取接口不可用")?;
        if let Ok(options) = automation.cast::<IUIAutomation2>() {
            unsafe {
                let _ = options.SetConnectionTimeout(500);
                let _ = options.SetTransactionTimeout(500);
            }
        }
        let ocr = Language::CreateLanguage(&HSTRING::from("en-US"))
            .ok()
            .and_then(|language| OcrEngine::TryCreateFromLanguage(&language).ok());
        Ok(Self {
            automation,
            ocr,
            _apartment: apartment,
        })
    }

    pub fn ocr_available(&self) -> bool {
        self.ocr.is_some()
    }

    pub fn capture(&self, point: POINT, use_ocr: bool) -> Option<CapturedText> {
        if own_window(point) {
            return None;
        }
        // Password controls are excluded before either direct extraction or OCR.
        let element = unsafe { self.automation.ElementFromPoint(point) }.ok();
        if element.as_ref().is_some_and(|item| unsafe {
            item.CurrentIsPassword()
                .map(|value| value.as_bool())
                .unwrap_or(false)
        }) {
            return None;
        }
        if let Some(element) = element {
            if let Some(text) = unsafe { self.capture_uia(point, element) } {
                return Some(text);
            }
        }
        if use_ocr {
            self.capture_ocr(point)
        } else {
            None
        }
    }

    unsafe fn capture_uia(
        &self,
        point: POINT,
        mut element: IUIAutomationElement,
    ) -> Option<CapturedText> {
        let walker = unsafe { self.automation.RawViewWalker() }.ok()?;
        // Browser text leaves often expose TextPattern on an ancestor instead of the leaf.
        for _ in 0..8 {
            if unsafe { element.CurrentIsPassword() }.ok()?.as_bool() {
                return None;
            }
            if let Ok(pattern) = unsafe {
                element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
            } {
                if let Some(captured) = unsafe { text_from_pattern(&pattern, point) } {
                    return Some(captured);
                }
            }
            element = unsafe { walker.GetParentElement(&element) }.ok()?;
        }
        None
    }

    fn capture_ocr(&self, point: POINT) -> Option<CapturedText> {
        let engine = self.ocr.as_ref()?;
        let monitor = unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST) };
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
            return None;
        }
        let rect = info.rcMonitor;
        let left = (point.x - 500).max(rect.left);
        let top = (point.y - 120).max(rect.top);
        let width = (left + 1000).min(rect.right) - left;
        let height = (top + 240).min(rect.bottom) - top;
        let bitmap = unsafe { screen_bitmap(left, top, width, height) }.ok()?;
        recognized_text(engine, &bitmap, (point.x - left, point.y - top))
    }
}

fn recognized_text(
    engine: &OcrEngine,
    bitmap: &SoftwareBitmap,
    point: (i32, i32),
) -> Option<CapturedText> {
    let result = engine.RecognizeAsync(bitmap).ok()?.get().ok()?;
    let lines = result.Lines().ok()?;
    let mut texts = Vec::new();
    let mut found = None;
    for (index, line) in lines.into_iter().enumerate() {
        let text = line.Text().ok()?.to_string();
        let mut text_offset = 0;
        for word in line.Words().ok()? {
            let raw_word = word.Text().ok()?.to_string();
            let offset = text[text_offset..]
                .find(&raw_word)
                .map(|offset| text_offset + offset);
            if let Some(offset) = offset {
                text_offset = offset + raw_word.len();
            }
            let bounds = word.BoundingRect().ok()?;
            let x = point.0 as f32;
            let y = point.1 as f32;
            if x >= bounds.X
                && x < bounds.X + bounds.Width
                && y >= bounds.Y
                && y < bounds.Y + bounds.Height
            {
                if let (Some(word), Some(offset)) = (normalize_word(&raw_word), offset) {
                    found = Some((index, word, offset));
                }
            }
        }
        texts.push(text);
    }
    let (index, word, offset) = found?;
    let from = index.saturating_sub(1);
    let context = texts[from..(index + 2).min(texts.len())].join(" ");
    let offset = texts[from..index]
        .iter()
        .map(|line| line.len() + 1)
        .sum::<usize>()
        + offset;
    Some(CapturedText {
        context: context_for_word(&context, &word, offset),
        word,
        source: "ocr",
    })
}

unsafe fn text_from_pattern(
    pattern: &IUIAutomationTextPattern,
    point: POINT,
) -> Option<CapturedText> {
    let range = unsafe { pattern.RangeFromPoint(point) }.ok()?;
    unsafe { range.ExpandToEnclosingUnit(TextUnit_Word) }.ok()?;
    let raw = unsafe { range.GetText(100) }.ok()?.to_string();
    let word = normalize_word(&raw)?;
    let trailing = raw.chars().rev().take_while(|c| c.is_whitespace()).count();
    if trailing > 0 {
        unsafe {
            range.MoveEndpointByUnit(
                TextPatternRangeEndpoint_End,
                TextUnit_Character,
                -(trailing as i32),
            )
        }
        .ok()?;
    }
    if !unsafe { point_in_range(&range, point) } {
        return None;
    }
    let context = (|| -> Option<String> {
        let context = unsafe { range.Clone() }.ok()?;
        unsafe { context.ExpandToEnclosingUnit(TextUnit_Line) }.ok()?;
        unsafe {
            let _ = context.MoveEndpointByUnit(TextPatternRangeEndpoint_Start, TextUnit_Line, -1);
            let _ = context.MoveEndpointByUnit(TextPatternRangeEndpoint_End, TextUnit_Line, 1);
        }
        let text = unsafe { context.GetText(2400) }.ok()?.to_string();
        let prefix = unsafe { context.Clone() }.ok()?;
        unsafe {
            prefix.MoveEndpointByRange(
                TextPatternRangeEndpoint_End,
                &range,
                TextPatternRangeEndpoint_Start,
            )
        }
        .ok()?;
        let offset = unsafe { prefix.GetText(2400) }.ok()?.to_string().len();
        Some(context_for_word(&text, &word, offset))
    })()
    .unwrap_or_default();
    Some(CapturedText {
        context,
        word,
        source: "uia",
    })
}

unsafe fn point_in_range(range: &IUIAutomationTextRange, point: POINT) -> bool {
    let Ok(array) = (unsafe { range.GetBoundingRectangles() }) else {
        return false;
    };
    if array.is_null() {
        return false;
    }
    let result = (|| -> windows::core::Result<bool> {
        let count = unsafe { SafeArrayGetUBound(array, 1)? - SafeArrayGetLBound(array, 1)? + 1 };
        let mut data = std::ptr::null_mut();
        unsafe {
            SafeArrayAccessData(array, &mut data)?;
        }
        let result = if count > 0 && !data.is_null() {
            let values = unsafe { std::slice::from_raw_parts(data as *const f64, count as usize) };
            values.chunks_exact(4).any(|rect| {
                point.x as f64 >= rect[0]
                    && (point.x as f64) < rect[0] + rect[2]
                    && point.y as f64 >= rect[1]
                    && (point.y as f64) < rect[1] + rect[3]
            })
        } else {
            false
        };
        unsafe {
            SafeArrayUnaccessData(array)?;
        }
        Ok(result)
    })()
    .unwrap_or(false);
    unsafe {
        let _ = SafeArrayDestroy(array);
    }
    result
}

unsafe fn screen_bitmap(
    left: i32,
    top: i32,
    width: i32,
    height: i32,
) -> windows::core::Result<SoftwareBitmap> {
    let screen = unsafe { GetDC(None) };
    let memory = unsafe { CreateCompatibleDC(Some(screen)) };
    let bitmap = unsafe { CreateCompatibleBitmap(screen, width, height) };
    if screen.is_invalid() || memory.is_invalid() || bitmap.is_invalid() {
        unsafe {
            if !bitmap.is_invalid() {
                let _ = DeleteObject(bitmap.into());
            }
            if !memory.is_invalid() {
                let _ = DeleteDC(memory);
            }
            if !screen.is_invalid() {
                ReleaseDC(None, screen);
            }
        }
        return Err(windows::core::Error::from_win32());
    }
    let old = unsafe { SelectObject(memory, bitmap.into()) };
    let copied = unsafe {
        BitBlt(
            memory,
            0,
            0,
            width,
            height,
            Some(screen),
            left,
            top,
            SRCCOPY,
        )
    };
    // GetDIBits requires the bitmap to be deselected from the device context.
    unsafe {
        SelectObject(memory, old);
    }
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let mut info = BITMAPINFO::default();
    info.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width,
        biHeight: -height,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };
    let rows = if copied.is_ok() {
        unsafe {
            GetDIBits(
                screen,
                bitmap,
                0,
                height as u32,
                Some(pixels.as_mut_ptr().cast()),
                &mut info,
                DIB_RGB_COLORS,
            )
        }
    } else {
        0
    };
    unsafe {
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
    }
    if rows != height {
        return Err(windows::core::Error::from_win32());
    }
    for pixel in pixels.chunks_exact_mut(4) {
        pixel[3] = 255;
    }
    let writer = DataWriter::new()?;
    writer.WriteBytes(&pixels)?;
    SoftwareBitmap::CreateCopyFromBuffer(
        &writer.DetachBuffer()?,
        BitmapPixelFormat::Bgra8,
        width,
        height,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::{core::w, Win32::Foundation::SIZE};

    #[test]
    fn real_windows_ocr_extracts_the_pointed_word_and_context() {
        let capture = CaptureEngine::new().expect("Windows UI Automation initialization");
        let Some(engine) = capture.ocr.as_ref() else {
            eprintln!(
                "OCR integration unavailable: install the Windows English OCR language pack."
            );
            return;
        };
        // Render a fixture directly into memory; this test never captures the user's desktop.
        let (width, height) = (600, 100);
        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let (pixels, point) = unsafe {
            let dc = CreateCompatibleDC(None);
            let mut bits = std::ptr::null_mut();
            let bitmap =
                CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0).unwrap();
            let bytes =
                std::slice::from_raw_parts_mut(bits as *mut u8, (width * height * 4) as usize);
            bytes.fill(255);
            let old_bitmap = SelectObject(dc, bitmap.into());
            let font = CreateFontW(
                -28,
                0,
                0,
                0,
                400,
                0,
                0,
                0,
                DEFAULT_CHARSET,
                OUT_DEFAULT_PRECIS,
                CLIP_DEFAULT_PRECIS,
                ANTIALIASED_QUALITY,
                0,
                w!("Arial"),
            );
            let old_font = SelectObject(dc, font.into());
            let text: Vec<u16> = "He sat on the bank.".encode_utf16().collect();
            assert!(TextOutW(dc, 20, 20, &text).as_bool());
            let mut prefix = SIZE::default();
            let mut word_size = SIZE::default();
            assert!(GetTextExtentPoint32W(
                dc,
                &"He sat on the ".encode_utf16().collect::<Vec<_>>(),
                &mut prefix
            )
            .as_bool());
            assert!(GetTextExtentPoint32W(
                dc,
                &"bank".encode_utf16().collect::<Vec<_>>(),
                &mut word_size
            )
            .as_bool());
            let pixels = bytes.to_vec();
            SelectObject(dc, old_font);
            SelectObject(dc, old_bitmap);
            let _ = DeleteObject(font.into());
            let _ = DeleteObject(bitmap.into());
            let _ = DeleteDC(dc);
            (pixels, (20 + prefix.cx + word_size.cx / 2, 34))
        };
        let writer = DataWriter::new().unwrap();
        writer.WriteBytes(&pixels).unwrap();
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &writer.DetachBuffer().unwrap(),
            BitmapPixelFormat::Bgra8,
            width,
            height,
        )
        .unwrap();
        let result = recognized_text(engine, &bitmap, point).expect("pointed OCR word");
        assert_eq!(result.word, "bank");
        assert!(result.context.contains("sat on the bank"));
        assert!(recognized_text(engine, &bitmap, (580, 80)).is_none());
    }
}
