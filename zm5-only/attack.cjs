'use strict';
// This callback is serialized into the Flash frame; keep it self-contained.
module.exports = function updateAttack(config) {
  window.__zmxyDropConfig = config;
  window.__zmxyAttackPower5 = function (base, attacker, target) {
    const c = window.__zmxyDropConfig || {};
    const age = Date.now() - c.updated_at;
    if (c.game !== 'zm5' || c.protocol !== 'zm5-attack-1.2' ||
        !['role','pet','fairy'].includes(attacker) || target !== 'monster' ||
        !Number.isFinite(base) || base <= 0 || !Number.isFinite(age) || age < 0 || age > 3500) return base;
    const value = c.attack_multiplier;
    const multiplier = Number.isInteger(value) && value >= 1 && value <= 2147483647 ? value : 1;
    const power = multiplier === 1 ? base : Math.min(2147483647, base * multiplier);
    window.__zmxyAttackTelemetry = {base_attack:base, effective_attack:power,
      attack_checks:((window.__zmxyAttackTelemetry || {}).attack_checks || 0) + 1};
    return power;
  };
  return window.__zmxyAttackTelemetry || {};
};
