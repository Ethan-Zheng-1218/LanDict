//! Windows ABI used only by the separate, 32-bit NSIS rendering module.
#![allow(non_snake_case, dead_code)]
use std::ffi::c_void;
pub type Handle = *mut c_void;
pub type WndProc = unsafe extern "system" fn(Handle, u32, usize, isize) -> isize;
pub type SubclassProc = unsafe extern "system" fn(Handle,u32,usize,isize,usize,usize)->isize;
#[repr(C)] #[derive(Default, Clone, Copy)] pub struct Rect { pub left:i32, pub top:i32, pub right:i32, pub bottom:i32 }
#[repr(C)] #[derive(Default)] pub struct Point { pub x:i32, pub y:i32 }
#[repr(C)] pub struct MonitorInfo {pub size:u32,pub monitor:Rect,pub work:Rect,pub flags:u32}
#[repr(C)] pub struct RectF {pub x:f32,pub y:f32,pub width:f32,pub height:f32}
#[repr(C)] pub struct Paint {pub hdc:Handle,pub erase:i32,pub rect:Rect,pub restore:i32,pub update:i32,pub reserved:[u8;32]}
#[repr(C)] pub struct Class {
    pub size:u32,pub style:u32,pub proc:Option<WndProc>,pub cls_extra:i32,pub wnd_extra:i32,
    pub instance:Handle,pub icon:Handle,pub cursor:Handle,pub background:Handle,
    pub menu:*const u16,pub name:*const u16,pub small_icon:Handle,
}
#[repr(C)] pub struct Startup {pub version:u32,pub callback:Handle,pub no_thread:i32,pub no_codecs:i32}
#[repr(C)] pub struct BitmapInfoHeader {pub size:u32,pub width:i32,pub height:i32,pub planes:u16,pub bits:u16,pub compression:u32,pub image_size:u32,pub xppm:i32,pub yppm:i32,pub colors:u32,pub important:u32}
#[repr(C)] pub struct BitmapInfo {pub header:BitmapInfoHeader,pub colors:[u32;1]}
#[repr(C)] pub struct Stack {pub next:*mut Stack,pub text:[u16;1]}
#[repr(C)] pub struct Extra {
    pub flags:Handle,pub execute:Handle,pub validate:Handle,
    pub register:Option<unsafe extern "system" fn(Handle,unsafe extern "C" fn(u32)->usize)->i32>,
}
#[repr(C)] pub struct DrawItem {pub kind:u32,pub id:u32,pub item:u32,pub action:u32,pub state:u32,pub hwnd:Handle,pub dc:Handle,pub rect:Rect,pub data:usize}
#[repr(C)] #[derive(Default)] pub struct TrackMouse {pub size:u32,pub flags:u32,pub hwnd:Handle,pub hover_time:u32}
#[repr(C)] pub struct BrowseInfo {
    pub owner:Handle,pub pidl_root:*mut c_void,pub display:*const u16,pub title:*const u16,
    pub flags:u32,pub proc:Option<unsafe extern "system" fn(Handle,u32,isize,isize)->i32>,pub param:isize,pub image:i32,
}
#[link(name="user32")] extern "system" {
    pub fn RegisterClassExW(class:*const Class)->u16;
    pub fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,style:u32,x:i32,y:i32,w:i32,h:i32,parent:Handle,menu:Handle,instance:Handle,param:Handle)->Handle;
    pub fn DefWindowProcW(hwnd:Handle,msg:u32,w:usize,l:isize)->isize;
    pub fn GetWindowLongW(hwnd:Handle,index:i32)->i32;
    pub fn SetWindowLongW(hwnd:Handle,index:i32,value:i32)->i32;
    pub fn GetDlgItem(hwnd:Handle,id:i32)->Handle;
    pub fn GetParent(hwnd:Handle)->Handle;
    pub fn FindWindowExW(parent:Handle,after:Handle,class:*const u16,title:*const u16)->Handle;
    pub fn ShowWindow(hwnd:Handle,cmd:i32)->i32;
    pub fn EnableWindow(hwnd:Handle,enable:i32)->i32;
    pub fn SetWindowPos(hwnd:Handle,after:Handle,x:i32,y:i32,w:i32,h:i32,flags:u32)->i32;
    pub fn GetClientRect(hwnd:Handle,rect:*mut Rect)->i32;
    pub fn GetWindowRect(hwnd:Handle,rect:*mut Rect)->i32;
    pub fn GetDpiForWindow(hwnd:Handle)->u32;
    pub fn MonitorFromWindow(hwnd:Handle,flags:u32)->Handle;
    pub fn GetMonitorInfoW(monitor:Handle,info:*mut MonitorInfo)->i32;
    pub fn SetTimer(hwnd:Handle,id:usize,ms:u32,proc:Handle)->usize;
    pub fn KillTimer(hwnd:Handle,id:usize)->i32;
    pub fn SendMessageW(hwnd:Handle,msg:u32,w:usize,l:isize)->isize;
    pub fn PostMessageW(hwnd:Handle,msg:u32,w:usize,l:isize)->i32;
    pub fn InvalidateRect(hwnd:Handle,rect:*const Rect,erase:i32)->i32;
    pub fn BeginPaint(hwnd:Handle,paint:*mut Paint)->Handle;
    pub fn EndPaint(hwnd:Handle,paint:*const Paint)->i32;
    pub fn DestroyWindow(hwnd:Handle)->i32;
    pub fn SetWindowRgn(hwnd:Handle,region:Handle,redraw:i32)->i32;
    pub fn ReleaseCapture()->i32;
    pub fn SetFocus(hwnd:Handle)->Handle;
    pub fn GetFocus()->Handle;
    pub fn SetCursor(cursor:Handle)->Handle;
    pub fn TrackMouseEvent(event:*mut TrackMouse)->i32;
    pub fn SetWindowTextW(hwnd:Handle,text:*const u16)->i32;
    pub fn LoadCursorW(instance:Handle,name:*const u16)->Handle;
}
#[link(name="shell32")] extern "system" {
    pub fn SHBrowseForFolderW(info:*mut BrowseInfo)->*mut c_void;
    pub fn SHGetPathFromIDListW(item:*const c_void,path:*mut u16)->i32;
    pub fn ShellExecuteW(owner:Handle,operation:*const u16,file:*const u16,parameters:*const u16,directory:*const u16,show:i32)->Handle;
}
#[link(name="ole32")] extern "system" {
    pub fn CoTaskMemFree(mem:*mut c_void);
}
#[link(name="kernel32")] extern "system" {
    pub fn GlobalFree(mem:Handle)->Handle;
    pub fn GlobalAlloc(flags:u32,bytes:usize)->Handle;
    pub fn GetModuleHandleExW(flags:u32,name:*const u16,handle:*mut Handle)->i32;
    pub fn GetTickCount64()->u64;
}
#[link(name="gdi32")] extern "system" {
    pub fn CreateSolidBrush(color:u32)->Handle;
    pub fn SetBkMode(dc:Handle,mode:i32)->i32;
    pub fn SetTextColor(dc:Handle,color:u32)->u32;
    pub fn CreateFontW(height:i32,width:i32,esc:i32,orientation:i32,weight:i32,italic:u32,underline:u32,strike:u32,charset:u32,precision:u32,clip:u32,quality:u32,family:u32,face:*const u16)->Handle;
    pub fn CreateCompatibleDC(hdc:Handle)->Handle;
    pub fn CreateCompatibleBitmap(hdc:Handle,w:i32,h:i32)->Handle;
    pub fn GetDIBits(hdc:Handle,bitmap:Handle,start:u32,lines:u32,data:*mut u8,info:*mut BitmapInfo,usage:u32)->i32;
    pub fn SelectObject(hdc:Handle,obj:Handle)->Handle;
    pub fn DeleteObject(obj:Handle)->i32;
    pub fn DeleteDC(hdc:Handle)->i32;
    pub fn BitBlt(dest:Handle,x:i32,y:i32,w:i32,h:i32,src:Handle,sx:i32,sy:i32,rop:u32)->i32;
    pub fn CreateRoundRectRgn(left:i32,top:i32,right:i32,bottom:i32,w:i32,h:i32)->Handle;
}
#[link(name="comctl32")] extern "system" {
    pub fn SetWindowSubclass(hwnd:Handle,proc:Option<SubclassProc>,id:usize,data:usize)->i32;
    pub fn RemoveWindowSubclass(hwnd:Handle,proc:Option<SubclassProc>,id:usize)->i32;
    pub fn DefSubclassProc(hwnd:Handle,msg:u32,w:usize,l:isize)->isize;
}
#[link(name="gdiplus")] extern "system" {
    pub fn GdiplusStartup(token:*mut usize,input:*const Startup,out:Handle)->i32;
    pub fn GdiplusShutdown(token:usize);
    pub fn GdipLoadImageFromFile(file:*const u16,image:*mut Handle)->i32;
    pub fn GdipDisposeImage(image:Handle)->i32;
    pub fn GdipCreateBitmapFromScan0(width:i32,height:i32,stride:i32,format:i32,scan:*const u8,image:*mut Handle)->i32;
    pub fn GdipGetImageGraphicsContext(image:Handle,g:*mut Handle)->i32;
    pub fn GdipGetImageWidth(image:Handle,width:*mut u32)->i32;
    pub fn GdipGetImageHeight(image:Handle,height:*mut u32)->i32;
    pub fn GdipCreateFromHDC(hdc:Handle,graphics:*mut Handle)->i32;
    pub fn GdipDeleteGraphics(graphics:Handle)->i32;
    pub fn GdipSetSmoothingMode(g:Handle,mode:i32)->i32;
    pub fn GdipSetInterpolationMode(g:Handle,mode:i32)->i32;
    pub fn GdipSetPixelOffsetMode(g:Handle,mode:i32)->i32;
    pub fn GdipScaleWorldTransform(g:Handle,x:f32,y:f32,order:i32)->i32;
    pub fn GdipTranslateWorldTransform(g:Handle,x:f32,y:f32,order:i32)->i32;
    pub fn GdipRotateWorldTransform(g:Handle,angle:f32,order:i32)->i32;
    pub fn GdipSaveGraphics(g:Handle,state:*mut u32)->i32;
    pub fn GdipRestoreGraphics(g:Handle,state:u32)->i32;
    pub fn GdipSetClipRect(g:Handle,x:f32,y:f32,w:f32,h:f32,combine:i32)->i32;
    pub fn GdipCreatePath(mode:i32,path:*mut Handle)->i32;
    pub fn GdipAddPathEllipse(path:Handle,x:f32,y:f32,w:f32,h:f32)->i32;
    pub fn GdipAddPathArc(path:Handle,x:f32,y:f32,w:f32,h:f32,start:f32,sweep:f32)->i32;
    pub fn GdipClosePathFigure(path:Handle)->i32;
    pub fn GdipSetClipPath(g:Handle,path:Handle,combine:i32)->i32;
    pub fn GdipDeletePath(path:Handle)->i32;
    pub fn GdipDrawImageRect(g:Handle,image:Handle,x:f32,y:f32,w:f32,h:f32)->i32;
    pub fn GdipCreateSolidFill(color:u32,brush:*mut Handle)->i32;
    #[link_name="GdipCreateLineBrushI"]
    pub fn GdipCreateLineBrush(point1:*const Point,point2:*const Point,color1:u32,color2:u32,wrap:i32,brush:*mut Handle)->i32;
    pub fn GdipSetLinePresetBlend(brush:Handle,colors:*const u32,positions:*const f32,count:i32)->i32;
    pub fn GdipDeleteBrush(brush:Handle)->i32;
    pub fn GdipFillRectangle(g:Handle,brush:Handle,x:f32,y:f32,w:f32,h:f32)->i32;
    pub fn GdipFillEllipse(g:Handle,brush:Handle,x:f32,y:f32,w:f32,h:f32)->i32;
    pub fn GdipCreateFontFamilyFromName(name:*const u16,collection:Handle,family:*mut Handle)->i32;
    pub fn GdipDeleteFontFamily(family:Handle)->i32;
    pub fn GdipCreateFont(family:Handle,size:f32,style:i32,unit:i32,font:*mut Handle)->i32;
    pub fn GdipDeleteFont(font:Handle)->i32;
    pub fn GdipSetTextRenderingHint(g:Handle,hint:i32)->i32;
    pub fn GdipCreateStringFormat(flags:i32,language:u16,format:*mut Handle)->i32;
    pub fn GdipSetStringFormatAlign(format:Handle,align:i32)->i32;
    pub fn GdipDeleteStringFormat(format:Handle)->i32;
    pub fn GdipDrawString(g:Handle,text:*const u16,len:i32,font:Handle,rect:*const RectF,format:Handle,brush:Handle)->i32;
    pub fn GdipCreatePen1(color:u32,width:f32,unit:i32,pen:*mut Handle)->i32;
    pub fn GdipDrawPath(graphics:Handle,pen:Handle,path:Handle)->i32;
    pub fn GdipStringFormatGetGenericTypographic(format:*mut Handle)->i32;
    pub fn GdipSetStringFormatFlags(format:Handle,flags:i32)->i32;
    pub fn GdipFillPath(graphics:Handle,brush:Handle,path:Handle)->i32;
    pub fn GdipDeletePen(pen:Handle)->i32;
    pub fn GdipDrawLine(g:Handle,pen:Handle,x1:f32,y1:f32,x2:f32,y2:f32)->i32;
    pub fn GdipDrawRectangle(g:Handle,pen:Handle,x:f32,y:f32,w:f32,h:f32)->i32;
    pub fn GdipCreateImageAttributes(attr:*mut Handle)->i32;
    pub fn GdipSetImageAttributesColorMatrix(attr:Handle,kind:i32,enable:i32,color:*const f32,gray:*const f32,flags:i32)->i32;
    pub fn GdipDisposeImageAttributes(attr:Handle)->i32;
    pub fn GdipDrawImageRectRectI(g:Handle,image:Handle,x:i32,y:i32,w:i32,h:i32,sx:i32,sy:i32,sw:i32,sh:i32,unit:i32,attr:Handle,callback:Handle,data:Handle)->i32;
}

pub fn wide(text:&str)->Vec<u16>{text.encode_utf16().chain(Some(0)).collect()}
