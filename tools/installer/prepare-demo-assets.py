"""Prepare the review assets for the interactive installer flow demo.

The native installer draws the sheep from 530x475 video frames down to 132 CSS
px, which softens the crayon edge. The demo uses the same crops pre-resized with
Lanczos to twice the painted size, so the browser (and later GDI+) only has to
scale by a clean factor.
"""
from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'src-tauri/target/installer-preview/assets'
DEST = ROOT / 'docs/installer-layout/assets'
VENDOR = ROOT / 'docs/installer-layout/vendor'
ALPINE = Path.home() / '.codex/skills/oil-ui/assets/vendor/alpine.min.js'
DEMO = ROOT / 'docs/installer-layout/安装流程演示.html'
AGREEMENT = ROOT / 'src-tauri/windows/agreement.txt'

SHEEP_SIZE = (264, 237)
# The crayon edge of the supplied frames softens at the tail and front paws after
# downscaling, so the review assets get a mild unsharp mask.
SHEEP_SHARPEN = dict(radius=1.1, percent=110, threshold=2)


def copy_scaled(name: str, size: tuple[int, int] | None = None, source: Path | None = None) -> None:
    origin = source or SOURCE / name
    image = Image.open(origin).convert('RGBA')
    if size:
        image = image.resize(size, Image.LANCZOS)
    image.save(DEST / name)


def sharpen(image: Image.Image) -> Image.Image:
    """Sharpen colours but keep the original alpha, so crayon edges stay clean."""
    alpha = image.getchannel('A')
    sharpened = image.filter(ImageFilter.UnsharpMask(**SHEEP_SHARPEN))
    sharpened.putalpha(alpha)
    return sharpened


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    VENDOR.mkdir(parents=True, exist_ok=True)
    for name in ('paper.png', 'brand.png', 'wordmark.png', 'check.png', 'cloud.png',
                 'clouds.png', 'earth-core.png', 'earth-outline.png', 'progress-texture.png'):
        copy_scaled(name)
    # The completed pose is a 1:1 crop from the reference, so it only needs the same mild
    # sharpening that the video frames get; the tail and front paws read crisper for it.
    copy_scaled('complete.png')
    (DEST / 'complete.png').unlink()
    sharpen(Image.open(SOURCE / 'complete.png').convert('RGBA')).save(DEST / 'complete.png')
    # Use the matted copy from the installer assets: the raw icon.png keeps opaque white
    # corners, which shows up as a white square behind the title-bar icon.
    copy_scaled('app-icon.png', (96, 96), source=SOURCE / 'app-icon.png')
    for index in range(24):
        frame = Image.open(SOURCE / f'sheep-run-{index}.png').convert('RGBA').resize(SHEEP_SIZE, Image.LANCZOS)
        sharpen(frame).save(DEST / f'sheep-run-{index}.png')
    (VENDOR / 'alpine.min.js').write_text(ALPINE.read_text(encoding='utf-8'), encoding='utf-8')
    agreement = AGREEMENT.read_text(encoding='utf-8-sig').replace('`', "'").replace('${', '$ {')
    source = DEMO.read_text(encoding='utf-8')
    if '__AGREEMENT_TEXT__' in source:
        DEMO.write_text(source.replace('__AGREEMENT_TEXT__', agreement), encoding='utf-8')
    print(f'Prepared {len(list(DEST.glob("*.png")))} demo assets in {DEST}')


if __name__ == '__main__':
    main()
