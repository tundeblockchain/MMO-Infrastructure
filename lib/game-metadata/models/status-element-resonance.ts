/**
 * Status, Element, and Resonance Definitions - MMO-4
 *
 * Status effects, elemental damage types, and class resonance synergies.
 */

import { ElementId, ResonanceId, StatusCategory } from './common';
import { ClassStartingStats } from './class';

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
