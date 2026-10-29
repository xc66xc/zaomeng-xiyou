"""Rebuild the local V58.8 role PvE damage patch from a verified original SWF."""
import hashlib
import os
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

from make_delta import unpack

CLASS = 'models.managers.BattleModelManager'
SOURCE_HASH = 'ca289d3cd34f12f304a2c37fa3396c8bd930d84be85ca49458b4493accf0b711'
METHODS = ('calPhysicalDamage', 'calSkillDamage')
CALLBACK = (
    "function(p,a,t,team,pk,tp,boss){try{return typeof "
    "window.__zmxyAttackPower4==='function'?"
    "window.__zmxyAttackPower4(p,a,t,team,pk,tp,boss):p;}catch(e){return p;}}"
)


def method_ids(xml: ET.Element) -> dict[str, int]:
    """Resolve method-body indices without assuming version-dependent IDs."""
    found: dict[str, int] = {}
    for abc in xml.iter('abc'):
        strings = list(abc.find('constants/constant_string'))
        names = list(abc.find('constants/constant_multiname'))
        spaces = list(abc.find('constants/constant_namespace'))
        for instance in abc.find('instance_info'):
            name = names[int(instance.get('name_index'))]
            package = spaces[int(name.get('namespace_index'))]
            qualified = (strings[int(package.get('name_index'))].text,
                         strings[int(name.get('name_index'))].text)
            if qualified != ('models.managers', 'BattleModelManager'):
                continue
            for trait in instance.findall('./instance_traits/traits/item'):
                method = strings[int(names[int(trait.get('name_index'))]
                                     .get('name_index'))].text
                if method in METHODS:
                    found[method] = next(
                        i for i, body in enumerate(abc.find('bodies'))
                        if body.get('method_info') == trait.get('method_info')
                    )
    if set(found) != set(METHODS):
        raise ValueError('Expected physical and skill damage methods not found')
    return found


def patch_tail(base: int, candidate: int) -> str:
    """Keep the original int in a separate local for every bridge failure."""
    return f'''mac_damage_return:
convert_i
setlocal {base}
mac_damage_try:
getlocal1
getproperty QName(PackageNamespace(""),"type")
pushstring "role"
ifne mac_original
getlex QName(PackageNamespace("models.managers"),"UserModelManager")
callproperty QName(PackageNamespace(""),"getIns"), 0
getlocal1
callproperty QName(PackageNamespace(""),"isMe"), 1
iffalse mac_original
getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
getproperty QName(PackageNamespace(""),"available")
iffalse mac_original
getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
pushstring "{CALLBACK}"
getlocal {base}
getlocal1
getproperty QName(PackageNamespace(""),"type")
getlocal2
getproperty QName(PackageNamespace(""),"type")
getlocal0
getproperty QName(PackageNamespace(""),"isTeam")
getlocal1
getproperty QName(PackageNamespace(""),"isPk")
getlocal2
getproperty QName(PackageNamespace(""),"isPk")
getlocal2
getproperty QName(PackageNamespace(""),"isPKBoss")
callproperty QName(PackageNamespace(""),"call"), 8
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
mac_damage_try_end:
mac_damage_catch:
pop
getlocal0
pushscope
jump mac_original
mac_modified:
getlocal {candidate}
convert_i
returnvalue
mac_original:
getlocal {base}
returnvalue
'''


def patch_method(source: str, method: str) -> str:
    anchor = (
        'trait method QName(PrivateNamespace('
        f'"models.managers:BattleModelManager"),"{method}")'
    )
    start = source.index(anchor)
    end = source.index('end ; method', start) + len('end ; method')
    text = '\n'.join(line.strip() for line in source[start:end].splitlines())
    count = int(re.search(r'localcount (\d+)', text)[1])
    if text.count('returnvalue') != 1 or 'try from' in text:
        raise ValueError('Unexpected damage return/exception layout')
    text = re.sub(r'localcount \d+', f'localcount {count + 2}', text)
    text = re.sub(r'maxstack (\d+)',
                  lambda m: f'maxstack {max(10, int(m[1]))}', text)
    text = text.replace('returnvalue', 'jump mac_damage_return')
    text = text.replace('end ; code', patch_tail(count, count + 1) + 'end ; code')
    handler = ('try from mac_damage_try to mac_damage_try_end '
               'target mac_damage_catch type null name null end\n')
    return text.replace('end ; body', handler + 'end ; body')


def main() -> None:
    root = Path(os.environ['ZMXY_PATCH_WORKDIR']).resolve()
    original = root / 'original.swf'
    if hashlib.sha256(unpack(original)).hexdigest() != SOURCE_HASH:
        raise ValueError('Only the verified official V58.8 input is supported')
    cli = [os.environ.get('JAVA', 'java'), '-Xmx2g', '-Djava.awt.headless=true',
           '-jar', os.environ['FFDEC_JAR']]
    ids = method_ids(ET.parse(root / 'original.xml').getroot())
    pcode = root / 'pcode/scripts/models/managers/BattleModelManager.pcode'
    source_text = pcode.read_text()
    source = original
    for method in METHODS:
        patch = root / f'{method}.pcode'
        patch.write_text(patch_method(source_text, method))
        target = root / f'{method}.swf'
        subprocess.run(cli + ['-replace', str(source), str(target), CLASS,
                             str(patch), str(ids[method])], check=True)
        source = target
    (root / 'release.swf').write_bytes(source.read_bytes())


if __name__ == '__main__':
    main()
