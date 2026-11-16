'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const zlib=require('node:zlib');
const {HelperService,unpack,applyRecipe,validateConfig,defaults,frameURL,discovery,inspectClient,hash,CHAPTERS,liveProcessIds}=require('./core.cjs');
function swf(body=Buffer.from([0,0,0,0,0,0,0])) {const header=Buffer.alloc(8);header.write('FWS');header[3]=15;header.writeUInt32LE(body.length+8,4);return Buffer.concat([header,body]);}
function recipe(source,result) {return {sourceHash:hash(source),resultHash:hash(result),resultSize:result.length,operations:[{add:result.toString('base64')}]};}
async function fixture(t) {
  // Windows CI may expose TEMP through an 8.3 alias (RUNNER~1); match the
  // canonical paths returned by inspectClient instead of comparing aliases.
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'zmxy-windows-test-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const resources=path.join(root,'shared'),support=path.join(root,'support'),client=path.join(root,'client'),app=path.join(client,'resources','app');
  await fs.mkdir(resources,{recursive:true});await fs.mkdir(path.join(app,'plugins'),{recursive:true});
  await fs.writeFile(path.join(client,'client.exe'),'test stub; never executed');
  await fs.writeFile(path.join(app,'main.js'),"'use strict';\nconsole.log('original');\n");
  await fs.writeFile(path.join(app,'config.json'),JSON.stringify({appUrl:'https://original.example/game',width:960}));
  await fs.writeFile(path.join(app,'plugins','pepflashplayer64_26_0_0_131.dll'),'test stub');
  const original=swf(),patched=swf(Buffer.from([0,1,0,0,0,0,0]));
  for(const entry of Object.values(CHAPTERS))if(entry.recipe)await fs.writeFile(path.join(resources,entry.recipe),JSON.stringify(recipe(original,patched)));
  for(const name of ['bridge.cjs','attack.cjs','auto-manifest.cjs'])await fs.copyFile(path.join(__dirname,'..','zm5-only',name),path.join(resources,name));
  for(const game of ['zm2','zm3']) {
    await fs.writeFile(path.join(resources,`boss-items-${game}.json`),JSON.stringify([{id:'boss_item',bigtype:'装备',name:'测试'}]));
    await fs.writeFile(path.join(resources,`${game}-items.json`),JSON.stringify([{id:'stone',kind:'item',name:'强化石',max_amount:99,default_amount:1,category:'测试'},{id:'repair',kind:'repair',name:'修复',max_amount:1,default_amount:1,category:'测试'}]));
  }
  let pids=[];const launched=[],launchedArgs=[];
  const service=new HelperService({support,resources,processQuery:async()=>pids,launcher:async(exe,args)=>{launched.push(exe);launchedArgs.push(args);pids=[4321];}});
  await service.initialize();
  return {root,resources,support,client,app,exe:path.join(client,'client.exe'),original,patched,service,launched,launchedArgs,setPids:value=>{pids=value;service.queryAt=0;}};
}
test('SWF unpack validates FWS and bounded CWS expansion',async()=>{
  const input=swf();assert.deepEqual(await unpack(input),input);
  const compressed=Buffer.concat([Buffer.from('CWS'),input.subarray(3,8),zlib.deflateSync(input.subarray(8))]);
  assert.deepEqual(await unpack(compressed),input);
  const malformed=Buffer.from(input);malformed.writeUInt32LE(32_000_001,4);
  await assert.rejects(unpack(malformed));
  const truncated=Buffer.from(input);truncated.writeUInt32LE(input.length+1,4);await assert.rejects(unpack(truncated));
  compressed.writeUInt32LE(9,4);await assert.rejects(unpack(compressed));
  await assert.rejects(unpack(Buffer.from('<html>download failed</html>')));
});
test('ZWS LZMA round trip and oversized dictionary rejection',async()=>{
  const input=swf(Buffer.from([0,1,2,3,255,254,128,0]));
  const compressed=await new Promise((resolve,reject)=>require('lzma').compress(input.subarray(8),1,(result,error)=>error?reject(error):resolve(Buffer.from(result))));
  const length=Buffer.alloc(4);length.writeUInt32LE(compressed.length-13);
  const zws=Buffer.concat([Buffer.from('ZWS'),input.subarray(3,8),length,compressed.subarray(0,5),compressed.subarray(13)]);
  assert.deepEqual(await unpack(zws),input);
  zws.writeUInt32LE(0x7fffffff,13);await assert.rejects(unpack(zws));
});
test('flat recipes verify both source and result and allow already patched input',async()=>{
  const source=swf(),result=swf(Buffer.from([0,8,0,0,0,0,0])),rule=recipe(source,result);
  assert.deepEqual(await applyRecipe(source,rule),result);
  assert.deepEqual(await applyRecipe(result,rule),result);
  await assert.rejects(applyRecipe(swf(Buffer.from([0,9,0,0,0,0,0])),rule));
  await assert.rejects(applyRecipe(source,{...rule,resultHash:'0'.repeat(64)}));
  await assert.rejects(applyRecipe(source,{...rule,operations:[{offset:-1,length:result.length}]}));
  await assert.rejects(applyRecipe(source,{...rule,operations:[{add:'!!!!'}]}));
});
test('nested DefineBinaryData reconstructs exact outer bytes and rejects duplicate targets',async()=>{
  const inner=swf(),changed=swf(Buffer.from([0,2,0,0,0,0,0]));
  function tag(data,id=3) {const header=Buffer.alloc(12);header.writeUInt16LE((87<<6)|63);header.writeUInt32LE(data.length+6,2);header.writeUInt16LE(id,6);return Buffer.concat([header,data]);}
  const prefix=Buffer.from([0,0,0,0,0]),end=Buffer.from([0,0]);
  const source=swf(Buffer.concat([prefix,tag(inner),end])),result=swf(Buffer.concat([prefix,tag(changed),end]));
  const rule={sourceHash:hash(source),resultHash:hash(result),resultSize:result.length,operations:[],embedded:{binaryID:3,...recipe(inner,changed)}};
  assert.deepEqual(await applyRecipe(source,rule),result);
  const duplicate=swf(Buffer.concat([prefix,tag(inner),tag(inner),end]));
  await assert.rejects(applyRecipe(duplicate,{...rule,sourceHash:hash(duplicate)}),/不唯一/);
  await assert.rejects(applyRecipe(source,{...rule,embedded:{...rule.embedded,binaryID:4}}),/找不到/);
});
test('chapter configuration rejects unsupported keys and preserves chapter isolation',()=>{
  const catalogs={zm2:{boss:[{id:'known'}]},zm3:{boss:[{id:'known'}]}};
  const original=defaults('zm2'),value=validateConfig('zm2',original,{attack_multiplier:20,boss_drop_enabled:true,boss_drop_item:'known'},catalogs);
  assert.equal(value.attack_multiplier,20);assert.equal(original.attack_multiplier,1);
  for(const input of [{attack_multiplier:0},{attack_multiplier:1.2},{attack_multiplier:'2'},{attack_multiplier:2147483648},{protocol:'fake'},{experience_multiplier:2},{boss_drop_enabled:true},{boss_drop_item:'unknown'},{strength_guaranteed:'true'}])assert.throws(()=>validateConfig('zm2',original,input,catalogs));
  assert.throws(()=>validateConfig('zm3',defaults('zm3'),{craft_elements:'jin+jin'},catalogs));
  assert.throws(()=>validateConfig('zm4',defaults('zm4'),{mode:'guaranteed'},catalogs));
});
test('official discovery requires one trusted URL and matching version',()=>{
  const base='https://sda.4399.com/4399swf/upload_swf/ftp22/csya/20170622/1/';
  const frame=base+'v4790h.htm';
  assert.equal(frameURL(Buffer.from(`game_url_arr[5]='${frame}'`)),frame);
  assert.deepEqual(discovery(frame,Buffer.from('<embed src="v4790.swf">')),{frameURL:frame,gameURL:base+'v4790.swf',filename:'v4790.swf'});
  for(const value of [frame+'?q=1',frame.replace('sda.4399.com','evil.test'),frame.replace('https:','http:'),base+'../v4790h.htm'])assert.throws(()=>frameURL(Buffer.from(`game_url_arr[5]='${value}'`)));
  assert.throws(()=>frameURL(Buffer.from(`game_url_arr[5]='${frame}';game_url_arr[5]='${base}v4800h.htm'`)));
  assert.throws(()=>discovery(frame,Buffer.from('<embed src="v4800.swf">')));
});
test('client validation rejects installers and clients missing Flash',async t=>{
  const f=await fixture(t);assert.equal((await inspectClient(f.exe)).main,path.join(f.app,'main.js'));
  await fs.rm(path.join(f.app,'plugins','pepflashplayer64_26_0_0_131.dll'));
  await assert.rejects(inspectClient(f.exe),/PepperFlash/);
});
test('process detection excludes exited Electron processes still retained by Windows',()=>{
  assert.deepEqual(liveProcessIds([{ProcessId:44100,ThreadCount:0},{ProcessId:4321,ThreadCount:19},{ProcessId:4322,ThreadCount:1}]),[4321,4322]);
  assert.deepEqual(liveProcessIds({ProcessId:4321,ThreadCount:19}),[4321]);
  assert.deepEqual(liveProcessIds([null,{ProcessId:1},{ProcessId:0,ThreadCount:20},{ProcessId:2,ThreadCount:0}]),[]);
});
test('process detection counts browser processes and unknown command lines, excluding Electron children',()=>{
  const main={ProcessId:4321,ThreadCount:19,CommandLine:'"D:\\测试客户端\\client.exe" --force-device-scale-factor=1'};
  const children=['renderer','gpu-process','ppapi','utility'].map((type,index)=>({ProcessId:4400+index,ThreadCount:16,CommandLine:`"D:\\测试客户端\\client.exe" --type=${type} --lang=zh-CN`}));
  assert.deepEqual(liveProcessIds([main,...children]),[4321]);
  assert.deepEqual(liveProcessIds(children),[]);
  assert.deepEqual(liveProcessIds([{ProcessId:5001,ThreadCount:2,CommandLine:null},{ProcessId:5002,ThreadCount:2}]),[5001,5002]);
  assert.deepEqual(liveProcessIds([{ProcessId:5003,ThreadCount:2,CommandLine:'client.exe "--type=renderer"'},{ProcessId:5004,ThreadCount:2,CommandLine:'client.exe --type utility'}]),[]);
  assert.deepEqual(liveProcessIds([
    {ProcessId:5005,ThreadCount:2,CommandLine:'"D:\\Games --type=backup\\Mole.exe" --force-device-scale-factor=1'},
    {ProcessId:5006,ThreadCount:2,ExecutablePath:'D:\\Games --type=backup\\Mole.exe',CommandLine:'D:\\Games --type=backup\\Mole.exe --force-device-scale-factor=1'},
    {ProcessId:5007,ThreadCount:2,CommandLine:'client.exe --user-data-dir="D:\\Games --type=backup\\profile"'},
    {ProcessId:5008,ThreadCount:2,CommandLine:'"D:\\Games --type=backup\\Mole.exe" --type=renderer'}
  ]),[5005,5006,5007]);
});
test('orphan renderers do not block reconnect or make an exited browser heartbeat valid',async t=>{
  const f=await fixture(t),main={ProcessId:4321,ThreadCount:19,CommandLine:'client.exe'};
  const child={ProcessId:4400,ThreadCount:16,CommandLine:'client.exe --type=renderer'};
  let processes=[child];f.service.processQuery=async()=>liveProcessIds(processes);
  await f.service.selectClient(f.exe);
  processes=[main,child];f.service.queryAt=0;
  const file=path.join(f.support,'status-zm2.json');
  await fs.writeFile(file,JSON.stringify({protocol:CHAPTERS.zm2.protocol,pid:4321,updated_at:Date.now(),patched_loaded:true}));
  await f.service.tick();assert.equal(f.service.snapshot().running,true);assert.equal(f.service.snapshot().statuses.zm2.pid,4321);
  processes=[child];f.service.queryAt=0;await f.service.tick();
  assert.equal(f.service.snapshot().running,false);assert.equal(f.service.snapshot().statuses.zm2,undefined);
  await fs.writeFile(file,JSON.stringify({protocol:CHAPTERS.zm2.protocol,pid:4400,updated_at:Date.now(),patched_loaded:true}));
  await f.service.tick();assert.equal(f.service.snapshot().statuses.zm2,undefined);
  await f.service.ensureStopped();
});
test('saved client selection survives restart and invalid selections report a warning',async t=>{
  const f=await fixture(t);await f.service.selectClient(f.exe);await f.service.shutdown();
  const restarted=new HelperService({support:f.support,resources:f.resources,processQuery:async()=>[]});
  const valid=await restarted.initialize();assert.equal(valid.clientPath,f.exe);assert.equal(valid.clientError,'');await restarted.shutdown();
  await fs.writeFile(path.join(f.support,'windows-client.json'),'{broken');
  const invalid=new HelperService({support:f.support,resources:f.resources,processQuery:async()=>[]});
  const warning=await invalid.initialize();assert.equal(warning.clientPath,'');assert.match(warning.clientError,/上次选择的客户端无法使用/);
  await invalid.selectClient(f.exe);assert.equal(invalid.snapshot().clientError,'');await invalid.shutdown();
  await fs.rm(f.exe);
  const missing=new HelperService({support:f.support,resources:f.resources,processQuery:async()=>[]});
  assert.match((await missing.initialize()).clientError,/上次选择的客户端无法使用/);await missing.shutdown();
});
test('display mode defaults to native pixels and persists only accepted choices',async t=>{
  const f=await fixture(t);assert.equal(f.service.snapshot().displayMode,'native');
  await f.service.setDisplayMode('system');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.support,'windows-display.json'),'utf8')),{mode:'system'});
  const restarted=new HelperService({support:f.support,resources:f.resources,processQuery:async()=>[]});
  assert.equal((await restarted.initialize()).displayMode,'system');
  for(const mode of ['auto','',null,1])await assert.rejects(restarted.setDisplayMode(mode),/显示模式无效/);
  assert.equal(restarted.snapshot().displayMode,'system');await restarted.shutdown();
  await fs.writeFile(path.join(f.support,'windows-display.json'),JSON.stringify({mode:'unrecognized'}));
  const invalid=new HelperService({support:f.support,resources:f.resources,processQuery:async()=>[]});
  assert.equal((await invalid.initialize()).displayMode,'native');await invalid.shutdown();
});
test('display selection changes only the next client launch arguments',async t=>{
  const f=await fixture(t);await f.service.selectClient(f.exe);
  const input=path.join(f.root,'official.swf');await fs.writeFile(input,f.original);
  await f.service.connect('zm1',input);assert.deepEqual(f.launchedArgs,[['--force-device-scale-factor=1']]);
  const beforeMain=await fs.readFile(path.join(f.app,'main.js')),beforeConfig=await fs.readFile(path.join(f.app,'config.json'));
  await f.service.setDisplayMode('system');
  assert.deepEqual(await fs.readFile(path.join(f.app,'main.js')),beforeMain);
  assert.deepEqual(await fs.readFile(path.join(f.app,'config.json')),beforeConfig);
  assert.equal(f.launched.length,1);
  f.setPids([]);await f.service.connect('zm1');assert.deepEqual(f.launchedArgs[1],[]);
  await f.service.setDisplayMode('native');f.setPids([]);await f.service.connect('zm1');assert.deepEqual(f.launchedArgs[2],['--force-device-scale-factor=1']);
});
test('launch handshake waits for a fresh bridge response from the spawned PID',async t=>{
  const f=await fixture(t),child={pid:4321,exitCode:null,signalCode:null};
  await fs.writeFile(path.join(f.support,'status.json'),JSON.stringify({protocol:CHAPTERS.zm5.protocol,pid:4321,updated_at:Date.now()-10000,patched_loaded:true}));
  let accepted=false;
  const waiting=f.service.waitForClient('zm5',child,{timeout:1000,pollInterval:10}).then(()=>{accepted=true;});
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(accepted,false);
  await fs.writeFile(path.join(f.support,'status.json'),JSON.stringify({protocol:CHAPTERS.zm5.protocol,pid:999,updated_at:Date.now(),patched_loaded:true}));
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(accepted,false);
  await fs.writeFile(path.join(f.support,'status.json'),JSON.stringify({protocol:CHAPTERS.zm5.protocol,pid:4321,updated_at:Date.now(),patched_loaded:false}));
  await waiting;assert.equal(accepted,true);
});
test('launch handshake reports early exit and an unresponsive client',async t=>{
  const f=await fixture(t),child={pid:4321,exitCode:null,signalCode:null};
  await assert.rejects(f.service.waitForClient('zm5',child,{timeout:30,pollInterval:5}),{code:'CLIENT_TIMEOUT'});
  child.exitCode=1;
  await assert.rejects(f.service.waitForClient('zm5',child,{timeout:1000,pollInterval:10}),{code:'CLIENT_EXITED'});
});
test('connect backs up once, installs idempotently, and restores original entry and config',async t=>{
  const f=await fixture(t),originalMain=await fs.readFile(path.join(f.app,'main.js')),originalConfig=await fs.readFile(path.join(f.app,'config.json'));
  await f.service.selectClient(f.exe);
  await assert.rejects(f.service.connect('zm1'),{code:'NEED_SWF'});
  const input=path.join(f.root,'official.swf');await fs.writeFile(input,f.original);
  await f.service.connect('zm1',input);
  assert.deepEqual(f.launched,[f.exe]);
  const main=await fs.readFile(path.join(f.app,'main.js'),'utf8');
  assert.equal(main.match(/ZMXY_DROP_CONTROL_BEGIN/g).length,1);
  assert.ok(main.includes(JSON.stringify(path.join(f.support,'bridge.cjs'))));
  assert.equal(JSON.parse(await fs.readFile(path.join(f.app,'config.json'),'utf8')).appUrl,'https://www.4399.com/flash/zmhj.htm?g=1');
  assert.deepEqual(await fs.readFile(path.join(f.support,'patched-zm1.swf')),f.patched);
  await assert.rejects(f.service.connect('zm1'),/完全退出/);
  f.setPids([]);await f.service.connect('zm1');
  assert.equal((await fs.readFile(path.join(f.app,'main.js'),'utf8')).match(/ZMXY_DROP_CONTROL_BEGIN/g).length,1);
  f.setPids([]);await f.service.restoreClient();
  assert.deepEqual(await fs.readFile(path.join(f.app,'main.js')),originalMain);
  assert.deepEqual(await fs.readFile(path.join(f.app,'config.json')),originalConfig);
  await f.service.shutdown();
});
test('client entry opens the requested chapter directly and refreshes chapter five discovery',async t=>{
  const f=await fixture(t);await f.service.selectClient(f.exe);
  let previousNonce;
  for(const game of ['zm1','zm2','zm3','zm4','zm5','zm5']) {
    await f.service.install({patched:f.patched},game);
    const config=JSON.parse(await fs.readFile(path.join(f.app,'config.json'),'utf8')),url=new URL(config.appUrl);
    assert.equal(url.origin+url.pathname,'https://www.4399.com/flash/zmhj.htm');
    assert.equal(url.searchParams.get('g'),game.slice(2));
    if(game==='zm5') {const nonce=url.searchParams.get('zmxy_auto');assert.match(nonce,/^[a-f0-9-]{36}$/);assert.notEqual(nonce,previousNonce);previousNonce=nonce;}
    else assert.equal(url.searchParams.has('zmxy_auto'),false);
  }
});
test('restore refuses to overwrite a client modified after integration',async t=>{
  const f=await fixture(t);await f.service.selectClient(f.exe);
  const input=path.join(f.root,'official.swf');await fs.writeFile(input,f.original);await f.service.connect('zm1',input);
  f.setPids([]);await fs.appendFile(path.join(f.app,'main.js'),'\n// external change');
  await assert.rejects(f.service.restoreClient(),/发生变化/);
  await assert.rejects(f.service.connect('zm1'),/发生变化/);
});
test('restore handles a partially committed integration without losing original files',async t=>{
  const f=await fixture(t);await f.service.selectClient(f.exe);
  const input=path.join(f.root,'official.swf'),originalConfig=await fs.readFile(path.join(f.app,'config.json'));
  await fs.writeFile(input,f.original);await f.service.connect('zm1',input);
  f.setPids([]);
  // Simulate interruption between the program entry write and configuration write.
  await fs.writeFile(path.join(f.app,'config.json'),originalConfig);
  await f.service.restoreClient();
  assert.equal((await fs.readFile(path.join(f.app,'main.js'),'utf8')).includes('ZMXY_DROP_CONTROL_BEGIN'),false);
  assert.deepEqual(await fs.readFile(path.join(f.app,'config.json')),originalConfig);
});
test('auto cache is keyed by fresh official bytes, engine and rule and never used offline',async t=>{
  const f=await fixture(t),base='https://sda.4399.com/4399swf/upload_swf/ftp22/csya/20170622/1/';
  const script="const fs=require('fs');const b=fs.readFileSync(process.argv[2]);b[9]+=1;fs.writeFileSync(process.argv[3],b);";
  await fs.writeFile(path.join(f.resources,'auto-patch.cjs'),script);
  await fs.writeFile(path.join(f.resources,'auto-patch-rule.json'),'{}');
  let current=f.original,requests=0;
  f.service.fetcher=async url=>{requests++;if(url.includes('www.4399.com'))return Buffer.from(`game_url_arr[5]='${base}v4800h.htm'`);if(url.includes('.htm'))return Buffer.from('<embed src="v4800.swf">');return current;};
  const first=await f.service.prepareFive();assert.equal(first.reused,false);
  const second=await f.service.prepareFive();assert.equal(second.reused,true);assert.deepEqual(first.patched,second.patched);assert.equal(requests,6);
  current=swf(Buffer.from([0,3,0,0,0,0,0]));
  const changed=await f.service.prepareFive();assert.equal(changed.reused,false);assert.notEqual(hash(first.patched),hash(changed.patched));
  await fs.writeFile(path.join(f.resources,'auto-patch-rule.json'),'{"changed":true}');
  assert.equal((await f.service.prepareFive()).reused,false);
  f.service.fetcher=async()=>{throw new Error('offline');};
  await assert.rejects(f.service.prepareFive(),/offline/);
});
test('heartbeat accepts matching live PID only; item requests are bound and never retried',async t=>{
  const f=await fixture(t);await f.service.selectClient(f.exe);f.setPids([4321]);
  async function publish(values={}) {await fs.writeFile(path.join(f.support,'status-zm2.json'),JSON.stringify({protocol:CHAPTERS.zm2.protocol,pid:4321,updated_at:Date.now(),patched_loaded:true,command_ready:true,...values}));}
  await publish({pid:999});await f.service.tick();assert.equal(f.service.snapshot().statuses.zm2,undefined);
  await publish({updated_at:Date.now()-3000});await f.service.tick();assert.equal(f.service.snapshot().statuses.zm2,undefined);
  await publish();await f.service.command('zm2',{item:'stone',amount:4,player:2});
  const config=JSON.parse(await fs.readFile(path.join(f.support,'settings-zm2.json'),'utf8'));
  assert.equal(config.command.client_pid,4321);assert.equal(config.command.player,2);assert.equal(config.command.amount,4);
  await assert.rejects(f.service.command('zm2',{item:'stone',amount:4,player:2}),/尚未返回/);
  await publish({command_result:{id:config.command.id,state:'ok',added:4,total:10}});await f.service.tick();
  assert.match(f.service.commandMessages.zm2,/已添加 4/);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.support,'settings-zm2.json'),'utf8')).command,undefined);
  await assert.rejects(f.service.command('zm2',{item:'unlisted',amount:1}),/白名单/);
  await f.service.command('zm2',{item:'stone',amount:1});f.service.pending.zm2.created_at-=17000;await f.service.tick();
  assert.match(f.service.commandMessages.zm2,/不会自动重试/);
});
test('shutdown expires every chapter even if an in-flight tick finishes later',async t=>{
  const f=await fixture(t);await f.service.selectClient(f.exe);await f.service.apply('zm3',{attack_multiplier:7});
  let unblock,started;const awaiting=new Promise(resolve=>{started=resolve;});
  f.service.queryAt=0;f.service.processQuery=async()=>{started();await new Promise(resolve=>{unblock=resolve;});return [];};
  const tick=f.service.tick();await awaiting;await f.service.shutdown();unblock();await tick;
  for(const game of Object.keys(CHAPTERS)) {const file=game==='zm5'?'settings.json':`settings-${game}.json`,config=JSON.parse(await fs.readFile(path.join(f.support,file),'utf8'));assert.equal(config.updated_at,0);assert.equal(config.attack_multiplier,1);assert.equal(config.command,undefined);}
});
