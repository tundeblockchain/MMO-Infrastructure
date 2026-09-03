/**
 * Seed Catalog V1 Tests - MMO-5
 *
 * Tests for seed data completeness and correctness.
 * Key requirements:
 * - 6 classes with exact starting primary stats
 * - 48 skills (6 classes × 8 skills)
 * - Thermal Shock must have kind='reaction'
 * - Combat constants as decimals
 * - Published catalogs are immutable
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import {
  GameMetadataRepository,
  PublishedCatalogImmutableError,
  CombatConstantsCatalog,
  ClassCatalog,
  SkillCatalog,
  StatusCatalog,
  ElementCatalog,
  ResonanceCatalog,
  COMBAT_CONSTANTS_V1,
  CLASSES_V1,
  SKILLS_V1,
  STATUSES_V1,
  ELEMENTS_V1,
  RESONANCES_V1,
  seedCatalogV1,
} from '../lib/game-metadata';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Seed Catalog V1 - Data Validation', () => {
  describe('Combat Constants - Decimal Values', () => {
    it('should have criticalDamageMultiplier as 1.50 (150%)', () => {
      expect(COMBAT_CONSTANTS_V1.critical.criticalDamageMultiplier).toBe(1.50);
    });

    it('should have physicalPower.strengthMultiplier as 2', () => {
      expect(COMBAT_CONSTANTS_V1.powerScaling.physicalPower.strengthMultiplier).toBe(2);
    });

    it('should have physicalPower.levelMultiplier as 1.5', () => {
      expect(COMBAT_CONSTANTS_V1.powerScaling.physicalPower.levelMultiplier).toBe(1.5);
    });

    it('should have baseHitChance as 0.90 (90%)', () => {
      expect(COMBAT_CONSTANTS_V1.accuracy.baseHitChance).toBe(0.90);
    });

    it('should have baseCritChance as 0.05 (5%)', () => {
      expect(COMBAT_CONSTANTS_V1.critical.baseCritChance).toBe(0.05);
    });

    it('should have blockDamageReduction as 0.50 (50%)', () => {
      expect(COMBAT_CONSTANTS_V1.defense.blockDamageReduction).toBe(0.50);
    });

    it('should have glancingHit.damageMultiplier as 0.50 (50%)', () => {
      expect(COMBAT_CONSTANTS_V1.glancingHit.damageMultiplier).toBe(0.50);
    });

    it('should have glancingHit.canCrit as false', () => {
      expect(COMBAT_CONSTANTS_V1.glancingHit.canCrit).toBe(false);
    });

    it('should have glancingHit.canStagger as false', () => {
      expect(COMBAT_CONSTANTS_V1.glancingHit.canStagger).toBe(false);
    });

    it('should have accuracyBonus.precisionConstant as 300', () => {
      expect(COMBAT_CONSTANTS_V1.accuracy.accuracyBonus.precisionConstant).toBe(300);
    });

    it('should have accuracyBonus.maxAccuracyBonus as 0.15 (15%)', () => {
      expect(COMBAT_CONSTANTS_V1.accuracy.accuracyBonus.maxAccuracyBonus).toBe(0.15);
    });

    it('should have weakPoint.precisionMultiplier as 0.0015', () => {
      expect(COMBAT_CONSTANTS_V1.accuracy.weakPoint.precisionMultiplier).toBe(0.0015);
    });

    it('should have critChance.luckConstant as 500', () => {
      expect(COMBAT_CONSTANTS_V1.critical.critChance.luckConstant).toBe(500);
    });

    it('should have critChance.maxLuckCritBonus as 0.30 (30%)', () => {
      expect(COMBAT_CONSTANTS_V1.critical.critChance.maxLuckCritBonus).toBe(0.30);
    });

    it('should have procChance.luckDivisor as 500', () => {
      expect(COMBAT_CONSTANTS_V1.critical.procChance.luckDivisor).toBe(500);
    });

    it('should have defenseConstant.baseConstant as 200', () => {
      expect(COMBAT_CONSTANTS_V1.defense.defenseConstant.baseConstant).toBe(200);
    });

    it('should have defenseConstant.levelMultiplier as 15', () => {
      expect(COMBAT_CONSTANTS_V1.defense.defenseConstant.levelMultiplier).toBe(15);
    });

    it('should have status.resistanceConstant as 100', () => {
      expect(COMBAT_CONSTANTS_V1.status.resistanceConstant).toBe(100);
    });

    it('should have statCaps.softCap as 100', () => {
      expect(COMBAT_CONSTANTS_V1.statCaps.softCap).toBe(100);
    });

    it('should have statCaps.hardCap as 150', () => {
      expect(COMBAT_CONSTANTS_V1.statCaps.hardCap).toBe(150);
    });

    it('should have speed.attackSpeed.finesseConstant as 400', () => {
      expect(COMBAT_CONSTANTS_V1.speed.attackSpeed.finesseConstant).toBe(400);
    });

    it('should have speed.dodgeRecovery.finesseConstant as 1000', () => {
      expect(COMBAT_CONSTANTS_V1.speed.dodgeRecovery.finesseConstant).toBe(1000);
    });

    it('should have vitality.maxHp.vitalityDivisor as 100', () => {
      expect(COMBAT_CONSTANTS_V1.vitality.maxHp.vitalityDivisor).toBe(100);
    });

    it('should have vitality.healingReceived.vitalityDivisor as 1000', () => {
      expect(COMBAT_CONSTANTS_V1.vitality.healingReceived.vitalityDivisor).toBe(1000);
    });

    it('should have devicePower.techDivisor as 100', () => {
      expect(COMBAT_CONSTANTS_V1.powerScaling.devicePower.techDivisor).toBe(100);
    });

    it('should have spellPower multipliers (INT*2 + Level*1)', () => {
      expect(COMBAT_CONSTANTS_V1.powerScaling.spellPower.intellectMultiplier).toBe(2);
      expect(COMBAT_CONSTANTS_V1.powerScaling.spellPower.levelMultiplier).toBe(1);
    });

    it('should have techPower multipliers (Tech*2 + Level*1)', () => {
      expect(COMBAT_CONSTANTS_V1.powerScaling.techPower.techMultiplier).toBe(2);
      expect(COMBAT_CONSTANTS_V1.powerScaling.techPower.levelMultiplier).toBe(1);
    });

    it('should have stat allocation bands as specified', () => {
      expect(COMBAT_CONSTANTS_V1.statAllocationBands).toHaveLength(4);
      
      const band1 = COMBAT_CONSTANTS_V1.statAllocationBands.find(b => b.minLevel === 1);
      expect(band1).toBeDefined();
      expect(band1!.maxLevel).toBe(10);
      expect(band1!.pointsPerLevel).toBe(2);

      const band2 = COMBAT_CONSTANTS_V1.statAllocationBands.find(b => b.minLevel === 11);
      expect(band2).toBeDefined();
      expect(band2!.maxLevel).toBe(30);
      expect(band2!.pointsPerLevel).toBe(3);

      const band3 = COMBAT_CONSTANTS_V1.statAllocationBands.find(b => b.minLevel === 31);
      expect(band3).toBeDefined();
      expect(band3!.maxLevel).toBe(60);
      expect(band3!.pointsPerLevel).toBe(4);

      const band4 = COMBAT_CONSTANTS_V1.statAllocationBands.find(b => b.minLevel === 61);
      expect(band4).toBeDefined();
      expect(band4!.pointsPerLevel).toBe(5);
    });
  });

  describe('Classes - Exact Primary Stats', () => {
    it('should have exactly 6 classes', () => {
      expect(CLASSES_V1).toHaveLength(6);
    });

    it('should have no empty data array', () => {
      expect(CLASSES_V1.length).toBeGreaterThan(0);
    });

    it('should have Vanguard with correct primary stats (12/7/12/4/6/5/4)', () => {
      const vanguard = CLASSES_V1.find(c => c.classId === 'vanguard');
      expect(vanguard).toBeDefined();
      expect(vanguard!.startingStats.strength).toBe(12);
      expect(vanguard!.startingStats.finesse).toBe(7);
      expect(vanguard!.startingStats.vitality).toBe(12);
      expect(vanguard!.startingStats.intellect).toBe(4);
      expect(vanguard!.startingStats.precision).toBe(6);
      expect(vanguard!.startingStats.luck).toBe(5);
      expect(vanguard!.startingStats.tech).toBe(4);
      expect(vanguard!.primaryResource).toBe('resolve');
      expect(vanguard!.resonance).toBe('valor');
    });

    it('should have Ranger with correct primary stats (6/11/6/4/13/7/3)', () => {
      const ranger = CLASSES_V1.find(c => c.classId === 'ranger');
      expect(ranger).toBeDefined();
      expect(ranger!.startingStats.strength).toBe(6);
      expect(ranger!.startingStats.finesse).toBe(11);
      expect(ranger!.startingStats.vitality).toBe(6);
      expect(ranger!.startingStats.intellect).toBe(4);
      expect(ranger!.startingStats.precision).toBe(13);
      expect(ranger!.startingStats.luck).toBe(7);
      expect(ranger!.startingStats.tech).toBe(3);
      expect(ranger!.primaryResource).toBe('focus');
      expect(ranger!.resonance).toBe('precision');
    });

    it('should have Arcanist with correct primary stats (3/6/5/14/8/7/7)', () => {
      const arcanist = CLASSES_V1.find(c => c.classId === 'arcanist');
      expect(arcanist).toBeDefined();
      expect(arcanist!.startingStats.strength).toBe(3);
      expect(arcanist!.startingStats.finesse).toBe(6);
      expect(arcanist!.startingStats.vitality).toBe(5);
      expect(arcanist!.startingStats.intellect).toBe(14);
      expect(arcanist!.startingStats.precision).toBe(8);
      expect(arcanist!.startingStats.luck).toBe(7);
      expect(arcanist!.startingStats.tech).toBe(7);
      expect(arcanist!.primaryResource).toBe('mana');
      expect(arcanist!.resonance).toBe('arcana');
    });

    it('should have Machinist with correct primary stats (4/7/6/8/10/5/14)', () => {
      const machinist = CLASSES_V1.find(c => c.classId === 'machinist');
      expect(machinist).toBeDefined();
      expect(machinist!.startingStats.strength).toBe(4);
      expect(machinist!.startingStats.finesse).toBe(7);
      expect(machinist!.startingStats.vitality).toBe(6);
      expect(machinist!.startingStats.intellect).toBe(8);
      expect(machinist!.startingStats.precision).toBe(10);
      expect(machinist!.startingStats.luck).toBe(5);
      expect(machinist!.startingStats.tech).toBe(14);
      expect(machinist!.primaryResource).toBe('charge');
      expect(machinist!.resonance).toBe('innovation');
    });

    it('should have Warden with correct primary stats (5/6/10/12/6/6/5)', () => {
      const warden = CLASSES_V1.find(c => c.classId === 'warden');
      expect(warden).toBeDefined();
      expect(warden!.startingStats.strength).toBe(5);
      expect(warden!.startingStats.finesse).toBe(6);
      expect(warden!.startingStats.vitality).toBe(10);
      expect(warden!.startingStats.intellect).toBe(12);
      expect(warden!.startingStats.precision).toBe(6);
      expect(warden!.startingStats.luck).toBe(6);
      expect(warden!.startingStats.tech).toBe(5);
      expect(warden!.primaryResource).toBe('radiance');
      expect(warden!.secondaryResource).toBe('judgement');
      expect(warden!.resonance).toBe('sanctuary');
    });

    it('should have Shade with correct primary stats (7/13/5/4/9/10/2)', () => {
      const shade = CLASSES_V1.find(c => c.classId === 'shade');
      expect(shade).toBeDefined();
      expect(shade!.startingStats.strength).toBe(7);
      expect(shade!.startingStats.finesse).toBe(13);
      expect(shade!.startingStats.vitality).toBe(5);
      expect(shade!.startingStats.intellect).toBe(4);
      expect(shade!.startingStats.precision).toBe(9);
      expect(shade!.startingStats.luck).toBe(10);
      expect(shade!.startingStats.tech).toBe(2);
      expect(shade!.primaryResource).toBe('momentum');
      expect(shade!.resonance).toBe('subterfuge');
    });

    it('should use only original class names (no Ragnarok/Arknights/Endfield)', () => {
      const validNames = ['vanguard', 'ranger', 'arcanist', 'machinist', 'warden', 'shade'];
      const classIds = CLASSES_V1.map(c => c.classId);
      
      expect(classIds).toEqual(expect.arrayContaining(validNames));
      expect(classIds).toHaveLength(6);
      
      const forbiddenNames = [
        'knight', 'wizard', 'assassin', 'priest', 'monk', 'crusader',
        'sniper', 'guard', 'medic', 'specialist', 'caster', 'defender',
        'doctor', 'texas', 'lappland', 'exusiai', 'silverash',
      ];
      
      for (const classId of classIds) {
        expect(forbiddenNames).not.toContain(classId.toLowerCase());
      }
    });
  });

  describe('Skills - 48 Skills Total', () => {
    it('should have exactly 48 skills (6 classes × 8 skills)', () => {
      expect(SKILLS_V1).toHaveLength(48);
    });

    it('should have no empty data array', () => {
      expect(SKILLS_V1.length).toBeGreaterThan(0);
    });

    it('should have 8 skills per class', () => {
      const classIds = ['vanguard', 'ranger', 'arcanist', 'machinist', 'warden', 'shade'];
      
      for (const classId of classIds) {
        const classSkills = SKILLS_V1.filter(s => s.classId === classId);
        expect(classSkills).toHaveLength(8);
      }
    });

    it('should have Thermal Shock with kind="reaction" (CRITICAL)', () => {
      const thermalShock = SKILLS_V1.find(s => s.skillId === 'arcanist_thermal_shock');
      expect(thermalShock).toBeDefined();
      expect(thermalShock!.kind).toBe('reaction');
      expect(thermalShock!.displayName).toBe('Thermal Shock');
    });

    it('should have stable skillIds following pattern classId_skill_name', () => {
      for (const skill of SKILLS_V1) {
        expect(skill.skillId).toMatch(/^[a-z]+_[a-z_]+$/);
        expect(skill.skillId.startsWith(skill.classId)).toBe(true);
      }
    });

    it('should have valid skill coefficients with basePower and scaling', () => {
      for (const skill of SKILLS_V1) {
        expect(skill.coefficients).toBeDefined();
        expect(typeof skill.coefficients.basePower).toBe('number');
        expect(Array.isArray(skill.coefficients.scaling)).toBe(true);
      }
    });

    it('should have Vanguard damage skills with physical power scaling', () => {
      const vanguardDamageSkills = SKILLS_V1.filter(
        s => s.classId === 'vanguard' &&
          s.kind === 'active' &&
          s.coefficients.basePower > 0 &&
          s.coefficients.scaling.length > 0
      );
      
      for (const skill of vanguardDamageSkills) {
        const hasAttackPower = skill.coefficients.scaling.some(s => s.stat === 'attackPower');
        expect(hasAttackPower).toBe(true);
      }
    });

    it('should have Arcanist skills with spell power scaling', () => {
      const arcanistSkills = SKILLS_V1.filter(s => s.classId === 'arcanist' && s.kind !== 'passive');
      const attackSkills = arcanistSkills.filter(s => s.coefficients.basePower > 0);
      
      for (const skill of attackSkills) {
        const hasSpellPower = skill.coefficients.scaling.some(s => s.stat === 'spellPower');
        expect(hasSpellPower || skill.coefficients.basePower === 0).toBe(true);
      }
    });

    it('should have Cleaving Strike generating Resolve', () => {
      const cleavingStrike = SKILLS_V1.find(s => s.skillId === 'vanguard_cleaving_strike');
      expect(cleavingStrike).toBeDefined();
      expect(cleavingStrike!.coefficients.basePower).toBe(1.50);
    });

    it('should have all Shade momentum costs correctly set', () => {
      const smokVeil = SKILLS_V1.find(s => s.skillId === 'shade_smoke_veil');
      expect(smokVeil).toBeDefined();
      expect(smokVeil!.resourceCost).toBe(2);
      
      const execution = SKILLS_V1.find(s => s.skillId === 'shade_execution');
      expect(execution).toBeDefined();
      expect(execution!.resourceCost).toBe(3);
    });
  });

  describe('Statuses - Referenced Effects', () => {
    it('should have no empty data array', () => {
      expect(STATUSES_V1.length).toBeGreaterThan(0);
    });

    it('should include Flame status', () => {
      const flame = STATUSES_V1.find(s => s.statusId === 'flame');
      expect(flame).toBeDefined();
      expect(flame!.category).toBe('dot');
    });

    it('should include Frost status', () => {
      const frost = STATUSES_V1.find(s => s.statusId === 'frost');
      expect(frost).toBeDefined();
    });

    it('should include Mark status', () => {
      const mark = STATUSES_V1.find(s => s.statusId === 'mark');
      expect(mark).toBeDefined();
      expect(mark!.category).toBe('debuff');
    });

    it('should include Venom/Poison status', () => {
      const venom = STATUSES_V1.find(s => s.statusId === 'venom');
      expect(venom).toBeDefined();
      expect(venom!.category).toBe('dot');
    });

    it('should include Armor Break status', () => {
      const armorBreak = STATUSES_V1.find(s => s.statusId === 'armor_break');
      expect(armorBreak).toBeDefined();
      expect(armorBreak!.category).toBe('debuff');
    });

    it('should include Weaken status', () => {
      const weaken = STATUSES_V1.find(s => s.statusId === 'weaken');
      expect(weaken).toBeDefined();
      expect(weaken!.category).toBe('debuff');
    });

    it('should include Exhausted status', () => {
      const exhausted = STATUSES_V1.find(s => s.statusId === 'exhausted');
      expect(exhausted).toBeDefined();
      expect(exhausted!.category).toBe('debuff');
    });

    it('should include Harmony status', () => {
      const harmony = STATUSES_V1.find(s => s.statusId === 'harmony');
      expect(harmony).toBeDefined();
      expect(harmony!.category).toBe('hot');
    });
  });

  describe('Elements - 8 Types with Relationships', () => {
    it('should have no empty data array', () => {
      expect(ELEMENTS_V1.length).toBeGreaterThan(0);
    });

    it('should have exactly 8 elements', () => {
      expect(ELEMENTS_V1).toHaveLength(8);
    });

    it('should include all required elements', () => {
      const elementIds = ELEMENTS_V1.map(e => e.elementId);
      expect(elementIds).toContain('physical');
      expect(elementIds).toContain('fire');
      expect(elementIds).toContain('ice');
      expect(elementIds).toContain('lightning');
      expect(elementIds).toContain('arcane');
      expect(elementIds).toContain('nature');
      expect(elementIds).toContain('shadow');
      expect(elementIds).toContain('radiant');
    });

    it('should have strongAgainst/weakAgainst as decimals', () => {
      const fire = ELEMENTS_V1.find(e => e.elementId === 'fire');
      expect(fire).toBeDefined();
      expect(fire!.strongAgainst.ice).toBe(1.25);
      expect(fire!.strongAgainst.nature).toBe(1.25);
    });
  });

  describe('Resonances - 6 Types', () => {
    it('should have no empty data array', () => {
      expect(RESONANCES_V1.length).toBeGreaterThan(0);
    });

    it('should have exactly 6 resonances', () => {
      expect(RESONANCES_V1).toHaveLength(6);
    });

    it('should include all class resonances', () => {
      const resonanceIds = RESONANCES_V1.map(r => r.resonanceId);
      expect(resonanceIds).toContain('valor');
      expect(resonanceIds).toContain('precision');
      expect(resonanceIds).toContain('arcana');
      expect(resonanceIds).toContain('innovation');
      expect(resonanceIds).toContain('sanctuary');
      expect(resonanceIds).toContain('subterfuge');
    });

    it('should have partyBonus entries', () => {
      for (const resonance of RESONANCES_V1) {
        expect(resonance.partyBonus).toBeDefined();
        expect(resonance.partyBonus.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('Seed Helper - Repository Integration', () => {
  let repository: GameMetadataRepository;
  const tableName = 'test-table';

  beforeEach(() => {
    ddbMock.reset();
    repository = new GameMetadataRepository({
      tableName,
      client: ddbMock as unknown as DynamoDBDocumentClient,
    });
  });

  describe('seedCatalogV1', () => {
    it('should seed and publish all six catalog types at v1', async () => {
      let putCallCount = 0;
      let updateCallCount = 0;
      const storedItems: Record<string, unknown> = {};

      ddbMock.on(PutCommand).callsFake((input) => {
        putCallCount++;
        const pk = input.Item.PK as string;
        const sk = input.Item.SK as string;
        storedItems[`${pk}#${sk}`] = { ...input.Item };
        return {};
      });

      ddbMock.on(UpdateCommand).callsFake((input) => {
        updateCallCount++;
        const pk = input.Key.PK as string;
        const sk = input.Key.SK as string;
        const key = `${pk}#${sk}`;
        const existing = storedItems[key] as Record<string, unknown>;
        if (existing) {
          existing.status = 'published';
          existing.publishedAt = new Date().toISOString();
        }
        return {
          Attributes: existing || {},
        };
      });

      ddbMock.on(GetCommand).callsFake((input) => {
        const pk = input.Key.PK as string;
        const sk = input.Key.SK as string;
        const key = `${pk}#${sk}`;
        return {
          Item: storedItems[key] || undefined,
        };
      });

      const result = await seedCatalogV1(repository);

      expect(putCallCount).toBe(6);
      expect(updateCallCount).toBe(6);

      expect(result.combatConstants).toBeDefined();
      expect(result.classes).toBeDefined();
      expect(result.skills).toBeDefined();
      expect(result.statuses).toBeDefined();
      expect(result.elements).toBeDefined();
      expect(result.resonances).toBeDefined();

      expect(result.combatConstants.status).toBe('published');
      expect(result.classes.status).toBe('published');
      expect(result.skills.status).toBe('published');
      expect(result.statuses.status).toBe('published');
      expect(result.elements.status).toBe('published');
      expect(result.resonances.status).toBe('published');
    });

    it('should create catalogs with correct data', async () => {
      const storedItems: Record<string, unknown> = {};

      ddbMock.on(PutCommand).callsFake((input) => {
        const pk = input.Item.PK as string;
        const sk = input.Item.SK as string;
        storedItems[`${pk}#${sk}`] = { ...input.Item };
        return {};
      });

      ddbMock.on(UpdateCommand).callsFake((input) => {
        const pk = input.Key.PK as string;
        const sk = input.Key.SK as string;
        const key = `${pk}#${sk}`;
        const existing = storedItems[key] as Record<string, unknown>;
        if (existing) {
          existing.status = 'published';
          existing.publishedAt = new Date().toISOString();
        }
        return { Attributes: existing || {} };
      });

      ddbMock.on(GetCommand).callsFake((input) => {
        const pk = input.Key.PK as string;
        const sk = input.Key.SK as string;
        return { Item: storedItems[`${pk}#${sk}`] || undefined };
      });

      const result = await seedCatalogV1(repository);

      expect(result.classes.data).toHaveLength(6);
      expect(result.skills.data).toHaveLength(48);
      expect(result.elements.data).toHaveLength(8);
      expect(result.resonances.data).toHaveLength(6);
    });
  });

  describe('Published Catalog Immutability', () => {
    it('should reject attempts to overwrite published catalog', async () => {
      const publishedCombatConstants: CombatConstantsCatalog = {
        catalogType: 'combat-constants',
        version: 1,
        status: 'published',
        createdAt: '2024-01-01T00:00:00.000Z',
        publishedAt: '2024-01-02T00:00:00.000Z',
        createdBy: 'seed-helper',
        data: COMBAT_CONSTANTS_V1,
      };

      ddbMock.on(UpdateCommand).rejects(
        new ConditionalCheckFailedException({
          message: 'The conditional request failed',
          $metadata: {},
        })
      );

      ddbMock.on(GetCommand).resolves({
        Item: publishedCombatConstants,
      });

      await expect(
        repository.updateDraftCatalog<CombatConstantsCatalog>('combat-constants', 1, {
          data: { ...COMBAT_CONSTANTS_V1, critical: { ...COMBAT_CONSTANTS_V1.critical, criticalDamageMultiplier: 2.0 } },
        })
      ).rejects.toThrow(PublishedCatalogImmutableError);
    });

    it('should reject republishing an already published catalog', async () => {
      const publishedCatalog: ClassCatalog = {
        catalogType: 'class',
        version: 1,
        status: 'published',
        createdAt: '2024-01-01T00:00:00.000Z',
        publishedAt: '2024-01-02T00:00:00.000Z',
        createdBy: 'seed-helper',
        data: CLASSES_V1,
      };

      ddbMock.on(UpdateCommand).rejects(
        new ConditionalCheckFailedException({
          message: 'The conditional request failed',
          $metadata: {},
        })
      );

      ddbMock.on(GetCommand).resolves({
        Item: publishedCatalog,
      });

      await expect(
        repository.publishCatalogVersion('class', 1)
      ).rejects.toThrow(PublishedCatalogImmutableError);
    });
  });
});
