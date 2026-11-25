# LanDict

Current release: **0.1.11** (2026-11-25).

A Windows English-learning desktop app combining dictionary lookup, translation, reading, vocabulary collection, and spaced review.

[中文](../README.md) · [Download for Windows](https://github.com/Ethan-Zheng-1218/LanDict/releases/latest)

## Features

- English and Chinese lookup, online dictionary results and local dictionary fallback.
- Input completion, short definition previews, pronunciation, and lookup history.
- Local English–Simplified Chinese translation after the required resources have been downloaded.
- Optional AI translation and word explanations using your own provider and API key.
- English articles with word lookup, vocabulary collection, read-aloud, and reading progress.
- Vocabulary import, JSON backup and restore, and spaced review.
- Desktop hover lookup, optional OCR, themes, a system tray, and startup settings.

## Install

Download [LanDict_0.1.11_x64-setup.exe](https://github.com/Ethan-Zheng-1218/LanDict/releases/download/v0.1.11/LanDict_0.1.11_x64-setup.exe), run it, and follow the installer. Check version **0.1.11** in Settings → About.

The current package targets Windows x64. Development uses Windows 11; Windows 10 compatibility has not been verified. Initial setup may need internet access for WebView2. Translation runtime and models are downloaded in the background after startup; local sentence translation becomes available after preparation completes. The installer is currently unsigned.

## Data and network

Vocabulary, settings, and learning progress are stored locally. Learning data is not synchronized to a cloud account. Online lookup, reading feeds, some audio, resource downloads, and optional AI features contact their respective services. AI queries use the endpoint you configure and may incur provider fees. The API key is stored in local application settings; it is not protected by a dedicated encrypted credential store.

## Documentation

The following guides are in Chinese:

- [Installation and updates](installation.md)
- [Usage](usage.md)
- [Development](development.md)
- [Privacy and data](privacy.md)
- [Changelog](changelog.md)
- [Release notes and SHA-256](releases/v0.1.11.md)

Third-party dictionaries, fonts, models, and dependencies retain their own rights and licenses. See the translation [NOTICE](../tools/local-translation/NOTICE.md). The browser extension is a separate project.
