"""Offline Argos-model inference. JSONL over pipes; no HTTP server or API keys."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import re
import sys
import threading

MAX_CHARACTERS = 20000
TOKEN_CHUNK_SIZE = 256


def split_sentences(text, source):
    if source == 'zh':
        return [part.strip() for part in re.findall(r'[^。！？!?]+[。！？!?]*', text) if part.strip()]
    import pysbd
    return [part.strip() for part in pysbd.Segmenter(language='en', clean=False).segment(text) if part.strip()]


def chunk_tokens(tokens):
    return [tokens[start:start + TOKEN_CHUNK_SIZE] for start in range(0, len(tokens), TOKEN_CHUNK_SIZE)]


class Engine:
    def __init__(self, models):
        # Tauri resource_dir may use a Windows verbatim path. CTranslate2's file
        # loader rejects that prefix even though Python can read the same files.
        path = os.fspath(models)
        if os.name == 'nt' and path.startswith('\\\\?\\'):
            path = ('\\\\' + path[8:]) if path[4:8].upper() == 'UNC\\' else path[4:]
        self.models = Path(path)
        self.loaded = {}

    def translate(self, text, source, target):
        if (source, target) not in (('en', 'zh'), ('zh', 'en')):
            raise ValueError('本地翻译仅支持英语与简体中文互译。')
        if not isinstance(text, str) or not text.strip():
            raise ValueError('请输入要翻译的文本。')
        if len(text) > MAX_CHARACTERS:
            raise ValueError('文本过长，请分段翻译（每次最多20,000字符）。')
        key = (source, target)
        if key not in self.loaded:
            model = self.models / f'translate-{source}_{target}-1_9'
            if not (model / 'model/model.bin').is_file() or not (model / 'sentencepiece.model').is_file():
                raise FileNotFoundError('本地翻译模型缺失，请重新安装完整版本。')
            import ctranslate2
            import sentencepiece
            self.loaded[key] = (
                ctranslate2.Translator(str(model / 'model'), device='cpu', compute_type='int8', inter_threads=1, intra_threads=2),
                sentencepiece.SentencePieceProcessor(model_file=str(model / 'sentencepiece.model')),
            )
        translator, tokenizer = self.loaded[key]
        paragraphs = []
        for paragraph in text.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
            if not paragraph.strip():
                paragraphs.append('')
                continue
            sentences = split_sentences(paragraph, source)
            tokens = [chunk for sentence in sentences for chunk in chunk_tokens(tokenizer.encode(sentence, out_type=str))]
            results = translator.translate_batch(tokens, beam_size=4, length_penalty=0.2, replace_unknowns=True, max_input_length=0, max_decoding_length=1024, max_batch_size=16)
            if any(len(result.hypotheses[0]) >= 1024 for result in results):
                raise ValueError('译文过长，请将文本分成更短的句子后重试。')
            decoded = [tokenizer.decode_pieces(result.hypotheses[0]).replace('▁', ' ').strip() for result in results]
            paragraphs.append((' ' if target == 'en' else '').join(decoded))
        return '\n'.join(paragraphs)


def disable_network():
    def deny(event, _args):
        if event in ('socket.connect', 'socket.getaddrinfo', 'socket.sendto'):
            raise OSError('本地翻译进程禁止联网。')
    sys.addaudithook(deny)


def watch_parent(pid):
    if os.name != 'nt' or not pid:
        return
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(0x00100000, False, pid)
    if not handle:
        raise OSError('无法确认本地翻译的父进程。')
    def wait():
        kernel.WaitForSingleObject(handle, 0xFFFFFFFF)
        kernel.CloseHandle(handle)
        os._exit(0)
    threading.Thread(target=wait, daemon=True).start()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--parent-pid', type=int)
    args = parser.parse_args()
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    os.environ.update(CT2_USE_MKL='0', CT2_PACKED_GEMM='0', OMP_NUM_THREADS='2', MKL_NUM_THREADS='2', OPENBLAS_NUM_THREADS='2')
    disable_network()
    watch_parent(args.parent_pid)
    # Import before ready so a missing DLL/runtime is a startup failure, not a stuck request.
    import ctranslate2, sentencepiece, pysbd
    engine = Engine(args.models)
    print(json.dumps({'ready': True}), flush=True)
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError('翻译请求格式无效。')
            translation = engine.translate(request.get('text'), request.get('source'), request.get('target'))
            response = {'id': request.get('id'), 'translation': translation}
        except Exception as error:
            response = {'id': request.get('id') if isinstance(request, dict) else None, 'error': str(error)}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
