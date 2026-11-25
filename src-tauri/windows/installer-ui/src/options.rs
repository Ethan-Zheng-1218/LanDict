use super::{capsule, capsule_brush, fill, round_rect_pen, wide, State};
use super::win32::*;
use std::path::PathBuf;
use std::ptr::null_mut;

pub const INSTALL: usize = 11006;
pub const BROWSE: usize = 11009;
pub const PATH: usize = 11008;

const INSTALL_INDEX: usize = 0;
const BROWSE_INDEX: usize = 1;
const PATH_INDEX: usize = 2;

/// Row 1 (location) and row 2 (licence) of the preparation page.
const PATH_FIELD:[f32;4]=[168.0,514.0,278.0,30.0];
const BROWSE_BUTTON:[f32;4]=[454.0,514.0,46.0,30.0];
const INSTALL_BUTTON:[f32;4]=[578.0,530.0,92.0,34.0];
/// The licence row is painted by the artwork window itself. One box, one label, one link: a
/// native checkbox cannot be themed here, and its own frame clipped the label.
const CONSENT_BOX:[f32;4]=[62.0,552.0,16.0,19.0];
const CONSENT_LABEL:[f32;4]=[84.0,552.0,106.0,19.0];
const AGREEMENT_LINK:[f32;4]=[194.0,552.0,130.0,19.0];
/// Small UI text: hinting and pixel alignment matter more than the shape of the glyphs.
const TEXT_SIZE:f32=15.0;
const CONSENT_TEXT:&str="我已阅读并同意";
const AGREEMENT_TEXT:&str="《软件使用协议》";

pub struct OptionsUi {
    pub controls:[Handle; 3],
    pub consent:bool,
    agreement:PathBuf,
    font:Handle,
    background:Handle,
    paper:Handle,
    text_font:Handle,
    text_formats:[Handle;2],
}

impl Drop for OptionsUi {
    fn drop(&mut self) { unsafe { DeleteObject(self.font); DeleteObject(self.background); DeleteObject(self.paper); GdipDeleteFont(self.text_font); for format in self.text_formats {GdipDeleteStringFormat(format);} } }
}

fn inside(rect:[f32;4],x:f32,y:f32)->bool {
    (rect[0]..rect[0]+rect[2]).contains(&x)&&(rect[1]..rect[1]+rect[3]).contains(&y)
}

impl OptionsUi {
    pub unsafe fn new(parent: Handle, agreement: &str, default_path: &str) -> Self {
        let mut instance = null_mut();
        GetModuleHandleExW(6, super::Attach as *const u16, &mut instance);
        // Only the primary button, the folder button and the folder field remain: the licence
        // box and link are drawn by the artwork window.
        let mut controls = [null_mut(); 3];
        controls[INSTALL_INDEX]=CreateWindowExW(0,wide("BUTTON").as_ptr(),wide("开始安装").as_ptr(),0x5001000b,0,0,1,1,parent,INSTALL as Handle,instance,null_mut());
        controls[BROWSE_INDEX]=CreateWindowExW(0,wide("BUTTON").as_ptr(),wide("浏览").as_ptr(),0x5001000b,0,0,1,1,parent,BROWSE as Handle,instance,null_mut());
        // The edit is created with the default folder already inside it.
        controls[PATH_INDEX]=CreateWindowExW(0,wide("EDIT").as_ptr(),wide(default_path).as_ptr(),0x50010080,0,0,1,1,parent,PATH as Handle,instance,null_mut());
        EnableWindow(controls[INSTALL_INDEX],0);
        let mut family=null_mut();let mut text_font=null_mut();
        GdipCreateFontFamilyFromName(wide("Segoe UI").as_ptr(),null_mut(),&mut family);
        GdipCreateFont(family,TEXT_SIZE,0,2,&mut text_font);GdipDeleteFontFamily(family);
        let mut text_formats=[null_mut();2];
        for (i,format) in text_formats.iter_mut().enumerate(){GdipStringFormatGetGenericTypographic(format);GdipSetStringFormatFlags(*format,0x5004);GdipSetStringFormatAlign(*format,i as i32);}
        let mut result = Self { controls,consent:false,agreement:PathBuf::from(agreement),font:null_mut(),background:CreateSolidBrush(0x00fcf6ef),paper:CreateSolidBrush(0x00ffffff),text_font,text_formats };
        result.layout(parent);
        result
    }

    /// consent, autostart, keep installer, desktop shortcut.
    /// Autostart lives in the app settings now, and the other two are always on.
    pub unsafe fn values(&self) -> [bool; 4] { [self.consent,false,true,true] }
    pub unsafe fn can_install(&self) -> bool { self.consent }

    /// The licence box and its label share one hit area; both flip the same state.
    pub fn hit_consent(x:f32,y:f32)->bool { inside(CONSENT_BOX,x,y)||inside(CONSENT_LABEL,x,y) }
    pub fn hit_link(x:f32,y:f32)->bool { inside(AGREEMENT_LINK,x,y) }

    pub unsafe fn toggle(&mut self) {
        self.consent=!self.consent;
        EnableWindow(self.controls[INSTALL_INDEX],i32::from(self.consent));
    }

    /// The agreement is a document, not a form field: show it as a page in the default browser.
    pub unsafe fn open_agreement(&self) {
        let Ok(source)=std::fs::read_to_string(&self.agreement) else{return;};
        let mut body=String::with_capacity(source.len()+512);
        for character in source.trim_start_matches('\u{feff}').chars() {
            match character {'&'=>body.push_str("&amp;"),'<'=>body.push_str("&lt;"),'>'=>body.push_str("&gt;"),_=>body.push(character)}
        }
        let page=format!("<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n<title>LanDict 软件使用协议</title>\n<style>\nbody{{font-family:\"Microsoft YaHei\",\"Segoe UI\",sans-serif;max-width:760px;margin:48px auto;padding:0 28px;line-height:1.9;color:#1f2937;background:#fbfdff;}}\npre{{font-family:inherit;font-size:15px;white-space:pre-wrap;margin:0;}}\n</style>\n</head>\n<body>\n<pre>{body}</pre>\n</body>\n</html>\n");
        let file=std::env::temp_dir().join("LanDict-Software-Agreement.html");
        if std::fs::write(&file,page.as_bytes()).is_err(){return;}
        let operation=wide("open");let target=wide(&file.to_string_lossy());let empty=wide("");
        ShellExecuteW(null_mut(),operation.as_ptr(),target.as_ptr(),empty.as_ptr(),null_mut(),1);
    }
    pub unsafe fn path_text(&self)->String {
        let field=self.controls[PATH_INDEX];
        if field.is_null(){return String::new();}
        let length=SendMessageW(field,0x000e,0,0) as usize;
        let mut buffer=vec![0u16;length+1];
        SendMessageW(field,0x000d,length+1,buffer.as_mut_ptr() as isize);
        String::from_utf16_lossy(&buffer[..length])
    }

    pub unsafe fn layout(&mut self,parent:Handle) {
        let mut rect = Rect::default(); GetClientRect(parent,&mut rect);
        let sx = rect.right as f32/730.0; let sy = rect.bottom as f32/583.0;
        // Row 1 chooses the folder, the primary button sits right.
        let positions = [
            (INSTALL_BUTTON[0],INSTALL_BUTTON[1],INSTALL_BUTTON[2],INSTALL_BUTTON[3]),
            (BROWSE_BUTTON[0],BROWSE_BUTTON[1],BROWSE_BUTTON[2],BROWSE_BUTTON[3]),
            (PATH_FIELD[0]+6.0,PATH_FIELD[1]+4.0,PATH_FIELD[2]-12.0,PATH_FIELD[3]-8.0),
        ];
        DeleteObject(self.font);
        self.font = CreateFontW(-(14.0*sy).round() as i32,0,0,0,400,0,0,0,1,0,0,5,0,wide("Segoe UI").as_ptr());
        for (control,(x,y,w,h)) in self.controls.iter().zip(positions) {
            SetWindowPos(*control,null_mut(),(x*sx).round() as i32,(y*sy).round() as i32,(w*sx).round() as i32,(h*sy).round() as i32,0x0004);
            SendMessageW(*control,0x0030,self.font as usize,1);
        }
    }

    pub unsafe fn command(&mut self,id:usize,parent:Handle) {
        match id {
            BROWSE => { self.pick_folder(); }
            INSTALL if self.consent => { PostMessageW(parent,0x111,1,0); }
            _ => {}
        }
    }

    unsafe fn pick_folder(&self) {
        let mut buffer=vec![0u16;1024];
        let title=wide("选择安装位置");
        let mut info=BrowseInfo{owner:null_mut(),pidl_root:null_mut(),display:null_mut(),title:title.as_ptr(),
            flags:0x0001|0x0040,proc:None,param:0,image:0};
        let item=SHBrowseForFolderW(&mut info);
        if item.is_null(){return;}
        let ok=SHGetPathFromIDListW(item,buffer.as_mut_ptr())!=0;
        CoTaskMemFree(item);
        let field=self.controls[PATH_INDEX];
        if ok && !field.is_null() {
            let length=buffer.iter().position(|c|*c==0).unwrap_or(0);
            let value=String::from_utf16_lossy(&buffer[..length]);
            if !value.is_empty(){SetWindowTextW(field,wide(&value).as_ptr());}
        }
    }
    pub unsafe fn color(&self,dc:Handle,control:Handle)->Handle {
        SetTextColor(dc,0x004b3323);SetBkMode(dc,1);
        if control==self.controls[PATH_INDEX] { self.paper } else { self.background }
    }
    /// The licence row: the box, the label and the link, on one baseline.
    pub unsafe fn draw_licence(&self,g:Handle,link_hover:bool) {
        GdipSetPixelOffsetMode(g,3);GdipSetTextRenderingHint(g,3);
        let (box_x,box_y)=(CONSENT_BOX[0],CONSENT_BOX[1]+2.0);
        let mut path=null_mut();GdipCreatePath(0,&mut path);
        for (x,y,start) in [(box_x,box_y,180.),(box_x+8.0,box_y,270.),(box_x+8.0,box_y+8.0,0.),(box_x,box_y+8.0,90.)] {GdipAddPathArc(path,x,y,6.,6.,start,90.);}
        GdipClosePathFigure(path);
        let mut brush=null_mut();GdipCreateSolidFill(if self.consent {0xff429dd5}else{0xfff8fcff},&mut brush);GdipFillPath(g,brush,path);GdipDeleteBrush(brush);
        let mut pen=null_mut();GdipCreatePen1(if self.consent {0xff429dd5}else{0xff98b4c8},1.0,2,&mut pen);GdipDrawPath(g,pen,path);GdipDeletePen(pen);GdipDeletePath(path);
        if self.consent {
            GdipCreatePen1(0xffffffff,1.7,2,&mut pen);
            GdipDrawLine(g,pen,box_x+3.5,box_y+7.0,box_x+6.0,box_y+9.5);GdipDrawLine(g,pen,box_x+6.0,box_y+9.5,box_x+10.5,box_y+4.0);
            GdipDeletePen(pen);
        }
        let mut brush=null_mut();GdipCreateSolidFill(0xff23334b,&mut brush);
        let label=wide(CONSENT_TEXT);let rect=RectF{x:CONSENT_LABEL[0],y:CONSENT_LABEL[1]+1.0,width:CONSENT_LABEL[2],height:CONSENT_LABEL[3]};
        GdipDrawString(g,label.as_ptr(),(label.len()-1) as i32,self.text_font,&rect,self.text_formats[0],brush);GdipDeleteBrush(brush);
        GdipCreateSolidFill(if link_hover {0xff1a6fa0}else{0xff2c83b9},&mut brush);
        let link=wide(AGREEMENT_TEXT);let rect=RectF{x:AGREEMENT_LINK[0],y:AGREEMENT_LINK[1]+1.0,width:AGREEMENT_LINK[2],height:AGREEMENT_LINK[3]};
        GdipDrawString(g,link.as_ptr(),(link.len()-1) as i32,self.text_font,&rect,self.text_formats[0],brush);GdipDeleteBrush(brush);
    }
    pub unsafe fn draw(&self,item:&DrawItem,_state:&State) {
        let mut g = null_mut();GdipCreateFromHDC(item.dc,&mut g);
        let width=(item.rect.right-item.rect.left) as f32;let height=(item.rect.bottom-item.rect.top) as f32;
        let browse=item.id==BROWSE as u32;
        let (logical_width,logical_height)=if browse {(BROWSE_BUTTON[2],BROWSE_BUTTON[3])}else{(INSTALL_BUTTON[2],INSTALL_BUTTON[3])};
        GdipScaleWorldTransform(g,width/logical_width,height/logical_height,0);
        GdipSetSmoothingMode(g,4);GdipSetPixelOffsetMode(g,3);GdipSetTextRenderingHint(g,3);
        fill(g,0xffeff6fc,0.0,0.0,logical_width,logical_height,false);
        let active=item.state&4==0;
        let pressed=item.state&1!=0;
        // One soft shadow keeps both buttons sitting above the page instead of carved into it.
        capsule(g,0x1f3d7ba4,0.5,2.5,logical_width-1.0,logical_height);
        let (label,color)=if browse {
            let (from,to)=if pressed {(0xffdceaf5,0xffe9f4fb)}else{(0xffffffff,0xffe7f3fb)};
            let mut brush=null_mut();
            GdipCreateLineBrush(&Point{x:0,y:0},&Point{x:0,y:logical_height as i32},from,to,0,&mut brush);
            capsule_brush(g,brush,0.0,0.0,logical_width,logical_height);GdipDeleteBrush(brush);
            let mut pen=null_mut();GdipCreatePen1(0xffbddaea,1.0,2,&mut pen);
            round_rect_pen(g,pen,0.5,0.5,logical_width-1.0,logical_height-1.0,logical_height/2.0);GdipDeletePen(pen);
            ("浏览",if pressed {0xff1f6f9e}else{0xff2b7fb8})
        } else {
            let (from,to)=if !active {(0xffd7e8f2,0xffc6dcea)} else if pressed {(0xff2c87c4,0xff49a6dc)} else {(0xff58afe0,0xff3692ce)};
            let mut brush=null_mut();
            GdipCreateLineBrush(&Point{x:0,y:0},&Point{x:0,y:logical_height as i32},from,to,0,&mut brush);
            capsule_brush(g,brush,0.0,0.0,logical_width,logical_height);GdipDeleteBrush(brush);
            ("开始安装",if active {0xffffffff}else{0xff7895a7})
        };
        let mut brush=null_mut();GdipCreateSolidFill(color,&mut brush);
        let value=wide(label);let rect=RectF{x:0.0,y:((logical_height-TEXT_SIZE)/2.0).max(0.0),width:logical_width,height:TEXT_SIZE};
        GdipDrawString(g,value.as_ptr(),(value.len()-1) as i32,self.text_font,&rect,self.text_formats[1],brush);
        GdipDeleteBrush(brush);GdipDeleteGraphics(g);
    }
}
