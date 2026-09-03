/**
 * Seed Helper - MMO-5
 *
 * Helper function to seed all catalog data at version 1.
 * Creates and publishes each catalog type.
 */

import {
  GameMetadataRepository,
  CombatConstantsCatalog,
  ClassCatalog,
  SkillCatalog,
  StatusCatalog,
  ElementCatalog,
  ResonanceCatalog,
} from '../index';
import { COMBAT_CONSTANTS_V1, COMBAT_CONSTANTS_V2 } from './combat-constants';
import { CLASSES_V1 } from './classes';
import { SKILLS_V1 } from './skills';
import { STATUSES_V1 } from './statuses';
import { ELEMENTS_V1 } from './elements';
import { RESONANCES_V1 } from './resonances';

export interface SeedOptions {
  version?: number;
  createdBy?: string;
  releaseNotes?: string;
}

export interface SeedResult {
  combatConstants: CombatConstantsCatalog;
  classes: ClassCatalog;
  skills: SkillCatalog;
  statuses: StatusCatalog;
  elements: ElementCatalog;
  resonances: ResonanceCatalog;
}

/**
 * Seeds all catalog types at the specified version and publishes them.
 * Creates catalog versions using createCatalogVersion, then publishes with publishCatalogVersion.
 *
 * @param repository - The GameMetadataRepository instance
 * @param options - Optional version (default 1), createdBy, and releaseNotes
 * @returns All published catalogs
 */
export async function seedCatalogV1(
  repository: GameMetadataRepository,
  options: SeedOptions = {}
): Promise<SeedResult> {
  const version = options.version ?? 1;
  const createdBy = options.createdBy ?? 'seed-helper';
  const releaseNotes = options.releaseNotes ?? 'Initial seed v1 from combat, class, and stat specs';

  // Create combat constants catalog v1
  const combatConstantsDraft = await repository.createCatalogVersion<CombatConstantsCatalog>({
    catalogType: 'combat-constants',
    version,
    createdBy,
    releaseNotes,
    data: COMBAT_CONSTANTS_V1,
  });
  await repository.publishCatalogVersion('combat-constants', version);
  const combatConstantsV1 = (await repository.getCatalogVersion<CombatConstantsCatalog>(
    'combat-constants',
    version
  ))!;

  // Create combat constants catalog v2 (MMO-9: ZoneServer additionalConstants)
  const combatConstantsV2Draft = await repository.createCatalogVersion<CombatConstantsCatalog>({
    catalogType: 'combat-constants',
    version: 2,
    createdBy,
    releaseNotes: 'MMO-9: Added ZoneServer additionalConstants keys',
    data: COMBAT_CONSTANTS_V2,
  });
  await repository.publishCatalogVersion('combat-constants', 2);
  const combatConstants = (await repository.getCatalogVersion<CombatConstantsCatalog>(
    'combat-constants',
    2
  ))!;

  // Create class catalog
  const classDraft = await repository.createCatalogVersion<ClassCatalog>({
    catalogType: 'class',
    version,
    createdBy,
    releaseNotes,
    data: CLASSES_V1,
  });
  await repository.publishCatalogVersion('class', version);
  const classes = (await repository.getCatalogVersion<ClassCatalog>('class', version))!;

  // Create skill catalog
  const skillDraft = await repository.createCatalogVersion<SkillCatalog>({
    catalogType: 'skill',
    version,
    createdBy,
    releaseNotes,
    data: SKILLS_V1,
  });
  await repository.publishCatalogVersion('skill', version);
  const skills = (await repository.getCatalogVersion<SkillCatalog>('skill', version))!;

  // Create status catalog
  const statusDraft = await repository.createCatalogVersion<StatusCatalog>({
    catalogType: 'status',
    version,
    createdBy,
    releaseNotes,
    data: STATUSES_V1,
  });
  await repository.publishCatalogVersion('status', version);
  const statuses = (await repository.getCatalogVersion<StatusCatalog>('status', version))!;

  // Create element catalog
  const elementDraft = await repository.createCatalogVersion<ElementCatalog>({
    catalogType: 'element',
    version,
    createdBy,
    releaseNotes,
    data: ELEMENTS_V1,
  });
  await repository.publishCatalogVersion('element', version);
  const elements = (await repository.getCatalogVersion<ElementCatalog>('element', version))!;

  // Create resonance catalog
  const resonanceDraft = await repository.createCatalogVersion<ResonanceCatalog>({
    catalogType: 'resonance',
    version,
    createdBy,
    releaseNotes,
    data: RESONANCES_V1,
  });
  await repository.publishCatalogVersion('resonance', version);
  const resonances = (await repository.getCatalogVersion<ResonanceCatalog>('resonance', version))!;

  return {
    combatConstants,
    classes,
    skills,
    statuses,
    elements,
    resonances,
  };
}
