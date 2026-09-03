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
