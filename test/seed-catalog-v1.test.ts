/**
 * Seed Catalog V1 Tests - MMO-5
 *
 * Tests for seed data completeness and correctness.
 * All values EXACTLY from v0.1 balance tables.
 *
 * Key assertions:
 * - Cleaving Strike: timing 0/350/300, stagger 20, PvP 0.90
 * - Execution: 2.00 P + 2.00 P × MissingHealthPercent, boss cap 3.25 P, timing 400/150/600, stagger 30, PvP 0.75
 * - Divine Intervention: anti-death 2s, heal 2.50 P + 1.00 INT, exhausted 90s, timing 250/100/350
 * - Thermal Shock: kind=reaction, 1s/target internal CD, 2.30 P + 1.00 INT
 * - Sever: per-stack 1.50/2.00/2.60/3.30/4.20, timing 250/200/550, stagger 15/stack
 * - Remote Detonation: turret 1.10 / drone 1.40 / mine 2.40, stagger 25/35/65, timing 150/100/500
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import {
  GameMetadataRepository,
  PublishedCatalogImmutableError,
  CombatConstantsCatalog,
  ClassCatalog,
  COMBAT_CONSTANTS_V1,
  CLASSES_V1,
  SKILLS_V1,
  SKILL_SPEC_VALUES,
  STATUSES_V1,
  ELEMENTS_V1,
  RESONANCES_V1,
  seedCatalogV1,
} from '../lib/game-metadata';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Seed Catalog V1 - Exact Spec Values', () => {
  describe('Cleaving Strike - Exact Values', () => {
    const cleavingStrike = SKILLS_V1.find(s => s.skillId === 'vanguard_cleaving_strike')!;

    it('should have timing 0/350/300', () => {
      expect(cleavingStrike.timing).toBeDefined();
      expect(cleavingStrike.timing!.castMs).toBe(0);
      expect(cleavingStrike.timing!.activeMs).toBe(350);
      expect(cleavingStrike.timing!.recoveryMs).toBe(300);
    });

    it('should have stagger 20', () => {
      expect(cleavingStrike.stagger).toBeDefined();
      expect(cleavingStrike.stagger!.staggerPower).toBe(20);
    });

    it('should have PvP damage 0.90', () => {
      expect(cleavingStrike.pvpMultipliers).toBeDefined();
      expect(cleavingStrike.pvpMultipliers!.damageMultiplier).toBe(0.90);
    });

    it('should have coefficients 1.50 P + 0.60 STR', () => {
      expect(cleavingStrike.coefficients.basePower).toBe(1.50);
      const strScaling = cleavingStrike.coefficients.scaling.find(s => s.stat === 'strength');
      expect(strScaling).toBeDefined();
      expect(strScaling!.coefficient).toBe(0.60);
    });

    it('should generate +8 Resolve per target, max +16 (PvP max +12)', () => {
      expect(cleavingStrike.resourceEffects).toBeDefined();
      const resolveEffect = cleavingStrike.resourceEffects!.find(e => e.resourceId === 'resolve');
      expect(resolveEffect).toBeDefined();
      expect(resolveEffect!.amount).toBe(8);
      expect(resolveEffect!.perTargetBonus).toBe(8);
      expect(cleavingStrike.pvpMultipliers!.resourceOverride).toBeDefined();
      expect(cleavingStrike.pvpMultipliers!.resourceOverride!.amount).toBe(12);
    });
  });

  describe('Execution - Exact Values', () => {
    const execution = SKILLS_V1.find(s => s.skillId === 'shade_execution')!;

    it('should have timing 400/150/600', () => {
      expect(execution.timing).toBeDefined();
      expect(execution.timing!.castMs).toBe(400);
      expect(execution.timing!.activeMs).toBe(150);
      expect(execution.timing!.recoveryMs).toBe(600);
    });

    it('should have stagger 30', () => {
      expect(execution.stagger).toBeDefined();
      expect(execution.stagger!.staggerPower).toBe(30);
    });

    it('should have PvP damage 0.75', () => {
      expect(execution.pvpMultipliers).toBeDefined();
      expect(execution.pvpMultipliers!.damageMultiplier).toBe(0.75);
    });

    it('should have formula 2.00 P + 2.00 P × MissingHealthPercent', () => {
      expect(execution.coefficients.basePower).toBe(2.00);
      const missingHpScaling = execution.coefficients.scaling.find(s => s.stat === 'missingHpPercent');
      expect(missingHpScaling).toBeDefined();
      expect(missingHpScaling!.coefficient).toBe(2.00);
    });

    it('should have boss cap 3.25 P', () => {
      expect(execution.coefficients.conditionals).toBeDefined();
      const bossCap = execution.coefficients.conditionals!.find(c => c.condition === 'boss_target');
      expect(bossCap).toBeDefined();
      expect(bossCap!.basePower).toBe(3.25);
    });

    it('should have below_hp_threshold 0.25 (25%)', () => {
      const hpThreshold = execution.coefficients.conditionals!.find(c => c.condition === 'below_hp_threshold');
      expect(hpThreshold).toBeDefined();
      expect(hpThreshold!.threshold).toBe(0.25);
    });

    it('should have PvP missing health cap 1.00 P', () => {
      expect(execution.pvpMultipliers!.missingHealthCap).toBe(1.00);
    });

    it('should cost -3 Momentum', () => {
      expect(execution.resourceEffects).toBeDefined();
      const momentumEffect = execution.resourceEffects!.find(e => e.resourceId === 'momentum');
      expect(momentumEffect).toBeDefined();
      expect(momentumEffect!.amount).toBe(-3);
    });
  });

  describe('Divine Intervention - Exact Values', () => {
    const divineIntervention = SKILLS_V1.find(s => s.skillId === 'warden_divine_intervention')!;

    it('should have timing 250/100/350', () => {
      expect(divineIntervention.timing).toBeDefined();
      expect(divineIntervention.timing!.castMs).toBe(250);
      expect(divineIntervention.timing!.activeMs).toBe(100);
      expect(divineIntervention.timing!.recoveryMs).toBe(350);
    });

    it('should have anti-death duration 2 seconds', () => {
      expect(divineIntervention.antiDeathDurationSeconds).toBe(2);
    });

    it('should have heal coefficients 2.50 Healing Power + 1.00 INT', () => {
      expect(divineIntervention.coefficients.basePower).toBe(2.50);
      const healingPowerScaling = divineIntervention.coefficients.scaling.find(s => s.stat === 'healingPower');
      expect(healingPowerScaling).toBeDefined();
      expect(healingPowerScaling!.coefficient).toBe(2.50);
      const intScaling = divineIntervention.coefficients.scaling.find(s => s.stat === 'intellect');
      expect(intScaling).toBeDefined();
      expect(intScaling!.coefficient).toBe(1.00);
    });

    it('should have exhausted duration 90s', () => {
      expect(divineIntervention.exhaustedDurationSeconds).toBe(90);
    });

    it('should cost -40 Judgement', () => {
      expect(divineIntervention.resourceEffects).toBeDefined();
      const judgementEffect = divineIntervention.resourceEffects!.find(e => e.resourceId === 'judgement');
      expect(judgementEffect).toBeDefined();
      expect(judgementEffect!.amount).toBe(-40);
    });

    it('should have cooldown 120s', () => {
      expect(divineIntervention.cooldownSeconds).toBe(120);
    });

    it('should have PvP: duration 1s, heal ×0.70, exhausted 120s', () => {
      expect(divineIntervention.pvpMultipliers).toBeDefined();
      expect(divineIntervention.pvpMultipliers!.durationSeconds).toBe(1);
      expect(divineIntervention.pvpMultipliers!.healingMultiplier).toBe(0.70);
      expect(divineIntervention.pvpMultipliers!.exhaustedDurationSeconds).toBe(120);
    });

    it('should apply divine_intervention status', () => {
      expect(divineIntervention.coefficients.appliesStatus).toBe('divine_intervention');
    });
  });

  describe('Thermal Shock - Exact Values', () => {
    const thermalShock = SKILLS_V1.find(s => s.skillId === 'arcanist_thermal_shock')!;

    it('should have kind=reaction', () => {
      expect(thermalShock.kind).toBe('reaction');
    });

    it('should have 1s/target internal CD', () => {
      expect(thermalShock.internalCooldownSeconds).toBe(1);
    });

    it('should have formula 2.30 P + 1.00 INT', () => {
      expect(thermalShock.coefficients.basePower).toBe(2.30);
      const intScaling = thermalShock.coefficients.scaling.find(s => s.stat === 'intellect');
      expect(intScaling).toBeDefined();
      expect(intScaling!.coefficient).toBe(1.00);
    });

    it('should have stagger 55', () => {
      expect(thermalShock.stagger!.staggerPower).toBe(55);
    });

    it('should have PvP damage 0.75, stagger 50%', () => {
      expect(thermalShock.pvpMultipliers!.damageMultiplier).toBe(0.75);
      expect(thermalShock.pvpMultipliers!.staggerMultiplier).toBe(0.50);
    });

    it('should have timing 0/0/0 with activePhaseType=reaction', () => {
      expect(thermalShock.timing!.castMs).toBe(0);
      expect(thermalShock.timing!.activeMs).toBe(0);
      expect(thermalShock.timing!.recoveryMs).toBe(0);
      expect(thermalShock.timing!.activePhaseType).toBe('reaction');
    });
  });

  describe('Sever - Exact Values', () => {
    const sever = SKILLS_V1.find(s => s.skillId === 'shade_sever')!;

    it('should have timing 250/200/550', () => {
      expect(sever.timing).toBeDefined();
      expect(sever.timing!.castMs).toBe(250);
      expect(sever.timing!.activeMs).toBe(200);
      expect(sever.timing!.recoveryMs).toBe(550);
    });

    it('should have per-stack coefficients 1.50/2.00/2.60/3.30/4.20', () => {
      expect(sever.coefficients.perStack).toBeDefined();
      expect(sever.coefficients.perStack!.basePowerPerStack).toEqual([1.50, 2.00, 2.60, 3.30, 4.20]);
    });

    it('should have stagger 15 per stack', () => {
      expect(sever.stagger!.staggerPower).toBe(15);
      expect(sever.stagger!.perStackStagger).toBe(15);
    });

    it('should have PvP damage 0.80 and five-stack coeff 3.60', () => {
      expect(sever.pvpMultipliers!.damageMultiplier).toBe(0.80);
      expect(sever.pvpMultipliers!.effectOverrides!.fiveStackCoeff).toBe(3.60);
    });

    it('should have 0.40 FIN per stack scaling', () => {
      const finScaling = sever.coefficients.scaling.find(s => s.stat === 'finesse');
      expect(finScaling).toBeDefined();
      expect(finScaling!.coefficient).toBe(0.40);
    });
  });

  describe('Remote Detonation - Exact Values', () => {
    const remoteDetonation = SKILLS_V1.find(s => s.skillId === 'machinist_remote_detonation')!;

    it('should have timing 150/100/500', () => {
      expect(remoteDetonation.timing).toBeDefined();
      expect(remoteDetonation.timing!.castMs).toBe(150);
      expect(remoteDetonation.timing!.activeMs).toBe(100);
      expect(remoteDetonation.timing!.recoveryMs).toBe(500);
    });

    it('should have turret 1.10, drone 1.40, mine 2.40 Device Power', () => {
      expect(remoteDetonation.coefficients.targetVariants).toBeDefined();
      expect(remoteDetonation.coefficients.targetVariants!.turret.basePower).toBe(1.10);
      expect(remoteDetonation.coefficients.targetVariants!.drone.basePower).toBe(1.40);
      expect(remoteDetonation.coefficients.targetVariants!.mine.basePower).toBe(2.40);
    });

    it('should have base stagger 25 (turret)', () => {
      expect(remoteDetonation.stagger!.staggerPower).toBe(25);
    });

    it('should have per-device stagger: turret 25, drone 35, mine 65', () => {
      expect(remoteDetonation.stagger!.targetVariants).toBeDefined();
      expect(remoteDetonation.stagger!.targetVariants!.turret).toBe(25);
      expect(remoteDetonation.stagger!.targetVariants!.drone).toBe(35);
      expect(remoteDetonation.stagger!.targetVariants!.mine).toBe(65);
    });

    it('should have PvP damage 0.70', () => {
      expect(remoteDetonation.pvpMultipliers!.damageMultiplier).toBe(0.70);
    });
  });

  describe("Hunter's Mark - Duration 8s", () => {
    const huntersMark = SKILLS_V1.find(s => s.skillId === 'ranger_hunters_mark')!;

    it('should have effectDuration=8', () => {
      expect(huntersMark.coefficients.effectDuration).toBe(8);
    });

    it('should have PvP duration 6s', () => {
      expect(huntersMark.pvpMultipliers!.durationSeconds).toBe(6);
    });
  });

  describe('Aether Bolt - Applies Aether Status', () => {
    const aetherBolt = SKILLS_V1.find(s => s.skillId === 'arcanist_aether_bolt')!;

    it('should apply status aether', () => {
      expect(aetherBolt.coefficients.appliesStatus).toBe('aether');
    });
  });

  describe('Arcanist Mana Costs - % of Base Mana', () => {
    it('should have Ember Lance -12% base Mana', () => {
      const emberLance = SKILLS_V1.find(s => s.skillId === 'arcanist_ember_lance')!;
      const manaEffect = emberLance.resourceEffects!.find(e => e.resourceId === 'mana');
      expect(manaEffect).toBeDefined();
      expect(manaEffect!.amount).toBe(-0.12);
      expect(manaEffect!.isPercentOfMax).toBe(true);
    });

    it('should have Frostbind -14% base Mana', () => {
      const frostbind = SKILLS_V1.find(s => s.skillId === 'arcanist_frostbind')!;
      const manaEffect = frostbind.resourceEffects!.find(e => e.resourceId === 'mana');
      expect(manaEffect).toBeDefined();
      expect(manaEffect!.amount).toBe(-0.14);
      expect(manaEffect!.isPercentOfMax).toBe(true);
    });

    it('should have Arc Surge -18% base Mana', () => {
      const arcSurge = SKILLS_V1.find(s => s.skillId === 'arcanist_arc_surge')!;
      const manaEffect = arcSurge.resourceEffects!.find(e => e.resourceId === 'mana');
      expect(manaEffect).toBeDefined();
      expect(manaEffect!.amount).toBe(-0.18);
      expect(manaEffect!.isPercentOfMax).toBe(true);
    });

    it('should have Aether Bolt -10% base Mana', () => {
      const aetherBolt = SKILLS_V1.find(s => s.skillId === 'arcanist_aether_bolt')!;
      const manaEffect = aetherBolt.resourceEffects!.find(e => e.resourceId === 'mana');
      expect(manaEffect).toBeDefined();
      expect(manaEffect!.amount).toBe(-0.10);
      expect(manaEffect!.isPercentOfMax).toBe(true);
    });

    it('should have Phase Step -8% base Mana', () => {
      const phaseStep = SKILLS_V1.find(s => s.skillId === 'arcanist_phase_step')!;
      const manaEffect = phaseStep.resourceEffects!.find(e => e.resourceId === 'mana');
      expect(manaEffect).toBeDefined();
      expect(manaEffect!.amount).toBe(-0.08);
      expect(manaEffect!.isPercentOfMax).toBe(true);
    });

    it('should have Mana Conduit restore +30% max Mana', () => {
      const manaConduit = SKILLS_V1.find(s => s.skillId === 'arcanist_mana_conduit')!;
      const manaEffect = manaConduit.resourceEffects!.find(e => e.resourceId === 'mana');
      expect(manaEffect).toBeDefined();
      expect(manaEffect!.amount).toBe(0.30);
      expect(manaEffect!.isPercentOfMax).toBe(true);
    });
  });

  describe('All 48 Skills - Timing/Stagger/PvP Match Spec', () => {
    it('should have exactly 48 skills', () => {
      expect(SKILLS_V1).toHaveLength(48);
    });

    it('should have all skills with timing defined', () => {
      for (const skill of SKILLS_V1) {
        expect(skill.timing).toBeDefined();
      }
    });

    it('should have all skills with stagger defined', () => {
      for (const skill of SKILLS_V1) {
        expect(skill.stagger).toBeDefined();
      }
    });

    it('should match SKILL_SPEC_VALUES for all 48 skills', () => {
      for (const skill of SKILLS_V1) {
        const expected = SKILL_SPEC_VALUES[skill.skillId];
        expect(expected).toBeDefined();
        
        // Timing
        expect(skill.timing!.castMs).toBe(expected.timing.castMs);
        expect(skill.timing!.activeMs).toBe(expected.timing.activeMs);
        expect(skill.timing!.recoveryMs).toBe(expected.timing.recoveryMs);
        
        // Stagger
        expect(skill.stagger!.staggerPower).toBe(expected.stagger);
        
        // PvP damage (if defined)
        if (expected.pvpDamage !== undefined) {
          expect(skill.pvpMultipliers?.damageMultiplier).toBe(expected.pvpDamage);
        }
      }
    });
  });

  describe('Resonances - Decimal Bonus Percentages', () => {
    it('should have all bonusPercent values as decimals (< 1)', () => {
      for (const resonance of RESONANCES_V1) {
        for (const bonus of resonance.partyBonus) {
          expect(bonus.bonusPercent).toBeLessThan(1);
          expect(bonus.bonusPercent).toBeGreaterThan(0);
        }
      }
    });

    it('should have valor HP bonusPercent as 0.10 (not 10)', () => {
      const valor = RESONANCES_V1.find(r => r.resonanceId === 'valor');
      expect(valor).toBeDefined();
      const hpBonus = valor!.partyBonus.find(b => b.stat === 'hp');
      expect(hpBonus).toBeDefined();
      expect(hpBonus!.bonusPercent).toBe(0.10);
    });
  });

  describe('Classes - Exact Primary Stats', () => {
    it('should have exactly 6 classes', () => {
      expect(CLASSES_V1).toHaveLength(6);
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
    });
  });

  describe('Combat Constants - Decimal Values', () => {
    it('should have criticalDamageMultiplier as 1.50 (150%)', () => {
      expect(COMBAT_CONSTANTS_V1.critical.criticalDamageMultiplier).toBe(1.50);
    });

    it('should have baseHitChance as 0.90 (90%)', () => {
      expect(COMBAT_CONSTANTS_V1.accuracy.baseHitChance).toBe(0.90);
    });

    it('should have stagger constants defined', () => {
      expect(COMBAT_CONSTANTS_V1.stagger).toBeDefined();
      expect(COMBAT_CONSTANTS_V1.stagger.baseStaggerThreshold).toBeGreaterThan(0);
    });

    it('should have PvP constants defined', () => {
      expect(COMBAT_CONSTANTS_V1.pvp).toBeDefined();
      expect(COMBAT_CONSTANTS_V1.pvp.globalDamageMultiplier).toBeLessThan(1);
    });
  });

  describe('Statuses and Elements - Non-Empty', () => {
    it('should have statuses non-empty', () => {
      expect(STATUSES_V1.length).toBeGreaterThan(0);
    });

    it('should have elements non-empty', () => {
      expect(ELEMENTS_V1.length).toBeGreaterThan(0);
    });

    it('should have exactly 8 elements', () => {
      expect(ELEMENTS_V1).toHaveLength(8);
    });

    it('should have exactly 6 resonances', () => {
      expect(RESONANCES_V1).toHaveLength(6);
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
        return { Attributes: existing || {} };
      });

      ddbMock.on(GetCommand).callsFake((input) => {
        const pk = input.Key.PK as string;
        const sk = input.Key.SK as string;
        return { Item: storedItems[`${pk}#${sk}`] || undefined };
      });

      const result = await seedCatalogV1(repository);

      expect(putCallCount).toBe(6);
      expect(updateCallCount).toBe(6);

      expect(result.combatConstants.status).toBe('published');
      expect(result.classes.status).toBe('published');
      expect(result.skills.status).toBe('published');
      expect(result.classes.data).toHaveLength(6);
      expect(result.skills.data).toHaveLength(48);
    });
  });

  describe('Published Catalog Immutability', () => {
    it('should reject attempts to overwrite published catalog', async () => {
      const publishedCatalog: CombatConstantsCatalog = {
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

      ddbMock.on(GetCommand).resolves({ Item: publishedCatalog });

      await expect(
        repository.updateDraftCatalog<CombatConstantsCatalog>('combat-constants', 1, {
          data: { ...COMBAT_CONSTANTS_V1 },
        })
      ).rejects.toThrow(PublishedCatalogImmutableError);
    });
  });
});
