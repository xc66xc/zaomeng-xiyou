'use strict';
// Windows host for the existing game-independent bridge and patch rules.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {execFile, spawn} = require('node:child_process');
const {promisify} = require('node:util');
const {setTimeout:delay} = require('node:timers/promises');
const execute = promisify(execFile);
const MAX = 32_000_000;
const TOPIC = 'https://www.4399.com/flash/zmhj.htm';
const AUTO_BASE = 'https://sda.4399.com/4399swf/upload_swf/ftp22/csya/20170622/1/';
const START = '// ZMXY_DROP_CONTROL_BEGIN\n';
const END = '// ZMXY_DROP_CONTROL_END\n';
const CHAPTERS = {
  zm1:{protocol:'zm1-helper-1.0',file:'v25928',recipe:'patch-zm1-v25928.json',base:'https://sbai.4399.com/4399swf/upload_swf/ftp5/hanbao/20110624/3/',suffix:'.htm'},
  zm2:{protocol:'zm2-helper-1.0',file:'v25928',recipe:'patch-v25928.json',base:'https://sbai.4399.com/4399swf/upload_swf/ftp6/hanbao/20110927/4/',suffix:'.htm'},
  zm3:{protocol:'zm3-helper-2.0',file:'v261029',recipe:'patch-v261029.json',base:'https://sda.4399.com/4399swf/upload_swf/ftp7/hanbao/20120107/6/',suffix:'.htm'},
  zm4:{protocol:'zm4-attack-1.0',file:'v5880',recipe:'patch-v5880.json',base:'https://sda.4399.com/4399swf/upload_swf/ftp15/csya/20150127/1/',suffix:'gg.htm'},
  zm5:{protocol:'zm5-attack-1.2'}
};
const BRIDGE_FILES = ['bridge.cjs','attack.cjs','auto-manifest.cjs','zm2-items.json','boss-items-zm2.json','zm3-items.json','boss-items-zm3.json'];
const ELEMENTS = new Set(['','jin','mu','shui','huo','tu','jin+mu','jin+shui','jin+huo','jin+tu','mu+shui','mu+huo','mu+tu','shui+huo','shui+tu','huo+tu']);
function failure(message, code = 'INVALID') { return Object.assign(new Error(message),{code}); }
function chapter(game) { if (!Object.hasOwn(CHAPTERS,game)) throw failure('章节无效。');return CHAPTERS[game]; }
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function settingsFile(game) { return game === 'zm5' ? 'settings.json' : `settings-${game}.json`; }
function statusFile(game) { return game === 'zm5' ? 'status.json' : `status-${game}.json`; }
function liveProcessIds(records) {
  // CIM can retain an exited Electron process while another process holds its
  // handle. Such a process has no threads and cannot own an active game window.
  return (Array.isArray(records)?records:[records]).filter(value=>value&&
    Number.isSafeInteger(value.ProcessId)&&value.ProcessId>0&&
    Number.isSafeInteger(value.ThreadCount)&&value.ThreadCount>0).map(value=>value.ProcessId);
}
function defaults(game) {
  const value={game,protocol:chapter(game).protocol,attack_multiplier:1};
  if (['zm1','zm2','zm3'].includes(game)) Object.assign(value,{mode:'original',multiplier:1});
  if (['zm2','zm3'].includes(game)) Object.assign(value,{boss_drop_enabled:false,boss_drop_item:'',strength_guaranteed:false});
  if (game==='zm2') value.fusion_guaranteed=false;
  if (game==='zm3') Object.assign(value,{experience_multiplier:1,craft_max_attributes:false,craft_elements:''});
  return value;
}
function integer(value, maximum, label) {
  if (!Number.isSafeInteger(value)||value<1||value>maximum) throw failure(`${label}请输入 1～${maximum} 的整数。`);
}
function validateConfig(game, previous, values, catalogs) {
  chapter(game);
  if (!values||typeof values!=='object'||Array.isArray(values)) throw failure('设置格式无效。');
  const allowed=defaults(game), result={...previous};
  for (const [key,value] of Object.entries(values)) {
    if (!Object.hasOwn(allowed,key)||['game','protocol'].includes(key)) throw failure('此章节不支持该设置：'+key);
    if (key==='attack_multiplier') integer(value,2147483647,'攻击倍率');
    else if (['multiplier','experience_multiplier'].includes(key)) integer(value,1000,key==='multiplier'?'爆率倍率':'经验倍率');
    else if (key==='mode') {if (!['original','multiplier','guaranteed'].includes(value)) throw failure('爆率模式无效。');}
    else if (key==='boss_drop_item') {if (value!==''&&!catalogs[game]?.boss.some(item=>item.id===value)) throw failure('Boss物品不在白名单中。');}
    else if (key==='craft_elements') {if (!ELEMENTS.has(value)) throw failure('法宝五行无效。');}
    else if (typeof value!=='boolean') throw failure('开关值无效。');
    result[key]=value;
  }
  if (result.boss_drop_enabled&&!catalogs[game]?.boss.some(item=>item.id===result.boss_drop_item)) throw failure('请先选择Boss掉落物品。');
  return result;
}
async function boundedFile(file,limit=MAX) {
  const stat=await fs.lstat(file);
  if (!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>limit) throw failure('文件大小或类型无效。');
  const handle=await fs.open(file,'r');
  try {
    const bytes=Buffer.alloc(stat.size+1);let cursor=0;
    while (cursor<bytes.length) {const {bytesRead}=await handle.read(bytes,cursor,bytes.length-cursor,cursor);if(!bytesRead)break;cursor+=bytesRead;}
    if(cursor!==stat.size)throw failure('读取时文件发生变化。');
    return bytes.subarray(0,cursor);
  } finally {await handle.close();}
}
async function atomicWrite(file,bytes) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  try {await fs.writeFile(temporary,bytes,{mode:0o600});await fs.rename(temporary,file);}
  finally {await fs.rm(temporary,{force:true}).catch(()=>{});}
}
async function unpack(input) {
  if (!Buffer.isBuffer(input)||input.length<8||input.length>MAX) throw failure('游戏文件无效。');
  const size=input.readUInt32LE(4),signature=input.toString('ascii',0,3);
  if(size<8||size>MAX)throw failure('游戏文件解压大小无效。');
  if(signature==='FWS') {if(size!==input.length)throw failure('游戏文件长度不符。');return input;}
  let body;
  if(signature==='CWS') body=zlib.inflateSync(input.subarray(8),{maxOutputLength:size-8});
  else if(signature==='ZWS') {
    // SWF CompressedLength counts the payload after the five LZMA properties.
    if(input.length<=17||input.readUInt32LE(8)!==input.length-17||input.readUInt32LE(13)>64*1024*1024)throw failure('LZMA游戏文件头无效。');
    const header=Buffer.alloc(13);input.copy(header,0,12,17);header.writeBigUInt64LE(BigInt(size-8),5);
    const compressed=Buffer.concat([header,input.subarray(17)]);
    body=await new Promise((resolve,reject)=>require('lzma').decompress(compressed,(result,error)=>error?reject(failure('LZMA游戏文件解压失败。')):resolve(Buffer.from(result))));
  } else throw failure('请选择有效的官方 SWF 文件。');
  if(body.length!==size-8)throw failure('游戏文件解压长度不符。');
  return Buffer.concat([Buffer.from('FWS'),input.subarray(3,8),body]);
}
function applyOperations(source, recipe) {
  if (!recipe||!Number.isSafeInteger(recipe.resultSize)||recipe.resultSize<8||recipe.resultSize>MAX||hash(source)!==recipe.sourceHash||!Array.isArray(recipe.operations)) throw failure('游戏文件版本或校验不符。');
  let size=0;const parts=[];
  for(const op of recipe.operations) {
    let bytes;
    if(op&&typeof op.add==='string'&&op.offset===undefined&&op.length===undefined&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(op.add)) bytes=Buffer.from(op.add,'base64');
    else if(op&&op.add===undefined&&Number.isSafeInteger(op.offset)&&Number.isSafeInteger(op.length)&&op.offset>=0&&op.length>=0&&op.offset<=source.length&&op.length<=source.length-op.offset) bytes=source.subarray(op.offset,op.offset+op.length);
    else throw failure('本地补丁指令无效。');
    if(bytes.length>recipe.resultSize-size)throw failure('本地补丁超出大小限制。');
    parts.push(bytes);size+=bytes.length;
  }
  const result=Buffer.concat(parts,size);
  if(size!==recipe.resultSize||hash(result)!==recipe.resultHash)throw failure('补丁生成后的校验不符。');
  return result;
}
async function applyRecipe(input, recipe) {
  const source=await unpack(input);
  if(recipe.resultSize===source.length&&hash(source)===recipe.resultHash)return source;
  if(hash(source)!==recipe.sourceHash)throw failure('游戏文件版本或校验不符，请选择所选章节支持的官方原始 SWF。');
  if(!recipe.embedded)return applyOperations(source,recipe);
  if(!Array.isArray(recipe.operations)||recipe.operations.length||!Number.isSafeInteger(recipe.embedded.binaryID)||recipe.embedded.binaryID<0||recipe.embedded.binaryID>65535||source.length<13)throw failure('嵌套补丁格式无效。');
  const embedded=recipe.embedded;
  let cursor=8+Math.ceil((5+4*(source[8]>>3))/8)+4, selected;
  while(cursor<source.length) {
    const start=cursor;
    if(cursor+2>source.length)throw failure('SWF标签截断。');
    const word=source.readUInt16LE(cursor),code=word>>6;let length=word&63;cursor+=2;
    if(length===63){if(cursor+4>source.length)throw failure('SWF标签截断。');length=source.readUInt32LE(cursor);cursor+=4;}
    if(length>source.length-cursor)throw failure('SWF标签大小无效。');
    if(code===87) {
      if(length<6)throw failure('SWF嵌套标签无效。');
      if(source.readUInt16LE(cursor)===embedded.binaryID) {
        if(selected||length<14)throw failure('SWF嵌套目标不唯一。');
        selected={start,payload:cursor,end:cursor+length};
      }
    }
    cursor+=length;if(code===0)break;
  }
  if(!selected)throw failure('找不到SWF嵌套目标。');
  const inner=await unpack(source.subarray(selected.payload+6,selected.end));
  const changed=applyOperations(inner,embedded),header=Buffer.alloc(6);
  header.writeUInt16LE((87<<6)|63);header.writeUInt32LE(6+changed.length,2);
  const result=Buffer.concat([source.subarray(0,selected.start),header,source.subarray(selected.payload,selected.payload+6),changed,source.subarray(selected.end)]);
  result.writeUInt32LE(result.length,4);
  if(result.length!==recipe.resultSize||result.length>MAX||hash(result)!==recipe.resultHash)throw failure('嵌套补丁生成后的校验不符。');
  return result;
}
async function fetchBounded(url,referer,maximum=MAX) {
  const address=new URL(url);
  if(address.protocol!=='https:'||!['www.4399.com','sda.4399.com','sbai.4399.com'].includes(address.hostname)||address.username||address.password||address.port)throw failure('下载地址不是支持的官方源。');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
  try {
    const response=await fetch(address,{redirect:'manual',signal:controller.signal,headers:{'Cache-Control':'no-cache',...(referer?{Referer:referer}:{})}});
    const expected=Number(response.headers.get('content-length'));
    if(response.status!==200||expected>maximum)throw failure('官方源响应状态或文件大小无效，未继续下载。');
    const parts=[];let length=0;
    for await (const part of response.body) {length+=part.length;if(length>maximum){controller.abort();throw failure('官方文件超过大小限制。');}parts.push(part);}
    if(!length)throw failure('官方源返回空文件。');
    return Buffer.concat(parts,length);
  } finally {clearTimeout(timer);}
}
function frameURL(bytes) {
  if(bytes.length>2_500_000)throw failure('官方专题页面过大。');
  const matches=new Set([...bytes.toString('utf8').matchAll(/game_url_arr\s*\[\s*5\s*\]\s*=\s*['"]([^'"]+)['"]/gi)].map(m=>m[1]));
  const value=[...matches][0];
  if(matches.size!==1||!new RegExp('^'+AUTO_BASE.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'v[0-9]{3,12}[a-z]{0,8}\\.htm$').test(value))throw failure('无法唯一识别造梦5官方入口，未使用旧版地址。');
  return value;
}
function discovery(frame,bytes) {
  if(bytes.length>2_500_000||frameURL(Buffer.from(`game_url_arr[5]='${frame}'`))!==frame)throw failure('官方游戏页面无效。');
  const pattern=new RegExp('^'+AUTO_BASE.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'v[0-9]{3,12}\\.swf$');
  const values=new Set();
  for(const match of bytes.toString('utf8').matchAll(/(?:src|value)\s*=\s*['"]([^'"]+\.swf)['"]/gi)) {
    try {const url=new URL(match[1],frame).href;if(pattern.test(url))values.add(url);}catch{}
  }
  const gameURL=[...values][0];
  if(values.size!==1||path.posix.basename(new URL(frame).pathname).match(/^v\d+/)[0]!==path.posix.basename(new URL(gameURL).pathname,'.swf'))throw failure('官方游戏文件路径不明确或与版本不符。');
  return {frameURL:frame,gameURL,filename:path.posix.basename(new URL(gameURL).pathname)};
}
async function inspectClient(exe) {
  if(typeof exe!=='string'||!path.isAbsolute(exe)||path.extname(exe).toLowerCase()!=='.exe')throw failure('请选择已安装的兼容 Windows 客户端 EXE。');
  const executable=await fs.realpath(exe),stat=await fs.stat(executable);
  if(!stat.isFile())throw failure('客户端 EXE 无效。');
  const app=path.join(path.dirname(executable),'resources','app');
  const main=path.join(app,'main.js'),config=path.join(app,'config.json');
  await boundedFile(main,2_000_000).catch(()=>{throw failure('此客户端不兼容。需要 resources/app/main.js 的 Electron 微端，不能选择安装程序或普通浏览器。');});
  const configuration=JSON.parse((await boundedFile(config,1_000_000)).toString('utf8'));
  if(!configuration||typeof configuration!=='object'||Array.isArray(configuration)||typeof configuration.appUrl!=='string')throw failure('客户端配置格式不兼容。');
  const pluginDirectories=[path.join(app,'plugins'),path.join(path.dirname(executable),'plugins'),path.join(path.dirname(executable),'PepperFlash')];
  let flash=false;
  async function scan(folder,depth=0) {
    const entries=await fs.readdir(folder,{withFileTypes:true}).catch(()=>[]);
    for(const entry of entries.slice(0,256)) {
      if(entry.isSymbolicLink())continue;
      if(entry.isFile()&&/^(pepflashplayer.*|pepperflash.*)\.dll$/i.test(entry.name))flash=true;
      if(entry.isDirectory()&&depth<2)await scan(path.join(folder,entry.name),depth+1);
    }
  }
  for(const folder of pluginDirectories)await scan(folder);
  if(!flash)throw failure('此客户端缺少 PepperFlash DLL。请选择从官方安装的旧版 Electron/Flash 兼容客户端。');
  return {exe:executable,app,main,config};
}

class HelperService {
  constructor({support,resources,fetcher=fetchBounded,processQuery,launcher}={}) {
    if(!support||!resources)throw failure('助手路径未配置。');
    this.support=path.resolve(support);this.resources=path.resolve(resources);this.fetcher=fetcher;
    this.processQuery=processQuery;this.launcher=launcher;this.clientPath='';this.client=null;this.clientError='';this.running=false;this.displayMode='native';
    this.configs=Object.fromEntries(Object.keys(CHAPTERS).map(game=>[game,defaults(game)]));
    this.catalogs={};this.statuses={};this.commandMessages={};this.pending={};this.pids=new Set();
    this.closed=false;this.queue=Promise.resolve();this.queryAt=0;
  }
  async initialize() {
    await fs.mkdir(this.support,{recursive:true});
    for(const game of ['zm2','zm3']) {
      const boss=JSON.parse((await boundedFile(path.join(this.resources,`boss-items-${game}.json`),1_000_000)).toString('utf8'));
      const items=JSON.parse((await boundedFile(path.join(this.resources,`${game}-items.json`),1_000_000)).toString('utf8'));
      if(!Array.isArray(boss)||!Array.isArray(items)||boss.some(item=>typeof item.id!=='string'||typeof item.bigtype!=='string')||items.some(item=>!Number.isSafeInteger(item.max_amount)||item.max_amount<1||item.max_amount>9999||!/^[A-Za-z0-9_]+$/.test(item.id)))throw failure('物品白名单格式无效。');
      this.catalogs[game]={boss,items};
    }
    let saved;
    const warn=error=>{this.clientError='上次选择的客户端无法使用，请重新选择兼容客户端：'+String(error.message||error);};
    try {saved=JSON.parse((await boundedFile(path.join(this.support,'windows-client.json'),16000)).toString('utf8'));}
    catch(error){if(error.code!=='ENOENT')warn(error);}
    if(saved!==undefined)try {this.client=await inspectClient(saved?.path);this.clientPath=this.client.exe;}catch(error){warn(error);}
    try {
      const display=JSON.parse((await boundedFile(path.join(this.support,'windows-display.json'),16000)).toString('utf8'));
      if(display?.mode==='native'||display?.mode==='system')this.displayMode=display.mode;
    }catch{}
    await this.tick();return this.snapshot();
  }
  snapshot() { return {clientPath:this.clientPath,clientError:this.clientError,displayMode:this.displayMode,running:this.running,configs:structuredClone(this.configs),statuses:structuredClone(this.statuses),commandMessages:{...this.commandMessages},catalogs:structuredClone(this.catalogs)}; }
  async setDisplayMode(mode) {
    if(mode!=='native'&&mode!=='system')throw failure('显示模式无效，请选择原生像素或跟随系统缩放。');
    await atomicWrite(path.join(this.support,'windows-display.json'),JSON.stringify({mode}));
    this.displayMode=mode;return this.snapshot();
  }
  async selectClient(exe) {
    if(this.clientPath)await this.ensureStopped();
    const selected=await inspectClient(exe);
    const active=await this.queryProcesses(selected.exe);
    if(active.length)throw failure('请先保存并完全退出所选客户端，再选择该 EXE。');
    await atomicWrite(path.join(this.support,'windows-client.json'),JSON.stringify({path:selected.exe}));
    this.client=selected;this.clientPath=selected.exe;this.clientError='';this.queryAt=0;this.statuses={};return this.snapshot();
  }
  async queryProcesses(exe=this.clientPath) {
    if(!exe)return [];
    if(this.processQuery)return this.processQuery(exe);
    if(process.platform!=='win32')return [];
    const script='@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ExecutablePath -eq $env:ZMXY_CLIENT_PATH } | Select-Object ProcessId,ThreadCount) | ConvertTo-Json -Compress';
    try {
      const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000,maxBuffer:65536,env:{...process.env,ZMXY_CLIENT_PATH:exe}});
      const parsed=stdout.trim()?JSON.parse(stdout):[];
      return liveProcessIds(parsed);
    } catch(error) {throw failure('无法检查客户端进程，请确认 Windows PowerShell 可用。');}
  }
  async ensureStopped() {
    if(!this.client)throw failure('请先选择兼容 Windows 客户端 EXE。','NEED_CLIENT');
    const pids=await this.queryProcesses();
    this.pids=new Set(pids);this.running=!!pids.length;
    if(this.running)throw failure('请保存并完全退出游戏，再执行接入或恢复操作。');
  }
  async recipe(game) {return JSON.parse((await boundedFile(path.join(this.resources,chapter(game).recipe),1_000_000)).toString('utf8'));}
  async prepareGame(game,inputPath) {
    const entry=chapter(game);
    if(game==='zm5')return this.prepareFive();
    const recipe=await this.recipe(game);
    if(!inputPath) {
      try {const patched=await applyRecipe(await boundedFile(path.join(this.support,`patched-${game}.swf`)),recipe);return {patched,filename:entry.file+'.swf'};}
      catch {throw failure(`请选择造梦${game.slice(2)}官方 ${entry.file}.swf 文件。`,'NEED_SWF');}
    }
    const original=await unpack(await boundedFile(inputPath));
    const patched=await applyRecipe(original,recipe);return {original,patched,filename:entry.file+'.swf'};
  }
  async prepareFive() {
    const topic=new URL(TOPIC);topic.searchParams.set('zmxy_auto',crypto.randomUUID());
    const frame=frameURL(await this.fetcher(topic.href,null,2_500_000));
    const fresh=new URL(frame);fresh.searchParams.set('zmxy_auto',crypto.randomUUID());
    const discovered=discovery(frame,await this.fetcher(fresh.href,TOPIC,2_500_000));
    const original=await unpack(await this.fetcher(discovered.gameURL,frame,MAX));
    const engine=await boundedFile(path.join(this.resources,'auto-patch.cjs'),2_000_000);
    const ruleBytes=await boundedFile(path.join(this.resources,'auto-patch-rule.json'),2_000_000);
    const sourceHash=hash(original),engineHash=hash(engine),ruleHash=hash(ruleBytes);
    const root=path.join(this.support,'auto-zm5-cache'),name=sourceHash+'-'+engineHash.slice(0,12)+'-'+ruleHash.slice(0,12),folder=path.join(root,name);
    try {
      const record=JSON.parse((await boundedFile(path.join(folder,'manifest.json'),16384)).toString('utf8'));
      const patched=await boundedFile(path.join(folder,'patch.swf'));
      if(record.schema_version===1&&record.game==='zm5'&&record.protocol===CHAPTERS.zm5.protocol&&record.engine_version==='1'&&record.source_hash===sourceHash&&record.engine_hash===engineHash&&record.rule_hash===ruleHash&&record.game_url===discovered.gameURL&&record.frame_url===frame&&hash(patched)===record.result_hash&&(await unpack(patched)).equals(patched))return {original,patched,filename:discovered.filename,manifest:record,reused:true};
    }catch{}
    const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'zmxy-auto-'));
    let patched;
    try {
      const input=path.join(temporary,'source.swf'),output=path.join(temporary,'patch.swf');
      await fs.writeFile(input,original);
      await execute(process.execPath,[path.join(this.resources,'auto-patch.cjs'),input,output,path.join(this.resources,'auto-patch-rule.json')],{windowsHide:true,timeout:45000,maxBuffer:64000,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}).catch(error=>{throw failure('当前游戏结构无法自动适配，未接入游戏。\n'+String(error.stderr||error.message).slice(0,1200));});
      patched=await boundedFile(output);
      if(!(await unpack(patched)).equals(patched)||patched.equals(original))throw failure('自动适配没有生成有效的新补丁。');
    }finally{await fs.rm(temporary,{recursive:true,force:true});}
    const manifest={schema_version:1,game:'zm5',protocol:CHAPTERS.zm5.protocol,game_url:discovered.gameURL,frame_url:frame,source_hash:sourceHash,result_hash:hash(patched),engine_version:'1',engine_hash:engineHash,rule_hash:ruleHash};
    await atomicWrite(path.join(folder,'source.swf'),original);await atomicWrite(path.join(folder,'patch.swf'),patched);await atomicWrite(path.join(folder,'manifest.json'),JSON.stringify(manifest));
    const folders=[];
    for(const item of await fs.readdir(root,{withFileTypes:true}))if(item.isDirectory()&&!item.isSymbolicLink()&&/^[a-f0-9]{64}-[a-f0-9]{12}-[a-f0-9]{12}$/.test(item.name)){const file=path.join(root,item.name);folders.push({file,time:(await fs.stat(file)).mtimeMs});}
    folders.sort((a,b)=>b.time-a.time);
    for(const old of folders.slice(3))await fs.rm(old.file,{recursive:true,force:true});
    return {original,patched,filename:discovered.filename,manifest,reused:false};
  }
  async downloadGame(game) {
    const entry=chapter(game);
    if(game==='zm5'){const ready=await this.prepareFive();return {data:ready.original,filename:ready.filename};}
    const data=await this.fetcher(entry.base+entry.file+'.swf',entry.base+entry.file+entry.suffix,MAX);
    await applyRecipe(data,await this.recipe(game));return {data,filename:entry.file+'.swf'};
  }
  backupDirectory() {return path.join(this.support,'client-backups',hash(Buffer.from(this.clientPath.toLowerCase())));}
  marker() {return START+`require(${JSON.stringify(path.join(this.support,'bridge.cjs'))});\n`+END;}
  async install(ready,game) {
    this.client=await inspectClient(this.clientPath);
    const oldMain=await boundedFile(this.client.main,2_000_000),oldConfig=await boundedFile(this.client.config,1_000_000);
    const current=oldMain.toString('utf8'),marker=this.marker(),backup=this.backupDirectory();
    let record;
    try {record=JSON.parse((await boundedFile(path.join(backup,'record.json'),16384)).toString('utf8'));}catch(error){if(error.code!=='ENOENT')throw failure('客户端接入备份损坏，请先恢复原客户端。');}
    if(record) {
      if(record.exe!==this.clientPath||![record.original_main_hash,record.installed_main_hash,record.previous_main_hash].includes(hash(oldMain))||![record.original_config_hash,record.installed_config_hash,record.previous_config_hash].includes(hash(oldConfig)))throw failure('客户端文件在接入后发生变化，未覆盖；请恢复原客户端或重新安装兼容客户端。');
    } else {
      if(current.includes('ZMXY_DROP_CONTROL_BEGIN'))throw failure('客户端已有其他助手接入记录，请先使用原助手恢复客户端。');
      await atomicWrite(path.join(backup,'main.js'),oldMain);await atomicWrite(path.join(backup,'config.json'),oldConfig);
      record={exe:this.clientPath,original_main_hash:hash(oldMain),original_config_hash:hash(oldConfig)};
    }
    for(const name of BRIDGE_FILES)await atomicWrite(path.join(this.support,name),await boundedFile(path.join(this.resources,name),2_000_000));
    await atomicWrite(path.join(this.support,`patched-${game}.swf`),ready.patched);
    if(ready.manifest)await atomicWrite(path.join(this.support,'auto-zm5.json'),JSON.stringify(ready.manifest));
    const nextMain=current.startsWith(marker)?oldMain:Buffer.from(marker+current);
    const config=JSON.parse(oldConfig.toString('utf8')),launchURL=new URL(TOPIC);
    launchURL.searchParams.set('g',game.slice(2));
    if(game==='zm5')launchURL.searchParams.set('zmxy_auto',crypto.randomUUID());
    config.appUrl=launchURL.href;
    const nextConfig=Buffer.from(JSON.stringify(config));
    try {
      // Commit verified originals and intended hashes before touching the client.
      // Recovery accepts each file independently in its original or installed state.
      record.previous_main_hash=hash(oldMain);record.previous_config_hash=hash(oldConfig);
      record.installed_main_hash=hash(nextMain);record.installed_config_hash=hash(nextConfig);
      await atomicWrite(path.join(backup,'record.json'),JSON.stringify(record));
      await atomicWrite(this.client.main,nextMain);await atomicWrite(this.client.config,nextConfig);
    } catch(error) {await atomicWrite(this.client.main,oldMain);await atomicWrite(this.client.config,oldConfig);throw error;}
  }
  async connect(game,inputPath) {
    chapter(game);await this.ensureStopped();
    const ready=await this.prepareGame(game,inputPath);
    await this.ensureStopped();
    await this.install(ready,game);await this.writeSettings();
    const launchArgs=this.displayMode==='native'?['--force-device-scale-factor=1']:[];
    if(this.launcher)await this.launcher(this.clientPath,launchArgs);
    else {
      const child=await new Promise((resolve,reject)=>{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const spawned=spawn(this.clientPath,launchArgs,{cwd:path.dirname(this.clientPath),detached:true,stdio:'ignore',windowsHide:false,env});spawned.once('error',reject);spawned.once('spawn',()=>{spawned.unref();resolve(spawned);});});
      await this.waitForClient(game,child);
    }
    this.queryAt=0;return {opened:true};
  }
  async waitForClient(game,child,{timeout=8000,pollInterval=200}={}) {
    const started=Date.now(),entry=chapter(game);
    const exited=()=>child.exitCode!==null&&child.exitCode!==undefined||!!child.signalCode;
    while(Date.now()-started<timeout) {
      if(exited())throw failure('游戏客户端在接入完成前已退出，请重新打开客户端后重试。','CLIENT_EXITED');
      try {
        const value=JSON.parse((await boundedFile(path.join(this.support,statusFile(game)),65536)).toString('utf8')),age=Date.now()-value.updated_at;
        if(value.protocol===entry.protocol&&value.pid===child.pid&&Number.isFinite(age)&&age>=0&&age<2500&&value.updated_at>=started&&!exited())return;
      }catch{}
      await delay(Math.min(pollInterval,Math.max(1,timeout-(Date.now()-started))));
    }
    if(exited())throw failure('游戏客户端在接入完成前已退出，请重新打开客户端后重试。','CLIENT_EXITED');
    throw failure('客户端未在 8 秒内返回接入确认。请检查客户端窗口；若未出现，请完全退出客户端后重试。','CLIENT_TIMEOUT');
  }
  async restoreClient() {
    await this.ensureStopped();this.client=await inspectClient(this.clientPath);
    const folder=this.backupDirectory();
    let record;try {record=JSON.parse((await boundedFile(path.join(folder,'record.json'),16384)).toString('utf8'));}catch{throw failure('此客户端没有可恢复的接入备份。');}
    const main=await boundedFile(path.join(this.client.app,'main.js'),2_000_000),config=await boundedFile(this.client.config,1_000_000);
    const originalMain=await boundedFile(path.join(folder,'main.js'),2_000_000),originalConfig=await boundedFile(path.join(folder,'config.json'),1_000_000);
    if(record.exe!==this.clientPath||![record.original_main_hash,record.installed_main_hash,record.previous_main_hash].includes(hash(main))||![record.original_config_hash,record.installed_config_hash,record.previous_config_hash].includes(hash(config))||hash(originalMain)!==record.original_main_hash||hash(originalConfig)!==record.original_config_hash)throw failure('客户端或备份已发生变化，未自动覆盖，请重新安装官方客户端。');
    try {await atomicWrite(this.client.main,originalMain);await atomicWrite(this.client.config,originalConfig);}catch(error){await atomicWrite(this.client.main,main);await atomicWrite(this.client.config,config);throw error;}
    await fs.rm(path.join(folder,'record.json'));return {restored:true};
  }
  async apply(game,values) {this.configs[game]=validateConfig(game,this.configs[game],values,this.catalogs);await this.writeSettings();return this.snapshot();}
  async command(game,{item,amount,player=1}={}) {
    chapter(game);if(!['zm2','zm3'].includes(game))throw failure('此章节不支持物品操作。');
    await this.tick();
    if(this.pending[game])throw failure('上次操作尚未返回，请先等待结果。');
    const state=this.statuses[game],selected=this.catalogs[game].items.find(value=>value.id===item);
    if(!state||!state.patched_loaded||!state.command_ready)throw failure('物品接口尚未就绪，请进入游戏后再操作。');
    if(!selected)throw failure('物品不在白名单中。');integer(amount,selected.max_amount,'数量');
    if(game==='zm2'&&![1,2].includes(player))throw failure('玩家编号无效。');
    const action=selected.kind==='pet'?'pet_potential':selected.kind==='repair'?'repair_wings':'add_item';
    this.pending[game]={id:crypto.randomUUID(),action,item,amount,created_at:Date.now(),client_pid:state.pid,...(game==='zm2'?{player}:{})};
    this.commandMessages[game]='请求已发送，等待游戏回执…';
    try {await this.writeSettings();}catch(error){delete this.pending[game];this.commandMessages[game]='请求写入失败，结果不明。请先检查游戏，避免重复操作。';throw error;}
    return {sent:true};
  }
  async writeSettings(expired=false) {
    const work=async()=>{
      // A tick already awaiting I/O must never resurrect settings after shutdown.
      expired=expired||this.closed;
      for(const game of Object.keys(CHAPTERS)) {
        const value=expired?{game,protocol:CHAPTERS[game].protocol,attack_multiplier:1,updated_at:0}:{...this.configs[game],updated_at:Date.now(),...(this.pending[game]?{command:this.pending[game]}:{})};
        await atomicWrite(path.join(this.support,settingsFile(game)),JSON.stringify(value));
      }
    };
    this.queue=this.queue.catch(()=>{}).then(work);return this.queue;
  }
  async tick() {
    if(this.closed)return;
    if(Date.now()-this.queryAt>3000) {const pids=await this.queryProcesses();this.pids=new Set(pids);this.running=!!pids.length;this.queryAt=Date.now();}
    const statuses={};
    for(const game of Object.keys(CHAPTERS)) {
      try {
        const value=JSON.parse((await boundedFile(path.join(this.support,statusFile(game)),65536)).toString('utf8')),age=Date.now()-value.updated_at;
        if(value.protocol===CHAPTERS[game].protocol&&this.pids.has(value.pid)&&Number.isFinite(age)&&age>=0&&age<2500)statuses[game]=value;
      }catch{}
      const pending=this.pending[game],receipt=statuses[game]?.command_result;
      if(pending&&receipt?.id===pending.id&&receipt.state!=='processing') {
        const messages={not_ready:'玩家或宠物尚未就绪',busy:'请先完成游戏中的交易或物品操作',full:'背包空间不足',missing:'物品或宠物未找到',duplicate_stack:'存在重复物品堆叠，请先整理背包',limit:'数量已达上限',invalid:'请求参数无效',unknown:'结果不明，请检查游戏，避免重复操作'};
        this.commandMessages[game]=receipt.state==='ok'?`已${pending.action==='repair_wings'?'修复':'添加'} ${receipt.added}，当前 ${receipt.total}。请在游戏中自行保存。`:messages[receipt.state]||'请求未完成，请先检查游戏。';delete this.pending[game];
      } else if(pending&&Date.now()-pending.created_at>16000) {delete this.pending[game];this.commandMessages[game]='未收到回执，结果不明。请先检查游戏，不会自动重试。';}
    }
    this.statuses=statuses;await this.writeSettings();return this.snapshot();
  }
  async shutdown() {this.closed=true;this.pending={};await this.writeSettings(true);}
}
module.exports={HelperService,CHAPTERS,MAX,unpack,applyRecipe,applyOperations,validateConfig,defaults,fetchBounded,frameURL,discovery,inspectClient,hash,liveProcessIds};
