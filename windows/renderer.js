'use strict';
const $ = id => document.getElementById(id);
const chapters = {
  zm1:['七魔王篇','v25928','悟空、唐僧与唐僧分身 · 仅本地角色','普通与技能伤害生效，唐僧和分身的回血动作不变。'],
  zm2:['十殿阎罗篇','v25928','本地双人角色 · 唐僧回血不变','普通与技能伤害生效，唐僧与影子的回血动作不变。'],
  zm3:['大闹天庭篇','v261029','四角色 · 仅本地副本','仅修改本地角色伤害，回血、辅助和联网竞技模式不变。'],
  zm4:['洪荒大劫篇','V58.8','本人角色 · 仅单人副本','本人角色的普通与技能伤害生效。'],
  zm5:['上古天帝篇','自动适配','角色、宠物、幻兽 · 仅单人副本','普通与技能伤害生效，独立真实伤害不变。']
};
let game = 'zm5', page = 'combat', busy = false, snapshot = {}, catalogs = {};
const drafts = Object.fromEntries(Object.keys(chapters).map(key => [key, {
  attack_multiplier:1, mode:'original', multiplier:1, experience_multiplier:1,
  boss_drop_enabled:false, boss_drop_item:'', strength_guaranteed:false,
  fusion_guaranteed:false, craft_max_attributes:false, craft_elements:''
}]));
let messageUntil = 0;
function message(title, detail = '', duration = 8000) {
  $('status-title').textContent = title;
  $('status-detail').textContent = detail;
  messageUntil = Date.now() + duration;
}
async function call(action, payload) {
  const response = await window.helper.call(action, payload);
  if (!response.ok) throw new Error(response.error || '操作失败');
  return response.value;
}
function option(select, value, label) {
  const element = document.createElement('option'); element.value = value; element.textContent = label; select.append(element);
}
function itemsForGame() { return catalogs[game]?.items || []; }
function populateItems() {
  const selected = $('item').value;
  $('item').replaceChildren();
  for (const item of itemsForGame().filter(item => item.category === $('category').value)) option($('item'), item.id, item.name);
  if (Array.from($('item').options).some(item => item.value === selected)) $('item').value = selected;
  updateItem();
}
function updateItem() {
  const item = itemsForGame().find(item => item.id === $('item').value);
  $('amount').value = item?.default_amount || 1;
  $('amount').disabled = item?.kind === 'repair';
  $('item-note').textContent = item?.kind === 'repair'
    ? '只移动已有刑天之翼，保留属性，不创建新翅膀。请在游戏中自行保存。'
    : `数量 1～${item?.max_amount || 1}；仅点击时执行一次，收到回执后请在游戏中自行保存。`;
}
function renderPage() {
  for (const target of ['combat','craft','items']) {
    $(target).hidden = page !== target;
    $(`${target}-tab`).setAttribute('aria-selected', String(page === target));
  }
  $('features-form').hidden = page === 'items';
}
function renderChapter() {
  const [title,version,scope,note] = chapters[game], value = drafts[game];
  for (const button of document.querySelectorAll('[data-game]')) {button.classList.toggle('selected',button.dataset.game === game);button.setAttribute('aria-pressed',String(button.dataset.game === game));}
  $('chapter-title').textContent = title; $('chapter-version').textContent = version;
  $('scope').textContent = scope; $('scope-note').textContent = note;
  $('attack').value = value.attack_multiplier;
  $('features').hidden = !['zm1','zm2','zm3'].includes(game);
  $('craft-tab').hidden = $('items-tab').hidden = game === 'zm1';
  $('craft-tab').textContent = game === 'zm2' ? '强化与合成' : '炼丹与强化';
  $('items-tab').textContent = game === 'zm2' ? '强化石与翅膀' : '物品与宠物';
  $('experience-row').hidden = $('attributes-row').hidden = $('elements-row').hidden = game !== 'zm3';
  $('boss-row').hidden = game === 'zm1';
  $('fusion-row').hidden = $('player-row').hidden = game !== 'zm2';
  $('drop-mode').value = value.mode; $('drop').value = value.multiplier;
  $('experience').value = value.experience_multiplier;
  $('boss-enabled').checked = value.boss_drop_enabled;
  $('boss').replaceChildren();
  for (const item of catalogs[game]?.boss || []) option($('boss'),item.id,`${item.name}${item.role ? ' · '+item.role : ''}`);
  if (value.boss_drop_item) $('boss').value = value.boss_drop_item;
  $('strength').checked = value.strength_guaranteed;
  $('fusion').checked = value.fusion_guaranteed;
  $('attributes').checked = value.craft_max_attributes;
  $('elements').value = value.craft_elements;
  $('category').replaceChildren();
  for (const category of new Set(itemsForGame().map(item => item.category))) option($('category'),category,category);
  populateItems();
  if (game === 'zm1') page = 'combat';
  renderPage(); messageUntil = 0; renderState(snapshot);
}
function renderState(state) {
  snapshot = state || {};
  $('version').textContent = state.version || '';
  $('display-mode').value = state.displayMode || 'native';
  $('client-path').textContent = state.clientPath || '尚未选择兼容 Windows 客户端';
  const current = state.statuses?.[game];
  const connected = !!current;
  $('connection').textContent = connected ? '客户端已连接' : state.running ? '客户端运行中' : '游戏未打开';
  $('connection').classList.toggle('connected',connected);
  $('status-dot').classList.toggle('connected',!!current?.patched_loaded);
  if (state.commandMessages?.[game]) $('command-result').textContent = state.commandMessages[game];
  else $('command-result').textContent = '';
  if (Date.now() < messageUntil) return;
  if (state.error) return message('配置写入失败',state.error);
  if (!state.clientPath && state.clientError) return message('请重新选择游戏客户端',state.clientError,0);
  if (current?.error) return message('接入提示',current.error,0);
  if (!current) return message(state.running ? '正在等待客户端连接' : '先接入游戏，再应用倍率',state.running ? '请进入对应章节。若没有响应，请保存并退出游戏后重新接入。' : '接入前请保存并完全退出游戏，首次使用需准备兼容客户端。',0);
  if (!current.patched_loaded) return message('客户端已连接',`请在游戏中进入造梦西游${game.slice(2)}（${chapters[game][1]}）。`,0);
  const detail = Number.isFinite(current.base_attack) ? `最近伤害 ${current.base_attack} → ${current.effective_attack}` : '等待战斗伤害。';
  message(`造梦西游${game.slice(2)}已接入 · 当前 ${state.configs?.[game]?.attack_multiplier ?? drafts[game].attack_multiplier} 倍`,detail,0);
}
async function operation(task) {
  if (busy) return;
  busy = true;
  for (const id of ['connect','download-game','choose-client','restore-client','display-mode']) $(id).disabled = true;
  try {await task();} catch (error) {message('操作未完成',error.message,12000);}
  finally {busy = false;for (const id of ['connect','download-game','choose-client','restore-client','display-mode']) $(id).disabled = false;}
}
function integer(id, maximum, label) {
  const text = $(id).value.trim();
  if (!/^[0-9]+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text)<1 || Number(text)>maximum) throw new Error(`${label}请输入 1～${maximum} 的整数。`);
  return Number(text);
}
document.querySelectorAll('[data-game]').forEach(button => button.addEventListener('click',() => {game = button.dataset.game;page = 'combat';renderChapter();}));
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click',() => {page = button.dataset.page;renderPage();}));
$('attack-form').addEventListener('submit',event => {event.preventDefault();operation(async() => {
  const targetGame = game;
  const value = integer('attack',2147483647,'攻击倍率');
  await call('apply',{game:targetGame,values:{attack_multiplier:value}}); drafts[targetGame].attack_multiplier = value;
  if (game === targetGame) message(`已设置 ${value} 倍`,'请在游戏中验证伤害效果。');
});});
$('reset-attack').addEventListener('click',() => {$('attack').value = '1';$('attack-form').requestSubmit();});
$('display-mode').addEventListener('change',() => operation(async() => {
  await call('setDisplayMode',{mode:$('display-mode').value});
  message('游戏显示模式已设置','请先在游戏中保存并退出，再点击「接入并打开游戏」使显示模式生效。');
}));
$('features-form').addEventListener('submit',event => {event.preventDefault();operation(async() => {
  const targetGame = game;
  const values = page === 'combat' ? {
    mode:$('drop-mode').value,multiplier:integer('drop',1000,'爆率倍率'),
    ...(game !== 'zm1' ? {boss_drop_enabled:$('boss-enabled').checked,boss_drop_item:$('boss').value} : {}),
    ...(game === 'zm3' ? {experience_multiplier:integer('experience',1000,'经验倍率')} : {})
  } : {strength_guaranteed:$('strength').checked,...(game === 'zm2' ? {fusion_guaranteed:$('fusion').checked} : {craft_max_attributes:$('attributes').checked,craft_elements:$('elements').value})};
  await call('apply',{game:targetGame,values});Object.assign(drafts[targetGame],values);
  if (game === targetGame) message('本章设置已应用','新开关只作用于本次运行，请在游戏中验证。');
});});
$('category').addEventListener('change',populateItems);$('item').addEventListener('change',updateItem);
$('items').addEventListener('submit',event => {event.preventDefault();operation(async() => {
  const item = itemsForGame().find(item => item.id === $('item').value);
  if (!item) throw new Error('请先选择物品。');
  const amount = integer('amount',item.max_amount,'数量');
  await call('command',{game,item:item.id,amount,player:Number($('player').value)});
  $('command-result').textContent = '请求已发送，等待游戏回执…';
});});
$('connect').addEventListener('click',() => operation(async() => {message('正在准备接入…','检查客户端和游戏文件，请稍候。',120000);const result = await call('connect',{game});message(result?.cancelled ? '已取消接入' : '已打开游戏客户端',result?.cancelled ? '' : '请在客户端中进入对应章节。');}));
$('download-game').addEventListener('click',() => operation(async() => {message('正在检查官方游戏文件…','将验证文件内容，并让你选择保存位置。',120000);const result = await call('downloadGame',{game});message(result?.cancelled ? '已取消保存' : '官方游戏文件已保存',result?.path || '');}));
$('download-client').addEventListener('click',() => operation(async() => {await call('downloadClient');message('已打开官方客户端下载页面','请选择 Windows 客户端，安装后在这里选择其 EXE 文件。');}));
$('choose-client').addEventListener('click',() => operation(async() => {const result = await call('chooseClient');if(!result?.cancelled) message('已选择客户端','请保存并完全退出游戏，再点击「接入并打开游戏」。');}));
$('restore-client').addEventListener('click',() => operation(async() => {const result = await call('restoreClient');if (!result?.cancelled) message('客户端已恢复','已还原接入前备份的程序入口和配置。');}));
window.helper.onState(renderState);
(async() => {
  const names = {'':'保持原始',jin:'金',mu:'木',shui:'水',huo:'火',tu:'土'};
  for (const value of ['', 'jin','mu','shui','huo','tu','jin+mu','jin+shui','jin+huo','jin+tu','mu+shui','mu+huo','mu+tu','shui+huo','shui+tu','huo+tu']) option($('elements'),value,value ? value.split('+').map(key=>names[key]).join(' + ') : names['']);
  try {const initial = await call('init'); catalogs = initial.catalogs || {};Object.entries(initial.configs || {}).forEach(([key,value])=>Object.assign(drafts[key],value));snapshot=initial;renderChapter();} catch(error) {message('助手初始化失败',error.message);}
})();
