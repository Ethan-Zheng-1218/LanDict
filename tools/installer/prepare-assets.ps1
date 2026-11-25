param(
    [string]$SourceDirectory = '',
    [string]$OutputDirectory = 'src-tauri/target/installer-preview/assets'
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $SourceDirectory) {
    # The artwork folder used to sit directly on the Desktop; accept either place.
    $SourceDirectory = @(
        (Join-Path $projectRoot '../design ui/07安装包'),
        'C:\Users\Ethan\Desktop\design ui\07安装包'
    ) | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'd.png') } | Select-Object -First 1
}
if (-not $SourceDirectory) { throw 'Installer artwork folder (07安装包 with a.png..e.png) was not found.' }
$SourceDirectory = [IO.Path]::GetFullPath($SourceDirectory)
if (-not [IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory = Join-Path $projectRoot $OutputDirectory }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$generatedRoot=[IO.Path]::GetFullPath((Join-Path $projectRoot 'src-tauri/target/installer-preview')).TrimEnd('\')+'\'
if (-not ([IO.Path]::GetFullPath($OutputDirectory)+'\').StartsWith($generatedRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Asset output must remain under the installer preview build directory' }
Get-ChildItem -LiteralPath $OutputDirectory -Filter '*.png' -File | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
Add-Type -AssemblyName System.Drawing

# Deterministic preparation of existing art, with no generated replacement art.
$drawingReferences = @(
    [Drawing.Bitmap].Assembly.Location,
    [Drawing.Rectangle].Assembly.Location,
    (Join-Path $PSHOME 'ref/System.Runtime.dll'),
    (Join-Path $PSHOME 'ref/System.Collections.dll'),
    (Join-Path $PSHOME 'ref/System.Runtime.InteropServices.dll')
)
if ($PSVersionTable.PSVersion.Major -lt 6) { $drawingReferences = @('System.Drawing') }
else { $drawingReferences += @(Get-ChildItem -LiteralPath $PSHOME -Filter 'System.Private.Windows.*.dll' | ForEach-Object FullName) }
Add-Type -ReferencedAssemblies $drawingReferences -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class InstallerArt {
  public static Bitmap Matte(Bitmap source, bool removeShadow) {
    var image = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(image)) g.DrawImageUnscaled(source, 0, 0);
    int w=image.Width, h=image.Height;
    var bits=image.LockBits(new Rectangle(0,0,w,h),ImageLockMode.ReadWrite,PixelFormat.Format32bppArgb);
    var pixels=new byte[bits.Stride*h]; Marshal.Copy(bits.Scan0,pixels,0,pixels.Length);
    var outside=new bool[w*h]; var queue=new Queue<int>();
    Action<int> add = n => {
      if(outside[n]) return;
      int k=(n/w)*bits.Stride+(n%w)*4;
      int b=pixels[k], g=pixels[k+1], r=pixels[k+2];
      int lo=Math.Min(r,Math.Min(g,b)), hi=Math.Max(r,Math.Max(g,b));
      if((lo>219 && hi-lo<34) || (removeShadow && b-r>12 && g-r>5 && lo>130)) {
        outside[n]=true; queue.Enqueue(n);
      }
    };
    for(int x=0;x<w;x++){add(x);add((h-1)*w+x);}
    for(int y=1;y<h-1;y++){add(y*w);add(y*w+w-1);}
    while(queue.Count>0){int n=queue.Dequeue(),x=n%w,y=n/w;
      if(x>0)add(n-1);if(x<w-1)add(n+1);if(y>0)add(n-w);if(y<h-1)add(n+w);
    }
    for(int n=0;n<w*h;n++) if(outside[n]) pixels[(n/w)*bits.Stride+(n%w)*4+3]=0;
    Marshal.Copy(pixels,0,bits.Scan0,pixels.Length); image.UnlockBits(bits); return image;
  }
  public static void SaveCrop(Bitmap source, Rectangle crop, string destination, bool matte, bool shadow) {
    using(var cut=source.Clone(crop,PixelFormat.Format32bppArgb)) {
      if(matte) {using(var image=Matte(cut,shadow)) image.Save(destination,ImageFormat.Png);}
      else cut.Save(destination,ImageFormat.Png);
    }
  }
  static void CloudMask(Graphics g,float[] xy,int height,bool down) {
    var points=new PointF[xy.Length/2];for(int i=0;i<points.Length;i++)points[i]=new PointF(xy[i*2],xy[i*2+1]);
    using(var path=new System.Drawing.Drawing2D.GraphicsPath()) {
      path.AddCurve(points,0.35f);
      if(down) {path.AddLine(points[points.Length-1],new PointF(points[points.Length-1].X,height));path.AddLine(new PointF(points[points.Length-1].X,height),new PointF(points[0].X,height));}
      path.CloseFigure();g.FillPath(Brushes.White,path);
    }
  }
  public static void Clouds(Bitmap source, Rectangle crop, string destination, bool foreground=false) {
    using(var image=source.Clone(crop,PixelFormat.Format32bppArgb))using(var mask=new Bitmap(crop.Width,crop.Height,PixelFormat.Format32bppArgb)) {
      using(var g=Graphics.FromImage(mask)) {
        g.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        // Trace e.png contours, copying its colors. Pale sky and shaded clouds overlap in color.
        if(foreground) {
          CloudMask(g,new float[]{0,21,15,12,35,8,55,13,70,27,82,45,86,57,103,54,117,60,130,74,136,92,143,97,149,110,155,128},crop.Height,true);
          CloudMask(g,new float[]{729,21,711,17,687,17,667,24,649,38,637,58,626,77,606,76,588,83,573,97,563,115,558,101,548,86,536,85,527,96,535,111,549,127,561,143},crop.Height,true);
          CloudMask(g,new float[]{134,73,144,62,153,63,160,52,173,40,186,39,199,47,207,61,215,65,222,73,223,79,215,83,197,83,185,91,170,86,154,86,143,87,135,81},crop.Height,false);
          CloudMask(g,new float[]{0,105,20,101,42,99,65,106,81,121,91,140,109,133,123,137,141,126,161,123,177,128,188,144,191,159,210,153,228,157,240,170,255,166,274,170,285,179,292,191,306,190,321,202,350,204,375,204,391,202,403,197,417,188,433,183,445,185,458,172,472,163,490,162,507,171,520,164,537,145,553,135,570,136,585,145,602,157,615,142,632,133,650,132,667,136,682,125,701,120,729,119},crop.Height,true);
        } else {
          CloudMask(g,new float[]{3,40,5,34,12,30,17,31,20,25,29,19,37,19,40,22,42,14,49,8,60,4,70,4,80,10,84,22,84,32,91,32,97,36,100,44,100,49,96,54,87,55,77,55,69,55,60,55,52,52,45,48,37,49,30,48,24,46,15,46,10,47,5,45},crop.Height,false);
        }
      }
      var bits=image.LockBits(new Rectangle(0,0,image.Width,image.Height),ImageLockMode.ReadWrite,PixelFormat.Format32bppArgb);
      var matte=mask.LockBits(new Rectangle(0,0,mask.Width,mask.Height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
      var p=new byte[bits.Stride*image.Height];var m=new byte[matte.Stride*mask.Height];Marshal.Copy(bits.Scan0,p,0,p.Length);Marshal.Copy(matte.Scan0,m,0,m.Length);
      for(int y=0;y<image.Height;y++)for(int x=0;x<image.Width;x++) {
        int k=y*bits.Stride+x*4,r=p[k+2],green=p[k+1],b=p[k];
        bool otherArt=r<160 || green<170 || b<180 || (r-green>25 && r-b>35) || green-b>25;
        p[k+3]=otherArt?(byte)0:m[y*matte.Stride+x*4+3];
      }
      Marshal.Copy(p,0,bits.Scan0,p.Length);image.UnlockBits(bits);mask.UnlockBits(matte);image.Save(destination,ImageFormat.Png);
    }
  }
  static Rectangle Bounds(Bitmap image) {
    var bits=image.LockBits(new Rectangle(0,0,image.Width,image.Height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
    var p=new byte[bits.Stride*image.Height];Marshal.Copy(bits.Scan0,p,0,p.Length);
    int left=image.Width,top=image.Height,right=0,bottom=0;
    for(int y=0;y<image.Height;y++)for(int x=0;x<image.Width;x++)if(p[y*bits.Stride+x*4+3]>32){left=Math.Min(left,x);right=Math.Max(right,x);top=Math.Min(top,y);bottom=Math.Max(bottom,y);}
    image.UnlockBits(bits);return Rectangle.FromLTRB(left,top,right+1,bottom+1);
  }
    public static void CleanComplete(string path) {
    string temporary=path+".clean.png";
    var source=new Bitmap(path);var image=(Bitmap)source.Clone();source.Dispose();
    using(image) {
      var bits=image.LockBits(new Rectangle(0,0,image.Width,image.Height),ImageLockMode.ReadWrite,PixelFormat.Format32bppArgb);
      var p=new byte[bits.Stride*image.Height];Marshal.Copy(bits.Scan0,p,0,p.Length);
      for(int y=0;y<image.Height;y++)for(int x=0;x<image.Width;x++) {
        int k=y*bits.Stride+x*4,b=p[k],g=p[k+1],r=p[k+2];
        bool outside=(x>=119 && y>=76)||(x<6 && y>=74)||(x<11 && y>=79);
        // Remove only the photographed blue floor and gray rim outside the pose.
        // Preserve the warm brown wool/feet outline; never repaint RGB pixels.
        if((b-r>8 && g-r>4)||(outside && r-g<35 && r-b<60)||(x>=123 && y>=76))p[k+3]=0;
      }
      Marshal.Copy(p,0,bits.Scan0,p.Length);image.UnlockBits(bits);image.Save(temporary,ImageFormat.Png);
    }
    System.IO.File.Copy(temporary,path,true);System.IO.File.Delete(temporary);
  }

    /// Write a multi-size ICO. Entries up to 64px use a 32bpp DIB (bottom-up BGRA plus the
    /// AND mask); 128px and above are stored as PNG, which Windows Vista and newer accept.
    public static void SaveIcon(Bitmap source, string destination, int[] sizes) {
      var images = new System.Collections.Generic.List<byte[]>();
      var dimensions = new System.Collections.Generic.List<int>();
      foreach (var size in sizes) {
        using (var scaled = new Bitmap(size, size, PixelFormat.Format32bppArgb)) {
          using (var graphics = Graphics.FromImage(scaled)) {
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            graphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            graphics.Clear(Color.Transparent);
            graphics.DrawImage(source, 0, 0, size, size);
          }
          if (size >= 128) {
            using (var stream = new System.IO.MemoryStream()) {
              scaled.Save(stream, ImageFormat.Png);
              images.Add(stream.ToArray());
            }
          } else {
            var rowSize = size * 4;
            var maskRow = ((size + 31) / 32) * 4;
            var pixels = new byte[rowSize * size];
            var locked = scaled.LockBits(new Rectangle(0, 0, size, size), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            for (var row = 0; row < size; row++) {
              Marshal.Copy(System.IntPtr.Add(locked.Scan0, row * locked.Stride), pixels, row * rowSize, rowSize);
            }
            scaled.UnlockBits(locked);
            using (var stream = new System.IO.MemoryStream())
            using (var writer = new System.IO.BinaryWriter(stream)) {
              writer.Write((uint)40);writer.Write(size);writer.Write(size * 2);
              writer.Write((ushort)1);writer.Write((ushort)32);writer.Write((uint)0);
              writer.Write((uint)(rowSize * size + maskRow * size));
              writer.Write(0);writer.Write(0);writer.Write((uint)0);writer.Write((uint)0);
              for (var row = size - 1; row >= 0; row--) { writer.Write(pixels, row * rowSize, rowSize); }
              writer.Write(new byte[maskRow * size]);
              writer.Flush();images.Add(stream.ToArray());
            }
          }
          dimensions.Add(size);
        }
      }
      using (var stream = System.IO.File.Create(destination))
      using (var writer = new System.IO.BinaryWriter(stream)) {
        writer.Write((ushort)0);writer.Write((ushort)1);writer.Write((ushort)dimensions.Count);
        var offset = 6 + 16 * dimensions.Count;
        for (var index = 0; index < dimensions.Count; index++) {
          var size = dimensions[index];var entry = size >= 256 ? 0 : size;
          writer.Write((byte)entry);writer.Write((byte)entry);writer.Write((byte)0);writer.Write((byte)0);
          writer.Write((ushort)1);writer.Write((ushort)32);
          writer.Write((uint)images[index].Length);writer.Write((uint)offset);
          offset += images[index].Length;
        }
        foreach (var image in images) { writer.Write(image); }
      }
    }
  public static void Planet(Bitmap original,string destination) {
    using(var matte=Matte(original,false)) {
      var bounds=Bounds(matte);int side=Math.Max(bounds.Width,bounds.Height)+8;
      using(var canvas=new Bitmap(840,840,PixelFormat.Format32bppArgb))using(var g=Graphics.FromImage(canvas)) {
        g.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
        float scale=840f/side;
        var target=new RectangleF((840-bounds.Width*scale)/2,(840-bounds.Height*scale)/2,bounds.Width*scale,bounds.Height*scale);
        g.DrawImage(matte,target,bounds,GraphicsUnit.Pixel);canvas.Save(destination,ImageFormat.Png);
      }
    }
  }
  public static void PlanetLayers(string source,string directory) {
    using(var image=new Bitmap(source)) {
      int w=image.Width,h=image.Height,cx=w/2,cy=h/2;
      var bits=image.LockBits(new Rectangle(0,0,w,h),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
      var original=new byte[bits.Stride*h];Marshal.Copy(bits.Scan0,original,0,original.Length);
      int stride=bits.Stride;image.UnlockBits(bits);
      var core=(byte[])original.Clone();var outline=(byte[])original.Clone();
      const int rays=2048;var boundary=new int[rays];var colors=new int[rays];
      Func<int,bool> brown=k=>original[k+3]>128 && original[k+2]-original[k+1]>18 && original[k+2]-original[k]>28;
      for(int ray=0;ray<rays;ray++) {
        double angle=ray*Math.PI*2/rays,dx=Math.Cos(angle),dy=Math.Sin(angle);
        bool found=false;int gaps=0,edge=400;
        for(int radius=419;radius>=320;radius--) {
          int x=Math.Max(0,Math.Min(w-1,cx+(int)Math.Round(dx*radius)));
          int y=Math.Max(0,Math.Min(h-1,cy+(int)Math.Round(dy*radius)));
          if(brown(y*stride+x*4)){found=true;gaps=0;edge=radius;}
          else if(found && ++gaps>=3)break;
        }
        double outer=1/Math.Sqrt(dx*dx/(417.0*417.0)+dy*dy/(400.0*400.0));
        // Continents sometimes join the rim: never retain their inward branches.
        edge=Math.Max(edge,(int)Math.Ceiling(outer*0.96));boundary[ray]=edge;
        int sample=edge-5;
        for(;sample>edge-60;sample--) {
          int px=cx+(int)Math.Round(dx*sample),py=cy+(int)Math.Round(dy*sample);
          if(!brown(py*stride+px*4))break;
        }
        int sx=cx+(int)Math.Round(dx*sample),sy=cy+(int)Math.Round(dy*sample);
        colors[ray]=sy*stride+sx*4;
      }
      for(int y=0;y<h;y++)for(int x=0;x<w;x++) {
        int k=y*stride+x*4;double dx=x-cx,dy=y-cy,radius=Math.Sqrt(dx*dx+dy*dy);
        double angle=Math.Atan2(dy,dx);if(angle<0)angle+=Math.PI*2;
        int ray=(int)Math.Round(angle*rays/(Math.PI*2))%rays;
        double normalized=Math.Sqrt(dx*dx/(417.0*417.0)+dy*dy/(400.0*400.0));
        bool rimColor=original[k+2]-original[k+1]>14 && original[k+2]-original[k]>24;
        if(normalized<0.96 || !rimColor)outline[k+3]=0;
        if(radius>=boundary[ray]-2) {
          int color=colors[ray];core[k]=original[color];core[k+1]=original[color+1];core[k+2]=original[color+2];core[k+3]=255;
        }
        if(radius>419)core[k+3]=0;
      }
      foreach(var item in new[]{Tuple.Create(core,"earth-core.png"),Tuple.Create(outline,"earth-outline.png")}) {
        using(var result=new Bitmap(w,h,PixelFormat.Format32bppArgb)) {
          var target=result.LockBits(new Rectangle(0,0,w,h),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb);
          Marshal.Copy(item.Item1,0,target.Scan0,item.Item1.Length);result.UnlockBits(target);
          result.Save(System.IO.Path.Combine(directory,item.Item2),ImageFormat.Png);
        }
      }
    }
  }
}
'@

$reference=[Drawing.Bitmap]::new((Join-Path $SourceDirectory 'd.png'))
[InstallerArt]::SaveCrop($reference,[Drawing.Rectangle]::new(64,70,155,220),(Join-Path $OutputDirectory 'paper.png'),$false,$false)
[InstallerArt]::SaveCrop($reference,[Drawing.Rectangle]::new(264,94,104,96),(Join-Path $OutputDirectory 'brand.png'),$true,$true)
[InstallerArt]::SaveCrop($reference,[Drawing.Rectangle]::new(374,121,184,55),(Join-Path $OutputDirectory 'wordmark.png'),$true,$true)
$reference.Dispose()
$videoDirectory=Join-Path $projectRoot 'docs/installer-animation/video-run'
$manifest=Get-Content -LiteralPath (Join-Path $videoDirectory 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.frame_count -ne 24 -or $manifest.cycle_duration_ms -ne 1000) { throw 'Expected the reviewed 24-frame / 1-second video animation' }
for ($i=0; $i -lt 24; $i++) {
    $inputFrame=Join-Path $videoDirectory $manifest.frame_files[$i]
    $bitmap=[Drawing.Bitmap]::new($inputFrame)
    if ($bitmap.Width -ne 530 -or $bitmap.Height -ne 475) { $bitmap.Dispose(); throw 'Video frame dimensions changed' }
    $bitmap.Dispose()
    Copy-Item -LiteralPath $inputFrame -Destination (Join-Path $OutputDirectory "sheep-run-$i.png")
}
$earth = [Drawing.Bitmap]::new((Join-Path $SourceDirectory 'b.png'))
[InstallerArt]::Planet($earth,(Join-Path $OutputDirectory 'earth.png'))
$earth.Dispose()
[InstallerArt]::PlanetLayers((Join-Path $OutputDirectory 'earth.png'),$OutputDirectory)
$planetTexture=[Drawing.Bitmap]::new((Join-Path $OutputDirectory 'earth.png'))
[InstallerArt]::SaveCrop($planetTexture,[Drawing.Rectangle]::new(420,580,128,32),(Join-Path $OutputDirectory 'progress-texture.png'),$false,$false)
$planetTexture.Dispose()

# The complete pose is copied from the user's final image, not redrawn.
$complete = [Drawing.Bitmap]::new((Join-Path $SourceDirectory 'e.png'))
[InstallerArt]::SaveCrop($complete,[Drawing.Rectangle]::new(331,262,132,97),(Join-Path $OutputDirectory 'complete.png'),$true,$true)
[InstallerArt]::CleanComplete((Join-Path $OutputDirectory 'complete.png'))
[InstallerArt]::SaveCrop($complete,[Drawing.Rectangle]::new(232,190,38,40),(Join-Path $OutputDirectory 'check.png'),$true,$true)
[InstallerArt]::Clouds($complete,[Drawing.Rectangle]::new(26,343,729,198),(Join-Path $OutputDirectory 'clouds.png'),$true)
[InstallerArt]::Clouds($complete,[Drawing.Rectangle]::new(489,302,113,86),(Join-Path $OutputDirectory 'cloud.png'))
$complete.Dispose()
$icon = [Drawing.Bitmap]::new((Join-Path $projectRoot 'icon.png'))
$iconMatte = [InstallerArt]::Matte($icon,$false)
$iconMatte.Save((Join-Path $OutputDirectory 'app-icon.png'),[Drawing.Imaging.ImageFormat]::Png)
# Windows scales one icon file to every shell size. A single 32x32 entry is what made the
# installer EXE and the taskbar button look blurry, so write a real multi-size ICO.
[InstallerArt]::SaveIcon($iconMatte,(Join-Path $OutputDirectory 'installer.ico'),@(16,24,32,48,64,128,256))
$iconMatte.Dispose(); $icon.Dispose()
$sourceFiles=@('a.png','b.png','c.png','d.png','e.png') | ForEach-Object { Join-Path $SourceDirectory $_ }
$sourceFiles += (Join-Path $projectRoot 'icon.png')
$provenance=@{sources=@($sourceFiles | ForEach-Object { @{path=$_;sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash} });sheep='24 complete frames extracted directly from the user video, no redraw or body-part rig';videoHash=$manifest.source_sha256;frameCount=24;cycleMs=1000;earth='b.png, centered, stationary border and separate rotating interior';brand='d.png';clouds='e.png';complete='e.png';titleIcon='icon.png'}
$provenance | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'provenance.json') -Encoding utf8
# Decode at the size actually needed at 200% DPI, avoiding full-resolution
# scaling on every animation paint. Coordinates remain in the original art.
Write-Output "Prepared existing installer layers in $OutputDirectory"
