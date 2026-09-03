/**
 * Game Metadata Models - MMO-4
 *
 * Versioned game data catalogs stored in DynamoDB.
 * Published versions are IMMUTABLE - new changes require a new version number.
 */

/** Status of a catalog version */
export type CatalogStatus = 'draft' | 'published';

/** Resource types used by player classes */
export type ResourceId =
  | 'resolve'
  | 'focus'
  | 'mana'
  | 'charge'
  | 'radiance'
  | 'judgement'
  | 'momentum';

/** Skill activation types */
export type SkillKind = 'active' | 'passive' | 'reaction';

/** Element types for damage/effects */
export type ElementId =
  | 'physical'
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'arcane'
  | 'nature'
  | 'shadow'
  | 'radiant';

/** Resonance types for class synergies */
export type ResonanceId =
  | 'valor'
  | 'precision'
  | 'arcana'
  | 'innovation'
  | 'sanctuary'
  | 'subterfuge';

/** Status effect categories */
export type StatusCategory = 'buff' | 'debuff' | 'control' | 'dot' | 'hot';

/** Base class identifiers */
export type ClassId =
  | 'vanguard'
  | 'ranger'
  | 'arcanist'
  | 'machinist'
  | 'warden'
  | 'shade';

// ============================================================================
// Combat Constants
// ============================================================================

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
  /**
   * Extensible map for additional constants that may be added in future versions.
   * Allows adding new tunable values without schema changes.
   */
  additionalConstants?: Record<string, number | boolean | string>;
}

// ============================================================================
// Class Catalog
// ============================================================================

/**
 * Seven primary stats for character builds.
 */
export interface PrimaryStats {
  /** Physical damage scaling */
  strength: number;
  /** Attack speed, dodge recovery */
  finesse: number;
  /** Max HP, healing received */
  vitality: number;
  /** Spell power scaling */
  intellect: number;
  /** Hit chance, weak point chance */
  precision: number;
  /** Crit chance, proc chance */
  luck: number;
  /** Tech/device power scaling */
  tech: number;
}

export interface ClassStartingStats extends PrimaryStats {
  /** Base health points */
  hp: number;
  /** Base resource pool size */
  resourcePool: number;
  /** Base armor value */
  armor: number;
  /** Base attack power (derived, but stored for reference) */
  attackPower: number;
  /** Base spell power (derived, but stored for reference) */
  spellPower: number;
  /** Base movement speed (units per second) */
  movementSpeed: number;
}

export interface ClassDefinition {
  /** Unique class identifier */
  classId: ClassId;
  /** Display name for the class */
  displayName: string;
  /** Class description */
  description: string;
  /** Primary resource used by this class */
  primaryResource: ResourceId;
  /** Secondary resource (if any) */
  secondaryResource?: ResourceId;
  /** Starting stats for new characters of this class */
  startingStats: ClassStartingStats;
  /** Associated resonance type */
  resonance: ResonanceId;
  /** Role tags for matchmaking/UI */
  roles: ('tank' | 'healer' | 'dps' | 'support')[];
}

// ============================================================================
// Skill Catalog
// ============================================================================

export interface ScalingVector {
  /** Stat that contributes to scaling */
  stat:
    | 'attackPower'
    | 'spellPower'
    | 'techPower'
    | 'maxHp'
    | 'armor'
    | 'level'
    | 'strength'
    | 'finesse'
    | 'vitality'
    | 'intellect'
    | 'precision'
    | 'luck'
    | 'tech';
  /** Coefficient for this stat (e.g., 0.5 = 50% of stat value) */
  coefficient: number;
}

export interface SkillCoefficients {
  /** Base damage/healing amount */
  basePower: number;
  /** Scaling vectors for damage calculation */
  scaling: ScalingVector[];
  /** Element type for damage skills */
  element?: ElementId;
  /** Status effect applied on hit */
  appliesStatus?: string;
  /** Duration of applied effect in seconds */
  effectDuration?: number;
}

export interface SkillDefinition {
  /** Stable skill identifier (never changes once assigned) */
  skillId: string;
  /** Class this skill belongs to */
  classId: ClassId;
  /** Display name */
  displayName: string;
  /** Skill description */
  description: string;
  /** Activation type */
  kind: SkillKind;
  /** Resource consumed (null for no cost) */
  resourceId: ResourceId | null;
  /** Resource cost amount */
  resourceCost: number;
  /** Cooldown in seconds (0 for no cooldown) */
  cooldownSeconds: number;
  /** Maximum charges (1 for standard cooldown behavior) */
  charges: number;
  /** Charge recharge time in seconds (if charges > 1) */
  chargeRechargeSeconds: number;
  /** Cast time in seconds (0 for instant) */
  castTimeSeconds: number;
  /** Whether skill can be cast while moving */
  castableWhileMoving: boolean;
  /** Range in units (0 for melee/self) */
  range: number;
  /** Damage/healing coefficients and scaling */
  coefficients: SkillCoefficients;
  /** Skill rank within the class (for unlock order) */
  unlockLevel: number;
  /** Icon asset path */
  iconPath: string;
}

// ============================================================================
// Status Effects
// ============================================================================

export interface StatusDefinition {
  /** Unique status identifier */
  statusId: string;
  /** Display name */
  displayName: string;
  /** Description of the effect */
  description: string;
  /** Category of effect */
  category: StatusCategory;
  /** Maximum stacks */
  maxStacks: number;
  /** Whether the effect can be dispelled */
  dispellable: boolean;
  /** Whether the effect persists through death */
  persistsThroughDeath: boolean;
  /** Icon asset path */
  iconPath: string;
}

// ============================================================================
// Element Definitions
// ============================================================================

export interface ElementDefinition {
  /** Element identifier */
  elementId: ElementId;
  /** Display name */
  displayName: string;
  /** Color hex code for UI */
  color: string;
  /** Elements this is strong against (e.g., 1.25 = 25% bonus damage) */
  strongAgainst: Partial<Record<ElementId, number>>;
  /** Elements this is weak against (e.g., 0.75 = 25% reduced damage) */
  weakAgainst: Partial<Record<ElementId, number>>;
}

// ============================================================================
// Resonance Definitions
// ============================================================================

export interface ResonanceDefinition {
  /** Resonance identifier */
  resonanceId: ResonanceId;
  /** Display name */
  displayName: string;
  /** Description of resonance effects */
  description: string;
  /** Stat bonuses when party members share resonance */
  partyBonus: {
    stat: keyof ClassStartingStats;
    bonusPercent: number;
  }[];
}

// ============================================================================
// Catalog Version Container
// ============================================================================

export interface CatalogVersion {
  /** Version number (monotonically increasing) */
  version: number;
  /** Status: draft or published */
  status: CatalogStatus;
  /** When this version was created */
  createdAt: string;
  /** When this version was published (if published) */
  publishedAt?: string;
  /** Who created this version */
  createdBy: string;
  /** Optional release notes */
  releaseNotes?: string;
}

export interface CombatConstantsCatalog extends CatalogVersion {
  catalogType: 'combat-constants';
  data: CombatConstants;
}

export interface ClassCatalog extends CatalogVersion {
  catalogType: 'class';
  data: ClassDefinition[];
}

export interface SkillCatalog extends CatalogVersion {
  catalogType: 'skill';
  data: SkillDefinition[];
}

export interface StatusCatalog extends CatalogVersion {
  catalogType: 'status';
  data: StatusDefinition[];
}

export interface ElementCatalog extends CatalogVersion {
  catalogType: 'element';
  data: ElementDefinition[];
}

export interface ResonanceCatalog extends CatalogVersion {
  catalogType: 'resonance';
  data: ResonanceDefinition[];
}

export type GameCatalog =
  | CombatConstantsCatalog
  | ClassCatalog
  | SkillCatalog
  | StatusCatalog
  | ElementCatalog
  | ResonanceCatalog;

export type CatalogType = GameCatalog['catalogType'];
