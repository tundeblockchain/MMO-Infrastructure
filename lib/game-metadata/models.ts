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

export interface CombatConstants {
  /** Critical hit damage multiplier (e.g., 1.50 = 150% damage) */
  criticalDamageMultiplier: number;
  /** Base critical hit chance (e.g., 0.05 = 5%) */
  baseCriticalChance: number;
  /** Damage reduction per point of armor */
  armorReductionPerPoint: number;
  /** Maximum damage reduction from armor (e.g., 0.75 = 75%) */
  maxArmorReduction: number;
  /** Base dodge chance (e.g., 0.02 = 2%) */
  baseDodgeChance: number;
  /** Maximum dodge chance cap (e.g., 0.40 = 40%) */
  maxDodgeChance: number;
  /** Block damage reduction (e.g., 0.50 = 50%) */
  blockDamageReduction: number;
  /** Global cooldown in seconds */
  globalCooldown: number;
  /** HP regeneration per second out of combat (e.g., 0.05 = 5% max HP) */
  outOfCombatHpRegen: number;
  /** Resource regeneration per second out of combat (e.g., 0.10 = 10% max) */
  outOfCombatResourceRegen: number;
  /** Seconds until out-of-combat status */
  combatDropoffSeconds: number;
}

// ============================================================================
// Class Catalog
// ============================================================================

export interface ClassStartingStats {
  /** Base health points */
  hp: number;
  /** Base resource pool size */
  resourcePool: number;
  /** Base armor value */
  armor: number;
  /** Base attack power */
  attackPower: number;
  /** Base spell power */
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
  stat: 'attackPower' | 'spellPower' | 'maxHp' | 'armor' | 'level';
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
