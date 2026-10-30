'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
const update=require('./attack.cjs');
const protocol={zm5:'zm5-attack-1.2',zm4:'zm4-attack-1.0',zm3:'zm3-helper-2.0'};
const urls={
  zm5:'https://sda.4399.com/4399swf/upload_swf/ftp22/csya/20170622/1/v4780.swf',
  zm4:'https://sda.4399.com/4399swf/upload_swf/ftp15/csya/20150127/1/v5880.swf',
  zm3:'https://sda.4399.com/4399swf/upload_swf/ftp7/hanbao/20120107/6/v261029.swf'
};
const config=(game,overrides={})=>({game,protocol:protocol[game],attack_multiplier:10,updated_at:Date.now(),...overrides});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const catalog={boss:[{id:'xtzy',name:'刑天之翼',bigtype:'sz'}],items:[{id:'wpxt',kind:'item',max_amount:9999},{id:'pet_potential',kind:'pet',max_amount:9999}]};
function configure(page,value) {
  return vm.runInContext(`(${update.toString()})(${JSON.stringify(value)},${JSON.stringify(catalog)})`,page);
}

test('serialized chapter five callback preserves role/pet/fairy scaling, bounds and expiry',()=>{
  const page=vm.createContext({window:{}});
  function power(overrides={},base=100,attacker='role',target='monster') {
    configure(page,config('zm5',overrides));
    return page.window.__zmxyAttackPower5(base,attacker,target);
  }
  for(const type of ['role','pet','fairy']) assert.equal(power({},100,type),1000);
  assert.equal(power({},100,'monster'),100);
  assert.equal(power({},100,'role','role'),100);
  for(const base of [0,-2,Infinity,-Infinity,NaN]) assert(Object.is(power({},base),base));
  assert.equal(power({},0.25),2.5);
  assert.equal(power({attack_multiplier:1},0.25),0.25);
  assert.equal(power({attack_multiplier:2147483647},100),2147483647);
  for(const value of [0,-1,1.5,2147483648,'100',null]) assert.equal(power({attack_multiplier:value}),100);
  for(const value of [{game:'zm4'},{protocol:'legacy'},{updated_at:Date.now()-5000},{updated_at:Date.now()+5000}]) {
    assert.equal(power(value),100);
  }
  assert.equal(power({attack_multiplier:20}),2000);
  assert.equal(power({attack_multiplier:1}),100);
});

test('chapter four only scales positive role-to-monster solo damage with explicit safe flags',()=>{
  const page=vm.createContext({window:{}});
  function power(overrides={},base=100,attacker='role',target='monster',flags=[false,false,false,false]) {
    configure(page,config('zm4',overrides));
    return page.window.__zmxyAttackPower4(base,attacker,target,...flags);
  }
  assert.equal(power(),1000);
  assert.equal(power({attack_multiplier:1}),100);
  assert.equal(power({attack_multiplier:2147483647}),2147483647);
  assert.equal(power({attack_multiplier:2},0.25),0.5);
  for(const value of [0,-1,1.5,2147483648,'10',null]) assert.equal(power({attack_multiplier:value}),100);
  for(const base of [0,-1,Infinity,-Infinity,NaN]) assert(Object.is(power({},base),base));
  for(const attacker of ['monster','pet','fairy','Role','']) assert.equal(power({},100,attacker),100);
  assert.equal(power({},100,'role','role'),100);
  for(let index=0;index<4;index++) {
    for(const value of [true,null,undefined,0,'false']) {
      const flags=[false,false,false,false];flags[index]=value;
      assert.equal(power({},100,'role','monster',flags),100);
    }
  }
  for(const overrides of [{game:'zm5'},{protocol:protocol.zm5},{updated_at:0},
    {updated_at:Date.now()-5000},{updated_at:Date.now()+5000},{updated_at:null}]) {
    assert.equal(power(overrides),100);
  }
});

test('chapter changes expire the other callback and discard previous chapter telemetry',()=>{
  const page=vm.createContext({window:{}});
  configure(page,config('zm5'));
  assert.equal(page.window.__zmxyAttackPower5(100,'role','monster'),1000);
  assert.equal(page.window.__zmxyAttackPower4(100,'role','monster',false,false,false,false),100);
  assert.equal(configure(page,config('zm4')).attack_checks,undefined);
  assert.equal(page.window.__zmxyAttackPower5(100,'role','monster'),100);
  assert.equal(page.window.__zmxyAttackPower4(30,'role','monster',false,false,false,false),300);
  assert.equal(configure(page,config('zm4')).attack_checks,1);
  assert.equal(configure(page,config('zm5')).attack_checks,undefined);
});

function bridgeHarness() {
  const app=new EventEmitter(), shortcuts=new Map(), memory=new Map(), sent=[];
  const configs=new Map([['settings.json',config('zm5')],['settings-zm4.json',config('zm4',{attack_multiplier:3})],['settings-zm3.json',config('zm3',{attack_multiplier:5})]]);
  const failures=new Set(),deferred=new Map();
  let poll,cleared=false;
  const fakeFs={
    async readFile(file) {
      const name=file.slice(file.lastIndexOf('/')+1);
      if(failures.has(name))throw Object.assign(new Error('missing '+name),{code:'ENOENT'});
      if(deferred.has(name))return deferred.get(name);
      if(name.startsWith('patched-'))return Buffer.from(name);
      if(name==='boss-items-zm3.json')return JSON.stringify(catalog.boss);
      if(name==='zm3-items.json')return JSON.stringify(catalog.items);
      if(!configs.has(name))throw Object.assign(new Error('missing '+name),{code:'ENOENT'});
      return JSON.stringify(configs.get(name));
    },
    async writeFile(file,value){memory.set(file,value);},
    async rename(from,to){memory.set(to,memory.get(from));memory.delete(from);}
  };
  const sandbox=vm.createContext({
    require(name) {
      if(name==='electron')return {app,globalShortcut:{unregister:key=>shortcuts.delete(key)}};
      if(name==='fs')return {promises:fakeFs};
      if(name==='./attack.cjs')return update;
      return require(name);
    },__dirname:'/test',process,Buffer,Date,Set,JSON,Number,Promise,
    setInterval(fn){poll=fn;return 1;},clearInterval(){cleared=true;}
  });
  vm.runInContext(fs.readFileSync(__dirname+'/bridge.cjs','utf8'),sandbox);
  function window() {
    const plugins=[];
    const debuggerApi=new EventEmitter(),page=vm.createContext({window:{},document:{querySelectorAll:()=>plugins}}),wc=new EventEmitter();
    debuggerApi.attach=()=>{};
    debuggerApi.sendCommand=async(method,args)=>{
      sent.push([method,args]);
      if(method==='Runtime.evaluate')return {result:{value:vm.runInContext(args.expression,page)}};
      return {};
    };
    wc.debugger=debuggerApi;wc.isDestroyed=()=>false;
    app.emit('browser-window-created',{}, {webContents:wc});
    return {wc,page,debuggerApi,plugins,
      context(id=7){debuggerApi.emit('message',{},'Runtime.executionContextCreated',
        {context:{id,origin:'https://sda.4399.com',auxData:{isDefault:true,frameId:'game-frame'}}});},
      request(game,id=game,url=urls[game]){debuggerApi.emit('message',{},'Fetch.requestPaused',
        {requestId:id,frameId:'game-frame',request:{url}});}
    };
  }
  return {app,shortcuts,memory,sent,configs,failures,deferred,window,poll:()=>poll(),
    status:game=>JSON.parse(memory.get(game==='zm5'?'/test/status.json':`/test/status-${game}.json`)),
    get cleared(){return cleared;}};
}

test('bridge patches exact chapter URLs and keeps independent settings, telemetry and clipboard shortcuts',async()=>{
  const h=bridgeHarness();
  h.app.on('ready',()=>{
    h.shortcuts.set('CommandOrControl+C',1);h.shortcuts.set('CommandOrControl+V',1);h.shortcuts.set('F5',1);
  });
  h.app.emit('ready');await flush();
  assert(!h.shortcuts.has('CommandOrControl+C')&&!h.shortcuts.has('CommandOrControl+V'));
  assert(h.shortcuts.has('F5'));
  const five=h.window(),four=h.window(),three=h.window();await flush();
  const patterns=h.sent.find(([method])=>method==='Fetch.enable')[1].patterns;
  assert.equal(patterns.length,3);
  assert.deepEqual(Array.from(patterns,entry=>entry.urlPattern).sort(),Object.values(urls).map(url=>url+'*').sort());
  five.context();four.context();three.context();five.request('zm5');four.request('zm4');three.request('zm3');await flush();
  for(const game of ['zm5','zm4','zm3'])assert(h.sent.some(([method,args])=>method==='Fetch.fulfillRequest'&&args.requestId===game));
  await h.poll();
  assert.equal(five.page.window.__zmxyAttackPower5(100,'role','monster'),1000);
  assert.equal(four.page.window.__zmxyAttackPower4(100,'role','monster',false,false,false,false),300);
  assert.equal(three.page.window.__zmxyAttackPower3(100,'Role1','hit1'),500);
  await h.poll();
  for(const game of ['zm5','zm4','zm3']) {
    assert.equal(h.status(game).protocol,protocol[game]);
    assert.equal(h.status(game).active_game,game);
    assert.equal(h.status(game).patched_loaded,true);
    assert.equal(h.status(game).attack_checks,1);
  }
  assert.equal(h.status('zm5').effective_attack,1000);
  assert.equal(h.status('zm4').effective_attack,300);
  assert.equal(h.status('zm3').effective_attack,500);
  four.request('zm4','other','https://example.org/zm4.swf');
  four.request('zm4','suffix',urls.zm4+'-other.swf');await flush();
  for(const id of ['other','suffix'])assert(h.sent.some(([method,args])=>method==='Fetch.continueRequest'&&args.requestId===id));
  h.app.emit('before-quit');assert(h.cleared);
});

test('switching chapters and navigating away clears inactive chapter loaded state and damage telemetry',async()=>{
  const h=bridgeHarness(),w=h.window();
  w.context();w.request('zm5');await flush();await h.poll();
  w.page.window.__zmxyAttackPower5(100,'role','monster');await h.poll();
  assert.equal(h.status('zm5').attack_checks,1);
  w.request('zm4');await flush();await h.poll();
  assert.equal(h.status('zm5').patched_loaded,false);
  assert.equal(h.status('zm5').attack_checks,0);
  assert.equal(h.status('zm5').effective_attack,undefined);
  assert.equal(h.status('zm4').patched_loaded,true);
  assert.equal(h.status('zm4').attack_checks,0);
  w.page.window.__zmxyAttackPower4(10,'role','monster',false,false,false,false);
  await h.poll();assert.equal(h.status('zm4').effective_attack,30);
  w.debuggerApi.emit('message',{},'Page.frameNavigated',{frame:{id:'game-frame',url:'https://example.org'}});
  await h.poll();
  assert.equal(h.status('zm4').patched_loaded,false);
  assert.equal(h.status('zm4').effective_attack,undefined);
  w.request('zm5');await flush();await h.poll();
  w.wc.emit('did-start-navigation',{},'https://example.org',false,true);
  await h.poll();assert.equal(h.status('zm5').patched_loaded,false);
});

test('missing patch falls back to official response and cross-chapter config is not applied',async()=>{
  const h=bridgeHarness(),w=h.window();
  h.configs.set('settings-zm4.json',config('zm5',{attack_multiplier:500}));
  h.failures.add('patched-zm4.swf');w.context();w.request('zm4');await flush();await h.poll();
  assert(h.sent.some(([method,args])=>method==='Fetch.continueRequest'&&args.requestId==='zm4'));
  assert.equal(h.status('zm4').patched_loaded,false);
  assert.match(h.status('zm4').error,/missing patched-zm4/);
  assert.equal(h.status('zm5').error,'');
  h.failures.delete('patched-zm4.swf');
  w.request('zm4','retry');await flush();await h.poll();
  assert.equal(h.status('zm4').patched_loaded,true);
  assert.equal(h.status('zm4').error,'');
  assert.equal(w.page.window.__zmxyAttackPower4(10,'role','monster',false,false,false,false),10);
  w.debuggerApi.emit('detach');await h.poll();
  assert.equal(h.status('zm4').patched_loaded,false);
  assert.match(h.status('zm4').error,/连接已断开/);
});


test('late patch loading cannot reactivate a page after navigation',async()=>{
  const h=bridgeHarness(),w=h.window();
  let resolvePatch;
  h.deferred.set('patched-zm4.swf',new Promise(resolve=>{resolvePatch=resolve;}));
  w.context();w.request('zm4');await flush();
  w.debuggerApi.emit('message',{},'Page.frameNavigated',{frame:{id:'game-frame',url:'https://example.org'}});
  resolvePatch(Buffer.from('patch'));await flush();await h.poll();
  assert.equal(h.status('zm4').patched_loaded,false);
  assert.equal(h.status('zm4').attack_checks,0);
  assert.equal(h.sent.filter(([method])=>method==='Runtime.evaluate').length,0);
});


test('login subframe context clears do not invalidate the loaded Flash frame',async()=>{
  const h=bridgeHarness(),w=h.window();
  w.context();w.request('zm4');await flush();await h.poll();
  w.debuggerApi.emit('message',{},'Runtime.executionContextsCleared',{});
  w.debuggerApi.emit('message',{},'Page.frameNavigated',{frame:{id:'login-frame',url:'https://ptlogin.4399.com'}});
  h.configs.get('settings-zm4.json').attack_multiplier=4;
  await h.poll();
  assert.equal(h.status('zm4').patched_loaded,true);
  assert.equal(w.page.window.__zmxyAttackPower4(25,'role','monster',false,false,false,false),100);
  await h.poll();assert.equal(h.status('zm4').effective_attack,100);
});


test('chapter three scales four heroes while preserving healing and invalid actions',()=>{
  const page=vm.createContext({window:{}});
  function power(overrides={},base=123,role='Role1',action='hit1') {
    configure(page,config('zm3',overrides));
    return page.window.__zmxyAttackPower3(base,role,action);
  }
  for(const role of ['Role1','Role2','Role3','Role4'])assert.equal(power({},123,role),1230);
  for(const action of ['hit6','hit7','hit8'])assert.equal(power({},123,'Role2',action),123);
  assert.equal(power({},123,'Role1','hit6'),1230);
  for(const action of ['stand','hurt','hit',null,15,{}])assert.equal(power({},123,'Role1',action),123);
  assert.equal(page.window.__zmxyAttackPower3(123,'Role1',undefined),123);
  for(const role of ['Role5','Role1Shadow','monster','pet',null])assert.equal(power({},123,role),123);
  for(const base of [0,-1,Infinity,-Infinity,NaN])assert(Object.is(power({},base),base));
  assert.equal(power({attack_multiplier:1}),123);
  assert.equal(power({attack_multiplier:2147483647}),2147483647);
  for(const value of [0,-1,1.5,2147483648,'10',null])assert.equal(power({attack_multiplier:value}),123);
  for(const value of [{game:'zm4'},{game:'zm5'},{protocol:protocol.zm4},{protocol:protocol.zm5},
    {updated_at:0},{updated_at:Date.now()-5000},{updated_at:Date.now()+5000},{updated_at:null}]) {
    assert.equal(power(value),123);
  }
});

test('switching all three chapters isolates callbacks and retained damage receipts',async()=>{
  const h=bridgeHarness(),w=h.window();
  w.context();w.request('zm3');await flush();await h.poll();
  assert.equal(w.page.window.__zmxyAttackPower3(40,'Role4','hit1'),200);
  assert.equal(w.page.window.__zmxyAttackPower4(40,'role','monster',false,false,false,false),40);
  assert.equal(w.page.window.__zmxyAttackPower5(40,'role','monster'),40);
  await h.poll();assert.equal(h.status('zm3').effective_attack,200);
  w.request('zm4');await flush();await h.poll();
  assert.equal(h.status('zm3').patched_loaded,false);
  assert.equal(h.status('zm3').effective_attack,undefined);
  assert.equal(w.page.window.__zmxyAttackPower3(40,'Role4','hit1'),40);
  assert.equal(w.page.window.__zmxyAttackPower4(40,'role','monster',false,false,false,false),120);
  w.request('zm5');await flush();await h.poll();
  assert.equal(h.status('zm4').patched_loaded,false);
  assert.equal(h.status('zm4').effective_attack,undefined);
  assert.equal(w.page.window.__zmxyAttackPower3(40,'Role4','hit1'),40);
  assert.equal(w.page.window.__zmxyAttackPower5(40,'role','monster'),400);
  w.request('zm3');await flush();await h.poll();
  assert.equal(h.status('zm5').patched_loaded,false);
  assert.equal(h.status('zm3').attack_checks,0);
  assert.equal(h.status('zm3').effective_attack,undefined);
});

test('chapter three missing patch and foreign configuration leave original damage unchanged',async()=>{
  const h=bridgeHarness(),w=h.window();
  h.configs.set('settings-zm3.json',config('zm4',{attack_multiplier:500}));
  h.failures.add('patched-zm3.swf');w.context();w.request('zm3');await flush();await h.poll();
  assert(h.sent.some(([method,args])=>method==='Fetch.continueRequest'&&args.requestId==='zm3'));
  assert.equal(h.status('zm3').patched_loaded,false);
  assert.match(h.status('zm3').error,/missing patched-zm3/);
  for(const game of ['zm4','zm5'])assert.equal(h.status(game).error,'');
  h.failures.delete('patched-zm3.swf');w.request('zm3','retry');await flush();await h.poll();
  assert.equal(h.status('zm3').patched_loaded,true);
  assert.equal(w.page.window.__zmxyAttackPower3(40,'Role1','hit1'),40);
});

test('chapter three drop and experience controls reject stale, invalid and foreign configurations',()=>{
  const page=vm.createContext({window:{}});
  function settings(overrides={}) {configure(page,config('zm3',{mode:'multiplier',multiplier:4,experience_multiplier:10,...overrides}));}
  settings();assert.equal(page.window.__zmxyDropRate(0.15),0.6);
  assert.equal(page.window.__zmxyExperience3(20),200);
  settings({mode:'guaranteed'});assert.equal(page.window.__zmxyDropRate(0),1);
  settings({multiplier:1000});assert.equal(page.window.__zmxyDropRate(0.15),1);
  settings({mode:'original'});assert.equal(page.window.__zmxyDropRate(0.15),0.15);
  for(const multiplier of [0,-1,1.2,1001,'10',null]) {
    settings({multiplier,experience_multiplier:multiplier});
    assert.equal(page.window.__zmxyDropRate(0.15),0.15);
    assert.equal(page.window.__zmxyExperience3(20),20);
  }
  settings({experience_multiplier:1000});assert.equal(page.window.__zmxyExperience3(1e7),1e8);
  assert.equal(page.window.__zmxyExperience3(1e9),1e9); // Do not reduce original large rewards.
  settings({experience_multiplier:1});assert.equal(page.window.__zmxyExperience3(0.15),0.15);
  for(const overrides of [{game:'zm4'},{protocol:'zm3-attack-1.0'},{updated_at:0},{updated_at:Date.now()+5000}]) {
    settings({...overrides,mode:'guaranteed',experience_multiplier:1000});
    assert.equal(page.window.__zmxyDropRate(0.15),0.15);
    assert.equal(page.window.__zmxyExperience3(20),20);
  }
  settings();
  for(const value of [-1,1.1,Infinity,NaN])assert(Object.is(page.window.__zmxyDropRate(value),value));
});

test('Boss choices are allowlisted and strength success does not enable unrelated fusion',()=>{
  const page=vm.createContext({window:{}});
  configure(page,config('zm3',{boss_drop_enabled:true,boss_drop_item:'xtzy',strength_guaranteed:true}));
  assert.deepEqual(JSON.parse(JSON.stringify(page.window.__zmxyBossDrop3(true))),{name:'xtzy',bigtype:'sz'});
  assert.equal(page.window.__zmxyBossDrop3(false),null);
  assert.equal(page.window.__zmxyCraftRate(0.001,'strength'),1);
  assert.equal(page.window.__zmxyCraftRate(0.75,'fusion'),0.75);
  for(const overrides of [{boss_drop_item:'unknown'},{boss_drop_enabled:false},{boss_drop_enabled:1},
    {protocol:'old'},{game:'zm5'},{updated_at:0}]) {
    configure(page,config('zm3',{boss_drop_enabled:true,boss_drop_item:'xtzy',...overrides}));
    assert.equal(page.window.__zmxyBossDrop3(true),null);
  }
  for(const overrides of [{strength_guaranteed:false},{strength_guaranteed:1},{updated_at:0},{game:'zm4'}]) {
    configure(page,config('zm3',{strength_guaranteed:true,...overrides}));
    assert.equal(page.window.__zmxyCraftRate(0.001,'strength'),0.001);
  }
});

test('forge choices remain inside nested crafting scope across ticks and expire abandoned scopes',()=>{
  const page=vm.createContext({window:{}});
  const settings=overrides=>configure(page,config('zm3',{craft_max_attributes:true,craft_elements:'jin+shui',...overrides}));
  settings();const forge=operation=>page.window.__zmxyForge3(operation);
  assert.equal(forge('best'),null);assert.equal(forge('elements'),null);
  forge('enter');settings();assert.equal(forge('best'),true);
  assert.deepEqual(JSON.parse(JSON.stringify(forge('elements'))),{jin:true,mu:false,shui:true,huo:false,tu:false});
  forge('enter');forge('leave');assert.equal(forge('best'),true);
  for(const craft_elements of ['random','jin+jin','jin+mu+shui','wrong','']) {
    settings({craft_elements});assert.equal(forge('elements'),null);
  }
  settings({craft_max_attributes:false});assert.equal(forge('best'),false);
  forge('leave');assert.equal(forge('best'),null);
  settings();forge('enter');page.window.__zmxyForgeState.entered_at=Date.now()-5000;
  assert.equal(forge('best'),null);
  forge('enter');configure(page,config('zm4'));settings();assert.equal(forge('best'),null);
  forge('enter');settings({updated_at:0});assert.equal(forge('best'),null);
});

function command(overrides={}) {
  return {id:'command-1',action:'add_item',item:'wpxt',amount:999,created_at:Date.now(),client_pid:process.pid,...overrides};
}
function flashPlugin(calls,response=['ok',0,999,999]) {
  return {__zmxyCommand3(argument) {
    if(argument==='__mac_helper|probe|probe||1')return ['ready',2,0,0];
    calls.push(argument);
    if(response instanceof Error)throw response;
    return response;
  }};
}

test('item clicks are bound to fresh client/chapter configuration and execute once across windows and frame reloads',async()=>{
  const h=bridgeHarness(),w=h.window(),other=h.window(),calls=[];
  w.plugins.push(flashPlugin(calls));other.plugins.push(flashPlugin(calls));
  for(const window of [w,other]){window.context();window.request('zm3');}
  await flush();await h.poll();assert.equal(h.status('zm3').command_ready,true);
  const settings=h.configs.get('settings-zm3.json');settings.command=command();
  await h.poll();await h.poll();assert.equal(calls.length,1);
  assert.equal(calls[0],'__mac_helper|command-1|add_item|wpxt|999');
  assert.deepEqual(h.status('zm3').command_result,{id:'command-1',state:'ok',before:0,total:999,added:999});
  w.debuggerApi.emit('message',{},'Page.frameNavigated',{frame:{id:'game-frame'}});
  w.request('zm3');await flush();await h.poll();assert.equal(calls.length,1);
  for(const overrides of [{id:'wrong-pid',client_pid:process.pid+1},{id:'old',created_at:Date.now()-16000},
    {id:'future',created_at:Date.now()+5000},{id:'invalid|id'}]) {
    settings.command=command(overrides);await h.poll();assert.equal(calls.length,1);
  }
  settings.command=command({id:'bad-item',item:'not-allowlisted'});await h.poll();
  assert.equal(h.status('zm3').command_result.state,'invalid');assert.equal(calls.length,1);
  settings.command=command({id:'bad-amount',amount:10000});await h.poll();
  assert.equal(h.status('zm3').command_result.state,'invalid');assert.equal(calls.length,1);
  settings.command=command({id:'bad-kind',action:'pet_potential'});await h.poll();assert.equal(calls.length,1);
  settings.command=command({id:'stale-settings'});settings.updated_at=0;await h.poll();assert.equal(calls.length,1);
});

test('uncertain item outcomes are terminal and never automatically retried after a context error',async()=>{
  const h=bridgeHarness(),w=h.window(),calls=[];
  w.plugins.push(flashPlugin(calls,new Error('Flash lost after mutation')));
  w.context();w.request('zm3');await flush();await h.poll();
  h.configs.get('settings-zm3.json').command=command();await h.poll();
  assert.equal(h.status('zm3').command_result.state,'unknown');
  assert.match(h.status('zm3').error,/不会自动重试/);
  w.plugins.splice(0,1,flashPlugin(calls));
  await h.poll();await h.poll();assert.equal(calls.length,1);
  h.configs.get('settings-zm3.json').command=command({id:'user-new-click'});await h.poll();
  assert.equal(calls.length,2);assert.equal(h.status('zm3').command_result.state,'ok');
  assert.equal(h.status('zm3').error,'');
});

test('readonly readiness rejects old patches, duplicate Flash plugins and foreign frame contexts',async()=>{
  const h=bridgeHarness(),w=h.window(),calls=[];
  w.plugins.push({__zmxyCommand3:()=>['ready',1,0,0]});
  w.context();w.request('zm3');await flush();
  h.configs.get('settings-zm3.json').command=command();await h.poll();
  assert.equal(h.status('zm3').command_ready,false);
  w.plugins.splice(0,1,flashPlugin(calls),flashPlugin(calls));await h.poll();
  assert.equal(h.status('zm3').command_ready,false);assert.equal(calls.length,0);
  w.plugins.pop();
  w.debuggerApi.emit('message',{},'Runtime.executionContextDestroyed',{executionContextId:7});
  w.debuggerApi.emit('message',{},'Runtime.executionContextCreated',
    {context:{id:9,origin:'https://sda.4399.com',auxData:{isDefault:true,frameId:'other-frame'}}});
  await h.poll();assert.equal(h.status('zm3').command_ready,false);assert.equal(calls.length,0);
  w.context();await h.poll();assert.equal(h.status('zm3').command_ready,true);assert.equal(calls.length,1);
});
