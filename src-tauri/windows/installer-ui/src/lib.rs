mod model;
mod win32;
mod options;
use std::{fs::OpenOptions, io::Write, path::PathBuf, ptr::{null, null_mut}};
use win32::*;

const WIDTH:f32=730.0;
const HEIGHT:f32=583.0;
const SHEEP_FIRST:usize=10;
const PROGRESS_TEXTURE:usize=SHEEP_FIRST+model::FRAME_COUNT+1;
const CLASS:&str="LanDictInstallerArtwork";
// Title-bar hit areas: only minimize and close are offered, plus the success button.
const TITLE_MIN:[f32;2]=[640.0,685.0];
const TITLE_CLOSE_X:f32=685.0;
const DONE_BUTTON:[f32;4]=[544.0,530.0,126.0,34.0];
const HOVER_NONE:i32=0;const HOVER_MINIMIZE:i32=1;const HOVER_CLOSE:i32=2;const HOVER_DONE:i32=3;
const HOVER_LINK:i32=4;
static mut CHILD:Handle=null_mut();
static mut GDI_TOKEN:usize=0;

struct State {
    parent:Handle, inner:Handle, flags:*mut i32, progress:Handle, images:Vec<Handle>, started:u64, success:bool,
    failed:bool, finished:Option<u64>,
    log:PathBuf, last_sample:u64, last_percent:u32, paper_alpha:Handle,
    fonts:[Handle;3], formats:[Handle;2], text_brush:Handle, paints:u64, record_dir:Option<PathBuf>,
    cached_images:Vec<Handle>, cached_width:i32,
    options:Option<options::OptionsUi>,
    hover:i32, last_hover:i32, tracking:bool,
}

impl Drop for State {
    fn drop(&mut self) {unsafe {
        for image in &self.images {GdipDisposeImage(*image);}
        for image in &self.cached_images {GdipDisposeImage(*image);}
        GdipDisposeImageAttributes(self.paper_alpha);
        for font in self.fonts {GdipDeleteFont(font);}
        for format in self.formats {GdipDeleteStringFormat(format);}
        GdipDeleteBrush(self.text_brush);
    }}
}

unsafe fn log(state:&State,event:&str) {
    if let Ok(mut file)=OpenOptions::new().create(true).append(true).open(&state.log) {
        let _=writeln!(file,"{} {}",GetTickCount64()-state.started,event);
    }
}

unsafe fn image(g:Handle,state:&State,index:usize,x:f32,y:f32,w:f32,h:f32) {
    GdipDrawImageRect(g,*state.cached_images.get(index).unwrap_or(&state.images[index]),x,y,w,h);
}

unsafe fn cache_images(state:&mut State,width:i32) {
    if state.cached_width==width {return;}
    for image in state.cached_images.drain(..) {GdipDisposeImage(image);}
    let fixed=[(730.0,583.0),(24.0,24.0),(103.0,89.0),(180.0,55.5),(36.0,35.0),(730.0,198.0),(112.0,74.0),(390.0,390.0),(390.0,390.0),(390.0,390.0)];
    let mut sizes=fixed.to_vec();sizes.extend((0..model::FRAME_COUNT).map(|_|(132.0,132.0*475.0/530.0)));sizes.push((132.0,97.0));sizes.push((546.0,14.0));
    let scale=width as f32/WIDTH;
    for (source,(w,h)) in state.images.iter().zip(sizes) {
        let w=(w*scale).round().max(1.0) as i32;let h=(h*scale).round().max(1.0) as i32;
        let mut bitmap=null_mut();let mut graphics=null_mut();
        if GdipCreateBitmapFromScan0(w,h,0,0x26200a,null(),&mut bitmap)!=0 {break;}
        if GdipGetImageGraphicsContext(bitmap,&mut graphics)!=0 {GdipDisposeImage(bitmap);break;}
        GdipSetInterpolationMode(graphics,7);GdipSetPixelOffsetMode(graphics,4);
        GdipDrawImageRect(graphics,*source,0.0,0.0,w as f32,h as f32);GdipDeleteGraphics(graphics);
        state.cached_images.push(bitmap);
    }
    if state.cached_images.len()!=state.images.len() {
        for image in state.cached_images.drain(..) {GdipDisposeImage(image);}
        log(state,"image-cache-unavailable using original artwork");
    }
    state.cached_width=width;
}

unsafe fn fill(g:Handle,color:u32,x:f32,y:f32,w:f32,h:f32,ellipse:bool) {
    let mut brush=null_mut();GdipCreateSolidFill(color,&mut brush);
    if ellipse {GdipFillEllipse(g,brush,x,y,w,h);} else {GdipFillRectangle(g,brush,x,y,w,h);}
    GdipDeleteBrush(brush);
}

unsafe fn capsule(g:Handle,color:u32,x:f32,y:f32,w:f32,h:f32) {
    if w<=0.0{return;}
    let d=h.min(w);fill(g,color,x,y,d,h,true);fill(g,color,x+w-d,y,d,h,true);
    if w>d {fill(g,color,x+d/2.0,y,w-d,h,false);}
}

/// Rounded rectangle used by the preparation page chrome (location field).
unsafe fn round_rect(g:Handle,color:u32,x:f32,y:f32,w:f32,h:f32,r:f32) {
    if w<=0.0||h<=0.0{return;}
    let radius=r.min(w/2.0).min(h/2.0);
    let mut path=null_mut();GdipCreatePath(0,&mut path);
    GdipAddPathArc(path,x,y,radius*2.0,radius*2.0,180.0,90.0);
    GdipAddPathArc(path,x+w-radius*2.0,y,radius*2.0,radius*2.0,270.0,90.0);
    GdipAddPathArc(path,x+w-radius*2.0,y+h-radius*2.0,radius*2.0,radius*2.0,0.0,90.0);
    GdipAddPathArc(path,x,y+h-radius*2.0,radius*2.0,radius*2.0,90.0,90.0);
    GdipClosePathFigure(path);
    let mut brush=null_mut();GdipCreateSolidFill(color,&mut brush);
    GdipFillPath(g,brush,path);GdipDeleteBrush(brush);GdipDeletePath(path);
}

unsafe fn round_rect_pen(g:Handle,pen:Handle,x:f32,y:f32,w:f32,h:f32,r:f32) {
    if w<=0.0||h<=0.0{return;}
    let radius=r.min(w/2.0).min(h/2.0);
    let mut path=null_mut();GdipCreatePath(0,&mut path);
    GdipAddPathArc(path,x,y,radius*2.0,radius*2.0,180.0,90.0);
    GdipAddPathArc(path,x+w-radius*2.0,y,radius*2.0,radius*2.0,270.0,90.0);
    GdipAddPathArc(path,x+w-radius*2.0,y+h-radius*2.0,radius*2.0,radius*2.0,0.0,90.0);
    GdipAddPathArc(path,x,y+h-radius*2.0,radius*2.0,radius*2.0,90.0,90.0);
    GdipClosePathFigure(path);GdipDrawPath(g,pen,path);GdipDeletePath(path);
}

unsafe fn capsule_brush(g:Handle,brush:Handle,x:f32,y:f32,w:f32,h:f32) {
    if w<=0.0{return;}
    let d=h.min(w);
    GdipFillEllipse(g,brush,x,y,d,h);GdipFillEllipse(g,brush,x+w-d,y,d,h);
    if w>d {GdipFillRectangle(g,brush,x+d/2.0,y,w-d,h);}
}

/// The primary action button, matching the Win32 control drawn on the preparation page.
unsafe fn accent_button(g:Handle,state:&State,label:&str,hover:bool,pressed:bool) {
    let [x,y,w,h]=DONE_BUTTON;
    if hover||pressed {fill(g,0x24398abb,x+1.0,y+3.0,w,h,true);}
    let (from,to)=if pressed {(0xff2c87c4,0xff49a6dc)} else if hover {(0xff4aa6dc,0xff2d88c5)} else {(0xff58afe0,0xff3692ce)};
    let mut brush=null_mut();
    GdipCreateLineBrush(&Point{x:x as i32,y:y as i32},&Point{x:(x+w) as i32,y:y as i32},from,to,0,&mut brush);
    capsule_brush(g,brush,x,y,w,h);GdipDeleteBrush(brush);
    let mut white=null_mut();GdipCreateSolidFill(0xffffffff,&mut white);
    let value=wide(label);let rect=RectF{x,y:y+7.0,width:w,height:20.0};
    GdipDrawString(g,value.as_ptr(),(value.len()-1) as i32,state.fonts[0],&rect,state.formats[1],white);
    GdipDeleteBrush(white);
}

unsafe fn text(g:Handle,state:&State,value:&str,x:f32,y:f32,w:f32,h:f32,size:f32,align:i32) {
    let font=state.fonts[if size==15.0 {0}else if size==23.0 {1}else{2}];
    let format=state.formats[usize::from(align==1)];
    let string=wide(value);let rect=RectF{x,y,width:w,height:h};
    GdipDrawString(g,string.as_ptr(),(string.len()-1) as i32,font,&rect,format,state.text_brush);
}

unsafe fn line(g:Handle,color:u32,x1:f32,y1:f32,x2:f32,y2:f32,width:f32) {
    let mut pen=null_mut();GdipCreatePen1(color,width,2,&mut pen);
    GdipDrawLine(g,pen,x1,y1,x2,y2);GdipDeletePen(pen);
}

unsafe fn sparkle(g:Handle,x:f32,y:f32,r:f32) {
    // Independent decoration layer; its size and color follow the reference.
    fill(g,0xff77b4dd,x-r*0.2,y-r,r*0.4,r*2.0,true);
    fill(g,0xff77b4dd,x-r,y-r*0.2,r*2.0,r*0.4,true);
}

unsafe fn render(hwnd:Handle,state:&mut State,hdc:Handle) {
    let mut rect=Rect::default();GetClientRect(hwnd,&mut rect);
    if rect.right<=0 || rect.bottom<=0{return;}
    cache_images(state,rect.right);
    let dc=CreateCompatibleDC(hdc);let bitmap=CreateCompatibleBitmap(hdc,rect.right,rect.bottom);
    let old=SelectObject(dc,bitmap);let mut g=null_mut();GdipCreateFromHDC(dc,&mut g);
    // The half-pixel offset that helps scaled artwork makes every glyph soft. This window draws
    // all of its own text, so it renders on the pixel grid with hinted antialiasing instead.
    GdipSetSmoothingMode(g,4);GdipSetInterpolationMode(g,7);GdipSetPixelOffsetMode(g,3);GdipSetTextRenderingHint(g,3);
    GdipScaleWorldTransform(g,rect.right as f32/WIDTH,rect.bottom as f32/HEIGHT,0);
    let mut background=null_mut();
    fill(g,0xfff1f4f8,0.0,0.0,WIDTH,HEIGHT,false);
    GdipCreateLineBrush(&Point{x:0,y:0},&Point{x:0,y:583},0xfff4f3f6,0xffbedff0,3,&mut background);
    GdipFillRectangle(g,background,0.0,0.0,WIDTH,HEIGHT);GdipDeleteBrush(background);
    let paper=*state.cached_images.first().unwrap_or(&state.images[0]);let mut pw=0;let mut ph=0;
    GdipGetImageWidth(paper,&mut pw);GdipGetImageHeight(paper,&mut ph);
    GdipDrawImageRectRectI(g,paper,0,0,730,583,0,0,pw as i32,ph as i32,2,state.paper_alpha,null_mut(),null_mut());

    // Custom title bar with real behaviour: minimize and close only, with hover feedback.
    image(g,state,1,13.0,10.0,24.0,24.0);
    text(g,state,"LanDict Setup",42.0,12.0,240.0,26.0,15.0,0);
    if state.hover==HOVER_MINIMIZE {fill(g,0x33ffffff,TITLE_MIN[0],0.0,TITLE_MIN[1]-TITLE_MIN[0],39.0,false);}
    if state.hover==HOVER_CLOSE {fill(g,0xffe0574f,TITLE_CLOSE_X,0.0,45.0,39.0,false);}
    line(g,if state.hover==HOVER_MINIMIZE {0xff2f3a4c}else{0xff4f536a},656.5,19.5,668.5,19.5,1.3);
    let close_color=if state.hover==HOVER_CLOSE {0xffffffff}else{0xff4f536a};
    line(g,close_color,701.5,13.5,713.5,25.5,1.3);line(g,close_color,713.5,13.5,701.5,25.5,1.3);

    image(g,state,2,228.0,70.0,103.0,89.0);
    image(g,state,3,343.0,96.0,180.0,55.5);
    if state.success {
        image(g,state,4,200.0,167.0,36.0,35.0);
        text(g,state,"LanDict is ready for you.",239.0,171.0,385.0,36.0,23.0,0);
    } else if state.failed {
        text(g,state,"Installation did not finish.",30.0,177.0,670.0,38.0,23.0,1);
    } else {
        text(g,state,"LanDict is getting ready for you.",30.0,177.0,670.0,38.0,23.0,1);
    }

    // Keep the scene alive after success: the sheep keeps running and the globe keeps turning.
    let elapsed=GetTickCount64()-state.started;
    let mut saved=0;GdipSaveGraphics(g,&mut saved);
    GdipSetClipRect(g,0.0,225.0,730.0,300.0,0);
    let radius=model::EARTH_RADIUS;
    // The outline and center are stationary. Only the interior art rotates.
    let mut core=null_mut();GdipCreatePath(0,&mut core);
    // Clip to 95% of the radius: the rotating art reaches r=420 in the 840px source while the
    // crayon ring is a soft band from r=384 to r=420, so its edge would sweep outside the ring.
    let clip_radius=model::EARTH_RADIUS*0.95;
    GdipAddPathEllipse(core,365.0-clip_radius,522.0-clip_radius,clip_radius*2.0,clip_radius*2.0);
    GdipSetClipPath(g,core,1);GdipDeletePath(core);
    GdipTranslateWorldTransform(g,365.0,522.0,0);
    GdipRotateWorldTransform(g,model::earth_angle(elapsed,model::EARTH_RADIUS),0);
    image(g,state,8,-radius,-radius,radius*2.0,radius*2.0);
    GdipRestoreGraphics(g,saved);
    GdipSaveGraphics(g,&mut saved);
    GdipSetClipRect(g,0.0,225.0,730.0,300.0,0);
    image(g,state,9,365.0-radius,522.0-radius,radius*2.0,radius*2.0);
    GdipRestoreGraphics(g,saved);

    image(g,state,6,465.0,282.0,112.0,74.0);
    sparkle(g,169.0,284.0,15.0);sparkle(g,595.0,350.0,17.0);
    fill(g,0xff76b3db,102.0,332.0,9.0,9.0,true);
    fill(g,0xff76b3db,625.0,323.0,7.0,9.0,true);
    fill(g,0xffb5d9ee,550.0,366.0,7.0,7.0,true);
    fill(g,0xffedf6fc,128.0,366.0,6.0,6.0,true);

    // The whole pose sits 15 DIP below the silhouette top so the paws rest on the crayon rim.
    let ground=522.0-model::EARTH_RADIUS+21.0*model::EARTH_RADIUS*2.0/840.0+15.0;
    // One small contact shadow instead of a wide smudge.
    for (w,h,alpha) in [(84.0,13.0,0x10u32),(66.0,10.0,0x14),(48.0,8.0,0x18)] {
        fill(g,(alpha<<24)|0x55637a,365.0-w/2.0,ground+1.0-h/2.0,w,h,true);
    }
    // Always the running pose: the fallen-asleep frame is gone for good.
    let width=132.0;
    let height=width*475.0/530.0;
    image(g,state,SHEEP_FIRST+model::frame_index(elapsed),365.0-width/2.0,ground-448.0*width/530.0,width,height);
    image(g,state,5,0.0,324.0,730.0,198.0);
    // Fade the painted cloud base into one pale surface before the progress bar starts, so the
    // globe silhouette never crosses the seam and no hard cloud edge shows through.
    let mut mist=null_mut();
    GdipCreateLineBrush(&Point{x:0,y:440},&Point{x:0,y:583},0x00eff6fc,0xffeff6fc,3,&mut mist);
    GdipSetLinePresetBlend(mist,[0x00eff6fc,0xffeff6fc,0xffeff6fc].as_ptr(),[0.0,0.42,1.0].as_ptr(),3);
    // One continuous rectangle: adjacent antialiased rectangles leak at fractional DPI.
    GdipFillRectangle(g,mist,0.0,440.0,730.0,143.0);GdipDeleteBrush(mist);

    let position=SendMessageW(state.progress,0x408,0,0) as i32; // PBM_GETPOS
    let maximum=SendMessageW(state.progress,0x407,0,0) as i32; // PBM_GETRANGE(high)
    let percent=model::progress_percent(position,maximum,state.success);
    if state.options.is_some() {
        // Preparation page: the location row chrome; the controls draw themselves on top.
        text(g,state,"选择安装地址",62.0,518.0,104.0,22.0,15.0,0);
        round_rect(g,0xffffffff,168.0,514.0,278.0,30.0,8.0);
        let mut pen=null_mut();GdipCreatePen1(0xffa9c6da,1.0,2,&mut pen);
        round_rect_pen(g,pen,168.5,514.5,277.0,29.0,8.0);GdipDeletePen(pen);
        // The licence row belongs to this window too, so the box, its label and the link
        // keep one baseline and no control frame can clip them.
        state.options.as_ref().unwrap().draw_licence(g,state.hover==HOVER_LINK);
    } else {
    // The bar sits fully inside the pale bottom panel, clear of the fade line.
    capsule(g,0x10658fab,60.0,508.0,550.0,17.0);
    capsule(g,0xffb9d6e4,61.0,506.0,548.0,16.0);
    capsule(g,0xffdeedf4,62.0,507.0,546.0,14.0);
    let fill_width=546.0*percent as f32/100.0;
    if fill_width>0.0 {
        let d=14.0_f32.min(fill_width);let mut path=null_mut();
        GdipCreatePath(0,&mut path);
        GdipAddPathArc(path,62.0,507.0,d,14.0,90.0,180.0);
        GdipAddPathArc(path,62.0+fill_width-d,507.0,d,14.0,270.0,180.0);
        GdipClosePathFigure(path);GdipSaveGraphics(g,&mut saved);
        GdipSetClipPath(g,path,1);GdipDeletePath(path);
        image(g,state,PROGRESS_TEXTURE,62.0,507.0,546.0,14.0);
        GdipRestoreGraphics(g,saved);
    }
    text(g,state,&format!("{percent}%"),623.0,500.0,68.0,31.0,22.0,0);
    if state.success {
        accent_button(g,state,"完成安装",state.hover==HOVER_DONE,false);
    }
    }

    GdipDeleteGraphics(g);BitBlt(hdc,0,0,rect.right,rect.bottom,dc,0,0,0x00cc0020);
    SelectObject(dc,old);
    // Optional preview recording: save the buffer actually presented to this HWND.
    // It is off in normal runs and never advances the installation engine.
    if let Some(directory)=&state.record_dir {
        let capture_elapsed=GetTickCount64()-state.started;
        if capture_elapsed<3000 {
            let mut pixels=vec![0u8;(rect.right*rect.bottom*4) as usize];
            let mut info=BitmapInfo{header:BitmapInfoHeader{size:40,width:rect.right,height:-rect.bottom,planes:1,bits:32,compression:0,image_size:pixels.len() as u32,xppm:0,yppm:0,colors:0,important:0},colors:[0]};
            if GetDIBits(dc,bitmap,0,rect.bottom as u32,pixels.as_mut_ptr(),&mut info,0)==rect.bottom {
                // Uncompressed top-down BMP avoids PNG encoding on the UI thread.
                let mut header=b"BM".to_vec();
                header.extend_from_slice(&((54+pixels.len()) as u32).to_le_bytes());
                header.extend_from_slice(&[0;4]);header.extend_from_slice(&54u32.to_le_bytes());
                header.extend_from_slice(&40u32.to_le_bytes());header.extend_from_slice(&rect.right.to_le_bytes());header.extend_from_slice(&(-rect.bottom).to_le_bytes());
                header.extend_from_slice(&1u16.to_le_bytes());header.extend_from_slice(&32u16.to_le_bytes());
                header.extend_from_slice(&0u32.to_le_bytes());header.extend_from_slice(&(pixels.len() as u32).to_le_bytes());header.extend_from_slice(&[0;16]);
                let file=directory.join(format!("{capture_elapsed:06}.bmp"));
                let result=std::fs::File::create(file).and_then(|mut f|{f.write_all(&header)?;f.write_all(&pixels)});
                if let Err(error)=result {log(state,&format!("recording-error {error}"));}
            } else {
                log(state,"recording-error GetDIBits failed");
            }
        }
    }
    DeleteObject(bitmap);DeleteDC(dc);
}

unsafe extern "system" fn window_proc(hwnd:Handle,msg:u32,w:usize,l:isize)->isize {
    let pointer=GetWindowLongW(hwnd,-21) as *mut State;
    if pointer.is_null(){return DefWindowProcW(hwnd,msg,w,l);}
    let state=&mut *pointer;
    match msg {
        0x111=>{if let Some(options)=state.options.as_mut(){options.command(w&0xffff,state.parent);return 0;}DefWindowProcW(hwnd,msg,w,l)}
        0x135|0x138=>{if let Some(options)=state.options.as_ref(){return options.color(w as Handle,l as Handle) as isize;}DefWindowProcW(hwnd,msg,w,l)}
        0x2b=>{if let Some(options)=state.options.as_ref(){options.draw(&*(l as *const DrawItem),state);return 1;}0}
        0x14=>1, // background is painted into the back buffer
        0x0f=>{let mut paint:Paint=std::mem::zeroed();let hdc=BeginPaint(hwnd,&mut paint);render(hwnd,state,hdc);EndPaint(hwnd,&paint);state.paints+=1;0}
        0x113=>{
            let elapsed=GetTickCount64()-state.started;
            if elapsed-state.last_sample>=100 {
                let pos=SendMessageW(state.progress,0x408,0,0) as i32;
                let max=SendMessageW(state.progress,0x407,0,0) as i32;
                let percent=model::progress_percent(pos,max,state.success);
                log(state,&format!("sample position={pos} maximum={max} percent={percent} frame={} angle={:.3} paints={} success={}",model::frame_index(elapsed),model::earth_angle(elapsed,model::EARTH_RADIUS),state.paints,state.success));
                state.last_percent=percent;state.last_sample=elapsed;
            }
            InvalidateRect(hwnd,null(),0);0
        }
        0x201=>{
            SetFocus(hwnd);
            let mut rect=Rect::default();GetClientRect(hwnd,&mut rect);
            let x=(l as u32&0xffff) as f32*WIDTH/rect.right.max(1) as f32;
            let y=((l as u32>>16)&0xffff) as f32*HEIGHT/rect.bottom.max(1) as f32;
            if y<39.0 {
                if x>=TITLE_CLOSE_X {PostMessageW(state.parent,0x111,if state.success {1}else{2},0);}
                else if (TITLE_MIN[0]..TITLE_MIN[1]).contains(&x) {ShowWindow(state.parent,6);}
                else if x<TITLE_MIN[0] {ReleaseCapture();SendMessageW(state.parent,0xa1,2,0);}
            } else if state.success && state.options.is_none()
                && (DONE_BUTTON[0]..DONE_BUTTON[0]+DONE_BUTTON[2]).contains(&x)
                && (DONE_BUTTON[1]..DONE_BUTTON[1]+DONE_BUTTON[3]).contains(&y) {
                // The success button closes the installer with a successful exit code.
                PostMessageW(state.parent,0x111,1,0);
            } else if let Some(options)=state.options.as_mut() {
                // The licence row is drawn inside this window, so it is hit-tested here:
                // the box (or its label) toggles consent, the link opens the agreement page.
                if options::OptionsUi::hit_link(x,y) {
                    options.open_agreement();
                } else if options::OptionsUi::hit_consent(x,y) {
                    options.toggle();InvalidateRect(hwnd,null(),0);
                }
            }0
        }
        0x200=>{ // WM_MOUSEMOVE: hover feedback for the drawn title bar and success button
            let mut rect=Rect::default();GetClientRect(hwnd,&mut rect);
            let x=(l as u32&0xffff) as f32*WIDTH/rect.right.max(1) as f32;
            let y=((l as u32>>16)&0xffff) as f32*HEIGHT/rect.bottom.max(1) as f32;
            // The title bar hovers on every page; the success button only exists after install.
            let hover=if y<39.0 {
                    if x>=TITLE_CLOSE_X {HOVER_CLOSE} else if (TITLE_MIN[0]..TITLE_MIN[1]).contains(&x) {HOVER_MINIMIZE} else {HOVER_NONE}
                } else if state.options.is_some() && options::OptionsUi::hit_link(x,y) {HOVER_LINK}
                else if state.options.is_none() && state.success
                    && (DONE_BUTTON[0]..DONE_BUTTON[0]+DONE_BUTTON[2]).contains(&x)
                    && (DONE_BUTTON[1]..DONE_BUTTON[1]+DONE_BUTTON[3]).contains(&y) {HOVER_DONE} else {HOVER_NONE};
            if hover!=state.hover {state.hover=hover;InvalidateRect(hwnd,null(),0);}
            if hover!=state.last_hover {state.last_hover=hover;log(state,&format!("hover={hover}"));}
            if !state.tracking {
                let mut track=TrackMouse{size:std::mem::size_of::<TrackMouse>() as u32,flags:0x00000002,hwnd,..Default::default()};
                if TrackMouseEvent(&mut track)!=0 {state.tracking=true;}
            }
            0
        }
        0x2a3=>{ // WM_MOUSELEAVE
            state.tracking=false;
            if state.last_hover!=HOVER_NONE {state.last_hover=HOVER_NONE;log(state,"hover=0 leave");}
            if state.hover!=HOVER_NONE {state.hover=HOVER_NONE;InvalidateRect(hwnd,null(),0);}
            0
        }
        0x20=>{ // WM_SETCURSOR: show the hand over interactive areas
            if state.hover==HOVER_DONE || state.hover==HOVER_LINK {
                SetCursor(LoadCursorW(null_mut(),32649usize as *const u16));return 1;
            }
            DefWindowProcW(hwnd,msg,w,l)
        }
        0x87=>4,
        0x100=>{if let Some(options)=state.options.as_mut(){if w==32 {options.toggle();InvalidateRect(hwnd,null(),0);}else if w==13 && options.can_install(){PostMessageW(state.parent,0x111,1,0);}else if w==27 {PostMessageW(state.parent,0x10,0,0);}}else if w==13 {PostMessageW(state.parent,0x111,if state.failed {2}else{1},0);}else if w==27 {PostMessageW(state.parent,0x10,0,0);}0}
        0x2=>{
            KillTimer(hwnd,1);
            RemoveWindowSubclass(state.inner,Some(install_observer),1);
            RemoveWindowSubclass(state.parent,Some(parent_observer),2);
            SetWindowLongW(hwnd,-21,0);log(state,"destroy");
            drop(Box::from_raw(pointer));CHILD=null_mut();0
        }
        0x8001=>{
            state.finished=Some(GetTickCount64()-state.started);
            state.success=w==1;state.failed=w!=1;
            log(state,if state.success {"installation-success percent=100"}else{"installation-failed"});
            InvalidateRect(hwnd,null(),0);0
        }
        _=>DefWindowProcW(hwnd,msg,w,l),
    }
}

unsafe extern "system" fn install_observer(hwnd:Handle,msg:u32,w:usize,l:isize,_id:usize,child:usize)->isize {
    if msg==0x404 { // NSIS WM_NOTIFY_INSTPROC_DONE, observed on the UI thread
        let child=child as Handle;let pointer=GetWindowLongW(child,-21) as *mut State;
        if !pointer.is_null() {
            let state=&*pointer;
            let error=*state.flags.add(2);let abort=*state.flags.add(3);
            log(state,&format!("engine-completed exec_error={error} abort={abort}"));
            PostMessageW(child,0x8001,usize::from(error==0 && abort==0),0);
        }
    }
    DefSubclassProc(hwnd,msg,w,l)
}

unsafe fn resize(parent:Handle,dpi:u32,initial:bool) {
    let scale=dpi.max(96) as f32/96.0;
    let mut rect=Rect::default();GetWindowRect(parent,&mut rect);
    let width=(WIDTH*scale).round() as i32;let height=(HEIGHT*scale).round() as i32;
    if initial {
        let mut monitor=MonitorInfo{size:40,monitor:Rect::default(),work:Rect::default(),flags:0};
        if GetMonitorInfoW(MonitorFromWindow(parent,2),&mut monitor)!=0 {
            // NSIS centers its smaller standard dialog; recenter after enlarging it.
            rect.left=monitor.work.left+((monitor.work.right-monitor.work.left-width)/2).max(0);
            rect.top=monitor.work.top+((monitor.work.bottom-monitor.work.top-height)/2).max(0);
        }
    }
    SetWindowPos(parent,null_mut(),rect.left,rect.top,width,height,0x0024);
    SetWindowRgn(parent,CreateRoundRectRgn(0,0,width+1,height+1,(20.0*scale) as i32,(20.0*scale) as i32),1);
    if !CHILD.is_null() {
        GetClientRect(parent,&mut rect);SetWindowPos(CHILD,null_mut(),0,0,rect.right,rect.bottom,0x0040);
        let state=GetWindowLongW(CHILD,-21) as *mut State;
        if !state.is_null(){if let Some(options)=(*state).options.as_mut(){options.layout(CHILD);}}
    }
}

unsafe extern "system" fn parent_observer(hwnd:Handle,msg:u32,w:usize,l:isize,_id:usize,child:usize)->isize {
    if msg==0x10 {
        let state=GetWindowLongW(child as Handle,-21) as *mut State;
        if !state.is_null() && ((*state).success || (*state).failed) {PostMessageW(hwnd,0x111,if (*state).success {1}else{2},0);return 0;}
    }
    if msg==0x2e0 {resize(hwnd,(w&0xffff) as u32,false);return 0;}
    DefSubclassProc(hwnd,msg,w,l)
}

unsafe fn pop(stack:*mut *mut Stack,size:i32)->String {
    if stack.is_null() || (*stack).is_null(){return String::new();}
    let item=*stack;let text=(*item).text.as_ptr();let mut len=0;
    while len<size.max(0) as usize && *text.add(len)!=0{len+=1;}
    let value=String::from_utf16_lossy(std::slice::from_raw_parts(text,len));
    *stack=(*item).next;GlobalFree(item.cast());value
}

unsafe fn push(stack:*mut *mut Stack,size:i32,value:&str) {
    if stack.is_null() || size<=0{return;}
    let item=GlobalAlloc(0x40,std::mem::size_of::<*mut Stack>()+size as usize*2) as *mut Stack;
    if item.is_null(){return;}
    (*item).next=*stack;let data=wide(value);
    std::ptr::copy_nonoverlapping(data.as_ptr(),(*item).text.as_mut_ptr(),data.len().min(size as usize));
    *stack=item;
}

unsafe extern "C" fn plugin_callback(message:u32)->usize {
    if message==1 && !CHILD.is_null(){DestroyWindow(CHILD);}
    if message==0 && GDI_TOKEN!=0 {GdiplusShutdown(GDI_TOKEN);GDI_TOKEN=0;}
    0
}

#[no_mangle]
pub unsafe extern "C" fn Attach(parent:Handle,size:i32,_vars:*mut u16,stack:*mut *mut Stack,extra:*mut Extra) {
    let asset_dir=pop(stack,size);let log_path=pop(stack,size);let preview_scale=pop(stack,size);let record=pop(stack,size);
    if !CHILD.is_null(){push(stack,size,"already attached");return;}
    let mut instance=null_mut();GetModuleHandleExW(6,Attach as *const u16,&mut instance);
    if extra.is_null() || (*extra).register.is_none(){push(stack,size,"NSIS plugin API unavailable");return;}
    ((*extra).register.unwrap())(instance,plugin_callback);
    if GDI_TOKEN==0 && GdiplusStartup(&raw mut GDI_TOKEN,&Startup{version:1,callback:null_mut(),no_thread:0,no_codecs:0},null_mut())!=0 {
        push(stack,size,"GDI+ initialization failed");return;
    }
    let mut names:Vec<String>=["paper.png","app-icon.png","brand.png","wordmark.png","check.png","clouds.png","cloud.png","earth.png","earth-core.png","earth-outline.png"].iter().map(|s|s.to_string()).collect();
    names.extend((0..model::FRAME_COUNT).map(|i|format!("sheep-run-{i}.png")));
    names.push("complete.png".to_string());
    names.push("progress-texture.png".to_string());
    let mut images=Vec::new();
    for name in names {
        let file=PathBuf::from(&asset_dir).join(&name);let mut img=null_mut();
        if GdipLoadImageFromFile(wide(&file.to_string_lossy()).as_ptr(),&mut img)!=0 {
            for image in images {GdipDisposeImage(image);}
            push(stack,size,&format!("Cannot load {name}"));return;
        }
        images.push(img);
    }
    let mut attributes=null_mut();GdipCreateImageAttributes(&mut attributes);
    let mut matrix=[0.0f32;25];for i in 0..5 {matrix[i*5+i]=1.0;}matrix[18]=0.28;
    GdipSetImageAttributesColorMatrix(attributes,1,1,matrix.as_ptr(),null(),0);
    let inner=FindWindowExW(parent,null_mut(),wide("#32770").as_ptr(),null());
    let progress=GetDlgItem(inner,1004);
    if progress.is_null(){
        for image in images {GdipDisposeImage(image);}GdipDisposeImageAttributes(attributes);
        push(stack,size,"Native NSIS progress control missing");return;
    }
    // Preserve the genuine progress control and its messages behind the drawing.
    for id in [1004,1006,1027,1005,1000,1028] {let item=GetDlgItem(inner,id);if !item.is_null(){ShowWindow(item,0);}}
    for id in [1,2,3,1028,1034,1035,1036,1037,1038,1039,1256] {let item=GetDlgItem(parent,id);if !item.is_null(){ShowWindow(item,0);}}
    let style=GetWindowLongW(parent,-16);SetWindowLongW(parent,-16,(style&!(0x00c00000|0x00040000))|0x02000000);
    let dpi=GetDpiForWindow(parent).max(96);
    // Explicit size simulation; never report this as the monitor's actual DPI.
    let scale=preview_scale.parse::<u32>().ok().filter(|s|[100,125,150,200].contains(s));
    resize(parent,scale.map(|s|s*96/100).unwrap_or(dpi),true);
    let name=wide(CLASS);
    let class=Class{size:std::mem::size_of::<Class>() as u32,style:3,proc:Some(window_proc),cls_extra:0,wnd_extra:0,
        instance,icon:null_mut(),cursor:LoadCursorW(null_mut(),32512usize as *const u16),background:null_mut(),menu:null(),name:name.as_ptr(),small_icon:null_mut()};
    RegisterClassExW(&class);
    let mut client=Rect::default();GetClientRect(parent,&mut client);
    CHILD=CreateWindowExW(0,name.as_ptr(),wide("LanDict installation artwork").as_ptr(),0x54000000,0,0,client.right,client.bottom,parent,null_mut(),instance,null_mut());
    if CHILD.is_null(){for image in images {GdipDisposeImage(image);}GdipDisposeImageAttributes(attributes);push(stack,size,"Artwork window creation failed");return;}
    let mut family=null_mut();let mut fonts=[null_mut();3];let mut formats=[null_mut();2];let mut text_brush=null_mut();
    GdipCreateFontFamilyFromName(wide("Segoe UI").as_ptr(),null_mut(),&mut family);
    for (i,size) in [15.0,23.0,22.0].iter().enumerate() {GdipCreateFont(family,*size,0,2,&mut fonts[i]);}
    GdipDeleteFontFamily(family);
    for i in 0..2 {GdipCreateStringFormat(0,0,&mut formats[i]);GdipSetStringFormatAlign(formats[i],i as i32);}
    GdipCreateSolidFill(0xff111c48,&mut text_brush);
    let log_path=PathBuf::from(log_path);
    let record_dir=if record=="yes" {log_path.parent().map(|p|p.join("recording").join(GetTickCount64().to_string())).filter(|p|std::fs::create_dir_all(p).is_ok())} else {None};
    let state=Box::new(State{parent,inner,flags:(*extra).flags.cast(),progress,images,started:GetTickCount64(),success:false,failed:false,finished:None,log:log_path,last_sample:0,last_percent:0,paper_alpha:attributes,fonts,formats,text_brush,paints:0,record_dir,cached_images:Vec::new(),cached_width:0,options:None,hover:HOVER_NONE,last_hover:HOVER_NONE,tracking:false});
    log(&state,&format!("attached actual_dpi={dpi} size_simulation={scale:?} window={}x{} frames=24 cycle_ms=1000",client.right,client.bottom));
    SetWindowLongW(CHILD,-21,Box::into_raw(state) as i32);
    SetWindowSubclass(inner,Some(install_observer),1,CHILD as usize);
    SetWindowSubclass(parent,Some(parent_observer),2,CHILD as usize);
    SetWindowPos(CHILD,null_mut(),0,0,client.right,client.bottom,0x0040);
    ShowWindow(inner,0);
    SetFocus(CHILD);
    SetTimer(CHILD,1,16,null_mut());InvalidateRect(CHILD,null(),0);push(stack,size,"ok");
}

#[no_mangle]
pub unsafe extern "C" fn Options(_parent:Handle,size:i32,_vars:*mut u16,stack:*mut *mut Stack,_extra:*mut Extra) {
    let agreement_path=pop(stack,size);let default_path=pop(stack,size);
    if CHILD.is_null(){push(stack,size,"Artwork must be attached first");return;}
    if !std::path::Path::new(&agreement_path).exists(){push(stack,size,&format!("Cannot find agreement: {agreement_path}"));return;}
    let state=&mut *(GetWindowLongW(CHILD,-21) as *mut State);
    if state.options.is_some(){push(stack,size,"Options already attached");return;}
    log(state,&format!("options default_path='{default_path}' agreement='{agreement_path}'"));
    state.options=Some(options::OptionsUi::new(CHILD,&agreement_path,&default_path));
    let style=GetWindowLongW(CHILD,-16);SetWindowLongW(CHILD,-16,style|0x02000000);
    InvalidateRect(CHILD,null(),0);push(stack,size,"ok");
}

/// The folder chosen on the preparation page, or an empty string when unchanged.
#[no_mangle]
pub unsafe extern "C" fn GetInstallPath(_parent:Handle,size:i32,_vars:*mut u16,stack:*mut *mut Stack,_extra:*mut Extra) {
    let value=if CHILD.is_null(){String::new()}else{
        let state=&*(GetWindowLongW(CHILD,-21) as *mut State);
        state.options.as_ref().map(|options|options.path_text()).unwrap_or_default()
    };
    push(stack,size,&value);
}

#[no_mangle]
pub unsafe extern "C" fn GetOptions(_parent:Handle,size:i32,_vars:*mut u16,stack:*mut *mut Stack,_extra:*mut Extra) {
    let values=if CHILD.is_null(){[false,false,true,true]}else{let state=&*(GetWindowLongW(CHILD,-21) as *mut State);state.options.as_ref().map(|options|options.values()).unwrap_or([false,false,true,true])};
    if !CHILD.is_null(){let state=&*(GetWindowLongW(CHILD,-21) as *mut State);log(state,&format!("options consent={} autostart={} keep_installer={} desktop={}",values[0],values[1],values[2],values[3]));}
    for value in values {push(stack,size,if value {"1"}else{"0"});}
}

#[no_mangle]
pub unsafe extern "C" fn Complete(_parent:Handle,_size:i32,_vars:*mut u16,_stack:*mut *mut Stack,_extra:*mut Extra) {
    if CHILD.is_null(){return;}
    let state=GetWindowLongW(CHILD,-21) as *mut State;
    if !state.is_null() && *(*state).flags.add(2)==0 && *(*state).flags.add(3)==0 {PostMessageW(CHILD,0x8001,1,0);}
}

#[no_mangle]
pub unsafe extern "C" fn Destroy(_parent:Handle,_size:i32,_vars:*mut u16,_stack:*mut *mut Stack,_extra:*mut Extra) {
    if !CHILD.is_null(){DestroyWindow(CHILD);}
}

