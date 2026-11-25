"""Check actual preview assets, captured native buffers and NSIS engine logs."""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[2]
build = root / 'src-tauri/target/installer-preview'
assets = build / 'assets'
review = build / 'review'
for i in range(24):
    assert (assets / f'sheep-run-{i}.png').read_bytes() == (root / 'docs/installer-animation/video-run/frames' / f'frame-{i:02d}.png').read_bytes()
outline = np.asarray(Image.open(assets / 'earth-outline.png').convert('RGBA'))
yy, xx = np.indices(outline.shape[:2])
rho = np.sqrt(((xx-420)/417)**2 + ((yy-420)/400)**2)
assert not ((outline[:, :, 3] > 128) & (rho < .94)).any(), 'Fixed continents extend inside the globe'
complete = Image.open(assets / 'complete.png').convert('RGBA')
assert complete.getpixel((126,83))[3] == 0, 'Gray rear fragment is opaque'
assert complete.getpixel((66,46))[3] == 255, 'Face interior became transparent'

payloads = []
for source, name in [('data/ecdict-sqlite-28/stardict-slim.db','stardict.db'), ('data/oxford-sqlite/landict-oxford.db','landict-oxford.db'), ('data/cedict-sqlite/landict-cedict.db','landict-cedict.db')]:
    expected = hashlib.sha256((root / source).read_bytes()).hexdigest()
    actual = hashlib.sha256((build / 'extracted' / name).read_bytes()).hexdigest()
    assert expected == actual
    payloads.append({'file': name, 'sha256': actual, 'matches_source': True})
success = (review / 'success.log').read_text()
failure = (review / 'failure.log').read_text()
cancel = (review / 'cancel.log').read_text()
assert 'engine-completed exec_error=0 abort=0' in success and 'installation-success percent=100' in success
assert 'installation-failed' in failure and 'abort=1' in failure
assert 'installation-success' not in failure and 'percent=100' not in failure
assert 'destroy' in cancel and 'installation-success' not in cancel

captures = []
for directory in (build / 'recording').iterdir():
    if directory.is_dir():
        files = sorted(directory.glob('*.bmp'))
        if files:
            captures.append((directory, files, Image.open(files[0]).size))
large = max((item for item in captures if item[2] == (1460,1166)), key=lambda item: item[0].stat().st_mtime)
first = Image.open(large[1][0]).convert('RGB')
first.save(review / 'size-200-render.png')
pixels = np.asarray(first)
row_delta = np.abs(np.diff(pixels[1036:1054].astype(np.int16), axis=0))
assert row_delta.max() <= 10, 'Hard seam remains at the end of the cloud fade'
last = np.asarray(Image.open(large[1][-1]).convert('RGB'))
assert np.array_equal(pixels[1054:1064,:1200], last[1054:1064,:1200]), 'Moving globe leaked below scene clip'

sizes = []
for scale, expected in [(125,(913,729)), (150,(1095,875))]:
    log = (review / f'size-{scale}.log').read_text()
    assert f'size_simulation=Some({scale})' in log and f'window={expected[0]}x{expected[1]}' in log
    sizes.append({'scale_percent': scale, 'window_size': expected, 'actual_dpi': 96, 'kind': 'size simulation'})
sizes.append({'scale_percent': 200, 'window_size': large[2], 'actual_dpi': 96, 'kind': 'native buffer size simulation; screen occluded by unrelated UAC/app prompt'})
result = {'source_sheep_pngs_identical':24, 'no_fixed_inward_coastal_fragments':True, 'completed_pose_gray_fragment_removed':True,
          'real_payload_hashes':payloads, 'successful_engine_completion':True, 'failed_engine_does_not_show_success_or_100':True,
          'cancel_destroy_observed':True, 'native_200_buffer_frames':len(large[1]), 'footer_max_adjacent_row_difference':int(row_delta.max()), 'footer_below_scene_clip_stationary':True,
          'actual_os_dpi_verified':96, 'size_simulations':sizes, 'visual_approval':'pending user review', 'product_install_uninstall':'not performed in preview stage'}
(review / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
