"""Add explicit, bounded local inventory commands without changing ABC traits.

The compiler consumes a locally exported game source. Only two method bodies are
transplanted back; neither the decompiled source nor complete game is distributed.
"""

import json
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path


def method_body(root: ET.Element, package: str, cls: str, method: str) -> int:
    """Resolve the original instance method's body index by qualified name."""
    for abc in root.iter('abc'):
        constants = abc.find('constants')
        strings = list(constants.find('constant_string'))
        names = list(constants.find('constant_multiname'))
        spaces = list(constants.find('constant_namespace'))
        for instance in abc.find('instance_info'):
            identity = names[int(instance.get('name_index'))]
            namespace = spaces[int(identity.get('namespace_index'))]
            if (strings[int(namespace.get('name_index'))].text or '',
                    strings[int(identity.get('name_index'))].text) != (package, cls):
                continue
            for trait in instance.findall('./instance_traits/traits/item'):
                name = names[int(trait.get('name_index'))]
                if strings[int(name.get('name_index'))].text != method:
                    continue
                return next(i for i, body in enumerate(abc.find('bodies'))
                            if body.get('method_info') == trait.get('method_info'))
    raise ValueError(f'Method not found: {package}.{cls}.{method}')


def extract_method(text: str, method: str) -> str:
    """Extract one instance method while retaining its namespace and signature."""
    match = re.search(r'trait method [^\n]*,"' + re.escape(method) + r'"\)', text)
    if match is None:
        raise ValueError(f'Exported method missing: {method}')
    end = text.index('end ; method', match.start()) + len('end ; method')
    return '\n'.join(line.strip() for line in text[match.start():end].splitlines())


def command_branch(catalog: list[dict]) -> str:
    """Generate the self-written whitelist and transaction preconditions."""
    allowed = [item['id'] for item in catalog if item['kind'] == 'item']
    return '''
         if(inarr == null && _name != null && _name.indexOf("__mac_helper|") == 0) {
            try {
               var macParts:Array = _name.split("|");
               if(macParts.length != 5 || macParts[1].length < 1 || macParts[1].length > 80) return ["invalid",0,0,0];
               var macAction:String = macParts[2];
               if(macAction == "probe" && macParts[1] == "probe") return ["ready",2,0,0];
               var macId:String = macParts[3];
               var macAmount:Number = Number(macParts[4]);
               if(macAmount < 1 || macAmount > 9999 || macAmount != Math.floor(macAmount) || !isFinite(macAmount)) return ["invalid",0,0,0];
               var macOwner:User = this.player1;
               if(macOwner == null || macOwner.roleid < 1 || macOwner.roleid > 4 || this.playNum < 1 || !this.isSingleGame() || this.isInWeiPk()) return ["not_ready",0,0,0];
               if(macOwner.outlist.length > 0) return ["busy",0,0,0];
               var macBefore:Number = 0;
               if(macAction == "pet_potential") {
                  if(macId != "pet_potential") return ["invalid",0,0,0];
                  var macPet:Object = macOwner.findCurrentPet(true);
                  if(macPet == null && macOwner.petsAry.length == 1) macPet = macOwner.petsAry[0];
                  if(macPet == null) return ["missing",0,0,0];
                  macBefore = macPet.getpotential();
                  if(macBefore > 4294967295 - macAmount) return ["limit",macBefore,macBefore,0];
                  macPet.setpotential(macBefore + macAmount);
                  return ["ok",macBefore,macPet.getpotential(),macAmount];
               }
               if(macAction != "add_item") return ["invalid",0,0,0];
               var macEquipment:Boolean = macId == "qlg" || macId == "_lsyxpt";
               var macAllowed:Array = ALLOWED_ITEMS;
               if(!macEquipment && macAllowed.indexOf(macId) < 0) return ["invalid",0,0,0];
               if(macEquipment && macAmount > (macId == "qlg" ? 1 : 27)) return ["invalid",0,0,0];
               if(macId == "qlg" && macOwner.roleid != 1) return ["not_ready",0,0,0];
               var macList:Array = macEquipment ? macOwner.zblist : macOwner.djlist;
               var macStack:MyEquipObj = null;
               var macMatches:int = 0;
               for each(var macEntry:MyEquipObj in macList) {
                  if(macEntry.getFillName() == macId) {
                     macBefore += macEquipment ? 1 : macEntry.getENum();
                     macStack = macEntry;
                     macMatches++;
                  }
               }
               if(!macEquipment && macMatches > 1) return ["duplicate_stack",macBefore,macBefore,0];
               if(!macEquipment && macBefore > 2147483647 - macAmount) return ["limit",macBefore,macBefore,0];
               var macSlots:int = macEquipment ? int(macAmount) : (macStack == null ? 1 : 0);
               if(macList.length + macSlots > macOwner.getMax()) return ["full",macBefore,macBefore,0];
               var macNext:Array = macList.concat();
               if(macEquipment) {
                  for(var macIndex:int = 0; macIndex < macAmount; macIndex++) {
                     var macNew:MyEquipObj = this.allEquip.findByName(macId);
                     if(macNew == null) return ["missing",macBefore,macBefore,0];
                     if(macId == "qlg") {
                        macNew.seteatt(350);
                        macNew.setstrengthValue(0);
                     }
                     macNew.setnum(1);
                     macNext.push(macNew);
                  }
                  macOwner.zblist = macNext;
               } else {
                  if(macStack == null) {
                     macStack = this.allEquip.findByName(macId);
                     if(macStack == null) return ["missing",macBefore,macBefore,0];
                     macStack.setnum(macAmount);
                     macNext.push(macStack);
                     macOwner.djlist = macNext;
                  } else {
                     macStack.setnum(macBefore + macAmount);
                  }
               }
               try {this.eventManger.dispatchEvent(new Event("CHANGETXT"));this.eventManger.dispatchEvent(new CommonEvent("REFRESHBACKPACK"));} catch(macRefreshError:Error) {}
               return ["ok",macBefore,macBefore + macAmount,macAmount];
            } catch(macCommandError:Error) {
               return ["unknown",0,0,0];
            }
         }
'''.replace('ALLOWED_ITEMS', json.dumps(allowed, separators=(',', ':')))


def registration(text: str) -> str:
    """Register the bridge without letting registration failure break startup."""
    if 'try from' in text:
        raise ValueError('Unexpected exception layout in GMain.processComplete')
    text = re.sub(r'maxstack (\d+)',
                  lambda match: f'maxstack {max(4, int(match[1]))}', text)
    returns = text.count('returnvoid')
    if returns != 1:
        raise ValueError(f'Expected one startup return, found {returns}')
    code = '''mac_register_try:
getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
getproperty QName(PackageNamespace(""),"available")
iffalse mac_register_done
getlex QName(PackageNamespace("flash.external"),"ExternalInterface")
pushstring "__zmxyCommand3"
getlex QName(PackageNamespace("config"),"Config")
callproperty QName(PackageNamespace(""),"getInstance"), 0
getproperty QName(PackageNamespace(""),"putQHsInArray")
callpropvoid QName(PackageNamespace(""),"addCallback"), 2
mac_register_end:
jump mac_register_done
mac_register_error:
pop
getlocal0
pushscope
mac_register_done:
returnvoid'''
    text = text.replace('returnvoid', code)
    return text.replace('end ; body',
                        'try from mac_register_try to mac_register_end '
                        'target mac_register_error type null name null end\n'
                        'end ; body')


def patch_commands(root: Path, cli: list[str], source: Path,
                   xml: ET.Element) -> Path:
    """Compile only the command method and transplant it into the current SWF."""
    work = root / 'commands'
    work.mkdir(parents=True, exist_ok=True)
    catalog_path = Path(__file__).resolve().parents[1] / 'zm5-only/zm3-items.json'
    catalog = json.loads(catalog_path.read_text())
    subprocess.run(cli + ['-selectclass', 'config.Config', '-export', 'script',
                         str(work / 'original'), str(source)], check=True)
    config = (work / 'original/scripts/config/Config.as').read_text()
    signature = ('      public function putQHsInArray(_name:String, '
                 'inarr:Array = null, num:int = 1, _isshop:Boolean = false, '
                 '_isask:Boolean = false, _player:User = null) : Array\n      {')
    if config.count(signature) != 1:
        raise ValueError('Unexpected Config command signature')
    config = config.replace('   import event.AEventDispatcher;',
                            '   import event.AEventDispatcher;\n   import event.CommonEvent;')
    config = config.replace(signature, signature + command_branch(catalog))
    # FFDec cannot resolve this unrelated singleton call while compiling Config.
    # The compiler's constructor is never transplanted into the actual game.
    config = config.replace('ContinuitySignIn.getIns().init();', '')
    compile_dir = work / 'compiler-source/config'
    compile_dir.mkdir(parents=True, exist_ok=True)
    (compile_dir / 'Config.as').write_text(config)
    compiled = work / 'compiled.swf'
    subprocess.run(cli + ['-importScript', str(source), str(compiled),
                         str(compile_dir.parent)], check=True)
    subprocess.run(cli + ['-selectclass', 'config.Config', '-format', 'script:pcode',
                         '-export', 'script', str(work / 'compiled-pcode'),
                         str(compiled)], check=True)
    command_text = (work / 'compiled-pcode/scripts/config/Config.pcode').read_text()
    subprocess.run(cli + ['-selectclass', 'config.Config', '-format', 'script:pcode',
                         '-export', 'script', str(work / 'original-pcode'),
                         str(source)], check=True)
    original_text = (work / 'original-pcode/scripts/config/Config.pcode').read_text()
    original_header = extract_method(original_text, 'putQHsInArray').split('\nbody\n', 1)[0]
    compiled_method = extract_method(command_text, 'putQHsInArray')
    # Keep method/parameter names and original trait metadata. The new catch
    # scope requires NEED_ACTIVATION; all existing flags remain intact.
    if 'flag NEED_ACTIVATION' in compiled_method:
        original_header = original_header.replace('\nmethod\n',
                                                  '\nmethod\nflag NEED_ACTIVATION\n', 1)
    command_patch = work / 'command.pcode'
    command_patch.write_text(original_header + '\nbody\n'
                             + compiled_method.split('\nbody\n', 1)[1])
    command_target = work / 'command.swf'
    subprocess.run(cli + ['-replace', str(source), str(command_target),
                         'config.Config', str(command_patch),
                         str(method_body(xml, 'config', 'Config', 'putQHsInArray'))],
                   check=True)
    subprocess.run(cli + ['-selectclass', 'GMain', '-format', 'script:pcode',
                         '-export', 'script', str(work / 'main-pcode'),
                         str(source)], check=True)
    main_text = (work / 'main-pcode/scripts/GMain.pcode').read_text()
    main_patch = work / 'register.pcode'
    main_patch.write_text(registration(extract_method(main_text, 'processComplete')))
    target = work / 'registered.swf'
    subprocess.run(cli + ['-replace', str(command_target), str(target), 'GMain',
                         str(main_patch),
                         str(method_body(xml, '', 'GMain', 'processComplete'))],
                   check=True)
    return target
