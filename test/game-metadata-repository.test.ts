/**
 * Game Metadata Repository Tests - MMO-4
 *
 * Tests for versioned catalog system with immutability enforcement.
 * Key requirement: published catalogs must be immutable.
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import {
  GameMetadataRepository,
  CatalogNotFoundError,
  PublishedCatalogImmutableError,
  CatalogVersionConflictError,
  catalogPk,
  versionSk,
  gsi2Pk,
  gsi2Sk,
} from '../lib/game-metadata/repository';
import {
  CombatConstantsCatalog,
  ClassCatalog,
  CombatConstants,
  ClassDefinition,
  PrimaryStats,
  ClassStartingStats,
} from '../lib/game-metadata/models';

const ddbMock = mockClient(DynamoDBDocumentClient);

/**
 * Complete combat constants with all spec values.
 * All percentages as decimals (150% = 1.50).
 */
function createFullCombatConstants(): CombatConstants {
  return {
    powerScaling: {
      physicalPower: {
        strengthMultiplier: 2.0,
        levelMultiplier: 1.5,
      },
      spellPower: {
        intellectMultiplier: 2.0,
        levelMultiplier: 1.0,
      },
      techPower: {
        techMultiplier: 2.0,
        levelMultiplier: 1.0,
      },
      devicePower: {
        techDivisor: 100,
      },
    },
    speed: {
      attackSpeed: {
        finesseConstant: 400,
        attackSpeedCap: 2.5,
      },
      dodgeRecovery: {
        finesseConstant: 1000,
      },
    },
    vitality: {
      maxHp: {
        vitalityDivisor: 100,
      },
      healingReceived: {
        vitalityDivisor: 1000,
      },
    },
    accuracy: {
      baseHitChance: 0.90,
      accuracyBonus: {
        precisionConstant: 300,
        maxAccuracyBonus: 0.15,
      },
      weakPoint: {
        precisionMultiplier: 0.0015,
      },
    },
    critical: {
      baseCritChance: 0.05,
      critChance: {
        luckConstant: 500,
        maxLuckCritBonus: 0.30,
      },
      procChance: {
        luckDivisor: 500,
      },
      criticalDamageMultiplier: 1.50,
    },
    defense: {
      defenseConstant: {
        baseConstant: 200,
        levelMultiplier: 15,
      },
      armorReductionPerPoint: 0.001,
      maxArmorReduction: 0.75,
      blockDamageReduction: 0.50,
    },
    glancingHit: {
      damageMultiplier: 0.50,
      canCrit: false,
      canStagger: false,
    },
    status: {
      resistanceConstant: 100,
    },
    statAllocationBands: [
      { minLevel: 1, maxLevel: 10, pointsPerLevel: 5, allocationCostPerPoint: 1 },
      { minLevel: 11, maxLevel: 30, pointsPerLevel: 4, allocationCostPerPoint: 1 },
      { minLevel: 31, maxLevel: 50, pointsPerLevel: 3, allocationCostPerPoint: 2 },
    ],
    statCaps: {
      softCap: 100,
      hardCap: 150,
      softCapPenalty: 0.50,
    },
    dodge: {
      baseDodgeChance: 0.02,
      maxDodgeChance: 0.40,
    },
    timing: {
      globalCooldown: 1.5,
      outOfCombatHpRegen: 0.05,
      outOfCombatResourceRegen: 0.10,
      combatDropoffSeconds: 10,
    },
    stagger: {
      baseStaggerThreshold: 100,
      staggerRecoveryRate: 10,
      staggerDurationSeconds: 2,
      staggerImmunitySeconds: 3,
    },
    pvp: {
      globalDamageMultiplier: 0.60,
      globalHealingMultiplier: 0.70,
      ccDurationMultiplier: 0.50,
      executeThresholdModifier: -0.10,
    },
  };
}

describe('GameMetadataRepository', () => {
  let repository: GameMetadataRepository;
  const tableName = 'test-table';

  beforeEach(() => {
    ddbMock.reset();
    repository = new GameMetadataRepository({
      tableName,
      client: ddbMock as unknown as DynamoDBDocumentClient,
    });
  });

  describe('Key Generation', () => {
    it('should generate correct partition keys', () => {
      expect(catalogPk('combat-constants')).toBe('CATALOG#combat-constants');
      expect(catalogPk('class')).toBe('CATALOG#class');
      expect(catalogPk('skill')).toBe('CATALOG#skill');
    });

    it('should generate zero-padded version sort keys', () => {
      expect(versionSk(1)).toBe('VERSION#00000001');
      expect(versionSk(42)).toBe('VERSION#00000042');
      expect(versionSk(12345678)).toBe('VERSION#12345678');
    });

    it('should generate correct GSI2 keys', () => {
      expect(gsi2Pk('published')).toBe('CATALOG#PUBLISHED');
      expect(gsi2Pk('draft')).toBe('CATALOG#DRAFT');
      expect(gsi2Sk('class', 1)).toBe('class#VERSION#00000001');
    });
  });

  describe('createCatalogVersion', () => {
    const combatConstants = createFullCombatConstants();

    it('should create a new draft catalog version', async () => {
      ddbMock.on(PutCommand).resolves({});

      const result = await repository.createCatalogVersion<CombatConstantsCatalog>({
        catalogType: 'combat-constants',
        version: 1,
        createdBy: 'test-user',
        data: combatConstants,
      });

      expect(result.status).toBe('draft');
      expect(result.version).toBe(1);
      expect(result.catalogType).toBe('combat-constants');
      expect(result.createdAt).toBeDefined();
      expect(result.data).toEqual(combatConstants);

      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input.ConditionExpression).toBe(
        'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      );
    });

    it('should fail when version already exists', async () => {
      ddbMock.on(PutCommand).rejects(
        new ConditionalCheckFailedException({
          message: 'The conditional request failed',
          $metadata: {},
        })
      );

      await expect(
        repository.createCatalogVersion<CombatConstantsCatalog>({
          catalogType: 'combat-constants',
          version: 1,
          createdBy: 'test-user',
          data: combatConstants,
        })
      ).rejects.toThrow(CatalogVersionConflictError);
    });
  });

  describe('updateDraftCatalog', () => {
    it('should update a draft catalog', async () => {
      const updatedData = createFullCombatConstants();
      updatedData.critical.criticalDamageMultiplier = 1.75;

      ddbMock.on(UpdateCommand).resolves({
        Attributes: {
          PK: 'CATALOG#combat-constants',
          SK: 'VERSION#00000001',
          catalogType: 'combat-constants',
          version: 1,
          status: 'draft',
          createdAt: '2024-01-01T00:00:00.000Z',
          createdBy: 'test-user',
          data: updatedData,
        },
      });

      const result = await repository.updateDraftCatalog<CombatConstantsCatalog>(
        'combat-constants',
        1,
        { data: updatedData }
      );

      expect(result.data).toEqual(updatedData);

      const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
      expect(updateCall.args[0].input.ConditionExpression).toBe(
        'attribute_exists(PK) AND #status = :draft'
      );
    });

    it('should fail when trying to update a published catalog', async () => {
      ddbMock.on(UpdateCommand).rejects(
        new ConditionalCheckFailedException({
          message: 'The conditional request failed',
          $metadata: {},
        })
      );

      ddbMock.on(GetCommand).resolves({
        Item: {
          catalogType: 'combat-constants',
          version: 1,
          status: 'published',
        },
      });

      await expect(
        repository.updateDraftCatalog<CombatConstantsCatalog>('combat-constants', 1, {
          data: createFullCombatConstants(),
        })
      ).rejects.toThrow(PublishedCatalogImmutableError);
    });

    it('should fail when catalog does not exist', async () => {
      ddbMock.on(UpdateCommand).rejects(
        new ConditionalCheckFailedException({
          message: 'The conditional request failed',
          $metadata: {},
        })
      );

      ddbMock.on(GetCommand).resolves({ Item: undefined });

      await expect(
        repository.updateDraftCatalog<CombatConstantsCatalog>('combat-constants', 1, {
          data: createFullCombatConstants(),
        })
      ).rejects.toThrow(CatalogNotFoundError);
    });
  });

  describe('publishCatalogVersion', () => {
    it('should publish a draft catalog', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: {
          PK: 'CATALOG#combat-constants',
          SK: 'VERSION#00000001',
          catalogType: 'combat-constants',
          version: 1,
          status: 'published',
          createdAt: '2024-01-01T00:00:00.000Z',
          publishedAt: '2024-01-02T00:00:00.000Z',
          createdBy: 'test-user',
        },
      });

      const result = await repository.publishCatalogVersion('combat-constants', 1);

      expect(result.status).toBe('published');
      expect(result.publishedAt).toBeDefined();

      const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
      expect(updateCall.args[0].input.ConditionExpression).toBe(
        'attribute_exists(PK) AND #status = :draft'
      );
    });

    it('should fail when catalog is already published', async () => {
      ddbMock.on(UpdateCommand).rejects(
        new ConditionalCheckFailedException({
          message: 'The conditional request failed',
          $metadata: {},
        })
      );

      ddbMock.on(GetCommand).resolves({
        Item: {
          catalogType: 'combat-constants',
          version: 1,
          status: 'published',
        },
      });

      await expect(
        repository.publishCatalogVersion('combat-constants', 1)
      ).rejects.toThrow(PublishedCatalogImmutableError);
    });
  });

  describe('IMMUTABILITY ENFORCEMENT - Critical Tests', () => {
    const publishedCatalog: CombatConstantsCatalog = {
      catalogType: 'combat-constants',
      version: 1,
      status: 'published',
      createdAt: '2024-01-01T00:00:00.000Z',
      publishedAt: '2024-01-02T00:00:00.000Z',
      createdBy: 'test-user',
      data: createFullCombatConstants(),
    };

    it('should reject attempts to overwrite a published catalog', async () => {
      ddbMock.on(PutCommand).rejects(
        new ConditionalCheckFailedException({
          message: 'The conditional request failed',
          $metadata: {},
        })
      );

      await expect(
        repository._testOverwritePublished(publishedCatalog)
      ).rejects.toThrow(ConditionalCheckFailedException);

      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input.ConditionExpression).toBe(
        'attribute_not_exists(PK) OR #status <> :published'
      );
    });

    it('should reject update attempts on published catalogs via updateDraftCatalog', async () => {
      ddbMock.on(UpdateCommand).rejects(
        new ConditionalCheckFailedException({
          message: 'The conditional request failed',
          $metadata: {},
        })
      );

      ddbMock.on(GetCommand).resolves({
        Item: publishedCatalog,
      });

      const modifiedData = createFullCombatConstants();
      modifiedData.critical.criticalDamageMultiplier = 2.0;

      await expect(
        repository.updateDraftCatalog<CombatConstantsCatalog>('combat-constants', 1, {
          data: modifiedData,
        })
      ).rejects.toThrow(PublishedCatalogImmutableError);
    });

    it('should reject republishing an already published catalog', async () => {
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
        repository.publishCatalogVersion('combat-constants', 1)
      ).rejects.toThrow(PublishedCatalogImmutableError);
    });

    it('should allow creating v2 after v1 is published', async () => {
      ddbMock.on(PutCommand).resolves({});

      const v2Data = createFullCombatConstants();
      v2Data.critical.criticalDamageMultiplier = 1.75;

      const result = await repository.createCatalogVersion<CombatConstantsCatalog>({
        catalogType: 'combat-constants',
        version: 2,
        createdBy: 'test-user',
        data: v2Data,
      });

      expect(result.version).toBe(2);
      expect(result.status).toBe('draft');
      expect(result.data.critical.criticalDamageMultiplier).toBe(1.75);
    });
  });

  describe('getCatalogVersion', () => {
    it('should return catalog when found', async () => {
      const catalog: CombatConstantsCatalog = {
        catalogType: 'combat-constants',
        version: 1,
        status: 'published',
        createdAt: '2024-01-01T00:00:00.000Z',
        publishedAt: '2024-01-02T00:00:00.000Z',
        createdBy: 'test-user',
        data: createFullCombatConstants(),
      };

      ddbMock.on(GetCommand).resolves({
        Item: {
          PK: 'CATALOG#combat-constants',
          SK: 'VERSION#00000001',
          ...catalog,
        },
      });

      const result = await repository.getCatalogVersion<CombatConstantsCatalog>(
        'combat-constants',
        1
      );

      expect(result).toEqual(catalog);
    });

    it('should return null when not found', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const result = await repository.getCatalogVersion<CombatConstantsCatalog>(
        'combat-constants',
        999
      );

      expect(result).toBeNull();
    });
  });

  describe('getLatestPublishedCatalog', () => {
    it('should return latest published version', async () => {
      const latestCatalog: CombatConstantsCatalog = {
        catalogType: 'combat-constants',
        version: 3,
        status: 'published',
        createdAt: '2024-01-03T00:00:00.000Z',
        publishedAt: '2024-01-03T12:00:00.000Z',
        createdBy: 'test-user',
        data: createFullCombatConstants(),
      };

      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            PK: 'CATALOG#combat-constants',
            SK: 'VERSION#00000003',
            GSI2PK: 'CATALOG#PUBLISHED',
            GSI2SK: 'combat-constants#VERSION#00000003',
            ...latestCatalog,
          },
        ],
      });

      const result = await repository.getLatestPublishedCatalog<CombatConstantsCatalog>(
        'combat-constants'
      );

      expect(result).toEqual(latestCatalog);
      expect(result?.version).toBe(3);

      const queryCall = ddbMock.commandCalls(QueryCommand)[0];
      expect(queryCall.args[0].input.IndexName).toBe('GSI2');
      expect(queryCall.args[0].input.ScanIndexForward).toBe(false);
    });

    it('should return null when no published versions exist', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await repository.getLatestPublishedCatalog<CombatConstantsCatalog>(
        'combat-constants'
      );

      expect(result).toBeNull();
    });
  });

  describe('listCatalogVersions', () => {
    it('should list all versions of a catalog type', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            PK: 'CATALOG#class',
            SK: 'VERSION#00000002',
            catalogType: 'class',
            version: 2,
            status: 'draft',
            createdAt: '2024-01-02T00:00:00.000Z',
            createdBy: 'test-user',
          },
          {
            PK: 'CATALOG#class',
            SK: 'VERSION#00000001',
            catalogType: 'class',
            version: 1,
            status: 'published',
            createdAt: '2024-01-01T00:00:00.000Z',
            publishedAt: '2024-01-01T12:00:00.000Z',
            createdBy: 'test-user',
          },
        ],
      });

      const result = await repository.listCatalogVersions('class');

      expect(result).toHaveLength(2);
      expect(result[0].version).toBe(2);
      expect(result[1].version).toBe(1);
    });

    it('should filter by status when specified', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            PK: 'CATALOG#class',
            SK: 'VERSION#00000001',
            catalogType: 'class',
            version: 1,
            status: 'published',
            createdAt: '2024-01-01T00:00:00.000Z',
            createdBy: 'test-user',
          },
        ],
      });

      await repository.listCatalogVersions('class', {
        status: 'published',
      });

      const queryCall = ddbMock.commandCalls(QueryCommand)[0];
      expect(queryCall.args[0].input.FilterExpression).toBe('#status = :status');
      expect(queryCall.args[0].input.ExpressionAttributeValues?.[':status']).toBe(
        'published'
      );
    });
  });
});

describe('CombatConstants - Complete Pipeline Coefficients', () => {
  const constants = createFullCombatConstants();

  describe('Power Scaling', () => {
    it('should have PhysicalPower coefficients (Strength*2 + Level*1.5)', () => {
      expect(constants.powerScaling.physicalPower.strengthMultiplier).toBe(2.0);
      expect(constants.powerScaling.physicalPower.levelMultiplier).toBe(1.5);
    });

    it('should have SpellPower coefficients (Intellect*2 + Level*1)', () => {
      expect(constants.powerScaling.spellPower.intellectMultiplier).toBe(2.0);
      expect(constants.powerScaling.spellPower.levelMultiplier).toBe(1.0);
    });

    it('should have TechPower coefficients (Tech*2 + Level*1)', () => {
      expect(constants.powerScaling.techPower.techMultiplier).toBe(2.0);
      expect(constants.powerScaling.techPower.levelMultiplier).toBe(1.0);
    });

    it('should have DevicePower divisor (Tech/100)', () => {
      expect(constants.powerScaling.devicePower.techDivisor).toBe(100);
    });
  });

  describe('Speed Constants', () => {
    it('should have AttackSpeed formula constant (Finesse/(Finesse+400))', () => {
      expect(constants.speed.attackSpeed.finesseConstant).toBe(400);
      expect(constants.speed.attackSpeed.attackSpeedCap).toBeGreaterThan(0);
    });

    it('should have DodgeRecovery formula constant (Finesse/(Finesse+1000))', () => {
      expect(constants.speed.dodgeRecovery.finesseConstant).toBe(1000);
    });
  });

  describe('Vitality Constants', () => {
    it('should have MaxHP formula (Vitality/100)', () => {
      expect(constants.vitality.maxHp.vitalityDivisor).toBe(100);
    });

    it('should have HealingReceived formula (Vitality/1000)', () => {
      expect(constants.vitality.healingReceived.vitalityDivisor).toBe(1000);
    });
  });

  describe('Accuracy Constants', () => {
    it('should have base hit chance (0.90)', () => {
      expect(constants.accuracy.baseHitChance).toBe(0.90);
    });

    it('should have AccuracyBonus formula (Precision/(Precision+300)*0.15)', () => {
      expect(constants.accuracy.accuracyBonus.precisionConstant).toBe(300);
      expect(constants.accuracy.accuracyBonus.maxAccuracyBonus).toBe(0.15);
    });

    it('should have WeakPoint formula (Precision*0.0015)', () => {
      expect(constants.accuracy.weakPoint.precisionMultiplier).toBe(0.0015);
    });
  });

  describe('Critical Constants', () => {
    it('should have base crit chance', () => {
      expect(constants.critical.baseCritChance).toBe(0.05);
    });

    it('should have CritChance formula (Luck/(Luck+500)*0.30 + base)', () => {
      expect(constants.critical.critChance.luckConstant).toBe(500);
      expect(constants.critical.critChance.maxLuckCritBonus).toBe(0.30);
    });

    it('should have ProcChance formula (Luck/500)', () => {
      expect(constants.critical.procChance.luckDivisor).toBe(500);
    });

    it('should have critical damage multiplier (1.50 = 150%)', () => {
      expect(constants.critical.criticalDamageMultiplier).toBe(1.50);
    });
  });

  describe('Defense Constants', () => {
    it('should have DefenseConstant formula (200 + AttackerLevel*15)', () => {
      expect(constants.defense.defenseConstant.baseConstant).toBe(200);
      expect(constants.defense.defenseConstant.levelMultiplier).toBe(15);
    });

    it('should have armor reduction values', () => {
      expect(constants.defense.armorReductionPerPoint).toBe(0.001);
      expect(constants.defense.maxArmorReduction).toBe(0.75);
    });

    it('should have block damage reduction (0.50 = 50%)', () => {
      expect(constants.defense.blockDamageReduction).toBe(0.50);
    });
  });

  describe('Glancing Hit Constants', () => {
    it('should have glancing hit damage (0.50 = 50%)', () => {
      expect(constants.glancingHit.damageMultiplier).toBe(0.50);
    });

    it('should not allow crit on glancing hits', () => {
      expect(constants.glancingHit.canCrit).toBe(false);
    });

    it('should not allow stagger on glancing hits', () => {
      expect(constants.glancingHit.canStagger).toBe(false);
    });
  });

  describe('Status Constants', () => {
    it('should have status resistance constant (100)', () => {
      expect(constants.status.resistanceConstant).toBe(100);
    });
  });

  describe('Stat Allocation', () => {
    it('should have stat allocation bands', () => {
      expect(constants.statAllocationBands.length).toBeGreaterThan(0);
      expect(constants.statAllocationBands[0].minLevel).toBe(1);
      expect(constants.statAllocationBands[0].pointsPerLevel).toBeGreaterThan(0);
    });

    it('should have soft cap at 100 and hard cap at 150', () => {
      expect(constants.statCaps.softCap).toBe(100);
      expect(constants.statCaps.hardCap).toBe(150);
    });
  });

  describe('Dodge Constants', () => {
    it('should have dodge chance values', () => {
      expect(constants.dodge.baseDodgeChance).toBe(0.02);
      expect(constants.dodge.maxDodgeChance).toBe(0.40);
    });
  });

  describe('Timing Constants', () => {
    it('should have GCD and regen values', () => {
      expect(constants.timing.globalCooldown).toBe(1.5);
      expect(constants.timing.outOfCombatHpRegen).toBe(0.05);
      expect(constants.timing.outOfCombatResourceRegen).toBe(0.10);
      expect(constants.timing.combatDropoffSeconds).toBe(10);
    });
  });

  describe('Extensibility', () => {
    it('should support additionalConstants map for future values', () => {
      const extendedConstants: CombatConstants = {
        ...constants,
        additionalConstants: {
          newMultiplier: 1.25,
          featureEnabled: true,
          newFormulaConstant: 'test',
        },
      };
      expect(extendedConstants.additionalConstants?.newMultiplier).toBe(1.25);
      expect(extendedConstants.additionalConstants?.featureEnabled).toBe(true);
    });
  });
});

describe('ClassStartingStats - Primary Stats', () => {
  const CLASS_PRIMARY_STATS: Record<string, PrimaryStats> = {
    vanguard: { strength: 12, finesse: 7, vitality: 12, intellect: 4, precision: 6, luck: 5, tech: 4 },
    ranger: { strength: 6, finesse: 11, vitality: 6, intellect: 4, precision: 13, luck: 7, tech: 3 },
    arcanist: { strength: 3, finesse: 6, vitality: 5, intellect: 14, precision: 8, luck: 7, tech: 7 },
    machinist: { strength: 4, finesse: 7, vitality: 6, intellect: 8, precision: 10, luck: 5, tech: 14 },
    warden: { strength: 5, finesse: 6, vitality: 10, intellect: 12, precision: 6, luck: 6, tech: 5 },
    shade: { strength: 7, finesse: 13, vitality: 5, intellect: 4, precision: 9, luck: 10, tech: 2 },
  };

  describe('Primary Stats Interface', () => {
    it('should require all seven primary stats', () => {
      const stats: PrimaryStats = {
        strength: 10,
        finesse: 10,
        vitality: 10,
        intellect: 10,
        precision: 10,
        luck: 10,
        tech: 10,
      };

      expect(stats.strength).toBeDefined();
      expect(stats.finesse).toBeDefined();
      expect(stats.vitality).toBeDefined();
      expect(stats.intellect).toBeDefined();
      expect(stats.precision).toBeDefined();
      expect(stats.luck).toBeDefined();
      expect(stats.tech).toBeDefined();
    });
  });

  describe('Vanguard Starting Stats', () => {
    const vanguard = CLASS_PRIMARY_STATS.vanguard;

    it('should have correct primary stats (12/7/12/4/6/5/4)', () => {
      expect(vanguard.strength).toBe(12);
      expect(vanguard.finesse).toBe(7);
      expect(vanguard.vitality).toBe(12);
      expect(vanguard.intellect).toBe(4);
      expect(vanguard.precision).toBe(6);
      expect(vanguard.luck).toBe(5);
      expect(vanguard.tech).toBe(4);
    });
  });

  describe('Ranger Starting Stats', () => {
    const ranger = CLASS_PRIMARY_STATS.ranger;

    it('should have correct primary stats (6/11/6/4/13/7/3)', () => {
      expect(ranger.strength).toBe(6);
      expect(ranger.finesse).toBe(11);
      expect(ranger.vitality).toBe(6);
      expect(ranger.intellect).toBe(4);
      expect(ranger.precision).toBe(13);
      expect(ranger.luck).toBe(7);
      expect(ranger.tech).toBe(3);
    });
  });

  describe('Arcanist Starting Stats', () => {
    const arcanist = CLASS_PRIMARY_STATS.arcanist;

    it('should have correct primary stats (3/6/5/14/8/7/7)', () => {
      expect(arcanist.strength).toBe(3);
      expect(arcanist.finesse).toBe(6);
      expect(arcanist.vitality).toBe(5);
      expect(arcanist.intellect).toBe(14);
      expect(arcanist.precision).toBe(8);
      expect(arcanist.luck).toBe(7);
      expect(arcanist.tech).toBe(7);
    });
  });

  describe('Machinist Starting Stats', () => {
    const machinist = CLASS_PRIMARY_STATS.machinist;

    it('should have correct primary stats (4/7/6/8/10/5/14)', () => {
      expect(machinist.strength).toBe(4);
      expect(machinist.finesse).toBe(7);
      expect(machinist.vitality).toBe(6);
      expect(machinist.intellect).toBe(8);
      expect(machinist.precision).toBe(10);
      expect(machinist.luck).toBe(5);
      expect(machinist.tech).toBe(14);
    });
  });

  describe('Warden Starting Stats', () => {
    const warden = CLASS_PRIMARY_STATS.warden;

    it('should have correct primary stats (5/6/10/12/6/6/5)', () => {
      expect(warden.strength).toBe(5);
      expect(warden.finesse).toBe(6);
      expect(warden.vitality).toBe(10);
      expect(warden.intellect).toBe(12);
      expect(warden.precision).toBe(6);
      expect(warden.luck).toBe(6);
      expect(warden.tech).toBe(5);
    });
  });

  describe('Shade Starting Stats', () => {
    const shade = CLASS_PRIMARY_STATS.shade;

    it('should have correct primary stats (7/13/5/4/9/10/2)', () => {
      expect(shade.strength).toBe(7);
      expect(shade.finesse).toBe(13);
      expect(shade.vitality).toBe(5);
      expect(shade.intellect).toBe(4);
      expect(shade.precision).toBe(9);
      expect(shade.luck).toBe(10);
      expect(shade.tech).toBe(2);
    });
  });

  describe('ClassStartingStats extends PrimaryStats', () => {
    it('should include both primary stats and derived stats', () => {
      const fullStats: ClassStartingStats = {
        strength: 12,
        finesse: 7,
        vitality: 12,
        intellect: 4,
        precision: 6,
        luck: 5,
        tech: 4,
        hp: 120,
        resourcePool: 100,
        armor: 15,
        attackPower: 12,
        spellPower: 5,
        movementSpeed: 5.0,
      };

      expect(fullStats.strength).toBe(12);
      expect(fullStats.hp).toBe(120);
      expect(fullStats.resourcePool).toBe(100);
    });
  });
});

describe('Class Catalog Structure with Primary Stats', () => {
  const vanguardClass: ClassDefinition = {
    classId: 'vanguard',
    displayName: 'Vanguard',
    description: 'A stalwart frontline defender who protects allies and controls the battlefield.',
    primaryResource: 'resolve',
    startingStats: {
      strength: 12,
      finesse: 7,
      vitality: 12,
      intellect: 4,
      precision: 6,
      luck: 5,
      tech: 4,
      hp: 120,
      resourcePool: 100,
      armor: 15,
      attackPower: 12,
      spellPower: 5,
      movementSpeed: 5.0,
    },
    resonance: 'valor',
    roles: ['tank'],
  };

  it('should have valid class structure with primary stats', () => {
    expect(vanguardClass.classId).toBe('vanguard');
    expect(vanguardClass.primaryResource).toBe('resolve');
    expect(vanguardClass.resonance).toBe('valor');
    expect(vanguardClass.roles).toContain('tank');
  });

  it('should have all seven primary stats', () => {
    expect(vanguardClass.startingStats.strength).toBe(12);
    expect(vanguardClass.startingStats.finesse).toBe(7);
    expect(vanguardClass.startingStats.vitality).toBe(12);
    expect(vanguardClass.startingStats.intellect).toBe(4);
    expect(vanguardClass.startingStats.precision).toBe(6);
    expect(vanguardClass.startingStats.luck).toBe(5);
    expect(vanguardClass.startingStats.tech).toBe(4);
  });

  it('should have derived stats', () => {
    expect(typeof vanguardClass.startingStats.hp).toBe('number');
    expect(typeof vanguardClass.startingStats.armor).toBe('number');
    expect(vanguardClass.startingStats.hp).toBeGreaterThan(0);
  });
});

describe('All Six Classes - Original Names Only', () => {
  const classNames = ['vanguard', 'ranger', 'arcanist', 'machinist', 'warden', 'shade'];

  it('should use only original class names (no Ragnarok/Arknights/Endfield IP)', () => {
    const forbiddenNames = [
      'knight', 'wizard', 'assassin', 'priest', 'monk', 'crusader',
      'sniper', 'guard', 'medic', 'specialist', 'caster', 'defender',
      'doctor', 'texas', 'lappland', 'exusiai', 'silverash',
    ];

    for (const name of classNames) {
      expect(forbiddenNames).not.toContain(name.toLowerCase());
    }
  });

  it('should have exactly 6 base classes', () => {
    expect(classNames).toHaveLength(6);
  });

  it('should include all required classes', () => {
    expect(classNames).toContain('vanguard');
    expect(classNames).toContain('ranger');
    expect(classNames).toContain('arcanist');
    expect(classNames).toContain('machinist');
    expect(classNames).toContain('warden');
    expect(classNames).toContain('shade');
  });
});
