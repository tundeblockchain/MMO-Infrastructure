/**
 * Catalog Lambda Tests - MMO-6
 *
 * Tests for read-only game metadata catalog API.
 * Tests cover:
 * - GET by version (happy path and 404 for missing/unpublished)
 * - Published version discovery (latest versions and list)
 * - Invalid inputs (bad catalog type, bad version number)
 */

import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../lambdas/catalog/handler';

const ddbMock = mockClient(DynamoDBDocumentClient);

function createMockEvent(
  method: string,
  path: string
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'api123',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req123',
      routeKey: `${method} ${path}`,
      stage: 'test',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  };
}

function createPublishedCatalog(
  catalogType: string,
  version: number,
  data: unknown
) {
  return {
    PK: `CATALOG#${catalogType}`,
    SK: `VERSION#${version.toString().padStart(8, '0')}`,
    GSI2PK: 'CATALOG#PUBLISHED',
    GSI2SK: `${catalogType}#VERSION#${version.toString().padStart(8, '0')}`,
    catalogType,
    version,
    status: 'published',
    createdAt: '2024-01-01T00:00:00.000Z',
    publishedAt: '2024-01-02T00:00:00.000Z',
    createdBy: 'test-user',
    data,
  };
}

function createDraftCatalog(catalogType: string, version: number, data: unknown) {
  return {
    PK: `CATALOG#${catalogType}`,
    SK: `VERSION#${version.toString().padStart(8, '0')}`,
    GSI2PK: 'CATALOG#DRAFT',
    GSI2SK: `${catalogType}#VERSION#${version.toString().padStart(8, '0')}`,
    catalogType,
    version,
    status: 'draft',
    createdAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'test-user',
    data,
  };
}

describe('Catalog Lambda Handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
  });

  beforeEach(() => {
    ddbMock.reset();
  });

  describe('GET /catalog/{catalogType}/v/{version} - Get Catalog by Version', () => {
    it('should return published catalog for valid type and version', async () => {
      const mockCatalog = createPublishedCatalog('class', 1, [
        { classId: 'vanguard', displayName: 'Vanguard' },
      ]);

      ddbMock.on(GetCommand).resolves({ Item: mockCatalog });

      const event = createMockEvent('GET', '/catalog/class/v/1');
      const result = await handler(event, {} as never, {} as never);

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.catalogType).toBe('class');
      expect(body.version).toBe(1);
      expect(body.status).toBe('published');
      expect(body.data).toEqual([{ classId: 'vanguard', displayName: 'Vanguard' }]);
      expect(body.PK).toBeUndefined();
      expect(body.SK).toBeUndefined();
      expect(body.GSI2PK).toBeUndefined();
      expect(body.GSI2SK).toBeUndefined();
    });

    it('should return 404 for non-existent catalog', async () => {
      ddbMock.on(GetCommand).resolves({});

      const event = createMockEvent('GET', '/catalog/class/v/999');
      const result = await handler(event, {} as never, {} as never);

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.error).toContain('not found or not published');
    });

    it('should return 404 for unpublished (draft) catalog', async () => {
      const draftCatalog = createDraftCatalog('class', 2, []);

      ddbMock.on(GetCommand).resolves({ Item: draftCatalog });

      const event = createMockEvent('GET', '/catalog/class/v/2');
      const result = await handler(event, {} as never, {} as never);

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.error).toContain('not found or not published');
    });

    it('should return 400 for invalid catalog type', async () => {
      const event = createMockEvent('GET', '/catalog/invalid-type/v/1');
      const result = await handler(event, {} as never, {} as never);

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toContain('Invalid catalog type');
      expect(body.error).toContain('Valid types:');
    });

    it('should return 400 for invalid version number', async () => {
      const event = createMockEvent('GET', '/catalog/class/v/0');
      const result = await handler(event, {} as never, {} as never);

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toContain('Version must be a positive integer');
    });

    it('should support all catalog types', async () => {
      const catalogTypes = [
        'combat-constants',
        'class',
        'skill',
        'status',
        'element',
        'resonance',
      ];

      for (const catalogType of catalogTypes) {
        ddbMock.reset();
        const mockCatalog = createPublishedCatalog(catalogType, 1, { test: true });
        ddbMock.on(GetCommand).resolves({ Item: mockCatalog });

        const event = createMockEvent('GET', `/catalog/${catalogType}/v/1`);
        const result = await handler(event, {} as never, {} as never);

        const response = result as { statusCode: number; body: string };
        expect(response.statusCode).toBe(200);

        const body = JSON.parse(response.body);
        expect(body.catalogType).toBe(catalogType);
      }
    });
  });

  describe('GET /catalog/versions/latest - Get Latest Published Versions', () => {
    it('should return latest version for each catalog type with published data', async () => {
      ddbMock.on(QueryCommand).callsFake((input) => {
        const prefix = input.ExpressionAttributeValues?.[':prefix'] as string;
        const catalogType = prefix.split('#')[0];

        const versionMap: Record<string, number> = {
          'combat-constants': 3,
          class: 2,
          skill: 1,
          status: 1,
          element: 1,
          resonance: 1,
        };

        const version = versionMap[catalogType];
        if (version) {
          return Promise.resolve({
            Items: [{ version }],
          });
        }
        return Promise.resolve({ Items: [] });
      });

      const event = createMockEvent('GET', '/catalog/versions/latest');
      const result = await handler(event, {} as never, {} as never);

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.versions).toBeDefined();
      expect(body.versions['combat-constants']).toBe(3);
      expect(body.versions['class']).toBe(2);
      expect(body.timestamp).toBeDefined();
    });

    it('should return empty versions object when no published catalogs exist', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const event = createMockEvent('GET', '/catalog/versions/latest');
      const result = await handler(event, {} as never, {} as never);

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.versions).toEqual({});
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('GET /catalog/versions - List All Published Versions', () => {
    it('should return list of all published versions', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            catalogType: 'class',
            version: 2,
            status: 'published',
            publishedAt: '2024-01-02T00:00:00.000Z',
          },
          {
            catalogType: 'class',
            version: 1,
            status: 'published',
            publishedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            catalogType: 'combat-constants',
            version: 1,
            status: 'published',
            publishedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      });

      const event = createMockEvent('GET', '/catalog/versions');
      const result = await handler(event, {} as never, {} as never);

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.versions).toHaveLength(3);
      expect(body.versions[0].catalogType).toBe('class');
      expect(body.versions[0].version).toBe(2);
    });

    it('should return empty array when no published versions exist', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const event = createMockEvent('GET', '/catalog/versions');
      const result = await handler(event, {} as never, {} as never);

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.versions).toEqual([]);
    });
  });

  describe('Route Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const event = createMockEvent('GET', '/unknown/route');
      const result = await handler(event, {} as never, {} as never);

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Route not found');
    });

    it('should return 400 for non-GET methods', async () => {
      const event = createMockEvent('POST', '/catalog/versions');
      const result = await handler(event, {} as never, {} as never);

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toContain('Only GET method is supported');
    });
  });

  describe('Error Handling', () => {
    it('should return 500 for DynamoDB errors', async () => {
      ddbMock.on(GetCommand).rejects(new Error('DynamoDB connection failed'));

      const event = createMockEvent('GET', '/catalog/class/v/1');
      const result = await handler(event, {} as never, {} as never);

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(500);
    });
  });
});

describe('Published-Only Policy', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
  });

  beforeEach(() => {
    ddbMock.reset();
  });

  it('enforces published-only reads for game server - draft catalogs return 404', async () => {
    const draftCatalog = createDraftCatalog('skill', 1, [{ skillId: 'basic-attack' }]);
    ddbMock.on(GetCommand).resolves({ Item: draftCatalog });

    const event = createMockEvent('GET', '/catalog/skill/v/1');
    const result = await handler(event, {} as never, {} as never);

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(404);
  });
});

/**
 * MMO-10: Admin Entity Response Shape Tests
 *
 * Tests that verify response shapes match OpenAPI specification for admin consumers.
 * Admin (MMO-17) reads entities by pinned version using GET /catalog/{type}/v/{version}.
 */
describe('Admin Entity Response Shapes (MMO-10)', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
  });

  beforeEach(() => {
    ddbMock.reset();
  });

  describe('ClassDefinition response shape', () => {
    it('should return class entities with required fields per OpenAPI schema', async () => {
      const classData = [
        {
          classId: 'vanguard',
          displayName: 'Vanguard',
          description: 'Tank class',
          primaryResource: 'resolve',
          startingStats: {
            strength: 12,
            finesse: 7,
            vitality: 12,
            intellect: 4,
            precision: 6,
            luck: 5,
            tech: 4,
            hp: 150,
            resourcePool: 100,
            armor: 20,
            attackPower: 26,
            spellPower: 9,
            movementSpeed: 5.0,
          },
          resonance: 'valor',
          roles: ['tank', 'dps'],
        },
      ];
      const mockCatalog = createPublishedCatalog('class', 1, classData);
      ddbMock.on(GetCommand).resolves({ Item: mockCatalog });

      const event = createMockEvent('GET', '/catalog/class/v/1');
      const result = await handler(event, {} as never, {} as never);

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.catalogType).toBe('class');
      expect(body.data).toHaveLength(1);

      const classEntity = body.data[0];
      expect(classEntity.classId).toBe('vanguard');
      expect(classEntity.displayName).toBe('Vanguard');
      expect(classEntity.primaryResource).toBe('resolve');
      expect(classEntity.resonance).toBe('valor');
      expect(classEntity.roles).toEqual(['tank', 'dps']);

      expect(classEntity.startingStats).toBeDefined();
      expect(classEntity.startingStats.strength).toBe(12);
      expect(classEntity.startingStats.hp).toBe(150);
      expect(classEntity.startingStats.movementSpeed).toBe(5.0);
    });
  });

  describe('SkillDefinition response shape', () => {
    it('should return skill entities with coefficients, timing, stagger, and pvpMultipliers', async () => {
      const skillData = [
        {
          skillId: 'vanguard_cleaving_strike',
          classId: 'vanguard',
          displayName: 'Cleaving Strike',
          description: '1.50 P + 0.60 STR',
          kind: 'active',
          resourceId: null,
          resourceCost: 0,
          resourceEffects: [
            { resourceId: 'resolve', amount: 8, isPercentOfMax: false, perTargetBonus: 8 },
          ],
          cooldownSeconds: 0,
          charges: 1,
          chargeRechargeSeconds: 0,
          castTimeSeconds: 0,
          castableWhileMoving: false,
          range: 0,
          coefficients: {
            basePower: 1.5,
            scaling: [
              { stat: 'attackPower', coefficient: 1.5 },
              { stat: 'strength', coefficient: 0.6 },
            ],
            element: 'physical',
          },
          timing: { castMs: 0, activeMs: 350, recoveryMs: 300 },
          stagger: { staggerPower: 20, canStagger: true },
          pvpMultipliers: {
            damageMultiplier: 0.9,
            resourceOverride: { resourceId: 'resolve', amount: 12 },
          },
          unlockLevel: 1,
          iconPath: 'icons/skills/vanguard/cleaving_strike.png',
        },
      ];
      const mockCatalog = createPublishedCatalog('skill', 1, skillData);
      ddbMock.on(GetCommand).resolves({ Item: mockCatalog });

      const event = createMockEvent('GET', '/catalog/skill/v/1');
      const result = await handler(event, {} as never, {} as never);

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.catalogType).toBe('skill');
      expect(body.data).toHaveLength(1);

      const skillEntity = body.data[0];
      expect(skillEntity.skillId).toBe('vanguard_cleaving_strike');
      expect(skillEntity.classId).toBe('vanguard');
      expect(skillEntity.kind).toBe('active');

      expect(skillEntity.coefficients).toBeDefined();
      expect(skillEntity.coefficients.basePower).toBe(1.5);
      expect(skillEntity.coefficients.scaling).toHaveLength(2);
      expect(skillEntity.coefficients.element).toBe('physical');

      expect(skillEntity.timing).toBeDefined();
      expect(skillEntity.timing.castMs).toBe(0);
      expect(skillEntity.timing.activeMs).toBe(350);
      expect(skillEntity.timing.recoveryMs).toBe(300);

      expect(skillEntity.stagger).toBeDefined();
      expect(skillEntity.stagger.staggerPower).toBe(20);
      expect(skillEntity.stagger.canStagger).toBe(true);

      expect(skillEntity.pvpMultipliers).toBeDefined();
      expect(skillEntity.pvpMultipliers.damageMultiplier).toBe(0.9);

      expect(skillEntity.resourceEffects).toBeDefined();
      expect(skillEntity.resourceEffects[0].isPercentOfMax).toBe(false);
    });
  });

  describe('CombatConstants response shape', () => {
    it('should return combat constants with nested powerScaling, critical, defense', async () => {
      const combatConstantsData = {
        powerScaling: {
          physicalPower: { strengthMultiplier: 2, levelMultiplier: 1.5 },
          spellPower: { intellectMultiplier: 2, levelMultiplier: 1 },
          techPower: { techMultiplier: 2, levelMultiplier: 1 },
          devicePower: { techDivisor: 100 },
        },
        critical: {
          baseCritChance: 0.05,
          critChance: { luckConstant: 500, maxLuckCritBonus: 0.3 },
          procChance: { luckDivisor: 500 },
          criticalDamageMultiplier: 1.5,
        },
        defense: {
          defenseConstant: { baseConstant: 200, levelMultiplier: 15 },
          armorReductionPerPoint: 0.001,
          maxArmorReduction: 0.75,
          blockDamageReduction: 0.5,
        },
        additionalConstants: {
          defaultAttackRange: 2.5,
          targetRange: 30,
        },
      };
      const mockCatalog = createPublishedCatalog('combat-constants', 2, combatConstantsData);
      ddbMock.on(GetCommand).resolves({ Item: mockCatalog });

      const event = createMockEvent('GET', '/catalog/combat-constants/v/2');
      const result = await handler(event, {} as never, {} as never);

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.catalogType).toBe('combat-constants');
      expect(body.data).toBeDefined();

      const data = body.data;
      expect(data.powerScaling).toBeDefined();
      expect(data.powerScaling.physicalPower.strengthMultiplier).toBe(2);
      expect(data.powerScaling.physicalPower.levelMultiplier).toBe(1.5);

      expect(data.critical).toBeDefined();
      expect(data.critical.baseCritChance).toBe(0.05);
      expect(data.critical.criticalDamageMultiplier).toBe(1.5);

      expect(data.defense).toBeDefined();
      expect(data.defense.armorReductionPerPoint).toBe(0.001);
      expect(data.defense.maxArmorReduction).toBe(0.75);

      expect(data.additionalConstants).toBeDefined();
      expect(data.additionalConstants.defaultAttackRange).toBe(2.5);
    });
  });

  describe('StatusDefinition response shape', () => {
    it('should return status entities with category, maxStacks, dispellable', async () => {
      const statusData = [
        {
          statusId: 'flame',
          displayName: 'Flame',
          description: 'Burning damage over time',
          category: 'dot',
          maxStacks: 3,
          dispellable: true,
          persistsThroughDeath: false,
          iconPath: 'icons/statuses/flame.png',
        },
        {
          statusId: 'stealth',
          displayName: 'Stealth',
          description: 'Hidden from enemies',
          category: 'buff',
          maxStacks: 1,
          dispellable: false,
          persistsThroughDeath: false,
          iconPath: 'icons/statuses/stealth.png',
        },
      ];
      const mockCatalog = createPublishedCatalog('status', 1, statusData);
      ddbMock.on(GetCommand).resolves({ Item: mockCatalog });

      const event = createMockEvent('GET', '/catalog/status/v/1');
      const result = await handler(event, {} as never, {} as never);

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.catalogType).toBe('status');
      expect(body.data).toHaveLength(2);

      const flameStatus = body.data[0];
      expect(flameStatus.statusId).toBe('flame');
      expect(flameStatus.category).toBe('dot');
      expect(flameStatus.maxStacks).toBe(3);
      expect(flameStatus.dispellable).toBe(true);
      expect(flameStatus.persistsThroughDeath).toBe(false);

      const stealthStatus = body.data[1];
      expect(stealthStatus.statusId).toBe('stealth');
      expect(stealthStatus.category).toBe('buff');
      expect(stealthStatus.dispellable).toBe(false);
    });
  });

  describe('ElementDefinition response shape', () => {
    it('should return element entities with strongAgainst/weakAgainst as decimals', async () => {
      const elementData = [
        {
          elementId: 'fire',
          displayName: 'Fire',
          color: '#FF4500',
          strongAgainst: { ice: 1.25, nature: 1.25 },
          weakAgainst: { fire: 0.5 },
        },
        {
          elementId: 'ice',
          displayName: 'Ice',
          color: '#00BFFF',
          strongAgainst: { lightning: 1.25, nature: 1.15 },
          weakAgainst: { fire: 0.75, ice: 0.5 },
        },
      ];
      const mockCatalog = createPublishedCatalog('element', 1, elementData);
      ddbMock.on(GetCommand).resolves({ Item: mockCatalog });

      const event = createMockEvent('GET', '/catalog/element/v/1');
      const result = await handler(event, {} as never, {} as never);

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.catalogType).toBe('element');
      expect(body.data).toHaveLength(2);

      const fireElement = body.data[0];
      expect(fireElement.elementId).toBe('fire');
      expect(fireElement.color).toBe('#FF4500');
      expect(fireElement.strongAgainst.ice).toBe(1.25);
      expect(fireElement.strongAgainst.nature).toBe(1.25);
      expect(fireElement.weakAgainst.fire).toBe(0.5);

      const iceElement = body.data[1];
      expect(iceElement.strongAgainst.lightning).toBe(1.25);
      expect(iceElement.weakAgainst.fire).toBe(0.75);
    });
  });

  describe('ResonanceDefinition response shape', () => {
    it('should return resonance entities with partyBonus as array of stat/bonusPercent', async () => {
      const resonanceData = [
        {
          resonanceId: 'valor',
          displayName: 'Valor',
          description: 'Vanguard resonance',
          partyBonus: [
            { stat: 'hp', bonusPercent: 0.1 },
            { stat: 'armor', bonusPercent: 0.08 },
          ],
        },
        {
          resonanceId: 'precision',
          displayName: 'Precision',
          description: 'Ranger resonance',
          partyBonus: [
            { stat: 'attackPower', bonusPercent: 0.06 },
            { stat: 'movementSpeed', bonusPercent: 0.05 },
          ],
        },
      ];
      const mockCatalog = createPublishedCatalog('resonance', 1, resonanceData);
      ddbMock.on(GetCommand).resolves({ Item: mockCatalog });

      const event = createMockEvent('GET', '/catalog/resonance/v/1');
      const result = await handler(event, {} as never, {} as never);

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.catalogType).toBe('resonance');
      expect(body.data).toHaveLength(2);

      const valorResonance = body.data[0];
      expect(valorResonance.resonanceId).toBe('valor');
      expect(valorResonance.partyBonus).toHaveLength(2);
      expect(valorResonance.partyBonus[0].stat).toBe('hp');
      expect(valorResonance.partyBonus[0].bonusPercent).toBe(0.1);
      expect(valorResonance.partyBonus[1].stat).toBe('armor');
      expect(valorResonance.partyBonus[1].bonusPercent).toBe(0.08);
    });
  });

  describe('Admin workflow: list then read by version', () => {
    it('should support admin listing versions then reading entities for a pinned version', async () => {
      ddbMock.on(QueryCommand).callsFake((input) => {
        if (input.KeyConditionExpression?.includes('GSI2PK')) {
          const prefix = input.ExpressionAttributeValues?.[':prefix'] as string | undefined;
          if (prefix) {
            const catalogType = prefix.split('#')[0];
            const versionMap: Record<string, number> = {
              class: 2,
              skill: 1,
            };
            const version = versionMap[catalogType];
            if (version) {
              return Promise.resolve({ Items: [{ version }] });
            }
          }
          return Promise.resolve({
            Items: [
              { catalogType: 'class', version: 2, status: 'published', publishedAt: '2024-01-02T00:00:00.000Z' },
              { catalogType: 'class', version: 1, status: 'published', publishedAt: '2024-01-01T00:00:00.000Z' },
            ],
          });
        }
        return Promise.resolve({ Items: [] });
      });

      const latestEvent = createMockEvent('GET', '/catalog/versions/latest');
      const latestResult = await handler(latestEvent, {} as never, {} as never);

      const latestResponse = latestResult as { statusCode: number; body: string };
      expect(latestResponse.statusCode).toBe(200);

      const latestBody = JSON.parse(latestResponse.body);
      expect(latestBody.versions).toBeDefined();

      const classVersion = latestBody.versions['class'] || 2;
      expect(classVersion).toBe(2);

      const classData = [
        {
          classId: 'vanguard',
          displayName: 'Vanguard',
          description: 'Tank class',
          primaryResource: 'resolve',
          startingStats: {
            strength: 12, finesse: 7, vitality: 12, intellect: 4,
            precision: 6, luck: 5, tech: 4, hp: 150, resourcePool: 100,
            armor: 20, attackPower: 26, spellPower: 9, movementSpeed: 5.0,
          },
          resonance: 'valor',
          roles: ['tank', 'dps'],
        },
      ];
      ddbMock.on(GetCommand).resolves({
        Item: createPublishedCatalog('class', classVersion, classData),
      });

      const readEvent = createMockEvent('GET', `/catalog/class/v/${classVersion}`);
      const readResult = await handler(readEvent, {} as never, {} as never);

      const readResponse = readResult as { statusCode: number; body: string };
      expect(readResponse.statusCode).toBe(200);

      const readBody = JSON.parse(readResponse.body);
      expect(readBody.catalogType).toBe('class');
      expect(readBody.version).toBe(classVersion);
      expect(readBody.data).toHaveLength(1);
      expect(readBody.data[0].classId).toBe('vanguard');
    });
  });
});
