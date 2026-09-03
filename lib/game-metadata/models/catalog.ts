/**
 * Catalog Version Container - MMO-4
 *
 * Versioned game data catalogs stored in DynamoDB.
 * Published versions are IMMUTABLE - new changes require a new version number.
 */

import { CatalogStatus } from './common';
import { CombatConstants } from './combat-constants';
import { ClassDefinition } from './class';
import { SkillDefinition } from './skill';
import { StatusDefinition, ElementDefinition, ResonanceDefinition } from './status-element-resonance';

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
