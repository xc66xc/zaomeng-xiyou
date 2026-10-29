"""Chapter five: scale eligible PvE damage immediately before HP application."""
import os
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(os.environ['ZMXY_PATCH_WORKDIR']).resolve()
JAVA = os.environ.get('JAVA', 'java')
CLI = [JAVA, '-Xmx2g', '-Djava.awt.headless=true', '-jar', os.environ['FFDEC_JAR']]
CLASS = 'prefabs.controls.DamageControl'
PRIVATE = 'QName(PrivateNamespace("prefabs.controls:DamageControl"),"damage")'
CALLBACK = "function(p,a,t){try{return typeof window.__zmxyAttackPower5==='function'?window.__zmxyAttackPower5(p,a,t):p;}catch(e){return p;}}"
USER_FLAGS = ['isTeam', 'isMultiple', 'isPk', 'isQc', 'isPvP', 'isPvP2', 'isPetPk', 'isPetBrawl', 'isUnionBoss', 'isWorldBoss', 'isFightWorldBoss', 'isUnionWarBoss', 'isLhBoss']
LEVEL_FLAGS = ['isMultiplayer', 'isTeam', 'isP2', 'isVideo', 'isUnionBoss', 'isWorldBoss', 'isUnionWar', 'isPK', 'isQc', 'isXzQc', 'isPvP', 'isPvP2', 'isPvPRobot', 'isPvPVideo', 'isTongTian', 'isPetPk', 'isPetTower', 'isPetLeiTai', 'isPetLeiTaiSee', 'isPetBrawl', 'isPetBrawlSee', 'isPreview', 'isLh']


def prop(name: str) -> str:
    return f'getproperty QName(PackageNamespace(""),"{name}")'


def attacker_guard(owner_local: int) -> list[str]:
    """Accept the local role and its pets or fairies."""
    return [
        'getlocal 135', prop('userVo'), f'setlocal {owner_local}',
        f'getlocal {owner_local}', prop('type'), 'pushstring "role"',
        'ifeq mac_damage_owner',
        f'getlocal {owner_local}', prop('type'), 'pushstring "pet"',
        'ifeq mac_damage_pet_owner',
        f'getlocal {owner_local}',
        'istype QName(PackageNamespace("models.vo"),"FairyUserVO")',
        'iffalse mac_damage_end',
        f'getlocal {owner_local}', prop('addXpUservo'),
        'jump mac_damage_companion_owner',
        'mac_damage_pet_owner:',
        f'getlocal {owner_local}', prop('playerUserVo'),
        'mac_damage_companion_owner:',
        f'setlocal {owner_local}', f'getlocal {owner_local}',
        'iffalse mac_damage_end',
        'mac_damage_owner:', f'getlocal {owner_local}', prop('type'),
        'pushstring "role"', 'ifne mac_damage_end',
        f'getlocal {owner_local}', prop('isMe'), 'iffalse mac_damage_end',
    ]


def main():
    xml = ET.parse(ROOT / 'original.xml').getroot()
    body_id = None
    for abc in xml.iter('abc'):
        strings = list(abc.find('constants/constant_string'))
        names = list(abc.find('constants/constant_multiname'))
        namespaces = list(abc.find('constants/constant_namespace'))
        def resolve(index):
            return strings[int(names[int(index)].get('name_index'))].text
        for instance in abc.find('instance_info'):
            qualified = names[int(instance.get('name_index'))]
            namespace = strings[int(namespaces[int(qualified.get('namespace_index'))].get('name_index'))].text
            if resolve(instance.get('name_index')) == 'DamageControl' and namespace == 'prefabs.controls':
                for trait in instance.findall('./instance_traits/traits/item'):
                    if resolve(trait.get('name_index')) == 'onHurt':
                        body_id = next(i for i, body in enumerate(abc.find('bodies')) if body.get('method_info') == trait.get('method_info'))
    assert body_id is not None
    original = (ROOT / 'pcode/scripts/prefabs/controls/DamageControl.pcode').read_text()
    start = original.index('trait method QName(PrivateNamespace("prefabs.controls:DamageControl"),"onHurt")')
    text = '\n'.join(line.strip() for line in original[start:original.index('end ; method', start) + 12].splitlines())
    count = int(re.search(r'localcount (\d+)', text)[1])
    text = re.sub(r'localcount \d+', f'localcount {count+1}', text)
    text = re.sub(r'maxstack (\d+)', lambda m: f'maxstack {max(6, int(m[1]))}', text)
    anchor = f'''getlocal 135
getlocal0
getproperty {PRIVATE}
getlocal 53
getlex QName(PrivateNamespace("prefabs.controls:DamageControl"),"skill")
callpropvoid QName(PackageNamespace(""),"CalLastDmgByAttackEntity"), 3'''
    assert text.count(anchor) == 1
    code = ['mac_damage_try:', 'getlocal0', f'getproperty {PRIVATE}', 'pushbyte 0', 'ifngt mac_damage_end',
            'getlocal 117', prop('type'), 'pushbyte 3', 'ifeq mac_damage_end']
    code += attacker_guard(count)
    for flag in USER_FLAGS:
        code += [f'getlocal {count}', prop(flag), 'iftrue mac_damage_end']
    code += ['getlocal 53', prop('userVo'), prop('type'),
             'pushstring "monster"', 'ifne mac_damage_end',
             'getlocal 53', prop('userVo'), prop('isMe'), 'iftrue mac_damage_end',
             'getlocal 135', prop('userVo'), prop('campId'), 'getlocal 53', prop('userVo'), prop('campId'), 'ifeq mac_damage_end']
    for local in (135, 53):
        for flag in USER_FLAGS:
            code += [f'getlocal {local}', prop('userVo'), prop(flag), 'iftrue mac_damage_end']
    code += ['getlex QName(PackageNamespace("com.wdcgame.engine.core"),"GameFrame")', prop('battleModelManager'), prop('levelInfo'),
             'astype QName(PackageNamespace("models.vo"),"BattleLevelParam")', f'setlocal {count}', f'getlocal {count}', 'iffalse mac_damage_end']
    for flag in LEVEL_FLAGS:
        code += [f'getlocal {count}', prop(flag), 'iftrue mac_damage_end']
    code += [f'getlocal {count}', prop('Config'), 'callproperty QName(PackageNamespace(""),"isMutilGm"), 0', 'iftrue mac_damage_end',
             'getlex QName(PackageNamespace("flash.external"),"ExternalInterface")', prop('available'), 'iffalse mac_damage_end',
             'getlex QName(PackageNamespace("flash.external"),"ExternalInterface")', f'pushstring "{CALLBACK}"',
             'getlocal0', f'getproperty {PRIVATE}',
             'getlocal 135', prop('userVo'),
             'istype QName(PackageNamespace("models.vo"),"FairyUserVO")',
             'iffalse mac_damage_regular_type', 'pushstring "fairy"',
             'jump mac_damage_attacker_type', 'mac_damage_regular_type:',
             'getlocal 135', prop('userVo'), prop('type'),
             'mac_damage_attacker_type:', 'pushstring "monster"',
             'callproperty QName(PackageNamespace(""),"call"), 4', 'dup', 'pushnull', 'ifne mac_damage_set', 'pop', 'jump mac_damage_end',
             'mac_damage_set:', f'setlocal {count}', f'getlocal {count}', 'istype QName(PackageNamespace(""),"Number")', 'iffalse mac_damage_end',
             'findpropstrict QName(PackageNamespace(""),"isFinite")', f'getlocal {count}', 'callproperty QName(PackageNamespace(""),"isFinite"), 1', 'iffalse mac_damage_end',
             f'getlocal {count}', 'pushbyte 0', 'ifngt mac_damage_end',
             'getlocal0', f'getlocal {count}', 'convert_d', f'setproperty {PRIVATE}', 'mac_damage_end:']
    text = text.replace(anchor, '\n'.join(code) + '\n' + anchor)
    text = text.replace('end ; code', 'mac_damage_catch:\npop\ngetlocal0\npushscope\njump mac_damage_end\nend ; code')
    text = text.replace('end ; body', 'try from mac_damage_try to mac_damage_end target mac_damage_catch type null name null end\nend ; body')
    patch = ROOT / 'onHurt.pcode'
    patch.write_text(text)
    subprocess.run(CLI + ['-replace', str(ROOT / 'original.swf'), str(ROOT / 'release.swf'), CLASS, str(patch), str(body_id)], check=True)


if __name__ == '__main__':
    main()
