"""Generate a compact local patch recipe; do not bundle original game files."""
import argparse
import base64
import hashlib
import json
import lzma
import zlib
from pathlib import Path


def unpack(path: Path) -> bytes:
    data = path.read_bytes()
    if data[:3] == b'ZWS':
        size = int.from_bytes(data[4:8], 'little') - 8
        stream = data[12:17] + size.to_bytes(8, 'little') + data[17:]
        data = b'FWS' + data[3:8] + lzma.decompress(stream, format=lzma.FORMAT_ALONE)
    if data[:3] == b'CWS':
        data = b'FWS' + data[3:8] + zlib.decompress(data[8:])
    if data[:3] != b'FWS' or int.from_bytes(data[4:8], 'little') != len(data):
        raise ValueError('Invalid SWF')
    return data


def generate(original: bytes, patched: bytes) -> dict:
    blocks = {original[i:i + 32]: i for i in range(0, len(original) - 31, 32)}
    ops = []
    pending = bytearray()
    cursor = 0
    while cursor < len(patched):
        position = blocks.get(patched[cursor:cursor + 32])
        if position is None:
            pending.append(patched[cursor])
            cursor += 1
            continue
        if pending:
            ops.append({'add': base64.b64encode(pending).decode('ascii')})
            pending.clear()
        length = 32
        while (position + length < len(original) and cursor + length < len(patched)
               and original[position + length] == patched[cursor + length]):
            length += 1
        ops.append({'offset': position, 'length': length})
        cursor += length
    if pending:
        ops.append({'add': base64.b64encode(pending).decode('ascii')})
    return {'sourceHash': hashlib.sha256(original).hexdigest(),
            'resultHash': hashlib.sha256(patched).hexdigest(),
            'resultSize': len(patched), 'operations': ops}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('original', type=Path)
    parser.add_argument('patched', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(generate(unpack(args.original), unpack(args.patched)),
                                     separators=(',', ':')) + '\n')
