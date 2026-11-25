import importlib.util
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
spec = importlib.util.spec_from_file_location('worker', HERE / 'worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
MODELS = ROOT / 'src-tauri/target/local-translation/models'


class WorkerTests(unittest.TestCase):
    def test_english_abbreviations_do_not_split_a_sentence(self):
        self.assertEqual(worker.split_sentences('Dr. Smith arrived at 12.5 p.m. He is here.', 'en'), ['Dr. Smith arrived at 12.5 p.m.', 'He is here.'])

    def test_chinese_sentence_boundaries_keep_punctuation(self):
        self.assertEqual(worker.split_sentences('你好。明天见！好吗？', 'zh'), ['你好。', '明天见！', '好吗？'])

    def test_long_input_chunks_keep_every_token(self):
        tokens = [str(n) for n in range(700)]
        chunks = worker.chunk_tokens(tokens)
        self.assertEqual([n for c in chunks for n in c], tokens)
        self.assertEqual([len(c) for c in chunks], [256, 256, 188])

    def test_empty_and_unsupported_requests_fail_without_loading_models(self):
        engine = worker.Engine(Path('missing-models'))
        for text, source, target in [('', 'en', 'zh'), ('hello', 'fr', 'zh'), ('hello', 'en', 'en'), ('x' * 20001, 'en', 'zh')]:
            with self.subTest(source=source, target=target), self.assertRaises(ValueError):
                engine.translate(text, source, target)

    def test_model_missing_has_a_clear_error(self):
        with self.assertRaisesRegex(FileNotFoundError, '模型'):
            worker.Engine(Path('missing-models')).translate('phase out', 'en', 'zh')

    def test_real_bilingual_translation_preserves_paragraphs(self):
        engine = worker.Engine(MODELS)
        self.assertEqual(engine.translate('phase out', 'en', 'zh'), '逐步淘汰')
        result = engine.translate('会议推迟到了星期五。\n\n期待与你见面', 'zh', 'en')
        self.assertIn('Friday', result)
        self.assertIn('\n\n', result)
        self.assertIn('meeting you', result)
        self.assertNotIn('▁', result)

    @unittest.skipUnless(os.name == 'nt', 'Windows extended resource path')
    def test_bilingual_models_load_from_tauri_extended_resource_path(self):
        engine = worker.Engine('\\\\?\\' + str(MODELS.resolve()))
        self.assertEqual(engine.translate('phase out', 'en', 'zh'), '逐步淘汰')
        self.assertIn('Friday', engine.translate('会议推迟到了星期五。', 'zh', 'en'))

    def test_utf8_protocol_recovers_after_invalid_request_and_exits_on_eof(self):
        env = os.environ.copy()
        env['PYTHONDONTWRITEBYTECODE'] = '1'
        payload = '\n'.join([json.dumps({'id': 'bad', 'text': '', 'source': 'en', 'target': 'zh'}), json.dumps({'id': 'cn', 'text': '会议推迟到了星期五。', 'source': 'zh', 'target': 'en'}, ensure_ascii=False)]) + '\n'
        result = subprocess.run([sys.executable, str(HERE / 'worker.py'), '--models', str(MODELS)], input=payload, capture_output=True, encoding='utf-8', env=env, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertTrue(lines[0]['ready'])
        self.assertEqual(lines[1]['id'], 'bad')
        self.assertIn('error', lines[1])
        self.assertEqual(lines[2]['id'], 'cn')
        self.assertIn('Friday', lines[2]['translation'])

    def test_network_is_blocked_before_any_connection(self):
        script = "import sys; sys.path.insert(0, sys.argv[1]); import worker, socket; worker.disable_network()\ntry:\n socket.create_connection(('127.0.0.1', 9))\nexcept OSError as error:\n assert '禁止联网' in str(error); print('blocked')\nelse:\n raise AssertionError('network was allowed')"
        result = subprocess.run([sys.executable, '-X', 'utf8', '-B', '-c', script, str(HERE)], capture_output=True, encoding='utf-8', timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'blocked')

    @unittest.skipUnless(os.name == 'nt', 'Windows parent process watcher')
    def test_worker_exits_when_parent_dies_even_with_stdin_open(self):
        parent = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
        helper = subprocess.Popen([sys.executable, '-B', str(HERE / 'worker.py'), '--models', str(MODELS), '--parent-pid', str(parent.pid)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding='utf-8')
        try:
            self.assertTrue(json.loads(helper.stdout.readline())['ready'])
            parent.kill()
            parent.wait(timeout=5)
            self.assertEqual(helper.wait(timeout=5), 0)
        finally:
            if parent.poll() is None:
                parent.kill()
            parent.wait(timeout=5)
            if helper.poll() is None:
                helper.kill()
            helper.communicate(timeout=5)


if __name__ == '__main__':
    unittest.main()
