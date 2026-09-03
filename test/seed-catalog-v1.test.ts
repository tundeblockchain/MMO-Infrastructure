/**
 * Seed Catalog V1 Tests - MMO-5
 *
 * Tests for seed data completeness and correctness.
 * Key requirements:
 * - 6 classes with exact starting primary stats
 * - 48 skills (6 classes × 8 skills)
 * - Thermal Shock must have kind='reaction' with internalCooldownSeconds=1
 * - Execution: missing-HP scaling with boss cap 3.25 P
 * - Sever: per-stack coefficients 1.50/2.00/2.60/3.30/4.20
 * - Divine Intervention: anti-death + 2.50 P heal
 * - Hunter's Mark: duration 8s
 * - Remote Detonation: separate turret/drone/mine coeffs
 * - Resonance bonusPercent as decimals (0.10, not 10)
 * - Combat constants as decimals
 * - Resource gen/spend with % max support
 * - Skill timing (castMs/activeMs/recoveryMs)
 * - Stagger coefficients
 * - PvP multipliers
 * - Per-stack and conditional coefficients
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

    it('should have stagger constants defined and non-empty', () => {
      expect(COMBAT_CONSTANTS_V1.stagger).toBeDefined();
      expect(COMBAT_CONSTANTS_V1.stagger.baseStaggerThreshold).toBeGreaterThan(0);
      expect(COMBAT_CONSTANTS_V1.stagger.staggerRecoveryRate).toBeGreaterThan(0);
      expect(COMBAT_CONSTANTS_V1.stagger.staggerDurationSeconds).toBeGreaterThan(0);
    });

    it('should have PvP constants defined and as decimals', () => {
      expect(COMBAT_CONSTANTS_V1.pvp).toBeDefined();
      expect(COMBAT_CONSTANTS_V1.pvp.globalDamageMultiplier).toBeLessThan(1);
      expect(COMBAT_CONSTANTS_V1.pvp.globalDamageMultiplier).toBeGreaterThan(0);
      expect(COMBAT_CONSTANTS_V1.pvp.globalHealingMultiplier).toBeLessThan(1);
      expect(COMBAT_CONSTANTS_V1.pvp.globalHealingMultiplier).toBeGreaterThan(0);
      expect(COMBAT_CONSTANTS_V1.pvp.ccDurationMultiplier).toBeLessThan(1);
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
  });

  describe('Thermal Shock - CRITICAL: kind=reaction, internalCooldown=1', () => {
    it('should have kind="reaction" (NOT active)', () => {
      const thermalShock = SKILLS_V1.find(s => s.skillId === 'arcanist_thermal_shock');
      expect(thermalShock).toBeDefined();
      expect(thermalShock!.kind).toBe('reaction');
    });

    it('should have internalCooldownSeconds=1 (per target)', () => {
      const thermalShock = SKILLS_V1.find(s => s.skillId === 'arcanist_thermal_shock');
      expect(thermalShock).toBeDefined();
      expect(thermalShock!.internalCooldownSeconds).toBe(1);
    });

    it('should have cooldownSeconds=0 (no global cooldown)', () => {
      const thermalShock = SKILLS_V1.find(s => s.skillId === 'arcanist_thermal_shock');
      expect(thermalShock).toBeDefined();
      expect(thermalShock!.cooldownSeconds).toBe(0);
    });
  });

  describe('Execution - Missing HP Scaling with Boss Cap', () => {
    it('should have missingHp scaling (NOT flat 5.00 P)', () => {
      const execution = SKILLS_V1.find(s => s.skillId === 'shade_execution');
      expect(execution).toBeDefined();
      expect(execution!.coefficients.basePower).not.toBe(5.00);
      
      const hasMissingHpScaling = execution!.coefficients.scaling.some(
        s => s.stat === 'missingHp'
      );
      expect(hasMissingHpScaling).toBe(true);
    });

    it('should have boss_target conditional with cap 3.25 P', () => {
      const execution = SKILLS_V1.find(s => s.skillId === 'shade_execution');
      expect(execution).toBeDefined();
      expect(execution!.coefficients.conditionals).toBeDefined();
      
      const bossCap = execution!.coefficients.conditionals!.find(
        c => c.condition === 'boss_target'
      );
      expect(bossCap).toBeDefined();
      expect(bossCap!.basePower).toBe(3.25);
    });

    it('should have below_hp_threshold conditional at 0.25 (25%)', () => {
      const execution = SKILLS_V1.find(s => s.skillId === 'shade_execution');
      expect(execution).toBeDefined();
      
      const hpThreshold = execution!.coefficients.conditionals!.find(
        c => c.condition === 'below_hp_threshold'
      );
      expect(hpThreshold).toBeDefined();
      expect(hpThreshold!.threshold).toBe(0.25);
    });
  });

  describe('Sever - Per-Stack Coefficients', () => {
    it('should have perStack coefficients 1.50/2.00/2.60/3.30/4.20', () => {
      const sever = SKILLS_V1.find(s => s.skillId === 'shade_sever');
      expect(sever).toBeDefined();
      expect(sever!.coefficients.perStack).toBeDefined();
      expect(sever!.coefficients.perStack!.basePowerPerStack).toEqual([1.50, 2.00, 2.60, 3.30, 4.20]);
    });

    it('should have scalingPerStack with FIN scaling per stack', () => {
      const sever = SKILLS_V1.find(s => s.skillId === 'shade_sever');
      expect(sever).toBeDefined();
      expect(sever!.coefficients.perStack!.scalingPerStack).toBeDefined();
      expect(sever!.coefficients.perStack!.scalingPerStack).toHaveLength(5);
    });
  });

  describe('Divine Intervention - Anti-Death + 2.50 P Heal', () => {
    it('should have basePower 2.50 (NOT 0.30 maxHp)', () => {
      const divineIntervention = SKILLS_V1.find(s => s.skillId === 'warden_divine_intervention');
      expect(divineIntervention).toBeDefined();
      expect(divineIntervention!.coefficients.basePower).toBe(2.50);
    });

    it('should have healingPower scaling', () => {
      const divineIntervention = SKILLS_V1.find(s => s.skillId === 'warden_divine_intervention');
      expect(divineIntervention).toBeDefined();
      
      const hasHealingPower = divineIntervention!.coefficients.scaling.some(
        s => s.stat === 'healingPower'
      );
      expect(hasHealingPower).toBe(true);
    });

    it('should apply divine_intervention status (anti-death)', () => {
      const divineIntervention = SKILLS_V1.find(s => s.skillId === 'warden_divine_intervention');
      expect(divineIntervention).toBeDefined();
      expect(divineIntervention!.coefficients.appliesStatus).toBe('divine_intervention');
    });
  });

  describe("Hunter's Mark - Duration 8s", () => {
    it('should have effectDuration=8 (NOT 12)', () => {
      const huntersMark = SKILLS_V1.find(s => s.skillId === 'ranger_hunters_mark');
      expect(huntersMark).toBeDefined();
      expect(huntersMark!.coefficients.effectDuration).toBe(8);
    });
  });

  describe('Remote Detonation - Separate Target Coefficients', () => {
    it('should have targetVariants with turret/drone/mine', () => {
      const remoteDetonation = SKILLS_V1.find(s => s.skillId === 'machinist_remote_detonation');
      expect(remoteDetonation).toBeDefined();
      expect(remoteDetonation!.coefficients.targetVariants).toBeDefined();
      expect(remoteDetonation!.coefficients.targetVariants!.turret).toBeDefined();
      expect(remoteDetonation!.coefficients.targetVariants!.drone).toBeDefined();
      expect(remoteDetonation!.coefficients.targetVariants!.mine).toBeDefined();
    });

    it('should have turret=1.10, drone=1.40, mine=2.40 DevicePower', () => {
      const remoteDetonation = SKILLS_V1.find(s => s.skillId === 'machinist_remote_detonation');
      expect(remoteDetonation).toBeDefined();
      
      const variants = remoteDetonation!.coefficients.targetVariants!;
      expect(variants.turret.basePower).toBe(1.10);
      expect(variants.drone.basePower).toBe(1.40);
      expect(variants.mine.basePower).toBe(2.40);
    });
  });

  describe('Resource Gen/Spend - % Max Resource Support', () => {
    it('should have Arcanist skills with isPercentOfMax=true', () => {
      const emberLance = SKILLS_V1.find(s => s.skillId === 'arcanist_ember_lance');
      expect(emberLance).toBeDefined();
      expect(emberLance!.resourceEffects).toBeDefined();
      expect(emberLance!.resourceEffects!.length).toBeGreaterThan(0);
      
      const manaEffect = emberLance!.resourceEffects!.find(e => e.resourceId === 'mana');
      expect(manaEffect).toBeDefined();
      expect(manaEffect!.isPercentOfMax).toBe(true);
    });

    it('should have resource generation skills (Cleaving Strike +8/target)', () => {
      const cleavingStrike = SKILLS_V1.find(s => s.skillId === 'vanguard_cleaving_strike');
      expect(cleavingStrike).toBeDefined();
      expect(cleavingStrike!.resourceEffects).toBeDefined();
      
      const resolveEffect = cleavingStrike!.resourceEffects!.find(e => e.resourceId === 'resolve');
      expect(resolveEffect).toBeDefined();
      expect(resolveEffect!.amount).toBeGreaterThan(0);
      expect(resolveEffect!.perTargetBonus).toBe(8);
    });

    it('should have all skills with resourceEffects when they have resource interactions', () => {
      const skillsWithResourceCost = SKILLS_V1.filter(
        s => s.resourceCost > 0 || s.resourceId !== null
      );
      
      for (const skill of skillsWithResourceCost) {
        if (skill.kind !== 'passive') {
          expect(skill.resourceEffects).toBeDefined();
        }
      }
    });
  });

  describe('Skill Timing - Cast/Active/Recovery Ms', () => {
    it('should have timing defined on all non-passive skills', () => {
      const nonPassiveSkills = SKILLS_V1.filter(s => s.kind !== 'passive');
      
      for (const skill of nonPassiveSkills) {
        expect(skill.timing).toBeDefined();
        expect(typeof skill.timing!.castMs).toBe('number');
        expect(typeof skill.timing!.activeMs).toBe('number');
        expect(typeof skill.timing!.recoveryMs).toBe('number');
      }
    });

    it('should have timing present on all skills', () => {
      for (const skill of SKILLS_V1) {
        expect(skill.timing).toBeDefined();
      }
    });
  });

  describe('Stagger Coefficients', () => {
    it('should have stagger defined on all skills', () => {
      for (const skill of SKILLS_V1) {
        expect(skill.stagger).toBeDefined();
        expect(typeof skill.stagger!.staggerPower).toBe('number');
        expect(typeof skill.stagger!.canStagger).toBe('boolean');
      }
    });

    it('should have stagger coefficients non-empty (at least some skills stagger)', () => {
      const skillsThatCanStagger = SKILLS_V1.filter(
        s => s.stagger && s.stagger.canStagger && s.stagger.staggerPower > 0
      );
      expect(skillsThatCanStagger.length).toBeGreaterThan(0);
    });
  });

  describe('PvP Multipliers', () => {
    it('should have pvpMultipliers present on combat skills', () => {
      const combatSkills = SKILLS_V1.filter(
        s => s.kind === 'active' && s.coefficients.basePower > 0
      );
      
      const skillsWithPvP = combatSkills.filter(s => s.pvpMultipliers);
      expect(skillsWithPvP.length).toBeGreaterThan(0);
    });

    it('should have PvP multipliers as decimals < 1 (damage reduction)', () => {
      const skillsWithPvPDamage = SKILLS_V1.filter(
        s => s.pvpMultipliers?.damageMultiplier !== undefined
      );
      
      for (const skill of skillsWithPvPDamage) {
        expect(skill.pvpMultipliers!.damageMultiplier).toBeLessThan(1);
        expect(skill.pvpMultipliers!.damageMultiplier).toBeGreaterThan(0);
      }
    });
  });

  describe('Conditional Coefficients', () => {
    it('should have conditionals on Piercing Shot (marked target)', () => {
      const piercingShot = SKILLS_V1.find(s => s.skillId === 'ranger_piercing_shot');
      expect(piercingShot).toBeDefined();
      expect(piercingShot!.coefficients.conditionals).toBeDefined();
      
      const markedConditional = piercingShot!.coefficients.conditionals!.find(
        c => c.condition === 'marked'
      );
      expect(markedConditional).toBeDefined();
      expect(markedConditional!.basePower).toBe(3.00);
    });

    it('should have conditionals on Counterblow (perfect timing)', () => {
      const counterblow = SKILLS_V1.find(s => s.skillId === 'vanguard_counterblow');
      expect(counterblow).toBeDefined();
      expect(counterblow!.coefficients.conditionals).toBeDefined();
      
      const perfectTimingConditional = counterblow!.coefficients.conditionals!.find(
        c => c.condition === 'perfect_timing'
      );
      expect(perfectTimingConditional).toBeDefined();
      expect(perfectTimingConditional!.basePower).toBe(3.20);
    });
  });

  describe('Resonance - Decimal Bonus Percentages', () => {
    it('should have all bonusPercent values as decimals (< 1)', () => {
      for (const resonance of RESONANCES_V1) {
        for (const bonus of resonance.partyBonus) {
          expect(bonus.bonusPercent).toBeLessThan(1);
          expect(bonus.bonusPercent).toBeGreaterThan(0);
        }
      }
    });

    it('should have valor bonusPercent as 0.10 (not 10)', () => {
      const valor = RESONANCES_V1.find(r => r.resonanceId === 'valor');
      expect(valor).toBeDefined();
      
      const hpBonus = valor!.partyBonus.find(b => b.stat === 'hp');
      expect(hpBonus).toBeDefined();
      expect(hpBonus!.bonusPercent).toBe(0.10);
    });

    it('should have exactly 6 resonances', () => {
      expect(RESONANCES_V1).toHaveLength(6);
    });
  });

  describe('Statuses - Non-Empty', () => {
    it('should have no empty data array', () => {
      expect(STATUSES_V1.length).toBeGreaterThan(0);
    });

    it('should include divine_intervention status', () => {
      const divineIntervention = STATUSES_V1.find(s => s.statusId === 'divine_intervention');
      expect(divineIntervention).toBeDefined();
      expect(divineIntervention!.persistsThroughDeath).toBe(true);
    });
  });

  describe('Elements - Non-Empty', () => {
    it('should have no empty data array', () => {
      expect(ELEMENTS_V1.length).toBeGreaterThan(0);
    });

    it('should have exactly 8 elements', () => {
      expect(ELEMENTS_V1).toHaveLength(8);
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

    it('should create catalogs with correct data counts', async () => {
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
