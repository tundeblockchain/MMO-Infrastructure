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
