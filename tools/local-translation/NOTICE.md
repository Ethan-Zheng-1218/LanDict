# LanDict local machine translation

English↔Simplified Chinese model packages `translate-en_zh-1_9` and
`translate-zh_en-1_9` were published by Argos Open Technologies:
https://www.argosopentech.com/argospm/index/

The original OPUS-MT models are licensed under Creative Commons Attribution 4.0
International. Authors: Jörg Tiedemann and Santhosh Thottingal, “OPUS-MT — Building
open translation services for the World”, EAMT 2020, Lisbon, Portugal.
https://github.com/Helsinki-NLP/OPUS-MT-train
https://creativecommons.org/licenses/by/4.0/

Argos converted the original weights into CTranslate2 model packages. LanDict
retains those weights and SentencePiece files without modification and omits
the unused Stanza sentence-boundary files. The original model README attribution
and metadata remain in each model directory. Full CC BY 4.0 text is MODEL-LICENSE.txt.

The private runtime contains CPython (PSF license), CTranslate2 (MIT),
SentencePiece (Apache-2.0), NumPy (BSD and bundled-library licenses), PyYAML (MIT),
PySBD (MIT) and Visual C++ redistributable DLLs (Microsoft distribution terms).
See runtime/LICENSE.txt and the corresponding runtime/deps/*.dist-info license
directories. Those notices are distributed intact, including licenses for native
libraries in the wheels. This application does not distribute LibreTranslate,
MiniSBD, PyTorch, spaCy or Stanza.

This translation is a local machine-generated reading aid. Idioms, names,
ambiguity and long sentences may be translated incorrectly.
