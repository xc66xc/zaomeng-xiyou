"""Rebuild only four hero attack methods in the verified v261029 game wrapper."""
import hashlib
import json
import os
import re
import struct
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

from make_delta import generate, unpack

SOURCE_HASH = '9e525984ea894cd940d3c834495c3e2c4bd43a0c3846a90bcedb8a23e947a76c'
INNER_SOURCE_HASH = '9cfb2ad24e63d0c74ca0ba56f1d638ced939fee2ac5ebb8ded166e80ac4e2ee4'
CLASSES = tuple(f'export.hero.Role{number}' for number in range(1, 5))
CALLBACK = (
    "function(p,r,a){try{return typeof window.__zmxyAttackPower3==='function'?"
    "window.__zmxyAttackPower3(p,r,a):p;}catch(e){return p;}}"
)
MAX_SIZE = 32_000_000


def binary_span(data: bytes) -> tuple[int, int, bytes]:
    """Locate exactly one DefineBinaryData with character ID 3."""
    nbits = data[8] >> 3
    position = 8 + (5 + 4 * nbits + 7) // 8 + 4
    found = []
    while position < len(data):
        start = position
        header = int.from_bytes(data[position:position + 2], 'little')
        position += 2
        length = header & 63
        if length == 63:
            length = int.from_bytes(data[position:position + 4], 'little')
            position += 4
        end = position + length
        if end > len(data):
            raise ValueError('Invalid SWF tag length')
        if header >> 6 == 87 and length >= 6:
            payload = data[position:end]
            if int.from_bytes(payload[:2], 'little') == 3:
                found.append((start, end, payload))
        position = end
        if header >> 6 == 0:
            break
    if len(found) != 1:
        raise ValueError('Expected one embedded game with character ID 3')
    return found[0]


def replace_binary(outer: bytes, inner: bytes) -> bytes:
    """Preserve every other tag; use one deterministic long-form tag header."""
    start, end, payload = binary_span(outer)
    payload = payload[:6] + inner
    tag = struct.pack('<HI', (87 << 6) | 63, len(payload)) + payload
    result = outer[:start] + tag + outer[end:]
    if len(result) > MAX_SIZE:
        raise ValueError('Patched game exceeds the native decoder size limit')
    return result[:4] + struct.pack('<I', len(result)) + result[8:]


def body_ids(root: ET.Element, name: str) -> int:
    """Find the method-body index, not the different method_info index."""
    for abc in root.iter('abc'):
        strings = list(abc.find('constants/constant_string'))
        names = list(abc.find('constants/constant_multiname'))
        namespaces = list(abc.find('constants/constant_namespace'))
        for instance in abc.find('instance_info'):
            item = names[int(instance.get('name_index'))]
            space = namespaces[int(item.get('namespace_index'))]
            identity = (strings[int(space.get('name_index'))].text,
                        strings[int(item.get('name_index'))].text)
            if identity != ('export.hero', name):
                continue
            for trait in instance.findall('./instance_traits/traits/item'):
                method = names[int(trait.get('name_index'))]
                if strings[int(method.get('name_index'))].text == 'getRealPower':
                    return next(i for i, body in enumerate(abc.find('bodies'))
                                if body.get('method_info') == trait.get('method_info'))
    raise ValueError(f'Hero attack method missing: {name}')


def attack_tail(name: str, original: int) -> str:
    """Save the original result and guard owner, solo mode, and bridge failures."""
    candidate, config = original + 1, original + 2
    return f'''mac_attack_return:
convert_i
setlocal {original}
mac_attack_try:
getlocal0
callproperty QName(PackageNamespace(""),"getPlayer"), 0
iffalse mac_original
getlex QName(PackageNamespace("config"),"Config")
callproperty QName(PackageNamespace(""),"getInstance"), 0
setlocal {config}
getlocal {config}
callproperty QName(PackageNamespace(""),"isSingleGame"), 0
iffalse mac_original
getlocal {config}
callproperty QName(PackageNamespace(""),"isInWeiPk"), 0
iftrue mac_original
getlocal0
callproperty QName(PackageNamespace(""),"getPlayer"), 0
getlocal {config}
getproperty QName(PackageNamespace(""),"player1")
ifeq mac_owner_ok
getlocal0
callproperty QName(PackageNamespace(""),"getPlayer"), 0
getlocal {config}
getproperty QName(PackageNamespace(""),"player2")
ifne mac_original
mac_owner_ok:
getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
getproperty QName(PackageNamespace(""),"available")
iffalse mac_original
getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
pushstring "{CALLBACK}"
getlocal {original}
pushstring "{name}"
getlocal1
callproperty QName(PackageNamespace(""),"call"), 4
setlocal {candidate}
getlocal {candidate}
istype QName(PackageNamespace(""),"Number")
iffalse mac_original
findpropstrict QName(PackageNamespace(""),"isFinite")
getlocal {candidate}
callproperty QName(PackageNamespace(""),"isFinite"), 1
iffalse mac_original
getlocal {candidate}
pushbyte 0
ifngt mac_original
getlocal {candidate}
pushint 2147483647
ifngt mac_modified
jump mac_original
mac_attack_try_end:
mac_attack_catch:
pop
getlocal0
pushscope
jump mac_original
mac_modified:
getlocal {candidate}
convert_i
returnvalue
mac_original:
getlocal {original}
returnvalue
'''


def patch_method(source: str, name: str) -> str:
    """Redirect existing returns without changing original damage calculations."""
    anchor = 'trait method QName(PackageNamespace(""),"getRealPower")'
    start = source.index(anchor)
    end = source.index('end ; method', start) + len('end ; method')
    text = '\n'.join(line.strip() for line in source[start:end].splitlines())
    if 'try from' in text or not re.search(r'^returnvalue$', text, re.MULTILINE):
        raise ValueError(f'Unexpected method layout: {name}')
    count = int(re.search(r'localcount (\d+)', text)[1])
    text = re.sub(r'localcount \d+', f'localcount {count + 3}', text)
    text = re.sub(r'maxstack (\d+)',
                  lambda match: f'maxstack {max(6, int(match[1]))}', text)
    text = text.replace('returnvalue', 'jump mac_attack_return')
    text = text.replace('end ; code', attack_tail(name, count) + 'end ; code')
    handler = ('try from mac_attack_try to mac_attack_try_end '
               'target mac_attack_catch type null name null end\n')
    return text.replace('end ; body', handler + 'end ; body')


def patch_heroes(root: Path, cli: list[str]) -> bytes:
    inner = root / 'inner.swf'
    subprocess.run(cli + ['-swf2xml', str(inner), str(root / 'inner.xml')], check=True)
    subprocess.run(cli + ['-selectclass', ','.join(CLASSES), '-format', 'script:pcode',
                         '-export', 'script', str(root / 'pcode'), str(inner)],
                   check=True)
    xml = ET.parse(root / 'inner.xml').getroot()
    source = inner
    for cls in CLASSES:
        name = cls.rsplit('.', 1)[1]
        text = (root / 'pcode/scripts' / (cls.replace('.', '/') + '.pcode')).read_text()
        patch = root / f'{name}-getRealPower.pcode'
        patch.write_text(patch_method(text, name))
        target = root / f'patched-{name}.swf'
        subprocess.run(cli + ['-replace', str(source), str(target), cls,
                             str(patch), str(body_ids(xml, name))], check=True)
        source = target
    return unpack(source)


def main() -> None:
    root = Path(os.environ['ZMXY_PATCH_WORKDIR']).resolve()
    original = unpack(root / 'original.swf')
    if hashlib.sha256(original).hexdigest() != SOURCE_HASH:
        raise ValueError('Only the verified official v261029 wrapper is supported')
    _, _, payload = binary_span(original)
    (root / 'inner.swf').write_bytes(payload[6:])
    inner = unpack(root / 'inner.swf')
    if hashlib.sha256(inner).hexdigest() != INNER_SOURCE_HASH:
        raise ValueError('Unexpected embedded game')
    cli = [os.environ.get('JAVA', 'java'), '-Xmx2g', '-Djava.awt.headless=true',
           '-jar', os.environ['FFDEC_JAR']]
    modified = patch_heroes(root, cli)
    result = replace_binary(original, modified)
    (root / 'release.swf').write_bytes(result)
    embedded = {'binaryID': 3, **generate(inner, modified)}
    recipe = {'sourceHash': SOURCE_HASH,
              'resultHash': hashlib.sha256(result).hexdigest(),
              'resultSize': len(result), 'operations': [], 'embedded': embedded}
    destination = Path(os.environ.get('ZMXY_RECIPE_PATH', root / 'patch-v261029.json'))
    destination.write_text(json.dumps(recipe, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    main()
