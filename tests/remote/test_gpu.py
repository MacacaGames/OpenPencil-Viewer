import importlib.util
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gpu', pathlib.Path(__file__).resolve().parents[2] / 'tools/remote/gpu.py')
gpu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gpu)


class GPUAcceptance(unittest.TestCase):
    def test_decode_only_is_not_encoding(self):
        with patch.object(gpu, 'command', return_value={'ok': True, 'output': 'VAProfileH264High : VAEntrypointVLD'}):
            result = gpu.encoding('/dev/dri/synthetic')
            self.assertFalse(result['h264EncodeEntrypoint'])
            self.assertFalse(result['actualEncode']['ok'])

    def test_advertised_encoding_without_actual_frames_is_failure(self):
        replies = [{'ok': True, 'output': 'VAProfileH264High : VAEntrypointEncSlice'}, {'ok': False, 'output': 'driver failed'}, {'ok': False, 'output': ''}]
        with patch.object(gpu, 'command', side_effect=replies):
            self.assertFalse(gpu.encoding('/dev/dri/synthetic')['actualEncode']['ok'])

    def test_force_vaapi_fails_without_device_and_auto_is_explicit_cpu(self):
        with patch.object(gpu, 'inventory', return_value=[]), patch.dict(gpu.os.environ, {'GPU_ENCODER_MODE': 'vaapi'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'Forced VA-API failed'):
                gpu.plan()
        with patch.object(gpu, 'inventory', return_value=[]), patch.dict(gpu.os.environ, {}, clear=True):
            result = gpu.plan()
            self.assertEqual(result['encoder'], 'cpu')
            self.assertEqual(result['zeroCopy'], 'unverified')
            self.assertEqual(result['renderStatus'], 'software-requested')

    def test_pci_resolves_node_and_same_gpu_default(self):
        device = {'pci': '0000:03:00.0', 'node': '/dev/dri/renderD131', 'vendor': '0x1002'}
        with patch.object(gpu, 'inventory', return_value=[device]), patch.object(gpu, 'encoding', return_value={'actualEncode': {'ok': True}}), patch.dict(gpu.os.environ, {'GPU_RENDER_PCI': device['pci'], 'GPU_ENCODER_MODE': 'auto'}, clear=True):
            result = gpu.plan()
            self.assertEqual(result['renderNode'], device['node'])
            self.assertEqual(result['encodeNode'], device['node'])
            self.assertEqual(result['encodePci'], result['renderPci'])


if __name__ == '__main__':
    unittest.main()
