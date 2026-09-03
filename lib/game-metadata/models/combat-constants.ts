/**
 * Combat Constants - MMO-4
 *
 * All tunable combat math constants stored as decimals (150% = 1.50).
 * No hardcoded C# literals - MMO-9 reads these from the catalog.
 */

/**
 * Power scaling coefficients for derived stat calculations.
 * All multipliers/divisors stored as decimals (150% = 1.50).
 */
export interface PowerScalingConstants {
  /** PhysicalPower = Strength * strengthMultiplier + Level * levelMultiplier */
  physicalPower: {
    strengthMultiplier: number;
    levelMultiplier: number;
  };
  /** SpellPower = Intellect * intellectMultiplier + Level * levelMultiplier */
  spellPower: {
    intellectMultiplier: number;
    levelMultiplier: number;
  };
  /** TechPower = Tech * techMultiplier + Level * levelMultiplier */
  techPower: {
    techMultiplier: number;
    levelMultiplier: number;
  };
  /** DevicePower = Tech / techDivisor */
  devicePower: {
    techDivisor: number;
  };
}

/**
 * Attack speed and dodge recovery formulas.
 * AttackSpeed = Finesse / (Finesse + finesseConstant), capped at attackSpeedCap
 * DodgeRecovery = Finesse / (Finesse + finesseConstant)
 */
export interface SpeedConstants {
  attackSpeed: {
    finesseConstant: number;
    attackSpeedCap: number;
  };
  dodgeRecovery: {
    finesseConstant: number;
  };
}

/**
 * Health and healing derived stat formulas.
 * MaxHP bonus = Vitality / vitalityDivisor
 * HealingReceived bonus = Vitality / vitalityDivisor
 */
export interface VitalityConstants {
  maxHp: {
    vitalityDivisor: number;
  };
  healingReceived: {
    vitalityDivisor: number;
  };
}

/**
 * Accuracy and hit chance formulas.
 * HitChance = baseHitChance + AccuracyBonus
 * AccuracyBonus = (Precision / (Precision + precisionConstant)) * maxAccuracyBonus
 * WeakPointChance = Precision * precisionMultiplier
 */
export interface AccuracyConstants {
  baseHitChance: number;
  accuracyBonus: {
    precisionConstant: number;
    maxAccuracyBonus: number;
  };
  weakPoint: {
    precisionMultiplier: number;
  };
}

/**
 * Critical hit and proc chance formulas.
 * CritChance = baseCritChance + (Luck / (Luck + luckConstant)) * maxLuckCritBonus
 * ProcChance = Luck / luckDivisor
 */
export interface CriticalConstants {
  baseCritChance: number;
  critChance: {
    luckConstant: number;
    maxLuckCritBonus: number;
  };
  procChance: {
    luckDivisor: number;
  };
  criticalDamageMultiplier: number;
}

/**
 * Defense calculation constants.
 * DefenseConstant = baseConstant + (AttackerLevel * levelMultiplier)
 * DamageReduction = Defense / (Defense + DefenseConstant)
 */
export interface DefenseConstants {
  defenseConstant: {
    baseConstant: number;
    levelMultiplier: number;
  };
  armorReductionPerPoint: number;
  maxArmorReduction: number;
  blockDamageReduction: number;
}

/**
 * Glancing hit mechanics.
 * Glancing hits deal reduced damage, cannot crit, and do not stagger.
 */
export interface GlancingHitConstants {
  damageMultiplier: number;
  canCrit: boolean;
  canStagger: boolean;
}

/**
 * Status effect application formula.
 * ApplicationChance = StatusPower / (StatusPower + TargetStatusResistance + resistanceConstant)
 */
export interface StatusConstants {
  resistanceConstant: number;
}

/**
 * Stat point allocation rules per level band.
 */
export interface StatAllocationBand {
  minLevel: number;
  maxLevel: number;
  pointsPerLevel: number;
  allocationCostPerPoint: number;
}

/**
 * Stat cap configuration.
 */
export interface StatCapConstants {
  softCap: number;
  hardCap: number;
  softCapPenalty: number;
}

/**
 * Dodge mechanics constants.
 */
export interface DodgeConstants {
  baseDodgeChance: number;
  maxDodgeChance: number;
}

/**
 * Combat timing constants.
 */
export interface CombatTimingConstants {
  globalCooldown: number;
  outOfCombatHpRegen: number;
  outOfCombatResourceRegen: number;
  combatDropoffSeconds: number;
}

/**
 * Stagger system constants.
 */
export interface StaggerConstants {
  /** Base stagger threshold for players */
  baseStaggerThreshold: number;
  /** Stagger recovery rate per second */
  staggerRecoveryRate: number;
  /** Stagger duration when threshold exceeded (seconds) */
  staggerDurationSeconds: number;
  /** Stagger immunity duration after recovery (seconds) */
  staggerImmunitySeconds: number;
}

/**
 * Global PvP balance multipliers (all as decimals, 1.0 = no change).
 */
export interface PvPConstants {
  /** Global damage reduction in PvP */
  globalDamageMultiplier: number;
  /** Global healing reduction in PvP */
  globalHealingMultiplier: number;
  /** Crowd control duration multiplier in PvP */
  ccDurationMultiplier: number;
  /** Execute threshold modifier in PvP (additive) */
  executeThresholdModifier: number;
}

/**
 * Complete combat constants catalog.
 * All percentages stored as decimals (150% = 1.50, 15% = 0.15).
 * Extensible via additionalConstants map for future additions.
 */
export interface CombatConstants {
  powerScaling: PowerScalingConstants;
  speed: SpeedConstants;
  vitality: VitalityConstants;
  accuracy: AccuracyConstants;
  critical: CriticalConstants;
  defense: DefenseConstants;
  glancingHit: GlancingHitConstants;
  status: StatusConstants;
  statAllocationBands: StatAllocationBand[];
  statCaps: StatCapConstants;
  dodge: DodgeConstants;
  timing: CombatTimingConstants;
  stagger: StaggerConstants;
  pvp: PvPConstants;
  /**
   * Extensible map for additional constants that may be added in future versions.
   * Allows adding new tunable values without schema changes.
   */
  additionalConstants?: Record<string, number | boolean | string>;
}
