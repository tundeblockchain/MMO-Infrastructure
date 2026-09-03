/**
 * Skill Catalog - MMO-4 / MMO-5
 *
 * Skill definitions with coefficients and scaling vectors.
 * 8 skills per class; kind: active | passive | reaction.
 *
 * MMO-5 additions:
 * - Skill timing (cast/active/recovery milliseconds)
 * - Resource gen/spend with % max resource support
 * - Stagger coefficients
 * - PvP multipliers
 * - Per-stack and conditional coefficients
 */

import { ClassId, ElementId, ResourceId, SkillKind } from './common';

export interface ScalingVector {
  /** Stat that contributes to scaling */
  stat:
    | 'attackPower'
    | 'spellPower'
    | 'techPower'
    | 'devicePower'
    | 'healingPower'
    | 'maxHp'
    | 'missingHp'
    | 'missingHpPercent'
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

/**
 * Per-stack coefficient progression for skills like Sever.
 * Index 0 = 1 stack, index 1 = 2 stacks, etc.
 */
export interface PerStackCoefficients {
  /** Per-stack base power values (index 0 = 1 stack) */
  basePowerPerStack: number[];
  /** Per-stack scaling vectors (optional, same for all stacks if not provided) */
  scalingPerStack?: ScalingVector[][];
}

/**
 * Conditional coefficient modifiers (e.g., marked target, below HP threshold).
 */
export interface ConditionalCoefficient {
  /** Condition identifier */
  condition: 'marked' | 'below_hp_threshold' | 'above_hp_threshold' | 'perfect_timing' | 'flanking' | 'stealthed' | 'boss_target';
  /** Threshold value for HP conditions (as decimal, e.g., 0.25 = 25%) */
  threshold?: number;
  /** Modified base power when condition is met */
  basePower?: number;
  /** Modified scaling when condition is met */
  scaling?: ScalingVector[];
  /** Damage multiplier when condition is met (1.0 = no change) */
  damageMultiplier?: number;
}

/**
 * Stagger mechanics for a skill.
 */
export interface StaggerCoefficients {
  /** Base stagger value dealt */
  staggerPower: number;
  /** Stagger resistance granted during skill (0-1) */
  staggerResist?: number;
  /** Whether this skill can stagger on hit */
  canStagger: boolean;
  /** Per-stack stagger values for stack-based skills */
  perStackStagger?: number;
  /** Stagger per hit for multi-hit skills */
  staggerPerHit?: number;
  /** Bonus stagger for specific conditions (e.g., elite/boss, center hit) */
  bonusStagger?: {
    condition: string;
    value: number;
  };
  /** Status buildup value (e.g., Armor Break, Burn, Freeze, Shock, Poison) */
  statusBuildup?: {
    status: string;
    value: number;
  };
}

/**
 * PvP balance multipliers (all as decimals, 1.0 = no change).
 */
export interface PvPMultipliers {
  /** Damage multiplier in PvP */
  damageMultiplier?: number;
  /** Healing multiplier in PvP */
  healingMultiplier?: number;
  /** Duration multiplier for effects in PvP (seconds override) */
  durationMultiplier?: number;
  /** Duration override in seconds for PvP */
  durationSeconds?: number;
  /** Cooldown multiplier in PvP (>1 = longer cooldown) */
  cooldownMultiplier?: number;
  /** Cooldown override in seconds for PvP */
  cooldownSeconds?: number;
  /** Stagger multiplier in PvP */
  staggerMultiplier?: number;
  /** Resource generation/cost override */
  resourceOverride?: {
    resourceId: ResourceId;
    amount: number;
  };
  /** Max targets/hits override for PvP */
  maxTargets?: number;
  /** Max hits per target override for PvP */
  maxHitsPerTarget?: number;
  /** Effect value override (e.g., crit bonus, range, etc.) */
  effectOverrides?: Record<string, number>;
  /** Additional status/debuff changes in PvP */
  statusOverrides?: Record<string, number>;
  /** Missing health cap for execute-type skills in PvP */
  missingHealthCap?: number;
  /** Exhausted debuff duration in PvP */
  exhaustedDurationSeconds?: number;
}

/**
 * Active phase type for special skill behaviors.
 * - 'standard': Normal active duration in ms
 * - 'hold': Channeled skill held until release (Brace)
 * - 'stance': Stance maintained until cancelled (Dead Focus)
 * - 'reaction': Automatic trigger, no active phase (Thermal Shock)
 * - 'deploy': Placement/deployment action (Pulse Mine, Sanctuary)
 * - 'buff': Instant buff application (Venom Edge)
 * - 'summon': Summoning action (Phantom Double)
 * - 'channel': Fixed duration channel (Mana Conduit)
 */
export type ActivePhaseType = 'standard' | 'hold' | 'stance' | 'reaction' | 'deploy' | 'buff' | 'summon' | 'channel';

/**
 * Skill timing in milliseconds for precise combat sync.
 */
export interface SkillTiming {
  /** Cast/windup time before skill activates (ms) */
  castMs: number;
  /** Active/execution time of the skill (ms), or 0 for special phases */
  activeMs: number;
  /** Recovery/backswing time after skill completes (ms) */
  recoveryMs: number;
  /** Type of active phase for special behaviors */
  activePhaseType?: ActivePhaseType;
}

/**
 * Resource generation or consumption configuration.
 */
export interface ResourceEffect {
  /** Resource type affected */
  resourceId: ResourceId;
  /** Amount (positive = generate, negative = consume) */
  amount: number;
  /** If true, amount is % of max resource (0.10 = 10%), not flat */
  isPercentOfMax: boolean;
  /** Per-target bonus (for AoE skills like Cleaving Strike) */
  perTargetBonus?: number;
}

export interface SkillCoefficients {
  /** Base damage/healing amount (power coefficient) */
  basePower: number;
  /** Scaling vectors for damage calculation */
  scaling: ScalingVector[];
  /** Element type for damage skills */
  element?: ElementId;
  /** Status effect applied on hit */
  appliesStatus?: string;
  /** Duration of applied effect in seconds */
  effectDuration?: number;
  /** Per-stack coefficient progression (e.g., Sever momentum stacks) */
  perStack?: PerStackCoefficients;
  /** Conditional modifiers (e.g., marked target, execute threshold) */
  conditionals?: ConditionalCoefficient[];
  /** Multi-target coefficients (e.g., Remote Detonation turret/drone/mine) */
  targetVariants?: Record<string, { basePower: number; scaling?: ScalingVector[] }>;
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
  /** Resource consumed (null for no cost) - DEPRECATED: use resourceEffects */
  resourceId: ResourceId | null;
  /** Resource cost amount - DEPRECATED: use resourceEffects */
  resourceCost: number;
  /** Resource generation and consumption effects */
  resourceEffects?: ResourceEffect[];
  /** Cooldown in seconds (0 for no cooldown) */
  cooldownSeconds: number;
  /** Internal cooldown per target in seconds (for reactions like Thermal Shock) */
  internalCooldownSeconds?: number;
  /** Maximum charges (1 for standard cooldown behavior) */
  charges: number;
  /** Charge recharge time in seconds (if charges > 1) */
  chargeRechargeSeconds: number;
  /** Cast time in seconds (0 for instant) - see also timing for ms precision */
  castTimeSeconds: number;
  /** Whether skill can be cast while moving */
  castableWhileMoving: boolean;
  /** Range in units (0 for melee/self) */
  range: number;
  /** Damage/healing coefficients and scaling */
  coefficients: SkillCoefficients;
  /** Precise timing in milliseconds for combat sync */
  timing?: SkillTiming;
  /** Stagger mechanics */
  stagger?: StaggerCoefficients;
  /** PvP balance multipliers */
  pvpMultipliers?: PvPMultipliers;
  /** Duration of anti-death effect in seconds (Divine Intervention) */
  antiDeathDurationSeconds?: number;
  /** Exhausted debuff duration in seconds after using skill */
  exhaustedDurationSeconds?: number;
  /** Skill rank within the class (for unlock order) */
  unlockLevel: number;
  /** Icon asset path */
  iconPath: string;
}
