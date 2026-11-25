"""Encode real NSIS presentation-buffer captures; retain their actual timing."""
from pathlib import Path
from fractions import Fraction
import argparse
import json
import sys
from PIL import Image

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / '.superpowers/animation-tools/reviewdeps'))
import av

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input', type=Path)
parser.add_argument('--output', type=Path, default=root / 'src-tauri/target/installer-preview/review')
args = parser.parse_args()
recordings = root / 'src-tauri/target/installer-preview/recording'
source = args.input or max((p for p in recordings.iterdir() if p.is_dir() and list(p.glob('*.bmp'))), key=lambda p: p.stat().st_mtime)
files = sorted(source.glob('*.bmp'))
assert len(files) >= 24, 'Need a real native recording, not a generated scene'
times = [int(p.stem) for p in files]
images = [Image.open(p).convert('RGB') for p in files]
assert times == sorted(set(times))
assert len({im.size for im in images}) == 1
args.output.mkdir(parents=True, exist_ok=True)
width, height = images[0].size
end = 3000
durations = [b-a for a, b in zip(times, times[1:] + [end])]
assert all(d > 0 for d in durations) and end-times[0] > 2500
video = args.output / 'native-window.mp4'
with av.open(str(video), 'w') as container:
    stream = container.add_stream('libx264', rate=40)
    stream.width = width + width % 2
    stream.height = height + height % 2
    stream.pix_fmt = 'yuv420p'
    stream.time_base = Fraction(1, 1000)
    stream.codec_context.time_base = Fraction(1, 1000)
    stream.options = {'crf': '18', 'preset': 'veryfast', 'bf': '0'}
    for im, timestamp in zip(images, times):
        # H.264 4:2:0 needs even dimensions; pad, never crop the native content.
        padded = Image.new('RGB', (stream.width, stream.height), '#eff3f9')
        padded.paste(im, (0, 0))
        frame = av.VideoFrame.from_image(padded)
        frame.pts = timestamp-times[0]
        frame.time_base = Fraction(1, 1000)
        for packet in stream.encode(frame):
            container.mux(packet)
    for packet in stream.encode():
        container.mux(packet)
with av.open(str(video)) as container:
    decoded = list(container.decode(video=0))
assert len(decoded) == len(files)
images[0].save(args.output / 'recording-first-frame.png')
gif_images = [im.resize((584, round(height*584/width)), Image.Resampling.LANCZOS) for im in images]
gif_durations = [10*(round((t+d-times[0])/10)-round((t-times[0])/10)) for t,d in zip(times,durations)]
gif_images[0].save(args.output / 'native-window.gif', save_all=True, append_images=gif_images[1:], duration=gif_durations, loop=0, disposal=2, optimize=False)
result = {'source': str(source.relative_to(root)), 'source_format': 'top-down BMP captured after actual BitBlt presentation',
          'native_size': [width, height], 'mp4_size': [stream.width, stream.height], 'captured_frames': len(files),
          'first_capture_ms': times[0], 'last_capture_ms': times[-1], 'mp4_decoded_frames': len(decoded),
          'frame_times_ms': times, 'playback': 'Original capture timing, no interpolation or fabricated progress'}
(args.output/'recording.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({key: value for key,value in result.items() if key != 'frame_times_ms'}, ensure_ascii=False))
