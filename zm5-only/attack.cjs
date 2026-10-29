'use strict';
// This callback is serialized into the Flash frame; keep it self-contained.
module.exports = function updateAttack(config) {
  if ((window.__zmxyDropConfig || {}).game !== config.game) window.__zmxyAttackTelemetry = {};
  window.__zmxyDropConfig = config;
  function result(base, multiplier) {
    const power = multiplier === 1 ? base : Math.min(2147483647, base * multiplier);
    window.__zmxyAttackTelemetry = {base_attack:base, effective_attack:power,
      attack_checks:((window.__zmxyAttackTelemetry || {}).attack_checks || 0) + 1};
    return power;
  }
  function multiplierFor(game, protocol, base) {
    const c = window.__zmxyDropConfig || {};
    const age = Date.now() - c.updated_at;
    if (c.game !== game || c.protocol !== protocol || !Number.isFinite(base) || base <= 0 ||
        !Number.isFinite(age) || age < 0 || age > 3500) return null;
    const value = c.attack_multiplier;
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
  return window.__zmxyAttackTelemetry || {};
};
