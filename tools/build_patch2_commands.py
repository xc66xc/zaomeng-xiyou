"""Build bounded player-local stone and wing-repair command method bodies."""

import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

from build_patch3_commands import registration
from build_patch3_features import extract_method, method_body_id

BRANCH = '''
         if(param2 == null && param1 != null && param1.indexOf("__mac_helper|") == 0) {
            try {
               var macParts:Array = param1.split("|");
               if(macParts.length != 6 || macParts[1].length < 1 || macParts[1].length > 80) return ["invalid",0,0,0];
               if(macParts[1] == "probe" && macParts[2] == "probe") return ["ready",2,0,0];
               var macAction:String = macParts[2];
               var macId:String = macParts[3];
               var macAmount:Number = Number(macParts[4]);
               var macWho:Number = Number(macParts[5]);
               if(!isFinite(macAmount) || macAmount < 1 || macAmount > 999 || macAmount != Math.floor(macAmount) || (macWho != 1 && macWho != 2)) return ["invalid",0,0,0];
               var macPlayer:User = macWho == 1 ? this.player1 : this.player2;
               if(macPlayer == null || macPlayer.roleid < 1 || macPlayer.roleid > 3 || this.playNum < macWho || this.isingamemenu) return ["not_ready",0,0,0];
               if(macPlayer.outlist.length > 0) return ["busy",0,0,0];
               if(macAction == "repair_wings") {
                  if(macId != "xtzy" || macAmount != 1) return ["invalid",0,0,0];
                  var macItems:Array = [];
                  var macEquipment:Array = [];
                  var macFashion:Array = macPlayer.rwlist.concat();
                  var macMoved:Array = [];
                  for each(var macWrong:MyEquipObj in macPlayer.djlist) {
                     if(macWrong.fillName == "xtzy") {
                        if(macWrong.type != "zbcb") return ["invalid",0,0,0];
                        if(macMoved.indexOf(macWrong) < 0) macMoved.push(macWrong);
                        if(macFashion.indexOf(macWrong) < 0) macFashion.push(macWrong);
                     } else macItems.push(macWrong);
                  }
                  for each(macWrong in macPlayer.zblist) {
                     if(macWrong.fillName == "xtzy") {
                        if(macWrong.type != "zbcb") return ["invalid",0,0,0];
                        if(macMoved.indexOf(macWrong) < 0) macMoved.push(macWrong);
                        if(macFashion.indexOf(macWrong) < 0) macFashion.push(macWrong);
                     } else macEquipment.push(macWrong);
                  }
                  if(macMoved.length == 0) return ["ok",0,macPlayer.rwlist.length,0];
                  if(macFashion.length > 25) return ["full",0,macPlayer.rwlist.length,0];
                  macPlayer.djlist = macItems;
                  macPlayer.zblist = macEquipment;
                  macPlayer.rwlist = macFashion;
                  try {
                     this.eventManger.dispatchEvent(new Event("CHANGETXT"));
                     this.eventManger.dispatchEvent(new CommonEvent("RefreshBack"));
                     this.eventManger.dispatchEvent(new CommonEvent("REFRESHBACKPACK"));
                  } catch(macRepairRefreshError:Error) {}
                  return ["ok",macMoved.length,macFashion.length,macMoved.length];
               }
               if(macAction != "add_item" || ["wpqhs1","wpqhs2","wpqhs3","wpqhs4"].indexOf(macId) < 0) return ["invalid",0,0,0];
               var macStack:MyEquipObj = null;
               var macBefore:Number = 0;
               var macFound:int = 0;
               for each(var macStone:MyEquipObj in macPlayer.djlist) {
                  if(macStone.fillName == macId) {
                     macStack = macStone;
                     macBefore = macStone.getENum();
                     macFound++;
                  }
               }
               if(macFound > 1) return ["duplicate_stack",macBefore,macBefore,0];
               if(macBefore + macAmount > 999) return ["limit",macBefore,macBefore,0];
               if(macStack == null) {
                  if(macPlayer.djlist.length >= 25) return ["full",0,0,0];
                  this.allEquip.reNewAll();
                  macStack = this.allEquip.findByName(macId);
                  if(macStack == null) return ["missing",0,0,0];
                  macStack.setNum(int(macAmount) - int(macStack.getENum()));
                  macPlayer.djlist.push(macStack);
               } else {
                  macStack.setNum(int(macAmount));
               }
               try {
                  this.eventManger.dispatchEvent(new Event("CHANGETXT"));
                  this.eventManger.dispatchEvent(new CommonEvent("RefreshBack"));
                  this.eventManger.dispatchEvent(new CommonEvent("REFRESHBACKPACK"));
               } catch(macStoneRefreshError:Error) {}
               return ["ok",macBefore,macStack.getENum(),macAmount];
            } catch(macCommandError:Error) { return ["unknown",0,0,0]; }
         }
'''


def patch_commands(root: Path, cli: list[str], source: Path,
                   xml: ET.Element) -> Path:
    """Transplant two methods; keep the original ABC traits and signatures."""
    work = root / 'commands'
    work.mkdir(parents=True, exist_ok=True)
    subprocess.run(cli + ['-selectclass', 'config.Config', '-export', 'script',
                         str(work / 'original'), str(source)], check=True)
    config = (work / 'original/scripts/config/Config.as').read_text()
    signature = ('      public function putQHsInArray(param1:String, '
                 'param2:Array = null) : Array\n      {')
    if config.count(signature) != 1:
        raise ValueError('Unexpected chapter-two command method signature')
    directory = work / 'compiler-source/config'
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'Config.as').write_text(config.replace(signature, signature + BRANCH))
    compiled = work / 'compiled.swf'
    subprocess.run(cli + ['-importScript', str(source), str(compiled),
                         str(directory.parent)], check=True)
    subprocess.run(cli + ['-selectclass', 'config.Config', '-format', 'script:pcode',
                         '-export', 'script', str(work / 'compiled-pcode'),
                         str(compiled)], check=True)
    original_text = (root / 'pcode/scripts/config/Config.pcode').read_text()
    old = extract_method(original_text, 'putQHsInArray')
    new = extract_method((work / 'compiled-pcode/scripts/config/Config.pcode')
                         .read_text(), 'putQHsInArray')
    header = old.split('\nbody\n', 1)[0]
    if 'flag NEED_ACTIVATION' in new and 'flag NEED_ACTIVATION' not in header:
        header = header.replace('\nmethod\n', '\nmethod\nflag NEED_ACTIVATION\n', 1)
    command = work / 'command.pcode'
    command.write_text(header + '\nbody\n' + new.split('\nbody\n', 1)[1])
    target = work / 'command.swf'
    subprocess.run(cli + ['-replace', str(source), str(target), 'config.Config',
                         str(command), str(method_body_id(xml, 'config.Config',
                                                         'putQHsInArray'))], check=True)
    startup = extract_method((root / 'pcode/scripts/GMain.pcode').read_text(),
                             'processComplete')
    register = work / 'register.pcode'
    register.write_text(registration(startup).replace('__zmxyCommand3', '__zmxyCommand2'))
    result = work / 'registered.swf'
    subprocess.run(cli + ['-replace', str(target), str(result), 'GMain', str(register),
                         str(method_body_id(xml, 'GMain', 'processComplete'))], check=True)
    return result
