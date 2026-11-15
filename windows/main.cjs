'use strict';
const {app, BrowserWindow, dialog, ipcMain, shell} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {HelperService} = require('./core.cjs');

app.setName('造梦西游攻击助手');
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let window, service, timer, ticking = false, closing = false, stopped = false, mutationBusy = false;
let lastError = '';
const support = path.join(app.getPath('appData'),'ZMXYDropControlWindows');
async function diagnose(event, detail) {
  try {
    const file = path.join(support,'windows-diagnostic.log');
    await fs.mkdir(support,{recursive:true});
    const size = (await fs.stat(file).catch(()=>({size:0}))).size;
    if (size > 128000) await fs.writeFile(file,'');
    await fs.appendFile(file,JSON.stringify({time:new Date().toISOString(),event,detail})+'\n');
  } catch {}
}
const documentURL = pathToFileURL(path.join(__dirname,'index.html')).href;
const resources = app.isPackaged ? path.join(__dirname,'shared') : path.join(__dirname,'..','zm5-only');
let version = app.getVersion();
async function state() {return {...service.snapshot(), version, ...(lastError ? {error:lastError} : {})};}
async function broadcast() {
  if (window && !window.isDestroyed()) window.webContents.send('helper:state',await state());
}
async function chooseClient() {
  const selection = await dialog.showOpenDialog(window,{
    title:'选择带 PepperFlash 的兼容 Windows 客户端 EXE',
    properties:['openFile'],filters:[{name:'Windows 客户端',extensions:['exe']}]
  });
  if (selection.canceled) return {cancelled:true};
  await service.selectClient(selection.filePaths[0]);
  return {path:selection.filePaths[0]};
}
async function connect(game) {
  if (!service.snapshot().clientPath) {
    if ((await chooseClient()).cancelled) return {cancelled:true};
  }
  try {return await service.connect(game);}
  catch (error) {
    if (error.code !== 'NEED_SWF') throw error;
    const selection = await dialog.showOpenDialog(window,{
      title:`选择造梦西游${game.slice(2)}官方原始 SWF（可先使用「官方游戏文件」下载）`,
      properties:['openFile'],filters:[{name:'官方原始游戏文件',extensions:['swf']}]
    });
    if (selection.canceled) return {cancelled:true};
    return service.connect(game,selection.filePaths[0]);
  }
}
async function downloadGame(game) {
  const result = await service.downloadGame(game);
  const selection = await dialog.showSaveDialog(window,{
    title:`保存造梦西游${game.slice(2)}官方游戏文件`,
    defaultPath:path.join(app.getPath('downloads'),`zm${game.slice(2)}-${result.filename}`),
    filters:[{name:'SWF 游戏文件',extensions:['swf']}]
  });
  if (selection.canceled || !selection.filePath) return {cancelled:true};
  await fs.writeFile(selection.filePath,result.data);
  return {path:selection.filePath};
}
const actions = {
  init:() => state(),
  chooseClient,
  apply:payload => service.apply(payload.game,payload.values),
  setDisplayMode:payload => service.setDisplayMode(payload.mode),
  command:payload => service.command(payload.game,payload),
  connect:payload => connect(payload.game),
  downloadGame:payload => downloadGame(payload.game),
  downloadClient:() => shell.openExternal('https://webres.61.com/common/flash/common_micro.html?game=mole'),
  restoreClient:async() => {
    await service.restoreClient();return {restored:true};
  }
};
ipcMain.handle('helper:call',async(event,action,payload) => {
  if (!window || event.sender !== window.webContents || event.senderFrame?.url !== documentURL) return {ok:false,error:'无效的窗口请求。'};
  if (!Object.hasOwn(actions,action)) return {ok:false,error:'未知操作。'};
  if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload))) return {ok:false,error:'参数无效。'};
  const mutating = action !== 'init' && action !== 'downloadClient';
  if (mutating && mutationBusy) return {ok:false,error:'正在准备游戏文件，请稍候。'};
  if (mutating) mutationBusy = true;
  try {
    if (mutating) await diagnose(action,{game:payload?.game,clientPath:service.snapshot().clientPath});
    const value = await actions[action](payload || {});
    await broadcast();return {ok:true,value};
  } catch(error) {await diagnose(action+'-error',String(error.stack || error));return {ok:false,error:String(error.message || error)};}
  finally {if (mutating) mutationBusy = false;}
});

app.on('second-instance',() => {if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
if (locked) app.whenReady().then(async() => {
  if (!app.isPackaged) {
    const plist = await fs.readFile(path.join(resources,'Info.plist'),'utf8');
    version = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] || version;
  }
  service = new HelperService({support,resources});
  await service.initialize();
  await diagnose('initialized',{support,clientPath:service.snapshot().clientPath,running:service.snapshot().running});
  window = new BrowserWindow({
    width:980,height:840,minWidth:720,minHeight:650,title:'造梦西游攻击助手',
    backgroundColor:'#f6f6f3',autoHideMenuBar:true,show:false,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate',event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback) => callback(false));
  window.once('ready-to-show',() => window.show());
  timer = setInterval(async() => {
    if(ticking || closing) return;
    ticking = true;
    try {await service.tick();lastError='';await broadcast();}
    catch(error) {lastError=String(error.message || error);await diagnose('heartbeat-error',lastError);await broadcast();}
    finally {ticking=false;}
  },1000);
  await window.loadFile(path.join(__dirname,'index.html'));
  await diagnose('window-loaded',{});
}).catch(error => {
  diagnose('startup-error',String(error.stack || error));
  dialog.showErrorBox('造梦西游助手启动失败',String(error.stack || error));
  app.quit();
});
app.on('window-all-closed',() => app.quit());
app.on('before-quit',event => {
  if(stopped || !service) return;
  event.preventDefault();
  if(closing) return;
  closing=true;clearInterval(timer);
  // Expire the heartbeat before exiting. The bridge also expires it on crashes.
  Promise.resolve(service.shutdown()).catch(()=>{}).finally(() => {stopped=true;app.quit();});
});
