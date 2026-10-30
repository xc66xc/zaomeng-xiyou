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
    url:'https://sda.4399.com/4399swf/upload_swf/ftp15/csya/20150127/1/v5880.swf'},
  zm3:{protocol:'zm3-helper-2.0',settings:'settings-zm3.json',statusFile:'status-zm3.json',patch:'patched-zm3.swf',
    url:'https://sda.4399.com/4399swf/upload_swf/ftp7/hanbao/20120107/6/v261029.swf'}
};
const controllers=new Set();
for(const [game,entry] of Object.entries(games)) {
  entry.config={game,protocol:entry.protocol,attack_multiplier:1,updated_at:0};
  entry.status={patched_loaded:false,attack_checks:0,error:''};
}
let busy=false,stopped=false;
let catalogs;
const handledCommands=new Set();
const unknownCommandError='物品操作结果未知，请先检查游戏背包；不会自动重试。';

async function loadCatalogs() {
  if(catalogs)return catalogs;
  const [boss,items]=await Promise.all(['boss-items-zm3.json','zm3-items.json'].map(async name=>
    JSON.parse(await fs.readFile(path.join(home,name),'utf8'))));
  if(!Array.isArray(boss)||!Array.isArray(items)||
      boss.some(item=>!item||typeof item.id!=='string'||typeof item.bigtype!=='string')||
      items.some(item=>!item||typeof item.id!=='string'||!['item','equipment','pet'].includes(item.kind)||
        !Number.isInteger(item.max_amount)||item.max_amount<1||item.max_amount>9999)) {
    throw new Error('造梦3物品目录校验失败，请重新接入。');
  }
  catalogs={boss,items};return catalogs;
}

function commandIdentity(command) {
  const age=command&&Date.now()-command.created_at;
  return command&&typeof command.id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(command.id)&&
    command.client_pid===process.pid&&Number.isFinite(age)&&age>=0&&age<=15000;
}

// Claim in this process before crossing the Flash boundary. Uncertain results
// are terminal; no automatic retry, including after frame/context replacement.
async function handleCommand(controller,contextId,generation) {
  const entry=games.zm3,command=entry.config.command;
  if(!commandIdentity(command)||handledCommands.has(command.id)||!entry.status.command_ready)return;
  if(controller.game!=='zm3'||controller.generation!==generation)return;
  const age=Date.now()-entry.config.updated_at;
  if(!Number.isFinite(age)||age<0||age>3500)return;
  if(handledCommands.size>=1024) {
    entry.status.command_result={id:command.id,state:'limit'};return;
  }
  handledCommands.add(command.id);
  const item=catalogs.items.find(item=>item.id===command.item);
  if(!item||!Number.isInteger(command.amount)||command.amount<1||command.amount>item.max_amount||
      (command.action!=='add_item'&&command.action!=='pet_potential')||
      (command.action==='pet_potential')!==(item.kind==='pet')) {
    entry.status.command_result={id:command.id,state:'invalid'};return;
  }
  entry.status.command_result={id:command.id,state:'processing'};
  const argument=['__mac_helper',command.id,command.action,command.item,command.amount].join('|');
  try {
    const result=await controller.wc.debugger.sendCommand('Runtime.evaluate',{
      expression:`(() => {const c=window.__zmxyDropConfig||{},age=Date.now()-c.updated_at;
        if(c.game!=='zm3'||c.protocol!=='zm3-helper-2.0'||!Number.isFinite(age)||age<0||age>3500)return ['not_ready',0,0,0];
        const p=Array.from(document.querySelectorAll('embed,object')).filter(p=>typeof p.__zmxyCommand3==='function');
        return p.length===1?p[0].__zmxyCommand3(${JSON.stringify(argument)}):['not_ready',0,0,0];})()`,
      contextId,returnByValue:true
    });
    const receipt=result&&result.result&&result.result.value;
    const states=['ok','invalid','not_ready','busy','full','missing','duplicate_stack','limit','unknown'];
    if(!Array.isArray(receipt)||receipt.length!==4||!states.includes(receipt[0])||
        receipt.slice(1).some(value=>!Number.isSafeInteger(value)||value<0))throw new Error('Invalid Flash receipt');
    entry.status.command_result={id:command.id,state:receipt[0],before:receipt[1],total:receipt[2],added:receipt[3]};
    if(receipt[0]!=='unknown'&&entry.status.error===unknownCommandError)entry.status.error='';
  } catch(error) {
    entry.status.command_result={id:command.id,state:'unknown'};
    entry.status.error=unknownCommandError;
  }
}

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
  const controller={wc,contexts:new Map(),game:null,frameId:null,generation:0};
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
        if(c.origin==='https://sda.4399.com'&&c.auxData&&c.auxData.isDefault) controller.contexts.set(c.id,c.auxData.frameId);
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
      const generation=c.generation;
      const chapterCatalogs=c.game==='zm3'?await loadCatalogs():{};
      entry.status.command_ready=false;
      for(const [contextId,frameId] of c.contexts) {
        if(frameId!==c.frameId||generation!==c.generation)continue;
        const result=await c.wc.debugger.sendCommand('Runtime.evaluate',{
          expression:`(${updateAttack.toString()})(${JSON.stringify(entry.config)},${JSON.stringify(chapterCatalogs)})`,contextId,returnByValue:true
        }).catch(error=>{
          if(/Cannot find context/.test(String(error.message||error))) c.contexts.delete(contextId);
          return null;
        });
        if(generation!==c.generation)break;
        if(result&&result.result&&result.result.value) entry.status={...entry.status,...result.result.value};
        if(c.game==='zm3')await handleCommand(c,contextId,generation);
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
