'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
const update=require('./attack.cjs');
const protocol={zm5:'zm5-attack-1.2',zm4:'zm4-attack-1.0'};
const urls={
  zm5:'https://sda.4399.com/4399swf/upload_swf/ftp22/csya/20170622/1/v4780.swf',
  zm4:'https://sda.4399.com/4399swf/upload_swf/ftp15/csya/20150127/1/v5880.swf'
};
const config=(game,overrides={})=>({game,protocol:protocol[game],attack_multiplier:10,updated_at:Date.now(),...overrides});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function configure(page,value) {
  return vm.runInContext(`(${update.toString()})(${JSON.stringify(value)})`,page);
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
  const configs=new Map([['settings.json',config('zm5')],['settings-zm4.json',config('zm4',{attack_multiplier:3})]]);
  const failures=new Set(),deferred=new Map();
  let poll,cleared=false;
  const fakeFs={
    async readFile(file) {
      const name=file.slice(file.lastIndexOf('/')+1);
      if(failures.has(name))throw Object.assign(new Error('missing '+name),{code:'ENOENT'});
      if(deferred.has(name))return deferred.get(name);
      if(name.startsWith('patched-'))return Buffer.from(name);
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
    const debuggerApi=new EventEmitter(),page=vm.createContext({window:{}}),wc=new EventEmitter();
    debuggerApi.attach=()=>{};
    debuggerApi.sendCommand=async(method,args)=>{
      sent.push([method,args]);
      if(method==='Runtime.evaluate')return {result:{value:vm.runInContext(args.expression,page)}};
      return {};
    };
    wc.debugger=debuggerApi;wc.isDestroyed=()=>false;
    app.emit('browser-window-created',{}, {webContents:wc});
    return {wc,page,debuggerApi,
      context(id=7){debuggerApi.emit('message',{},'Runtime.executionContextCreated',
        {context:{id,origin:'https://sda.4399.com',auxData:{isDefault:true}}});},
      request(game,id=game,url=urls[game]){debuggerApi.emit('message',{},'Fetch.requestPaused',
        {requestId:id,frameId:'game-frame',request:{url}});}
    };
  }
  return {app,shortcuts,memory,sent,configs,failures,deferred,window,poll:()=>poll(),
    status:game=>JSON.parse(memory.get(game==='zm5'?'/test/status.json':'/test/status-zm4.json')),
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
  const five=h.window(),four=h.window();await flush();
  const patterns=h.sent.find(([method])=>method==='Fetch.enable')[1].patterns;
  assert.equal(patterns.length,2);
  assert.deepEqual(Array.from(patterns,entry=>entry.urlPattern).sort(),Object.values(urls).map(url=>url+'*').sort());
  five.context();four.context();five.request('zm5');four.request('zm4');await flush();
  for(const game of ['zm5','zm4'])assert(h.sent.some(([method,args])=>method==='Fetch.fulfillRequest'&&args.requestId===game));
  await h.poll();
  assert.equal(five.page.window.__zmxyAttackPower5(100,'role','monster'),1000);
  assert.equal(four.page.window.__zmxyAttackPower4(100,'role','monster',false,false,false,false),300);
  await h.poll();
  for(const game of ['zm5','zm4']) {
    assert.equal(h.status(game).protocol,protocol[game]);
    assert.equal(h.status(game).active_game,game);
    assert.equal(h.status(game).patched_loaded,true);
    assert.equal(h.status(game).attack_checks,1);
  }
  assert.equal(h.status('zm5').effective_attack,1000);
  assert.equal(h.status('zm4').effective_attack,300);
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
