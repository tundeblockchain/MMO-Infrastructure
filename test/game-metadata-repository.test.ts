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
} from '../lib/game-metadata/models';

const ddbMock = mockClient(DynamoDBDocumentClient);

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
    const combatConstants: CombatConstants = {
      criticalDamageMultiplier: 1.5,
      baseCriticalChance: 0.05,
      armorReductionPerPoint: 0.001,
      maxArmorReduction: 0.75,
      baseDodgeChance: 0.02,
      maxDodgeChance: 0.4,
      blockDamageReduction: 0.5,
      globalCooldown: 1.5,
      outOfCombatHpRegen: 0.05,
      outOfCombatResourceRegen: 0.1,
      combatDropoffSeconds: 10,
    };

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
      const updatedData: CombatConstants = {
        criticalDamageMultiplier: 1.75,
        baseCriticalChance: 0.06,
        armorReductionPerPoint: 0.001,
        maxArmorReduction: 0.75,
        baseDodgeChance: 0.02,
        maxDodgeChance: 0.4,
        blockDamageReduction: 0.5,
        globalCooldown: 1.5,
        outOfCombatHpRegen: 0.05,
        outOfCombatResourceRegen: 0.1,
        combatDropoffSeconds: 10,
      };

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
          data: {} as CombatConstants,
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
          data: {} as CombatConstants,
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
      data: {
        criticalDamageMultiplier: 1.5,
        baseCriticalChance: 0.05,
        armorReductionPerPoint: 0.001,
        maxArmorReduction: 0.75,
        baseDodgeChance: 0.02,
        maxDodgeChance: 0.4,
        blockDamageReduction: 0.5,
        globalCooldown: 1.5,
        outOfCombatHpRegen: 0.05,
        outOfCombatResourceRegen: 0.1,
        combatDropoffSeconds: 10,
      },
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

      const modifiedData = {
        ...publishedCatalog.data,
        criticalDamageMultiplier: 2.0,
      };

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

      const v2Data: CombatConstants = {
        ...publishedCatalog.data,
        criticalDamageMultiplier: 1.75,
      };

      const result = await repository.createCatalogVersion<CombatConstantsCatalog>({
        catalogType: 'combat-constants',
        version: 2,
        createdBy: 'test-user',
        data: v2Data,
      });

      expect(result.version).toBe(2);
      expect(result.status).toBe('draft');
      expect(result.data.criticalDamageMultiplier).toBe(1.75);
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
        data: {
          criticalDamageMultiplier: 1.5,
          baseCriticalChance: 0.05,
          armorReductionPerPoint: 0.001,
          maxArmorReduction: 0.75,
          baseDodgeChance: 0.02,
          maxDodgeChance: 0.4,
          blockDamageReduction: 0.5,
          globalCooldown: 1.5,
          outOfCombatHpRegen: 0.05,
          outOfCombatResourceRegen: 0.1,
          combatDropoffSeconds: 10,
        },
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
        data: {
          criticalDamageMultiplier: 1.75,
          baseCriticalChance: 0.06,
          armorReductionPerPoint: 0.001,
          maxArmorReduction: 0.75,
          baseDodgeChance: 0.02,
          maxDodgeChance: 0.4,
          blockDamageReduction: 0.5,
          globalCooldown: 1.5,
          outOfCombatHpRegen: 0.05,
          outOfCombatResourceRegen: 0.1,
          combatDropoffSeconds: 10,
        },
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

      const result = await repository.listCatalogVersions('class', {
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

describe('Model Types - Combat Constants Decimal Format', () => {
  it('should represent percentages as decimals', () => {
    const constants: CombatConstants = {
      criticalDamageMultiplier: 1.5,
      baseCriticalChance: 0.05,
      armorReductionPerPoint: 0.001,
      maxArmorReduction: 0.75,
      baseDodgeChance: 0.02,
      maxDodgeChance: 0.4,
      blockDamageReduction: 0.5,
      globalCooldown: 1.5,
      outOfCombatHpRegen: 0.05,
      outOfCombatResourceRegen: 0.1,
      combatDropoffSeconds: 10,
    };

    expect(constants.criticalDamageMultiplier).toBe(1.5);
    expect(constants.baseCriticalChance).toBe(0.05);
    expect(constants.maxArmorReduction).toBe(0.75);
  });
});

describe('Class Catalog Structure', () => {
  const vanguardClass: ClassDefinition = {
    classId: 'vanguard',
    displayName: 'Vanguard',
    description: 'A stalwart frontline defender who protects allies and controls the battlefield.',
    primaryResource: 'resolve',
    startingStats: {
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

  it('should have valid class structure', () => {
    expect(vanguardClass.classId).toBe('vanguard');
    expect(vanguardClass.primaryResource).toBe('resolve');
    expect(vanguardClass.resonance).toBe('valor');
    expect(vanguardClass.roles).toContain('tank');
  });

  it('should have numeric starting stats', () => {
    expect(typeof vanguardClass.startingStats.hp).toBe('number');
    expect(typeof vanguardClass.startingStats.armor).toBe('number');
    expect(vanguardClass.startingStats.hp).toBeGreaterThan(0);
  });
});
