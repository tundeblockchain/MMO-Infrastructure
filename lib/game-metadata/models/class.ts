/**
 * Class Catalog - MMO-4
 *
 * Class definitions with primary stats and starting values.
 * 6 base classes: Vanguard, Ranger, Arcanist, Machinist, Warden, Shade.
 */

import { ClassId, ResonanceId, ResourceId } from './common';

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
