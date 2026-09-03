/**
 * Combat Constants Seed Data - MMO-5, MMO-9
 *
 * All tunable combat math constants from the combat formula spec.
 * Percentages as decimals: 150% → 1.50, 15% → 0.15, 5% → 0.05
 *
 * v1: Initial combat constants (MMO-5)
 * v2: Added additionalConstants for ZoneServer (MMO-9)
 */

import { CombatConstants } from '../models';

export const COMBAT_CONSTANTS_V1: CombatConstants = {
  powerScaling: {
    physicalPower: {
      strengthMultiplier: 2,
      levelMultiplier: 1.5,
    },
    spellPower: {
      intellectMultiplier: 2,
      levelMultiplier: 1,
    },
    techPower: {
      techMultiplier: 2,
      levelMultiplier: 1,
    },
    devicePower: {
      techDivisor: 100,
    },
  },
  speed: {
    attackSpeed: {
      finesseConstant: 400,
      attackSpeedCap: 2.5,
    },
    dodgeRecovery: {
      finesseConstant: 1000,
    },
  },
  vitality: {
    maxHp: {
      vitalityDivisor: 100,
    },
    healingReceived: {
      vitalityDivisor: 1000,
    },
  },
  accuracy: {
    baseHitChance: 0.90,
    accuracyBonus: {
      precisionConstant: 300,
      maxAccuracyBonus: 0.15,
    },
    weakPoint: {
      precisionMultiplier: 0.0015,
    },
  },
  critical: {
    baseCritChance: 0.05,
    critChance: {
      luckConstant: 500,
      maxLuckCritBonus: 0.30,
    },
    procChance: {
      luckDivisor: 500,
    },
    criticalDamageMultiplier: 1.50,
  },
  defense: {
    defenseConstant: {
      baseConstant: 200,
      levelMultiplier: 15,
    },
    armorReductionPerPoint: 0.001,
    maxArmorReduction: 0.75,
    blockDamageReduction: 0.50,
  },
  glancingHit: {
    damageMultiplier: 0.50,
    canCrit: false,
    canStagger: false,
  },
  status: {
    resistanceConstant: 100,
  },
  statAllocationBands: [
    { minLevel: 1, maxLevel: 10, pointsPerLevel: 2, allocationCostPerPoint: 1 },
    { minLevel: 11, maxLevel: 30, pointsPerLevel: 3, allocationCostPerPoint: 1 },
    { minLevel: 31, maxLevel: 60, pointsPerLevel: 4, allocationCostPerPoint: 2 },
    { minLevel: 61, maxLevel: 100, pointsPerLevel: 5, allocationCostPerPoint: 3 },
  ],
  statCaps: {
    softCap: 100,
    hardCap: 150,
    softCapPenalty: 0.50,
  },
  dodge: {
    baseDodgeChance: 0.02,
    maxDodgeChance: 0.40,
  },
  timing: {
    globalCooldown: 1.5,
    outOfCombatHpRegen: 0.05,
    outOfCombatResourceRegen: 0.10,
    combatDropoffSeconds: 10,
  },
  stagger: {
    baseStaggerThreshold: 100,
    staggerRecoveryRate: 10,
    staggerDurationSeconds: 2,
    staggerImmunitySeconds: 3,
  },
  pvp: {
    globalDamageMultiplier: 0.60,
    globalHealingMultiplier: 0.70,
    ccDurationMultiplier: 0.50,
    executeThresholdModifier: -0.10,
  },
  additionalConstants: {
    allocationCostBand1Max: 30,
    allocationCostBand2Max: 60,
    allocationCostBand3Max: 90,
    allocationCostBand4Max: 120,
    allocationCostBand1Cost: 1,
    allocationCostBand2Cost: 2,
    allocationCostBand3Cost: 3,
    allocationCostBand4Cost: 4,
    allocationCostBand5Cost: 5,
  },
};

/**
 * Combat Constants V2 - MMO-9
 *
 * Adds ZoneServer additionalConstants keys required for fail-close behavior.
 * All v1 fields remain identical; only additionalConstants extended.
 */
export const COMBAT_CONSTANTS_V2: CombatConstants = {
  ...COMBAT_CONSTANTS_V1,
  additionalConstants: {
    ...COMBAT_CONSTANTS_V1.additionalConstants,
    defaultAttackRange: 2.5,
    targetRange: 30,
    defaultAttackDamage: 10,
    defaultAttackCooldown: 1.5,
    defaultMonsterHp: 100,
    defaultMonsterSp: 50,
    defaultMonsterMoveSpeed: 3.0,
    monsterSpellRollChance: 0.01,
    aoiRadius: 30,
    lootDespawnSeconds: 60,
    lootPickupRadius: 2.5,
    lootVisibilityRadius: 30,
    playerRespawnSeconds: 4,
    monsterRespawnSeconds: 4,
  },
};
