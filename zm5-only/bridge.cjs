'use strict';
const {app,globalShortcut,Menu}=require('electron');
if (typeof app.setName === 'function') app.setName('造梦西游');
const fs=require('fs').promises;
const path=require('path');
const updateAttack=require('./attack.cjs');
const home=__dirname;
const games={
  zm5:{protocol:'zm5-attack-1.2',settings:'settings.json',statusFile:'status.json',patch:'patched-zm5.swf',
    url:'https://sda.4399.com/4399swf/upload_swf/ftp22/csya/20170622/1/v4780.swf'},
  zm4:{protocol:'zm4-attack-1.0',settings:'settings-zm4.json',statusFile:'status-zm4.json',patch:'patched-zm4.swf',
    url:'https://sda.4399.com/4399swf/upload_swf/ftp15/csya/20150127/1/v5880.swf'}
};
const controllers=new Set();
for(const [game,entry] of Object.entries(games)) {
  entry.config={game,protocol:entry.protocol,attack_multiplier:1,updated_at:0};
  entry.status={patched_loaded:false,attack_checks:0,error:''};
}
let busy=false,stopped=false;

app.once('ready',()=>process.nextTick(()=>{
  globalShortcut.unregister('CommandOrControl+C');
  globalShortcut.unregister('CommandOrControl+V');
  if (Menu && typeof Menu.getApplicationMenu === 'function') {
    const menu = Menu.getApplicationMenu();
    if (menu && menu.items.length) {
      menu.items[0].label = '造梦西游';
      Menu.setApplicationMenu(menu);
    }
  }
}));

function validConfig(value,game) {
  return value && value.protocol===games[game].protocol && value.game===game &&
    Number.isInteger(value.attack_multiplier) && value.attack_multiplier>=1 &&
    value.attack_multiplier<=2147483647 && Number.isFinite(value.updated_at);
}
function errorFor(game,error) {
  for(const [key,entry] of Object.entries(games)) {
    if(!game||key===game) entry.status.error=String(error.message||error);
  }
}
async function publish(game) {
  const entry=games[game];
  const value={...entry.status,protocol:entry.protocol,patch_version:entry.protocol,active_game:game,
    pid:process.pid,updated_at:Date.now()};
  const file=path.join(home,`status-${game}-${process.pid}.tmp`);
  await fs.writeFile(file,JSON.stringify(value),{mode:0o600});
  await fs.rename(file,path.join(home,entry.statusFile));
}
function attach(window) {
  const wc=window.webContents;
  const controller={wc,contexts:new Set(),game:null,frameId:null,generation:0};
  controllers.add(controller);
  wc.once('destroyed',()=>controllers.delete(controller));
  wc.on('did-start-navigation',(_event,_url,inPlace,isMainFrame)=>{
    if(isMainFrame&&!inPlace){controller.game=null;controller.contexts.clear();controller.generation++;}
  });
  wc.debugger.on('detach',()=>{
    errorFor(controller.game,'接入连接已断开，请保存并重开游戏。');
    controller.contexts.clear();controller.game=null;controller.generation++;
  });
  wc.debugger.on('message',async(_event,method,params)=>{
    let requestGame;
    try {
      if(method==='Runtime.executionContextCreated') {
        const c=params.context;
        if(c.origin==='https://sda.4399.com'&&c.auxData&&c.auxData.isDefault) controller.contexts.add(c.id);
      } else if(method==='Runtime.executionContextDestroyed') {
        controller.contexts.delete(params.executionContextId);
      } else if(method==='Runtime.executionContextsCleared') {
        // Login/ad subframes emit this event in Electron 11 while the Flash
        // frame remains alive. Invalidate only scoped frame/main navigation.
      } else if((method==='Page.frameNavigated'&&params.frame.id===controller.frameId)||
                (method==='Page.frameDetached'&&params.frameId===controller.frameId)) {
        controller.game=null;controller.generation++;
      } else if(method==='Fetch.requestPaused') {
        requestGame=Object.keys(games).find(game=>params.request.url.split('?')[0]===games[game].url);
        if(!requestGame) {
          await wc.debugger.sendCommand('Fetch.continueRequest',{requestId:params.requestId});return;
        }
        // A failed chapter switch must not keep advertising the previous patch as active.
        controller.game=null;
        controller.frameId=params.frameId;
        const generation=++controller.generation;
        const entry=games[requestGame];
        if(!entry.patchData) entry.patchData=await fs.readFile(path.join(home,entry.patch));
        await wc.debugger.sendCommand('Fetch.fulfillRequest',{
          requestId:params.requestId,responseCode:200,
          responseHeaders:[{name:'Content-Type',value:'application/x-shockwave-flash'},
            {name:'Cache-Control',value:'no-store'}],body:entry.patchData.toString('base64')
        });
        if(generation===controller.generation) {
          controller.game=requestGame;entry.status.error='';
        }
      }
    } catch(error) {
      errorFor(requestGame||controller.game,error);
      if(method==='Fetch.requestPaused') await wc.debugger.sendCommand('Fetch.continueRequest',
        {requestId:params.requestId}).catch(()=>{});
    }
  });
  try {
    wc.debugger.attach('1.3');
    Promise.all([wc.debugger.sendCommand('Runtime.enable'),wc.debugger.sendCommand('Page.enable'),
      wc.debugger.sendCommand('Fetch.enable',
      {patterns:Object.values(games).map(entry=>({urlPattern:entry.url+'*',requestStage:'Request'}))})])
      .catch(error=>errorFor(null,error));
  } catch(error) {errorFor(null,error);}
}
app.on('browser-window-created',(_event,window)=>attach(window));
const timer=setInterval(async()=>{
  if(busy||stopped)return;
  busy=true;
  try {
    for(const [game,entry] of Object.entries(games)) {
      try {
        const value=JSON.parse(await fs.readFile(path.join(home,entry.settings),'utf8'));
        if(validConfig(value,game)) entry.config=value;
      } catch(error) {
        if(error.code!=='ENOENT') entry.status.error='无法读取倍率配置。';
      }
    }
    for(const c of controllers) {
      if(!c.game||c.wc.isDestroyed()) continue;
      const entry=games[c.game];
      for(const contextId of c.contexts) {
        const result=await c.wc.debugger.sendCommand('Runtime.evaluate',{
          expression:`(${updateAttack.toString()})(${JSON.stringify(entry.config)})`,contextId,returnByValue:true
        }).catch(error=>{
          if(/Cannot find context/.test(String(error.message||error))) c.contexts.delete(contextId);
          return null;
        });
        if(result&&result.result&&result.result.value) entry.status={...entry.status,...result.result.value};
      }
    }
    for(const [game,entry] of Object.entries(games)) {
      entry.status.patched_loaded=Array.from(controllers).some(c=>c.game===game&&!c.wc.isDestroyed());
      if(!entry.status.patched_loaded)entry.status={patched_loaded:false,attack_checks:0,error:entry.status.error};
      await publish(game);
    }
  } catch(error) {errorFor(null,error);}
  finally {busy=false;}
},500);
app.once('before-quit',()=>{stopped=true;clearInterval(timer);});
