/**
 * Game Metadata Models - MMO-4
 *
 * Barrel export for all model types.
 * Published versions are IMMUTABLE - new changes require a new version number.
 */

// Common types
export {
  CatalogStatus,
  ResourceId,
  SkillKind,
  ElementId,
  ResonanceId,
  StatusCategory,
  ClassId,
} from './common';

// Combat constants
export {
  PowerScalingConstants,
  SpeedConstants,
  VitalityConstants,
  AccuracyConstants,
  CriticalConstants,
  DefenseConstants,
  GlancingHitConstants,
  StatusConstants,
  StatAllocationBand,
  StatCapConstants,
  DodgeConstants,
  CombatTimingConstants,
  StaggerConstants,
  PvPConstants,
  CombatConstants,
} from './combat-constants';

// Class catalog
export {
  PrimaryStats,
  ClassStartingStats,
  ClassDefinition,
} from './class';

// Skill catalog
export {
  ScalingVector,
  PerStackCoefficients,
  ConditionalCoefficient,
  StaggerCoefficients,
  PvPMultipliers,
  SkillTiming,
  ResourceEffect,
  SkillCoefficients,
  SkillDefinition,
} from './skill';

// Status, element, resonance
export {
  StatusDefinition,
  ElementDefinition,
  ResonanceDefinition,
} from './status-element-resonance';

// Catalog version containers
export {
  CatalogVersion,
  CombatConstantsCatalog,
  ClassCatalog,
  SkillCatalog,
  StatusCatalog,
  ElementCatalog,
  ResonanceCatalog,
  GameCatalog,
  CatalogType,
} from './catalog';
