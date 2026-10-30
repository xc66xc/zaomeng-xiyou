"""Build chapter-one attack/drop deltas against the verified official game."""

import hashlib
import json
import os
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

from build_patch3 import binary_span, replace_binary
from build_patch3_features import extract_method, method_body_id
from make_delta import generate, unpack

SOURCE_HASH = '7c5a14392f3d722a5f11f10cb1f2c148abf000a813b61590b15b1a36dcc18874'
INNER_SOURCE_HASH = '9799d3e61f37ffe4c1aa19f93bc9577919e773953fcb5b4e1c5dabefd3034c71'
CALLBACK = ("function(p,r,a){try{return typeof window.__zmxyAttackPower1==='function'?"
            "window.__zmxyAttackPower1(p,r,a):p;}catch(e){return p;}}")


def attack_tail(name: str, original: int) -> str:
    """Keep damage bound to local players, including a shadow's source owner."""
    candidate, config = original + 1, original + 2
    shadow = name == 'Role2Shadow'
    source_guard = ('getlocal0\ngetproperty QName(PackageNamespace(""),"source")\n'
                    'iffalse mac_original\n') if shadow else ''
    owner = ('getlocal0\n' + ('getproperty QName(PackageNamespace(""),"source")\n'
                              if shadow else '')
             + 'callproperty QName(PackageNamespace(""),"getPlayer"), 0\n')
    return f'''mac_attack_return:
convert_i
setlocal {original}
mac_attack_try:
{source_guard}{owner}iffalse mac_original
getlex QName(PackageNamespace("config"),"Config")
callproperty QName(PackageNamespace(""),"getInstance"), 0
setlocal {config}
{owner}getlocal {config}
getproperty QName(PackageNamespace(""),"player1")
ifeq mac_owner_ok
{owner}getlocal {config}
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


def drop_method(text: str) -> str:
    """Wrap only the ordinary probability operand; preserve original drop tables."""
    marker = re.search(r'getlocal0\ngetproperty Multiname\("probability",[^\n]+\n(ifnle \w+)', text)
    if marker is None or len(re.findall(r'getproperty Multiname\("probability",', text)) != 1:
        raise ValueError('Unexpected chapter-one probability gate')
    count = int(re.search(r'localcount (\d+)', text)[1])
    text = re.sub(r'localcount \d+', f'localcount {count + 2}', text)
    text = re.sub(r'maxstack (\d+)', lambda m: f'maxstack {int(m[1]) + 8}', text)
    callback = ("function(p){try{return typeof window.__zmxyDropRate==='function'?"
                "window.__zmxyDropRate(p):p;}catch(e){return p;}}")
    original, candidate = count, count + 1
    rate = f'''convert_d
setlocal {original}
getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
getproperty QName(PackageNamespace(""),"available")
iffalse mac_drop_original
getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
pushstring "{callback}"
getlocal {original}
callproperty QName(PackageNamespace(""),"call"), 2
setlocal {candidate}
getlocal {candidate}
istype QName(PackageNamespace(""),"Number")
iffalse mac_drop_original
findpropstrict QName(PackageNamespace(""),"isFinite")
getlocal {candidate}
callproperty QName(PackageNamespace(""),"isFinite"), 1
iffalse mac_drop_original
getlocal {candidate}
pushbyte 0
ifnge mac_drop_original
getlocal {candidate}
pushbyte 1
ifngt mac_drop_modified
jump mac_drop_original
mac_drop_modified:
getlocal {candidate}
convert_d
jump mac_drop_end
mac_drop_original:
getlocal {original}
mac_drop_end:
'''
    position = text.index(marker[1], text.index('getproperty Multiname("probability",'))
    return text[:position] + rate + text[position:]


def main() -> None:
    root = Path(os.environ['ZMXY_PATCH_WORKDIR']).resolve()
    root.mkdir(parents=True, exist_ok=True)
    outer = unpack(root / 'original.swf')
    if hashlib.sha256(outer).hexdigest() != SOURCE_HASH:
        raise ValueError('Only verified official chapter-one v25928 is supported')
    _, _, payload = binary_span(outer)
    (root / 'inner.swf').write_bytes(payload[6:])
    inner = unpack(root / 'inner.swf')
    if hashlib.sha256(inner).hexdigest() != INNER_SOURCE_HASH:
        raise ValueError('Unexpected chapter-one embedded game')
    cli = [os.environ.get('JAVA', 'java'), '-Xmx2g', '-Djava.awt.headless=true',
           '-jar', os.environ['FFDEC_JAR']]
    subprocess.run(cli + ['-swf2xml', str(root / 'inner.swf'), str(root / 'inner.xml')], check=True)
    xml = ET.parse(root / 'inner.xml').getroot()
    roles = ['Role1', 'Role2', 'Role2Shadow']
    classes = ['base.BaseMonster', *[f'export.hero.{name}' for name in roles]]
    subprocess.run(cli + ['-selectclass', ','.join(classes), '-format', 'script:pcode',
                         '-export', 'script', str(root / 'pcode'), str(root / 'inner.swf')], check=True)
    jobs = [(f'export.hero.{name}', 'getRealPower',
             lambda text, name=name: patch_method(text, name)) for name in roles]
    jobs.append(('base.BaseMonster', 'fallEquip', drop_method))
    source = root / 'inner.swf'
    for cls, method, transform in jobs:
        original = (root / 'pcode/scripts' / (cls.replace('.', '/') + '.pcode')).read_text()
        text = transform(extract_method(original, method))
        patch = root / f'{cls}-{method}.pcode'
        patch.write_text(text)
        target = root / f'{cls}-{method}.swf'
        subprocess.run(cli + ['-replace', str(source), str(target), cls, str(patch),
                             str(method_body_id(xml, cls, method))], check=True)
        source = target
    modified = unpack(source)
    result = replace_binary(outer, modified)
    (root / 'release.swf').write_bytes(result)
    recipe = {'sourceHash': SOURCE_HASH, 'resultHash': hashlib.sha256(result).hexdigest(),
              'resultSize': len(result), 'operations': [],
              'embedded': {'binaryID': 3, **generate(inner, modified)}}
    target = Path(os.environ.get('ZMXY_RECIPE_PATH', root / 'patch-zm1-v25928.json'))
    target.write_text(json.dumps(recipe, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    main()
