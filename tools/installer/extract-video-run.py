"""Extract the user's complete sheep poses; never redraw or move body parts.

Requires PyAV, Pillow and NumPy. Use --av-path for a project-local PyAV install.
"""
from __future__ import annotations

import argparse
from collections import deque
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


REPO = Path(__file__).resolve().parents[2]
CROP = (120, 120, 650, 595)  # One fixed coordinate system for all poses.
START = 14
COUNT = 24


def matte(image: Image.Image) -> Image.Image:
    """Fill the closed crayon silhouette, preserving the cream wool inside it."""
    rgb = np.asarray(image, dtype=np.int16)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    ink = (r - g > 18) & (g - b > 5) & (g < 210) & (r > 80)
    # Close tiny compression gaps in the outline, not gaps between body parts.
    wall_image = Image.fromarray(ink.astype(np.uint8) * 255)
    wall_image = wall_image.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    wall = np.asarray(wall_image) > 0
    height, width = wall.shape
    exterior = np.zeros_like(wall)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        for y in (0, height - 1):
            if not wall[y, x]:
                exterior[y, x] = True
                queue.append((y, x))
    for y in range(1, height - 1):
        for x in (0, width - 1):
            if not wall[y, x]:
                exterior[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < height and 0 <= nx < width and not wall[ny, nx] and not exterior[ny, nx]:
                exterior[ny, nx] = True
                queue.append((ny, nx))
    alpha = Image.fromarray((~exterior).astype(np.uint8) * 255)
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))
    result = image.convert('RGBA')
    result.putalpha(alpha)
    return result


def preview(pose: Image.Image, background: str = '#e7f1fb') -> Image.Image:
    canvas = Image.new('RGBA', (360, 340), background)
    scaled = pose.resize((318, 285), Image.Resampling.LANCZOS)
    canvas.alpha_composite(scaled, (21, 27))
    return canvas.convert('RGB')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=REPO / 'docs/installer-animation/doubao-reference.mp4')
    parser.add_argument('--output', type=Path, default=REPO / 'docs/installer-animation/video-run')
    parser.add_argument('--av-path', type=Path, default=REPO / '.superpowers/animation-tools/reviewdeps')
    args = parser.parse_args()
    if args.av_path.is_dir():
        sys.path.insert(0, str(args.av_path))
    import av

    with av.open(str(args.source)) as container:
        stream = container.streams.video[0]
        rate = Fraction(stream.average_rate)
        decoded = list(container.decode(video=0))
        rgb_frames = [frame.to_image().convert('RGB') for frame in decoded]
        timestamps = [float(frame.pts * stream.time_base) for frame in decoded]
    if rate != 24 or rgb_frames[0].size != (720, 720) or len(rgb_frames) <= START + COUNT:
        raise ValueError('Selection was reviewed against the supplied 720×720, 24 fps video only.')

    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    frames_dir = output / 'frames'
    frames_dir.mkdir(exist_ok=True)
    poses = [matte(rgb_frames[index].crop(CROP)) for index in range(START, START + COUNT)]
    filenames = []
    for index, pose in enumerate(poses):
        name = f'frame-{index:02d}.png'
        pose.save(frames_dir / name)
        filenames.append('frames/' + name)

    width, height = poses[0].size
    sheet = Image.new('RGBA', (width * 6, height * 4))
    contact = Image.new('RGB', (6 * 240, 4 * 248), '#e7f1fb')
    draw = ImageDraw.Draw(contact)
    for index, pose in enumerate(poses):
        sheet.paste(pose, ((index % 6) * width, (index // 6) * height))
        tile = preview(pose).resize((230, 217), Image.Resampling.LANCZOS)
        x, y = (index % 6) * 240, (index // 6) * 248
        contact.paste(tile, (x + 5, y + 25))
        draw.text((x + 8, y + 7), f'{index:02d} / source {START + index} / {(START + index)/24:.3f}s', fill='#1a3855')
    sheet.save(output / 'sprite-sheet.png')
    contact.save(output / 'contact-sheet.png')

    display_frames = [preview(pose) for pose in poses]
    # GIF has 10 ms time resolution; distribute its rounding error over the cycle.
    durations = [10 * (round((i + 1) * 100 / 24) - round(i * 100 / 24)) for i in range(COUNT)]
    display_frames[0].save(output / 'preview.gif', save_all=True, append_images=display_frames[1:],
                           duration=durations, loop=0, disposal=2, optimize=False)
    display_frames[0].save(output / 'slow.gif', save_all=True, append_images=display_frames[1:],
                           duration=[duration * 3 for duration in durations], loop=0, disposal=2, optimize=False)
    poses[0].save(output / 'transparent.webp', save_all=True, append_images=poses[1:],
                  duration=[round((i + 1)*1000/24)-round(i*1000/24) for i in range(COUNT)],
                  loop=0, lossless=True, exact=True, method=6)

    # Verify saved assets against the decoded source, including interior RGB pixels.
    coverage, bounds = [], []
    for index, name in enumerate(filenames):
        saved = Image.open(output / name)
        assert saved.mode == 'RGBA' and saved.size == (530, 475)
        array = np.asarray(saved)
        expected = np.asarray(rgb_frames[START + index].crop(CROP))
        assert np.array_equal(array[:, :, :3], expected), 'Source artwork pixels were altered'
        alpha = array[:, :, 3]
        assert alpha.min() == 0 and alpha.max() == 255
        assert not alpha[0, :].any() and not alpha[-1, :].any()
        assert not alpha[:, 0].any() and not alpha[:, -1].any()
        assert np.all(alpha[160:240, 220:270] == 255), 'Wool/face interior lost opacity'
        coverage.append(int((alpha > 128).sum()))
        bounds.append(saved.getchannel('A').getbbox())
    gif = Image.open(output / 'preview.gif')
    gif_duration = 0
    for i in range(gif.n_frames):
        gif.seek(i)
        gif_duration += gif.info['duration']
    assert gif.n_frames == COUNT and gif_duration == 1000
    slow = Image.open(output / 'slow.gif')
    slow_duration = 0
    for i in range(slow.n_frames):
        slow.seek(i)
        slow_duration += slow.info['duration']
    assert slow.n_frames == COUNT and slow_duration == 3000
    assert Image.open(output / 'transparent.webp').n_frames == COUNT
    with Image.open(output / 'sprite-sheet.png') as atlas:
        assert atlas.mode == 'RGBA' and atlas.size == (width * 6, height * 4)
        for index, pose in enumerate(poses):
            x, y = (index % 6) * width, (index // 6) * height
            assert np.array_equal(np.asarray(atlas.crop((x, y, x + width, y + height))), np.asarray(pose))
    arrays = [np.asarray(image, dtype=np.float32) for image in display_frames]
    adjacent = [float(np.abs(a-b).mean()) for a, b in zip(arrays[:-1], arrays[1:])]
    seam = float(np.abs(arrays[-1] - arrays[0]).mean())
    assert seam <= max(adjacent), 'Loop join is larger than every internal frame transition'

    manifest = {
        'source_file': args.source.name,
        'source_sha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
        'source_size': [720, 720], 'source_fps': [rate.numerator, rate.denominator],
        'source_decoded_frames': len(decoded), 'source_frame_indices': list(range(START, START + COUNT)),
        'source_timestamps_seconds': timestamps[START:START+COUNT],
        'crop_xyxy': CROP, 'frame_size': [width, height], 'frame_count': COUNT,
        'frame_duration_ms_rational': [1000, 24], 'cycle_duration_ms': 1000,
        'frame_files': filenames, 'sprite_grid': [6, 4],
        'gif_frame_durations_ms': durations,
        'matte': 'Closed brown crayon silhouette, exterior flood fill, 0.6 px alpha antialias; original RGB retained.',
        'registration': 'Single fixed crop for every source frame; no per-frame centering, body transforms or added bobbing.',
        'opaque_pixel_counts': coverage, 'alpha_bounds': bounds,
        'verification': {'source_rgb_unchanged': True, 'png_count': COUNT, 'gif_frames': gif.n_frames,
                         'gif_duration_ms': gif_duration, 'slow_duration_ms': slow_duration,
                         'sprite_tiles_rgba_unchanged': True, 'join_mean_rgb_difference': seam,
                         'internal_mean_rgb_difference': float(np.mean(adjacent)),
                         'internal_max_rgb_difference': max(adjacent)},
        'visual_status': 'Candidate for user review; no final installer acceptance implied.',
    }
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest['verification'], ensure_ascii=False))


if __name__ == '__main__':
    main()
