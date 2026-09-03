/**
 * Common Types - MMO-4
 *
 * Shared type definitions used across game metadata catalogs.
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
