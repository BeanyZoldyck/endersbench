import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import status


class StatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_partial_checkpoint_is_not_ready(self):
        snapshot = self.root / 'models--Qwen--Qwen3.8-27B/snapshots' / status.REVISION
        snapshot.mkdir(parents=True)
        (snapshot / 'model-00001-of-00018.safetensors').write_bytes(b'partial test')
        result = status.checkpoint_progress(self.root)
        self.assertEqual(result['shards'], 1)
        self.assertFalse(result['ready'])

    def test_incomplete_blobs_are_not_counted_as_completed_weights(self):
        blobs = self.root / 'models--Qwen--Qwen3.8-27B/blobs'
        blobs.mkdir(parents=True)
        (blobs / 'shard.incomplete').write_bytes(b'partial')
        result = status.checkpoint_progress(self.root)
        self.assertEqual(result['shards'], 0)
        self.assertFalse(result['ready'])

    def test_log_tail_handles_missing_file_and_carriage_returns(self):
        self.assertEqual(status.read_tail(self.root / 'absent'), '(log not available)')
        log = self.root / 'install.log'
        log.write_bytes(b'old\rprogress 1\rprogress 2\nfinished\n')
        self.assertEqual(status.read_tail(log, 2), 'progress 2\nfinished')

    def test_missing_environment_is_not_ready(self):
        with patch.object(status, 'active_jobs', return_value=[]):
            result = status.inspect(self.root, self.root)
        self.assertIn('Missing interpreter', result['error'])
        self.assertEqual(result['packages'], {})


if __name__ == '__main__':
    unittest.main()
