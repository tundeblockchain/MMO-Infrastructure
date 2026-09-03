/**
 * Skill Catalog - MMO-4
 *
 * Skill definitions with coefficients and scaling vectors.
 * 8 skills per class; kind: active | passive | reaction.
 */

import { ClassId, ElementId, ResourceId, SkillKind } from './common';

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
