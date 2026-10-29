'use strict';
const {app,globalShortcut,Menu}=require('electron');
if (typeof app.setName === 'function') app.setName('造梦西游');
const fs=require('fs').promises;
const path=require('path');
const updateAttack=require('./attack.cjs');
const home=__dirname;
const protocol='zm5-attack-1.2';
const gameURL='https://sda.4399.com/4399swf/upload_swf/ftp22/csya/20170622/1/v4780.swf';
const controllers=new Set();
let config={game:'zm5',protocol,attack_multiplier:1,updated_at:0};
let status={patched_loaded:false,attack_checks:0,error:''};
let busy=false,stopped=false,patch;

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

function validConfig(value) {
  return value && value.protocol===protocol && value.game==='zm5' &&
    Number.isInteger(value.attack_multiplier) && value.attack_multiplier>=1 &&
    value.attack_multiplier<=2147483647 && Number.isFinite(value.updated_at);
}
async function publish() {
  const value={...status,protocol,patch_version:protocol,active_game:'zm5',
    pid:process.pid,updated_at:Date.now()};
  const file=path.join(home,`status-zm5-${process.pid}.tmp`);
  await fs.writeFile(file,JSON.stringify(value),{mode:0o600});
  await fs.rename(file,path.join(home,'status.json'));
}
function attach(window) {
  const wc=window.webContents;
  const controller={wc,contexts:new Set(),loaded:false};
  controllers.add(controller);
  wc.once('destroyed',()=>controllers.delete(controller));
  wc.on('did-start-navigation',(_event,_url,inPlace,isMainFrame)=>{
    if(isMainFrame&&!inPlace){controller.loaded=false;controller.contexts.clear();}
  });
  wc.debugger.on('detach',()=>{
    controller.contexts.clear();controller.loaded=false;
    status.error='接入连接已断开，请保存并重开游戏。';
  });
  wc.debugger.on('message',async(_event,method,params)=>{
    try {
      if(method==='Runtime.executionContextCreated') {
        const c=params.context;
        if(c.origin==='https://sda.4399.com'&&c.auxData&&c.auxData.isDefault) controller.contexts.add(c.id);
      } else if(method==='Runtime.executionContextDestroyed') controller.contexts.delete(params.executionContextId);
      else if(method==='Runtime.executionContextsCleared') controller.contexts.clear();
      else if(method==='Fetch.requestPaused') {
        if(params.request.url.split('?')[0]!==gameURL) {
          await wc.debugger.sendCommand('Fetch.continueRequest',{requestId:params.requestId});return;
        }
        if(!patch) patch=await fs.readFile(path.join(home,'patched-zm5.swf'));
        await wc.debugger.sendCommand('Fetch.fulfillRequest',{
          requestId:params.requestId,responseCode:200,
          responseHeaders:[{name:'Content-Type',value:'application/x-shockwave-flash'},
            {name:'Cache-Control',value:'no-store'}],body:patch.toString('base64')
        });
        controller.loaded=true;status.error='';
      }
    } catch(error) {
      status.error=String(error.message||error);
      if(method==='Fetch.requestPaused') await wc.debugger.sendCommand('Fetch.continueRequest',
        {requestId:params.requestId}).catch(()=>{});
    }
  });
  try {
    wc.debugger.attach('1.3');
    Promise.all([wc.debugger.sendCommand('Runtime.enable'),wc.debugger.sendCommand('Fetch.enable',
      {patterns:[{urlPattern:gameURL+'*',requestStage:'Request'}]})])
      .catch(error=>{status.error=error.message;});
  } catch(error) {status.error=error.message;}
}
app.on('browser-window-created',(_event,window)=>attach(window));
const timer=setInterval(async()=>{
  if(busy||stopped)return;
  busy=true;
  try {
    try {
      const value=JSON.parse(await fs.readFile(path.join(home,'settings.json'),'utf8'));
      if(validConfig(value)) config=value;
    } catch(error) {
      if(error.code!=='ENOENT') status.error='无法读取倍率配置。';
    }
    for(const c of controllers) {
      if(!c.loaded||c.wc.isDestroyed()) continue;
      for(const contextId of c.contexts) {
        const result=await c.wc.debugger.sendCommand('Runtime.evaluate',{
          expression:`(${updateAttack.toString()})(${JSON.stringify(config)})`,contextId,returnByValue:true
        }).catch(()=>null);
        if(result&&result.result&&result.result.value) status={...status,...result.result.value};
      }
    }
    status.patched_loaded=Array.from(controllers).some(c=>c.loaded);
    await publish();
  } catch(error) {status.error=String(error.message||error);}
  finally {busy=false;}
},500);
app.once('before-quit',()=>{stopped=true;clearInterval(timer);});
