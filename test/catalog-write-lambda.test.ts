/**
 * Catalog Write Lambda Tests - MMO-7
 *
 * Tests for authenticated catalog publish API.
 * Tests cover:
 * - Happy path: publish new version with valid Firebase JWT
 * - Auth: reject missing/invalid JWT
 * - Immutability: reject overwrite of published version (409 conflict)
 * - Validation: invalid catalog type, invalid payload structure
 */

import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../lambdas/catalog-write/handler';

const ddbMock = mockClient(DynamoDBDocumentClient);

jest.mock('../lambdas/shared/auth', () => ({
  verifyFirebaseIdToken: jest.fn(),
}));

import { verifyFirebaseIdToken } from '../lambdas/shared/auth';
const mockVerifyFirebaseIdToken = verifyFirebaseIdToken as jest.MockedFunction<
  typeof verifyFirebaseIdToken
>;

function createMockEvent(
  method: string,
  path: string,
  options?: {
    body?: unknown;
    authorization?: string;
  }
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {
      ...(options?.authorization ? { authorization: options.authorization } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
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

const VALID_TOKEN = 'Bearer valid-firebase-token';
const VALID_ACCOUNT_ID = 'firebase-user-123';

describe('Catalog Write Lambda Handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
  });

  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
  });

  describe('POST /catalog/{catalogType}/versions - Publish New Version', () => {
    it('should publish new catalog version with valid Firebase JWT', async () => {
      mockVerifyFirebaseIdToken.mockResolvedValueOnce({
        uid: VALID_ACCOUNT_ID,
        aud: 'test-project',
        auth_time: 1704067200,
        exp: 1704153600,
        iat: 1704067200,
        iss: 'https://securetoken.google.com/test-project',
        sub: VALID_ACCOUNT_ID,
        firebase: {
          identities: {},
          sign_in_provider: 'password',
        },
      });

      ddbMock.on(QueryCommand).resolves({ Items: [] });
      ddbMock.on(PutCommand).resolves({});

      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: VALID_TOKEN,
        body: {
          data: [{ classId: 'vanguard', displayName: 'Vanguard' }],
          releaseNotes: 'Initial release',
        },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.catalogType).toBe('class');
      expect(body.version).toBe(1);
      expect(body.status).toBe('published');
      expect(body.createdBy).toBe(VALID_ACCOUNT_ID);
      expect(body.releaseNotes).toBe('Initial release');
      expect(body.publishedAt).toBeDefined();
    });

    it('should allocate next version number when versions exist', async () => {
      mockVerifyFirebaseIdToken.mockResolvedValueOnce({
        uid: VALID_ACCOUNT_ID,
        aud: 'test-project',
        auth_time: 1704067200,
        exp: 1704153600,
        iat: 1704067200,
        iss: 'https://securetoken.google.com/test-project',
        sub: VALID_ACCOUNT_ID,
        firebase: {
          identities: {},
          sign_in_provider: 'password',
        },
      });

      ddbMock.on(QueryCommand).resolves({
        Items: [{ version: 3 }],
      });
      ddbMock.on(PutCommand).resolves({});

      const event = createMockEvent('POST', '/catalog/skill/versions', {
        authorization: VALID_TOKEN,
        body: {
          data: [{ skillId: 'basic-attack', displayName: 'Basic Attack' }],
        },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.version).toBe(4);
    });

    it('should support combat-constants catalog type with object data', async () => {
      mockVerifyFirebaseIdToken.mockResolvedValueOnce({
        uid: VALID_ACCOUNT_ID,
        aud: 'test-project',
        auth_time: 1704067200,
        exp: 1704153600,
        iat: 1704067200,
        iss: 'https://securetoken.google.com/test-project',
        sub: VALID_ACCOUNT_ID,
        firebase: {
          identities: {},
          sign_in_provider: 'password',
        },
      });

      ddbMock.on(QueryCommand).resolves({ Items: [] });
      ddbMock.on(PutCommand).resolves({});

      const event = createMockEvent('POST', '/catalog/combat-constants/versions', {
        authorization: VALID_TOKEN,
        body: {
          data: { powerScaling: { baseDamageMultiplier: 1.0 } },
        },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.catalogType).toBe('combat-constants');
    });
  });

  describe('Authentication - Reject Missing/Invalid JWT', () => {
    it('should return 401 when no Authorization header provided', async () => {
      const event = createMockEvent('POST', '/catalog/class/versions', {
        body: { data: [] },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toContain('Firebase ID token required');
    });

    it('should return 401 when Authorization header has no Bearer prefix', async () => {
      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: 'invalid-token',
        body: { data: [] },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 when Firebase token verification fails', async () => {
      mockVerifyFirebaseIdToken.mockRejectedValueOnce(new Error('Token expired'));

      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: 'Bearer expired-token',
        body: { data: [] },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toContain('Firebase ID token required');
    });

    it('should return 401 when token is malformed', async () => {
      mockVerifyFirebaseIdToken.mockRejectedValueOnce(
        new Error('Decoding Firebase ID token failed')
      );

      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: 'Bearer malformed.token.here',
        body: { data: [] },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Immutability - Reject Overwrite of Published Version', () => {
    it('should return 409 when version already exists (race condition)', async () => {
      mockVerifyFirebaseIdToken.mockResolvedValueOnce({
        uid: VALID_ACCOUNT_ID,
        aud: 'test-project',
        auth_time: 1704067200,
        exp: 1704153600,
        iat: 1704067200,
        iss: 'https://securetoken.google.com/test-project',
        sub: VALID_ACCOUNT_ID,
        firebase: {
          identities: {},
          sign_in_provider: 'password',
        },
      });

      ddbMock.on(QueryCommand).resolves({ Items: [{ version: 1 }] });

      const conditionalError = new ConditionalCheckFailedException({
        message: 'The conditional request failed',
        $metadata: {},
      });
      ddbMock.on(PutCommand).rejects(conditionalError);

      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: VALID_TOKEN,
        body: {
          data: [{ classId: 'vanguard' }],
        },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(409);

      const body = JSON.parse(response.body);
      expect(body.error).toContain('already exists');
      expect(body.error).toContain('Retry');
    });
  });

  describe('Validation - Invalid Catalog Type and Payload', () => {
    beforeEach(() => {
      mockVerifyFirebaseIdToken.mockResolvedValue({
        uid: VALID_ACCOUNT_ID,
        aud: 'test-project',
        auth_time: 1704067200,
        exp: 1704153600,
        iat: 1704067200,
        iss: 'https://securetoken.google.com/test-project',
        sub: VALID_ACCOUNT_ID,
        firebase: {
          identities: {},
          sign_in_provider: 'password',
        },
      });
    });

    it('should return 400 for invalid catalog type', async () => {
      const event = createMockEvent('POST', '/catalog/invalid-type/versions', {
        authorization: VALID_TOKEN,
        body: { data: [] },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toContain('Invalid catalog type');
      expect(body.error).toContain('Valid types:');
    });

    it('should return 400 when body is not valid JSON', async () => {
      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: VALID_TOKEN,
      });
      event.body = 'not valid json';

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toContain('valid JSON');
    });

    it('should return 400 when data is missing', async () => {
      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: VALID_TOKEN,
        body: { releaseNotes: 'no data field' },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toContain('data is required');
    });

    it('should return 400 when class data is not an array', async () => {
      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: VALID_TOKEN,
        body: { data: { notAnArray: true } },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toContain('must be an array');
    });

    it('should return 400 when combat-constants data is an array', async () => {
      const event = createMockEvent('POST', '/catalog/combat-constants/versions', {
        authorization: VALID_TOKEN,
        body: { data: [{ notAnObject: true }] },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toContain('must be an object');
    });

    it('should validate all array-based catalog types', async () => {
      const arrayTypes = ['skill', 'status', 'element', 'resonance'];

      for (const catalogType of arrayTypes) {
        const event = createMockEvent('POST', `/catalog/${catalogType}/versions`, {
          authorization: VALID_TOKEN,
          body: { data: { notAnArray: true } },
        });

        const result = await handler(event, {} as never, {} as never);
        const response = result as { statusCode: number; body: string };

        expect(response.statusCode).toBe(400);

        const body = JSON.parse(response.body);
        expect(body.error).toContain('must be an array');
      }
    });
  });

  describe('Route Handling', () => {
    beforeEach(() => {
      mockVerifyFirebaseIdToken.mockResolvedValue({
        uid: VALID_ACCOUNT_ID,
        aud: 'test-project',
        auth_time: 1704067200,
        exp: 1704153600,
        iat: 1704067200,
        iss: 'https://securetoken.google.com/test-project',
        sub: VALID_ACCOUNT_ID,
        firebase: {
          identities: {},
          sign_in_provider: 'password',
        },
      });
    });

    it('should return 404 for unknown routes', async () => {
      const event = createMockEvent('POST', '/catalog/unknown/route', {
        authorization: VALID_TOKEN,
        body: { data: [] },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Route not found');
    });

    it('should return 404 for GET requests to write endpoint', async () => {
      const event = createMockEvent('GET', '/catalog/class/versions', {
        authorization: VALID_TOKEN,
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(404);
    });
  });

  describe('Error Handling', () => {
    it('should return 500 for DynamoDB errors', async () => {
      mockVerifyFirebaseIdToken.mockResolvedValueOnce({
        uid: VALID_ACCOUNT_ID,
        aud: 'test-project',
        auth_time: 1704067200,
        exp: 1704153600,
        iat: 1704067200,
        iss: 'https://securetoken.google.com/test-project',
        sub: VALID_ACCOUNT_ID,
        firebase: {
          identities: {},
          sign_in_provider: 'password',
        },
      });

      ddbMock.on(QueryCommand).rejects(new Error('DynamoDB connection failed'));

      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: VALID_TOKEN,
        body: { data: [] },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(500);
    });
  });
});

describe('All Catalog Types Support', () => {
  const ALL_CATALOG_TYPES = [
    'combat-constants',
    'class',
    'skill',
    'status',
    'element',
    'resonance',
  ];

  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
  });

  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();

    mockVerifyFirebaseIdToken.mockResolvedValue({
      uid: VALID_ACCOUNT_ID,
      aud: 'test-project',
      auth_time: 1704067200,
      exp: 1704153600,
      iat: 1704067200,
      iss: 'https://securetoken.google.com/test-project',
      sub: VALID_ACCOUNT_ID,
      firebase: {
        identities: {},
        sign_in_provider: 'password',
      },
    });

    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});
  });

  it.each(ALL_CATALOG_TYPES)('should accept valid %s catalog', async (catalogType) => {
    const data =
      catalogType === 'combat-constants' ? { powerScaling: {} } : [{ id: 'test' }];

    const event = createMockEvent('POST', `/catalog/${catalogType}/versions`, {
      authorization: VALID_TOKEN,
      body: { data },
    });

    const result = await handler(event, {} as never, {} as never);
    const response = result as { statusCode: number; body: string };

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body.catalogType).toBe(catalogType);
    expect(body.status).toBe('published');
  });
});

/**
 * Admin Publish Scenarios - MMO-11
 *
 * Tests for admin catalog publish workflow with seed-shaped data.
 * Validates that the API accepts complete entity structures matching
 * the TypeScript models and seed data shapes.
 */
describe('Admin Publish Scenarios (MMO-11)', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
  });

  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();

    mockVerifyFirebaseIdToken.mockResolvedValue({
      uid: VALID_ACCOUNT_ID,
      aud: 'test-project',
      auth_time: 1704067200,
      exp: 1704153600,
      iat: 1704067200,
      iss: 'https://securetoken.google.com/test-project',
      sub: VALID_ACCOUNT_ID,
      firebase: {
        identities: {},
        sign_in_provider: 'password',
      },
    });

    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});
  });

  describe('Class Catalog - Seed Shape Validation', () => {
    it('should accept class with full startingStats structure', async () => {
      const classData = [
        {
          classId: 'vanguard',
          displayName: 'Vanguard',
          description: 'A stalwart frontline defender who protects allies.',
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

      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: VALID_TOKEN,
        body: { data: classData, releaseNotes: 'Initial class definitions' },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.catalogType).toBe('class');
      expect(body.releaseNotes).toBe('Initial class definitions');
    });

    it('should accept class with optional secondaryResource (Warden)', async () => {
      const wardenClass = [
        {
          classId: 'warden',
          displayName: 'Warden',
          description: 'A divine guardian who balances offensive judgment and protective radiance.',
          primaryResource: 'radiance',
          secondaryResource: 'judgement',
          startingStats: {
            strength: 5,
            finesse: 6,
            vitality: 10,
            intellect: 12,
            precision: 6,
            luck: 6,
            tech: 5,
            hp: 120,
            resourcePool: 100,
            armor: 12,
            attackPower: 12,
            spellPower: 25,
            movementSpeed: 5.0,
          },
          resonance: 'sanctuary',
          roles: ['healer', 'support'],
        },
      ];

      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: VALID_TOKEN,
        body: { data: wardenClass },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);
    });
  });

  describe('Combat Constants - Nested powerScaling Structure', () => {
    it('should accept combat constants with full nested structure', async () => {
      const combatConstants = {
        powerScaling: {
          physicalPower: { strengthMultiplier: 2, levelMultiplier: 1.5 },
          spellPower: { intellectMultiplier: 2, levelMultiplier: 1 },
          techPower: { techMultiplier: 2, levelMultiplier: 1 },
          devicePower: { techDivisor: 100 },
        },
        speed: {
          attackSpeed: { finesseConstant: 400, attackSpeedCap: 2.5 },
          dodgeRecovery: { finesseConstant: 1000 },
        },
        vitality: {
          maxHp: { vitalityDivisor: 100 },
          healingReceived: { vitalityDivisor: 1000 },
        },
        accuracy: {
          baseHitChance: 0.90,
          accuracyBonus: { precisionConstant: 300, maxAccuracyBonus: 0.15 },
          weakPoint: { precisionMultiplier: 0.0015 },
        },
        critical: {
          baseCritChance: 0.05,
          critChance: { luckConstant: 500, maxLuckCritBonus: 0.30 },
          procChance: { luckDivisor: 500 },
          criticalDamageMultiplier: 1.50,
        },
        defense: {
          defenseConstant: { baseConstant: 200, levelMultiplier: 15 },
          armorReductionPerPoint: 0.001,
          maxArmorReduction: 0.75,
          blockDamageReduction: 0.50,
        },
        glancingHit: { damageMultiplier: 0.50, canCrit: false, canStagger: false },
        status: { resistanceConstant: 100 },
        statAllocationBands: [
          { minLevel: 1, maxLevel: 10, pointsPerLevel: 2, allocationCostPerPoint: 1 },
          { minLevel: 11, maxLevel: 30, pointsPerLevel: 3, allocationCostPerPoint: 1 },
        ],
        statCaps: { softCap: 100, hardCap: 150, softCapPenalty: 0.50 },
        dodge: { baseDodgeChance: 0.02, maxDodgeChance: 0.40 },
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
        additionalConstants: {
          defaultAttackRange: 2.5,
          targetRange: 30,
          aoiRadius: 30,
        },
      };

      const event = createMockEvent('POST', '/catalog/combat-constants/versions', {
        authorization: VALID_TOKEN,
        body: { data: combatConstants, releaseNotes: 'Combat constants v2' },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.catalogType).toBe('combat-constants');
    });

    it('should accept combat constants with decimal percentages (1.50 = 150%)', async () => {
      const combatConstants = {
        powerScaling: {
          physicalPower: { strengthMultiplier: 2, levelMultiplier: 1.5 },
          spellPower: { intellectMultiplier: 2, levelMultiplier: 1 },
          techPower: { techMultiplier: 2, levelMultiplier: 1 },
          devicePower: { techDivisor: 100 },
        },
        critical: {
          baseCritChance: 0.05,
          critChance: { luckConstant: 500, maxLuckCritBonus: 0.30 },
          procChance: { luckDivisor: 500 },
          criticalDamageMultiplier: 1.50,
        },
      };

      const event = createMockEvent('POST', '/catalog/combat-constants/versions', {
        authorization: VALID_TOKEN,
        body: { data: combatConstants },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);
    });
  });

  describe('Skill Catalog - Timing and Stagger Validation', () => {
    it('should accept skill with timing, stagger, and pvpMultipliers', async () => {
      const skillData = [
        {
          skillId: 'vanguard_cleaving_strike',
          classId: 'vanguard',
          displayName: 'Cleaving Strike',
          description: '1.50 P + 0.60 STR, 120° arc. +8 Resolve per target; max +16.',
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
            basePower: 1.50,
            scaling: [
              { stat: 'attackPower', coefficient: 1.50 },
              { stat: 'strength', coefficient: 0.60 },
            ],
            element: 'physical',
          },
          timing: { castMs: 0, activeMs: 350, recoveryMs: 300 },
          stagger: { staggerPower: 20, canStagger: true },
          pvpMultipliers: {
            damageMultiplier: 0.90,
            resourceOverride: { resourceId: 'resolve', amount: 12 },
          },
          unlockLevel: 1,
          iconPath: 'icons/skills/vanguard/cleaving_strike.png',
        },
      ];

      const event = createMockEvent('POST', '/catalog/skill/versions', {
        authorization: VALID_TOKEN,
        body: { data: skillData },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);
    });

    it('should accept skill with perStack coefficients (Sever)', async () => {
      const severSkill = [
        {
          skillId: 'shade_sever',
          classId: 'shade',
          displayName: 'Sever',
          description: '1.50/2.00/2.60/3.30/4.20 P + 0.40 FIN per stack.',
          kind: 'active',
          resourceId: 'momentum',
          resourceCost: 1,
          cooldownSeconds: 6,
          charges: 1,
          chargeRechargeSeconds: 0,
          castTimeSeconds: 0,
          castableWhileMoving: false,
          range: 0,
          coefficients: {
            basePower: 1.50,
            scaling: [
              { stat: 'attackPower', coefficient: 1.50 },
              { stat: 'finesse', coefficient: 0.40 },
            ],
            element: 'physical',
            perStack: {
              basePowerPerStack: [1.50, 2.00, 2.60, 3.30, 4.20],
            },
          },
          timing: { castMs: 250, activeMs: 200, recoveryMs: 550 },
          stagger: { staggerPower: 15, perStackStagger: 15, canStagger: true },
          pvpMultipliers: { damageMultiplier: 0.80 },
          unlockLevel: 16,
          iconPath: 'icons/skills/shade/sever.png',
        },
      ];

      const event = createMockEvent('POST', '/catalog/skill/versions', {
        authorization: VALID_TOKEN,
        body: { data: severSkill },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);
    });

    it('should accept reaction skill with internalCooldownSeconds', async () => {
      const reactionSkill = [
        {
          skillId: 'arcanist_thermal_shock',
          classId: 'arcanist',
          displayName: 'Thermal Shock',
          description: 'REACTION: 2.30 P + 1.00 INT; consumes Flame+Frost.',
          kind: 'reaction',
          resourceId: null,
          resourceCost: 0,
          cooldownSeconds: 0,
          internalCooldownSeconds: 1,
          charges: 1,
          chargeRechargeSeconds: 0,
          castTimeSeconds: 0,
          castableWhileMoving: true,
          range: 30,
          coefficients: {
            basePower: 2.30,
            scaling: [
              { stat: 'spellPower', coefficient: 2.30 },
              { stat: 'intellect', coefficient: 1.00 },
            ],
            element: 'arcane',
          },
          timing: { castMs: 0, activeMs: 0, recoveryMs: 0, activePhaseType: 'reaction' },
          stagger: { staggerPower: 55, canStagger: true },
          pvpMultipliers: { damageMultiplier: 0.75, staggerMultiplier: 0.50 },
          unlockLevel: 16,
          iconPath: 'icons/skills/arcanist/thermal_shock.png',
        },
      ];

      const event = createMockEvent('POST', '/catalog/skill/versions', {
        authorization: VALID_TOKEN,
        body: { data: reactionSkill },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);
    });
  });

  describe('Status Catalog - All Categories', () => {
    it('should accept status effects of all categories', async () => {
      const statusData = [
        {
          statusId: 'flame',
          displayName: 'Flame',
          description: 'Burning from fire damage.',
          category: 'dot',
          maxStacks: 3,
          dispellable: true,
          persistsThroughDeath: false,
          iconPath: 'icons/statuses/flame.png',
        },
        {
          statusId: 'stagger',
          displayName: 'Stagger',
          description: 'Staggered, briefly unable to act.',
          category: 'control',
          maxStacks: 1,
          dispellable: false,
          persistsThroughDeath: false,
          iconPath: 'icons/statuses/stagger.png',
        },
        {
          statusId: 'armor_break',
          displayName: 'Armor Break',
          description: 'Armor reduced.',
          category: 'debuff',
          maxStacks: 1,
          dispellable: true,
          persistsThroughDeath: false,
          iconPath: 'icons/statuses/armor_break.png',
        },
        {
          statusId: 'stealth',
          displayName: 'Stealth',
          description: 'Hidden from enemies.',
          category: 'buff',
          maxStacks: 1,
          dispellable: false,
          persistsThroughDeath: false,
          iconPath: 'icons/statuses/stealth.png',
        },
        {
          statusId: 'sanctuary',
          displayName: 'Sanctuary',
          description: 'Healing over time.',
          category: 'hot',
          maxStacks: 1,
          dispellable: false,
          persistsThroughDeath: false,
          iconPath: 'icons/statuses/sanctuary.png',
        },
      ];

      const event = createMockEvent('POST', '/catalog/status/versions', {
        authorization: VALID_TOKEN,
        body: { data: statusData },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);
    });
  });

  describe('Element Catalog - Affinity Relationships', () => {
    it('should accept elements with strongAgainst/weakAgainst as decimals', async () => {
      const elementData = [
        {
          elementId: 'fire',
          displayName: 'Fire',
          color: '#FF4500',
          strongAgainst: { ice: 1.25, nature: 1.25 },
          weakAgainst: { fire: 0.50 },
        },
        {
          elementId: 'ice',
          displayName: 'Ice',
          color: '#00BFFF',
          strongAgainst: { lightning: 1.25, nature: 1.15 },
          weakAgainst: { fire: 0.75, ice: 0.50 },
        },
      ];

      const event = createMockEvent('POST', '/catalog/element/versions', {
        authorization: VALID_TOKEN,
        body: { data: elementData },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);
    });
  });

  describe('Resonance Catalog - Party Bonuses', () => {
    it('should accept resonance with partyBonus as decimals (0.10 = 10%)', async () => {
      const resonanceData = [
        {
          resonanceId: 'valor',
          displayName: 'Valor',
          description: 'The resonance of the Vanguard.',
          partyBonus: [
            { stat: 'hp', bonusPercent: 0.10 },
            { stat: 'armor', bonusPercent: 0.08 },
          ],
        },
        {
          resonanceId: 'arcana',
          displayName: 'Arcana',
          description: 'The resonance of the Arcanist.',
          partyBonus: [
            { stat: 'spellPower', bonusPercent: 0.10 },
            { stat: 'resourcePool', bonusPercent: 0.05 },
          ],
        },
      ];

      const event = createMockEvent('POST', '/catalog/resonance/versions', {
        authorization: VALID_TOKEN,
        body: { data: resonanceData },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);
    });
  });

  describe('Immutability and Version Allocation', () => {
    it('should allocate sequential versions for same catalog type', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [{ version: 5 }] });

      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: VALID_TOKEN,
        body: { data: [{ classId: 'test' }] },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.version).toBe(6);
    });

    it('should return 409 on version conflict (concurrent publish race)', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [{ version: 1 }] });
      ddbMock.on(PutCommand).rejects(
        new ConditionalCheckFailedException({
          message: 'The conditional request failed',
          $metadata: {},
        })
      );

      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: VALID_TOKEN,
        body: { data: [{ classId: 'test' }] },
      });

      const result = await handler(event, {} as never, {} as never);
      const response = result as { statusCode: number; body: string };

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('already exists');
      expect(body.error).toContain('Retry');
    });

    it('should store complete data payload in DynamoDB', async () => {
      let capturedItem: unknown = null;
      ddbMock.on(PutCommand).callsFake((input) => {
        capturedItem = input.Item;
        return {};
      });

      const classData = [
        {
          classId: 'vanguard',
          displayName: 'Vanguard',
          startingStats: { strength: 12, hp: 150 },
        },
      ];

      const event = createMockEvent('POST', '/catalog/class/versions', {
        authorization: VALID_TOKEN,
        body: { data: classData, releaseNotes: 'Test release' },
      });

      await handler(event, {} as never, {} as never);

      expect(capturedItem).toBeDefined();
      const item = capturedItem as { data: unknown; releaseNotes: string };
      expect(item.data).toEqual(classData);
      expect(item.releaseNotes).toBe('Test release');
    });
  });
});
