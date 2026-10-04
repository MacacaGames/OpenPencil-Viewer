#!/usr/bin/env python3
"""Read-only PCI/DRM diagnostics; encode only a generated test pattern in /tmp."""
import argparse
import glob
import json
import os
import pathlib
import re
import subprocess
import tempfile


def command(args, env=None, timeout=15):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
        return {"ok": result.returncode == 0, "code": result.returncode,
                "output": (result.stdout + result.stderr)[-32768:]}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"ok": False, "output": str(error)}


def inventory():
    devices = []
    for entry in sorted(glob.glob('/sys/class/drm/renderD*')):
        path = pathlib.Path(entry)
        node = '/dev/dri/' + path.name
        if not os.path.exists(node):
            continue
        device = (path / 'device').resolve()
        def read(name):
            try:
                return (device / name).read_text().strip()
            except OSError:
                return ''
        devices.append({"pci": device.name, "node": node,
                        "vendor": read('vendor'), "device": read('device'),
                        "driver": (device / 'driver').resolve().name,
                        "description": command(['lspci', '-nnk', '-s', device.name])['output']})
    return devices


def select(devices, choice, default=None):
    if choice == 'auto':
        return default or next((d for d in devices if d['vendor'] == '0x1002'), next(iter(devices), None))
    if not re.fullmatch(r'[0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-7]', choice):
        raise ValueError('GPU selection must be auto or a full PCI address')
    result = next((d for d in devices if d['pci'].lower() == choice.lower()), None)
    if not result:
        raise ValueError('Selected PCI device has no accessible render node in this container')
    return result


def encoding(node):
    info = command(['vainfo', '--display', 'drm', '--device', node])
    entrypoint = info['ok'] and bool(re.search(r'VAProfileH264\w*\s*:\s*VAEntrypointEncSlice(?:LP)?\b', info['output']))
    result = {"vainfo": info, "h264EncodeEntrypoint": entrypoint, "actualEncode": {"ok": False, "output": 'H.264 encoding entrypoint absent'}}
    if not entrypoint:
        return result
    with tempfile.TemporaryDirectory(prefix='portal-gpu-') as folder:
        output = folder + '/synthetic.h264'
        encoded = command(['ffmpeg', '-hide_banner', '-nostdin', '-loglevel', 'verbose',
                           '-vaapi_device', node, '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
                           '-vf', 'format=nv12,hwupload', '-frames:v', '30', '-an',
                           '-c:v', 'h264_vaapi', '-f', 'h264', output], timeout=20)
        verified = command(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_read_frames',
                            '-count_frames', '-of', 'json', output])
        encoded['ok'] = encoded['ok'] and verified['ok'] and '"h264"' in verified['output'] and '"30"' in verified['output']
        result['actualEncode'] = encoded
        result['ffprobe'] = verified
    return result


def plan(diagnostic=False):
    devices = inventory()
    render_mode = os.environ.get('GPU_RENDER_MODE', 'auto')
    encoder_mode = os.environ.get('GPU_ENCODER_MODE', 'auto')
    if render_mode not in ('auto', 'software') or encoder_mode not in ('auto', 'vaapi', 'cpu'):
        raise ValueError('Invalid GPU mode')
    renderer = select(devices, os.environ.get('GPU_RENDER_PCI', 'auto')) if render_mode != 'software' else None
    encoder = select(devices, os.environ.get('GPU_ENCODE_PCI', 'auto'), renderer)
    tested = encoding(encoder['node']) if encoder and (encoder_mode != 'cpu' or diagnostic) else None
    success = encoder_mode != 'cpu' and bool(tested and tested['actualEncode']['ok'])
    if encoder_mode == 'vaapi' and not success:
        raise ValueError('Forced VA-API failed: H.264 encode entrypoint AND actual synthetic encode are required')
    return {"devices": devices, "renderNode": renderer['node'] if renderer else None,
            "renderPci": renderer['pci'] if renderer else None,
            "renderStatus": 'hardware-requested-not-yet-verified' if renderer else 'software-requested',
            "encodeNode": encoder['node'] if encoder and success else None,
            "encodePci": encoder['pci'] if encoder and success else None,
            "encoder": 'vaapi' if success else 'cpu', "requestedEncoder": encoder_mode,
            "fallbackReason": None if success else ('forced-cpu' if encoder_mode == 'cpu' else 'no-verified-h264-vaapi-encoder'),
            "zeroCopy": 'unverified', "encodingTest": tested}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--select', action='store_true', help='Machine-readable startup selection')
    parser.add_argument('--diagnose', action='store_true', help='Include EGL/GL and image/package/host versions')
    args = parser.parse_args()
    try:
        result = plan(args.diagnose)
        if args.diagnose:
            result['host'] = command(['uname', '-a'])
            result['unraidVersion'] = command(['cat', '/host-version/unraid-version'])
            result['packages'] = command(['dpkg-query', '-W', 'chromium', 'mesa-va-drivers', 'libgl1-mesa-dri', 'vainfo', 'ffmpeg'])
            result['selkies'] = command(['/lsiopy/bin/python', '-c', 'import importlib.metadata as m; print({k:m.version(k) for k in ["selkies","pixelflux"]})'])
            result['egl'] = command(['eglinfo', '-B'])
            result['opengl'] = command(['glxinfo', '-B'])
            result['softwareRendererDetected'] = bool(re.search(r'llvmpipe|softpipe|swrast', result['egl']['output'] + result['opengl']['output'], re.I))
        print(json.dumps(result, indent=2))
    except ValueError as error:
        print(json.dumps({"error": str(error)}))
        raise SystemExit(2)


if __name__ == '__main__':
    main()
