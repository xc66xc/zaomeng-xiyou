'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
const update=require('./attack.cjs');
const config={protocol:'zm5-attack-1.2',game:'zm5',attack_multiplier:10,updated_at:Date.now()};

test('serialized Flash callback scales role/pet/fairy, caps and expires',()=>{
  const page=vm.createContext({window:{}});
  function power(overrides={},base=100,attacker='role',target='monster') {
    vm.runInContext(`(${update.toString()})(${JSON.stringify({...config,updated_at:Date.now(),...overrides})})`,page);
    return vm.runInContext(`window.__zmxyAttackPower5(${base},'${attacker}','${target}')`,page);
  }
  for(const type of ['role','pet','fairy']) assert.equal(power({},100,type),1000);
  assert.equal(power({},100,'monster'),100);
  assert.equal(power({},100,'role','role'),100);
  assert.equal(power({},0),0);
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

test('bridge intercepts only chapter five, publishes telemetry and releases clipboard shortcuts',async()=>{
  const app=new EventEmitter(), shortcuts=new Map(), sent=[], memory=new Map();
  let poll;
  const fakeFs={
    async readFile(file){if(file.endsWith('patched-zm5.swf')) return Buffer.from('patch');return JSON.stringify({...config,updated_at:Date.now()});},
    async writeFile(file,value){memory.set(file,value);},
    async rename(from,to){memory.set(to,memory.get(from));memory.delete(from);}
  };
  const sandbox=vm.createContext({
    require(name){
      if(name==='electron') return {app,globalShortcut:{unregister:key=>shortcuts.delete(key)}};
      if(name==='fs')return {promises:fakeFs};
      if(name==='./attack.cjs')return update;
      return require(name);
    },__dirname:'/test',process,Buffer,Date,Set,JSON,Number,Promise,
    setInterval(fn){poll=fn;return 1;},clearInterval(){}
  });
  vm.runInContext(fs.readFileSync(__dirname+'/bridge.cjs','utf8'),sandbox);
  app.on('ready',()=>{shortcuts.set('CommandOrControl+C',1);shortcuts.set('CommandOrControl+V',1);shortcuts.set('F5',1);});
  app.emit('ready');await new Promise(resolve=>setImmediate(resolve));
  assert(!shortcuts.has('CommandOrControl+C')&&!shortcuts.has('CommandOrControl+V'));
  assert(shortcuts.has('F5'));
  const debuggerApi=new EventEmitter();
  const page=vm.createContext({window:{}});
  debuggerApi.attach=()=>{};
  debuggerApi.sendCommand=async(method,args)=>{
    sent.push([method,args]);
    if(method==='Runtime.evaluate')return {result:{value:vm.runInContext(args.expression,page)}};
    return {};
  };
  const wc=new EventEmitter();wc.debugger=debuggerApi;wc.isDestroyed=()=>false;
  app.emit('browser-window-created',{}, {webContents:wc});
  await new Promise(resolve=>setImmediate(resolve));
  const pattern=sent.find(([method])=>method==='Fetch.enable')[1].patterns;
  assert.equal(pattern.length,1);assert(pattern[0].urlPattern.endsWith('/v4780.swf*'));
  debuggerApi.emit('message',{},'Runtime.executionContextCreated',{context:{id:7,origin:'https://sda.4399.com',auxData:{isDefault:true}}});
  const request={requestId:'five',request:{url:pattern[0].urlPattern.slice(0,-1)}};
  debuggerApi.emit('message',{},'Fetch.requestPaused',request);
  await new Promise(resolve=>setImmediate(resolve));
  assert(sent.some(([method,args])=>method==='Fetch.fulfillRequest'&&args.requestId==='five'));
  await poll();
  assert.equal(vm.runInContext('window.__zmxyAttackPower5(100,"role","monster")',page),1000);
  await poll();
  const status=JSON.parse(memory.get('/test/status.json'));
  assert.equal(status.protocol,'zm5-attack-1.2');assert.equal(status.patched_loaded,true);
  assert.equal(status.attack_checks,1);assert.equal(status.effective_attack,1000);
  debuggerApi.emit('message',{},'Fetch.requestPaused',{requestId:'other',request:{url:'https://example.org/zm4.swf'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert(sent.some(([method,args])=>method==='Fetch.continueRequest'&&args.requestId==='other'));
  app.emit('before-quit');
});
