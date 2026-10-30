"""Restore opt-in chapter-three features by replacing bounded method bodies."""

import re
import subprocess
import xml.etree.ElementTree as ET
from collections.abc import Callable
from pathlib import Path

EXTERNAL = 'QName(PackageNamespace("flash.external"),"ExternalInterface")'
PUBLIC = 'QName(PackageNamespace(""),"call")'
CONFIG = 'QName(PackageNamespace("config"),"Config")'


def method_body_id(root: ET.Element, cls: str, method: str) -> int:
    """Resolve the method-body index while checking its complete class identity."""
    package, _, name = cls.rpartition('.')
    for abc in root.iter('abc'):
        strings = list(abc.find('constants/constant_string'))
        names = list(abc.find('constants/constant_multiname'))
        spaces = list(abc.find('constants/constant_namespace'))
        for instance in abc.find('instance_info'):
            item = names[int(instance.get('name_index'))]
            space = spaces[int(item.get('namespace_index'))]
            identity = (strings[int(space.get('name_index'))].text or '',
                        strings[int(item.get('name_index'))].text)
            if identity != (package, name):
                continue
            for trait in instance.findall('./instance_traits/traits/item'):
                entry = names[int(trait.get('name_index'))]
                if strings[int(entry.get('name_index'))].text == method:
                    return next(i for i, body in enumerate(abc.find('bodies'))
                                if body.get('method_info') == trait.get('method_info'))
    raise ValueError(f'Method missing: {cls}.{method}')


def extract_method(text: str, method: str) -> str:
    """Retain the original method metadata and signature."""
    match = re.search(r'trait method [^\n]*,"' + re.escape(method) + r'"\)', text)
    if match is None:
        raise ValueError(f'Method text missing: {method}')
    start = match.start()
    end = text.index('end ; method', start) + len('end ; method')
    return '\n'.join(line.strip() for line in text[start:end].splitlines())


def solo_guard(label: str) -> str:
    """Keep helper callbacks outside network and arena game paths."""
    return (f'getlex {CONFIG}\n'
            'callproperty QName(PackageNamespace(""),"getInstance"), 0\n'
            'callproperty QName(PackageNamespace(""),"isSingleGame"), 0\n'
            f'iffalse {label}\ngetlex {CONFIG}\n'
            'callproperty QName(PackageNamespace(""),"getInstance"), 0\n'
            'callproperty QName(PackageNamespace(""),"isInWeiPk"), 0\n'
            f'iftrue {label}\n')


def external_guard(label: str) -> str:
    return (solo_guard(label) + f'getlex {EXTERNAL}\n'
            'getproperty QName(PackageNamespace(""),"available")\n'
            f'iffalse {label}\n')


def numeric_wrap(local: int, callback: str, label: str,
                 extra: str = '') -> str:
    """Wrap one number; invalid callbacks retain the original operand."""
    function = (f"function(p,k){{try{{return typeof window.{callback}==='function'?"
                f"window.{callback}(p,k):p;}}catch(e){{return p;}}}}")
    arguments = 3 if extra else 2
    return (f'convert_d\nsetlocal {local}\n' + external_guard(label + '_original')
            + f'getlex {EXTERNAL}\npushstring "{function}"\ngetlocal {local}\n'
            + extra + f'callproperty {PUBLIC}, {arguments}\n'
            'dup\npushnull\n' + f'ifne {label}_value\npop\n'
            + f'jump {label}_original\n{label}_value:\nconvert_d\n'
            + f'jump {label}_end\n{label}_original:\ngetlocal {local}\n'
            + f'{label}_end:\n')


def experience(text: str, expected: int) -> str:
    local = int(re.search(r'localcount (\d+)', text)[1])
    text = re.sub(r'localcount \d+', f'localcount {local + 1}', text)
    lines, output, hits = text.splitlines(), [], 0
    for index, line in enumerate(lines):
        output.append(line)
        if not line.startswith('getproperty Multiname("exp",'):
            continue
        if 'multiply' in lines[index + 1:index + 4]:
            continue  # Preserve stored-buff and original double-experience math.
        hits += 1
        output.append(numeric_wrap(local, '__zmxyExperience3', f'exp_{hits}'))
    if hits != expected:
        raise ValueError(f'Experience layout changed: {hits} != {expected}')
    return '\n'.join(output)


def drops(text: str) -> str:
    """Keep original probability gate, task hooks, coordinates and pickup route."""
    local = int(re.search(r'localcount (\d+)', text)[1])
    text = re.sub(r'localcount \d+', f'localcount {local + 1}', text)
    rate = numeric_wrap(11, '__zmxyDropRate', 'drop_rate') + 'setlocal 11\n'
    anchor = 'getlex QName(PackageNamespace("mvc.controllor"),"RandomControllor")'
    if text.count(anchor) != 2 or text.count('ofs0223:\n') != 1:
        raise ValueError('Monster drop layout changed')
    # Numeric wrapper consumes its input; the rate is otherwise an empty stack.
    text = text.replace(anchor, 'getlocal 11\n' + rate + anchor, 1)
    js = ("function(b){try{return typeof window.__zmxyBossDrop3==='function'?"
          "window.__zmxyBossDrop3(b):null;}catch(e){return null;}}")
    code = (external_guard('boss_original') + 'getlocal0\n'
            'getproperty QName(PackageNamespace(""),"isBoss")\n'
            f'iffalse boss_original\ngetlex {EXTERNAL}\npushstring "{js}"\n'
            f'pushtrue\ncallproperty {PUBLIC}, 2\nsetlocal {local}\n'
            f'getlocal {local}\niffalse boss_original\n'
            'findpropstrict QName(PackageNamespace("my"),"FallEquipObj")\n'
            f'getlocal {local}\n'
            'constructprop QName(PackageNamespace("my"),"FallEquipObj"), 1\n'
            'coerce QName(PackageNamespace("my"),"FallEquipObj")\n'
            'setlocal 9\njump boss_spawn\nboss_original:\n')
    pos = text.rindex('setlocal 9\n') + len('setlocal 9\n')
    text = text[:pos] + 'boss_spawn:\n' + text[pos:]
    return text.replace('ofs0223:\n', 'ofs0223:\n' + code)


def strength(text: str, method: str) -> str:
    local = int(re.search(r'localcount (\d+)', text)[1])
    text = re.sub(r'localcount \d+', f'localcount {local + 1}', text)
    if method == 'afterReadStore':
        return text.replace('lessthan', numeric_wrap(
            local, '__zmxyCraftRate', 'strength_actual', 'pushstring "strength"\n')
            + 'lessthan', 1)
    marker = 'pushbyte 100\nmultiply'
    parts = text.split(marker)
    if len(parts) != 4:
        raise ValueError('Strength preview layout changed')
    namespace = re.search(r'QName\((PrivateNamespace\(.*?\)),"changeLuck"\)', text)[1]
    result = parts[0]
    for index in range(3):
        if index < 2:
            result += (f'getlocal0\ncallproperty QName({namespace},"findIfQHS"), 0\n'
                       f'iffalse strength_skip{index}\n')
            result += numeric_wrap(local, '__zmxyCraftRate', f'strength_{index}',
                                   'pushstring "strength"\n')
            result += f'strength_skip{index}:\n'
        result += marker + parts[index + 1]
    return result


def forge_callback(operation: str, label: str) -> str:
    js = ("function(){try{return typeof window.__zmxyForge3==='function'?"
          f"window.__zmxyForge3('{operation}'):null;}}catch(e){{return null;}}}}")
    return (external_guard(label + '_none') + f'getlex {EXTERNAL}\n'
            f'pushstring "{js}"\ncallproperty {PUBLIC}, 1\n'
            f'jump {label}_done\n{label}_none:\npushnull\n{label}_done:\n')


def forge_scope(text: str) -> str:
    if 'try from' in text:
        raise ValueError('Forge scope already contains an exception table')
    text = text.replace('pushscope\n', 'pushscope\n' + forge_callback(
        'enter', 'forge_enter') + 'pop\nforge_try:\n', 1)
    count = 0

    def leave(match: re.Match) -> str:
        nonlocal count
        count += 1
        return forge_callback('leave', f'forge_leave{count}') + 'pop\n' + match[0]

    text = re.sub(r'\breturn(?:value|void)\b', leave, text)
    handler = ('forge_end:\nforge_error:\ngetlocal0\npushscope\n'
               + forge_callback('leave', 'forge_cleanup') + 'pop\nthrow\n')
    return text.replace('end ; code', handler + 'end ; code\n'
                        'try from forge_try to forge_end target forge_error '
                        'type null name null end')


def forge_maximum(text: str) -> str:
    local = int(re.search(r'localcount (\d+)', text)[1])
    text = re.sub(r'localcount \d+', f'localcount {local + 1}', text)
    text = text.replace('pushscope\n', 'pushscope\n' + forge_callback(
        'best', 'forge_best') + f'convert_b\nsetlocal {local}\n', 1)

    def replace(match: re.Match) -> str:
        label = f'forge_roll{match.start()}'
        return (match[0] + f'getlocal {local}\niffalse {label}\npop\n'
                f'pushdouble 1\n{label}:\n')

    text, count = re.subn(r'(callproperty [^\n]*,"getRandom"\), 0\n)', replace, text)
    if count == 0:
        raise ValueError('Expected attribute random rolls')
    return text


def forge_elements(text: str) -> str:
    code = (forge_callback('elements', 'forge_elements')
            + 'dup\npushnull\nifeq forge_random\nreturnvalue\nforge_random:\npop\n')
    return text.replace('pushscope\n', 'pushscope\n' + code, 1)


def patch_features(root: Path, cli: list[str], source: Path,
                   xml: ET.Element) -> Path:
    """Apply only the named historical feature methods to the current game."""
    jobs: list[tuple[str, str, Callable[[str], str]]] = [
        ('base.BaseMonster', 'fallEquip', drops),
        ('base.BaseMonster', 'reduceHp', lambda text: experience(text, 5)),
        ('base.BaseMonster', 'judgeAlive', lambda text: experience(text, 1)),
        ('export.monster.Monster66', 'beMagicAttack', lambda text: experience(text, 3)),
        ('export.monster.Monster69', 'reduceHp', lambda text: experience(text, 5)),
        ('export.monster.Monster111', 'reduceHp', lambda text: experience(text, 5)),
        ('export.strength.Strength', 'afterReadStore',
         lambda text: strength(text, 'afterReadStore')),
        ('export.strength.Strength', 'changeLuck', lambda text: strength(text, 'changeLuck')),
        ('export.strength.Making', 'achieveWhichProduce', forge_scope),
        ('export.strength.Fusion', 'doFusion', forge_scope),
        ('export.strength.Making', 'randomGemAttributeByGemName', forge_maximum),
        *[('my.AllEquipment', name, forge_maximum) for name in
          ['newMyEquipObj', 'initSutraEquipment', 'initSellEquipment', 'initPetEquip',
           'getEupdataSunSutraValueEquip']],
        ('my.AllEquipment', 'initRondomPro', forge_elements),
    ]
    classes = ','.join(dict.fromkeys(job[0] for job in jobs))
    subprocess.run(cli + ['-selectclass', classes, '-format', 'script:pcode',
                         '-export', 'script', str(root / 'feature-pcode'), str(source)],
                   check=True)
    for cls, method, transform in jobs:
        path = root / 'feature-pcode/scripts' / (cls.replace('.', '/') + '.pcode')
        text = transform(extract_method(path.read_text(), method))
        text = re.sub(r'maxstack (\d+)', lambda match:
                      f'maxstack {int(match[1]) + 8}', text)
        patch = root / f'feature-{cls}-{method}.pcode'
        patch.write_text(text)
        target = root / f'feature-{cls}-{method}.swf'
        subprocess.run(cli + ['-replace', str(source), str(target), cls, str(patch),
                             str(method_body_id(xml, cls, method))], check=True)
        source = target
    return source
