'use strict';
// Serialized into the Flash frame: no module variables or imports here.
module.exports = function updateAttack(config, catalogs = {}) {
  const previous = window.__zmxyDropConfig || {};
  if (previous.game !== config.game || previous.protocol !== config.protocol) {
    window.__zmxyAttackTelemetry = {};
    window.__zmxyHelperTelemetry = {};
    window.__zmxyForgeState = {depth:0, entered_at:0};
  }
  window.__zmxyDropConfig = config;
  window.__zmxyBossItems3 = catalogs.boss || [];
  window.__zmxyBossItems2 = catalogs.boss || [];
  function live(game, protocol) {
    const c = window.__zmxyDropConfig || {};
    const age = Date.now() - c.updated_at;
    return c.game === game && c.protocol === protocol && Number.isFinite(age) && age >= 0 && age <= 3500;
  }
  function helperLive(game = 'zm3') {
    return game === 'zm2' ? live('zm2', 'zm2-helper-1.0') : live('zm3', 'zm3-helper-2.0');
  }
  function result(base, multiplier) {
    const power = multiplier === 1 ? base : Math.min(2147483647, base * multiplier);
    window.__zmxyAttackTelemetry = {base_attack:base, effective_attack:power,
      attack_checks:((window.__zmxyAttackTelemetry || {}).attack_checks || 0) + 1};
    return power;
  }
  function record(values, counter) {
    const previous = window.__zmxyHelperTelemetry || {};
    window.__zmxyHelperTelemetry = {...previous, ...values, [counter]:(previous[counter] || 0) + 1};
  }
  function multiplierFor(game, protocol, base) {
    if (!live(game, protocol) || !Number.isFinite(base) || base <= 0) return null;
    const value = window.__zmxyDropConfig.attack_multiplier;
    return Number.isInteger(value) && value >= 1 && value <= 2147483647 ? value : 1;
  }
  window.__zmxyAttackPower5 = function (base, attacker, target) {
    if (!['role','pet','fairy'].includes(attacker) || target !== 'monster') return base;
    const multiplier = multiplierFor('zm5', 'zm5-attack-1.2', base);
    return multiplier === null ? base : result(base, multiplier);
  };
  window.__zmxyAttackPower4 = function (base, attacker, target, team, pk, targetPK, leagueBoss) {
    if (attacker !== 'role' || target !== 'monster' || team !== false || pk !== false ||
        targetPK !== false || leagueBoss !== false) return base;
    const multiplier = multiplierFor('zm4', 'zm4-attack-1.0', base);
    return multiplier === null ? base : result(base, multiplier);
  };
  window.__zmxyAttackPower3 = function (base, role, action) {
    if (!['Role1','Role2','Role3','Role4'].includes(role) || typeof action !== 'string' ||
        !/^hit[0-9]/.test(action) || (role === 'Role2' && ['hit6','hit7','hit8'].includes(action))) return base;
    const multiplier = multiplierFor('zm3', 'zm3-helper-2.0', base);
    return multiplier === null ? base : result(base, multiplier);
  };
  window.__zmxyAttackPower2 = function (base, role, action) {
    if (!['Role1','Role2','Role3','Role2Shadow'].includes(role) || typeof action !== 'string' ||
        !/^hit[0-9]/.test(action) || (['Role2','Role2Shadow'].includes(role) && action === 'hit5')) return base;
    const multiplier = multiplierFor('zm2', 'zm2-helper-1.0', base);
    return multiplier === null ? base : result(base, multiplier);
  };
  window.__zmxyDropRate = function (base) {
    if (!(helperLive('zm2') || helperLive()) || !Number.isFinite(base) || base < 0 || base > 1) return base;
    const c = window.__zmxyDropConfig;
    let rate = base;
    if (c.mode === 'guaranteed') rate = 1;
    else if (c.mode === 'multiplier' && Number.isInteger(c.multiplier) && c.multiplier >= 1 && c.multiplier <= 1000) {
      rate = Math.min(1, base * c.multiplier);
    }
    record({base_probability:base, effective_probability:rate}, 'drop_checks');
    return rate;
  };
  window.__zmxyBossDrop3 = function (isBoss) {
    const c = window.__zmxyDropConfig || {};
    if (!helperLive() || isBoss !== true || c.boss_drop_enabled !== true) return null;
    const item = window.__zmxyBossItems3.find(item => item.id === c.boss_drop_item);
    if (!item) return null;
    record({boss_drop_item:item.id}, 'boss_drop_checks');
    return {name:item.id, bigtype:item.bigtype};
  };
  window.__zmxyBossDrop2 = function (isBoss) {
    const c = window.__zmxyDropConfig || {};
    if (!helperLive('zm2') || isBoss !== true || c.boss_drop_enabled !== true) return null;
    const item = window.__zmxyBossItems2.find(item => item.id === c.boss_drop_item);
    if (!item) return null;
    record({boss_drop_item:item.id}, 'boss_drop_checks');
    return {name:item.id, bigtype:item.bigtype};
  };
  window.__zmxyExperience3 = function (base) {
    const c = window.__zmxyDropConfig || {}, value = c.experience_multiplier;
    if (!helperLive() || !Number.isFinite(base) || base <= 0 || !Number.isInteger(value) ||
        value < 1 || value > 1000) return base;
    const experience = value === 1 ? base : Math.max(base, Math.min(100000000, Math.floor(base * value)));
    record({base_experience:base, effective_experience:experience}, 'experience_checks');
    return experience;
  };
  window.__zmxyCraftRate = function (base, kind) {
    if (!Number.isFinite(base) || base < 0 || base > 1) return base;
    const supported = helperLive('zm2') ? ['strength','fusion'].includes(kind) : helperLive() && kind === 'strength';
    if (!supported) return base;
    const key = kind === 'strength' ? 'strength_guaranteed' : 'fusion_guaranteed';
    return window.__zmxyDropConfig[key] === true ? 1 : base;
  };
  // Store scope outside this tick's closure: Flash can synchronously nest calls.
  // An abandoned scope expires even if its matching leave was never delivered.
  window.__zmxyForgeState = window.__zmxyForgeState || {depth:0, entered_at:0};
  window.__zmxyForge3 = function (operation) {
    const state = window.__zmxyForgeState;
    const age = Date.now() - state.entered_at;
    if (!helperLive() || (state.depth && (!Number.isFinite(age) || age < 0 || age > 3500))) {
      state.depth = 0;
    }
    if (operation === 'leave') { state.depth = Math.max(0, state.depth - 1); return null; }
    if (!helperLive()) return null;
    if (operation === 'enter') {
      if (!state.depth) state.entered_at = Date.now();
      state.depth = Math.min(32, state.depth + 1);
      return null;
    }
    if (!state.depth) return null;
    const c = window.__zmxyDropConfig;
    if (operation === 'best') return c.craft_max_attributes === true;
    if (operation !== 'elements' || typeof c.craft_elements !== 'string') return null;
    const keys = ['jin','mu','shui','huo','tu'], chosen = c.craft_elements.split('+');
    if (chosen.length < 1 || chosen.length > 2 || new Set(chosen).size !== chosen.length ||
        chosen.some(key => !keys.includes(key))) return null;
    return Object.fromEntries(keys.map(key => [key, chosen.includes(key)]));
  };
  let commandReady = false;
  const commandGame = helperLive('zm2') ? 'zm2' : helperLive() ? 'zm3' : null;
  if (commandGame && typeof document !== 'undefined') {
    const method = commandGame === 'zm2' ? '__zmxyCommand2' : '__zmxyCommand3';
    const plugins = Array.from(document.querySelectorAll('embed,object')).filter(plugin => typeof plugin[method] === 'function');
    if (plugins.length === 1) {
      try {
        const probe = commandGame === 'zm2' ? '__mac_helper|probe|probe||1|1' : '__mac_helper|probe|probe||1';
        const receipt = plugins[0][method](probe);
        commandReady = Array.isArray(receipt) && receipt.length === 4 && receipt[0] === 'ready' && receipt[1] === 2;
      } catch (_) { commandReady = false; }
    }
  }
  return {...(window.__zmxyAttackTelemetry || {}), ...(window.__zmxyHelperTelemetry || {}), command_ready:commandReady};
};
