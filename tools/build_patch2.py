"""Rebuild verified chapter-two helpers without distributing complete games."""

import hashlib
import json
import os
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

from build_patch3 import binary_span, replace_binary
from build_patch3_features import extract_method, method_body_id
from build_patch2_commands import patch_commands
from make_delta import generate, unpack

SOURCE_HASH = '434c997ef088418b44f2d6edadaf231d3ce48cd834ae066fcb52ef78b931d8f2'
INNER_SOURCE_HASH = '93b5c80a1b1ae0532acee39552ad2d486e22d2c0bf6858618475b7ca9fc17bdd'
CALLBACK = ("function(p,r,a){try{return typeof window.__zmxyAttackPower2==='function'?"
            "window.__zmxyAttackPower2(p,r,a):p;}catch(e){return p;}}")
CRAFT_CALLBACK = ("function(p,k){try{return typeof window.__zmxyCraftRate==='function'?"
                  "window.__zmxyCraftRate(p,k):p;}catch(e){return p;}}")


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


def wrap(local: int, kind: str, label: str) -> str:
    return f'''convert_d
setlocal {local}
getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
getproperty QName(PackageNamespace(""),"available")
iffalse {label}_original
getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
pushstring "{CRAFT_CALLBACK}"
getlocal {local}
pushstring "{kind}"
callproperty QName(PackageNamespace(""),"call"), 3
dup
pushnull
ifne {label}_value
pop
jump {label}_original
{label}_value:
convert_d
jump {label}_end
{label}_original:
getlocal {local}
{label}_end:
'''


def craft(s: str, name: str, method: str) -> str:
    count = int(re.search(r'localcount (\d+)', s)[1])
    s = re.sub(r'localcount \d+', f'localcount {count + 1}', s)
    s = re.sub(r'maxstack \d+', 'maxstack 8', s)
    kind = 'strength' if name == 'Strength' else 'fusion'
    if method == 'afterReadStore':
        marker = re.search(r'ifnlt \w+', s)[0]
        s = s.replace(marker, wrap(count, kind, 'craft_actual') + marker, 1)
    elif method == 'changeLuck':
        # Only the first two displays have a weapon. The third is the empty UI.
        marker = 'pushbyte 100\nmultiply'
        parts = s.split(marker)
        assert len(parts) == 4
        s = parts[0]
        private = re.search(r'QName\((PrivateNamespace\(.*?\)),"changeLuck"\)', s)[1]
        for index in range(3):
            if index < 2:
                s += f'getlocal0\ncallproperty QName({private},"findIfQHS"), 0\niffalse craft_display_skip{index}\n'
                s += wrap(count, kind, f'craft_display{index}')
                s += f'craft_display_skip{index}:\n'
            s += marker + parts[index + 1]
    else:
        marker = 'pushbyte 75\npushstring "%"'
        assert s.count(marker) == 1
        s = s.replace(marker, 'pushdouble 0.75\n' + wrap(count, kind, 'craft_preview') + 'pushbyte 100\nmultiply\npushstring "%"')
    return s



def drop_method(text: str) -> str:
    """Replace only ordinary probability/drop selection, retaining special hooks."""
    label = re.search(r'istypelate\s+iffalse (\w+)', text)[1]
    callback = ("function(p){try{return typeof window.__zmxyDropRate==='function'?"
                "window.__zmxyDropRate(p):p;}catch(e){return p;}}")
    rate = f'''getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
getproperty QName(PackageNamespace(""),"available")
iffalse mac_drop_continue
getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
pushstring "{callback}"
getlocal1
callproperty QName(PackageNamespace(""),"call"), 2
dup
pushnull
ifne mac_drop_update
pop
jump mac_drop_continue
mac_drop_update:
convert_d
setlocal1
mac_drop_continue:
'''
    if text.count(label + ':') != 1:
        raise ValueError('Unexpected ordinary drop branch')
    text = text.replace(label + ':', label + ':\n' + rate)
    count = int(re.search(r'localcount (\d+)', text)[1])
    if count != 9:
        raise ValueError('Unexpected chapter-two drop locals')
    text = text.replace('localcount 9', 'localcount 10')
    callback = ("function(b){try{return typeof window.__zmxyBossDrop2==='function'?"
                "window.__zmxyBossDrop2(b):null;}catch(e){return null;}}")
    anchor = 'getlocal0\ngetlex Multiname("Monster77"'
    index = text.index(anchor)
    override = f'''pushnull
setlocal 9
getlocal0
getproperty QName(PackageNamespace(""),"isBoss")
iffalse mac_boss_original
getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
getproperty QName(PackageNamespace(""),"available")
iffalse mac_boss_original
getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
pushstring "{callback}"
pushtrue
callproperty QName(PackageNamespace(""),"call"), 2
setlocal 9
getlocal 9
iftrue ofs0164
mac_boss_original:
'''
    text = text[:index] + override + text[index:]
    marker = 'ifnle ofs0248\n'
    if text.count(marker) != 1:
        raise ValueError('Unexpected ordinary probability gate')
    choose = '''getlocal 9
iffalse mac_boss_choose_original
findpropstrict QName(PackageNamespace("my"),"FallEquipObj")
getlocal 9
constructprop QName(PackageNamespace("my"),"FallEquipObj"), 1
coerce QName(PackageNamespace("my"),"FallEquipObj")
setlocal 5
jump mac_boss_spawn
mac_boss_choose_original:
'''
    text = text.replace(marker, marker + choose)
    index = text.rindex('setlocal 5\n') + len('setlocal 5\n')
    return text[:index] + 'mac_boss_spawn:\n' + text[index:]


def main() -> None:
    root = Path(os.environ['ZMXY_PATCH_WORKDIR']).resolve()
    root.mkdir(parents=True, exist_ok=True)
    outer = unpack(root / 'original.swf')
    if hashlib.sha256(outer).hexdigest() != SOURCE_HASH:
        raise ValueError('Only verified official chapter-two v25928 is supported')
    _, _, payload = binary_span(outer)
    (root / 'inner.swf').write_bytes(payload[6:])
    inner = unpack(root / 'inner.swf')
    if hashlib.sha256(inner).hexdigest() != INNER_SOURCE_HASH:
        raise ValueError('Unexpected chapter-two embedded game')
    cli = [os.environ.get('JAVA', 'java'), '-Xmx2g', '-Djava.awt.headless=true',
           '-jar', os.environ['FFDEC_JAR']]
    subprocess.run(cli + ['-swf2xml', str(root / 'inner.swf'), str(root / 'inner.xml')], check=True)
    xml = ET.parse(root / 'inner.xml').getroot()
    classes = ['base.BaseMonster', 'GMain', 'config.Config',
               'export.strength.Strength', 'export.strength.Fusion',
               *[f'export.hero.{name}' for name in ['Role1', 'Role2', 'Role3', 'Role2Shadow']]]
    subprocess.run(cli + ['-selectclass', ','.join(classes), '-format', 'script:pcode',
                         '-export', 'script', str(root / 'pcode'), str(root / 'inner.swf')], check=True)
    jobs = [(f'export.hero.{name}', 'getRealPower',
             lambda text, name=name: patch_method(text, name))
            for name in ['Role1', 'Role2', 'Role3', 'Role2Shadow']]
    jobs.append(('base.BaseMonster', 'fallEquip', drop_method))
    for name, method in [('Strength', 'afterReadStore'), ('Fusion', 'afterReadStore'),
                         ('Strength', 'changeLuck'), ('Fusion', 'previewFun')]:
        jobs.append((f'export.strength.{name}', method,
                     lambda text, name=name, method=method: craft(text, name, method)))
    source = root / 'inner.swf'
    for cls, method, transform in jobs:
        original = (root / 'pcode/scripts' / (cls.replace('.', '/') + '.pcode')).read_text()
        text = transform(extract_method(original, method))
        text = re.sub(r'maxstack (\d+)', lambda match: f'maxstack {int(match[1]) + 8}', text)
        patch = root / f'{cls}-{method}.pcode'
        patch.write_text(text)
        target = root / f'{cls}-{method}.swf'
        subprocess.run(cli + ['-replace', str(source), str(target), cls, str(patch),
                             str(method_body_id(xml, cls, method))], check=True)
        source = target
    source = patch_commands(root, cli, source, xml)
    modified = unpack(source)
    result = replace_binary(outer, modified)
    (root / 'release.swf').write_bytes(result)
    recipe = {'sourceHash': SOURCE_HASH, 'resultHash': hashlib.sha256(result).hexdigest(),
              'resultSize': len(result), 'operations': [],
              'embedded': {'binaryID': 3, **generate(inner, modified)}}
    target = Path(os.environ.get('ZMXY_RECIPE_PATH', root / 'patch-v25928.json'))
    target.write_text(json.dumps(recipe, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    main()
