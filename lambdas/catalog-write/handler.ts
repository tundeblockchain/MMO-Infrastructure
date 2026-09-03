/**
 * Catalog Write Lambda Handler - MMO-7
 *
 * Authenticated APIs for publishing new catalog versions.
 * Requires Firebase JWT authentication.
 *
 * Endpoints:
 * - POST /catalog/{catalogType}/versions - Create and publish a new catalog version
 *
 * Design:
 * - Published versions are IMMUTABLE; attempts to overwrite return 409 Conflict
 * - Each publish automatically allocates the next version number
 * - Firebase JWT required on all write endpoints
 */

import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  json,
  badRequest,
  unauthorized,
  notFound,
  serverError,
  getBearerToken,
  parseJsonBody,
} from '../shared/http';
import { verifyFirebaseIdToken } from '../shared/auth';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = process.env.TABLE_NAME!;

const CATALOG_TYPES = [
  'combat-constants',
  'class',
  'skill',
  'status',
  'element',
  'resonance',
] as const;

type CatalogType = (typeof CATALOG_TYPES)[number];

function isCatalogType(value: string): value is CatalogType {
  return CATALOG_TYPES.includes(value as CatalogType);
}

function catalogPk(catalogType: string): string {
  return `CATALOG#${catalogType}`;
}

function versionSk(version: number): string {
  return `VERSION#${version.toString().padStart(8, '0')}`;
}

function gsi2Pk(status: 'published' | 'draft'): string {
  return `CATALOG#${status.toUpperCase()}`;
}

function gsi2Sk(catalogType: string, version: number): string {
  return `${catalogType}#VERSION#${version.toString().padStart(8, '0')}`;
}

export interface PublishCatalogRequest {
  data: unknown;
  releaseNotes?: string;
}

export interface PublishedCatalogResponse {
  catalogType: string;
  version: number;
  status: 'published';
  createdAt: string;
  publishedAt: string;
  createdBy: string;
  releaseNotes?: string;
}

/**
 * Verify Firebase JWT from Authorization header.
 * Returns the user's account ID (Firebase UID) or null if invalid.
 */
async function authenticateRequest(
  authorizationHeader?: string
): Promise<{ accountId: string } | null> {
  const token = getBearerToken(authorizationHeader);
  if (!token) {
    return null;
  }

  try {
    const decoded = await verifyFirebaseIdToken(token);
    return { accountId: decoded.uid };
  } catch {
    return null;
  }
}

/**
 * Get the next available version number for a catalog type.
 * Queries all existing versions and returns max + 1.
 */
async function getNextVersionNumber(catalogType: CatalogType): Promise<number> {
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': catalogPk(catalogType),
        ':skPrefix': 'VERSION#',
      },
      ScanIndexForward: false,
      Limit: 1,
      ProjectionExpression: 'version',
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return 1;
  }

  return (result.Items[0].version as number) + 1;
}

/**
 * Publish a new catalog version.
 * Allocates the next version number and publishes immediately.
 * Uses conditional write to prevent race conditions.
 */
async function publishNewCatalogVersion(
  catalogType: CatalogType,
  data: unknown,
  createdBy: string,
  releaseNotes?: string
): Promise<PublishedCatalogResponse> {
  const now = new Date().toISOString();
  const version = await getNextVersionNumber(catalogType);

  const catalogItem = {
    PK: catalogPk(catalogType),
    SK: versionSk(version),
    GSI2PK: gsi2Pk('published'),
    GSI2SK: gsi2Sk(catalogType, version),
    catalogType,
    version,
    status: 'published' as const,
    createdAt: now,
    publishedAt: now,
    createdBy,
    releaseNotes,
    data,
  };

  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: catalogItem,
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new VersionConflictError(catalogType, version);
    }
    throw err;
  }

  return {
    catalogType,
    version,
    status: 'published',
    createdAt: now,
    publishedAt: now,
    createdBy,
    releaseNotes,
  };
}

class VersionConflictError extends Error {
  constructor(
    public catalogType: string,
    public version: number
  ) {
    super(`Version ${version} already exists for ${catalogType}`);
    this.name = 'VersionConflictError';
  }
}

/**
 * Validate catalog data has basic structure.
 * Returns error message if invalid, null if valid.
 */
function validateCatalogData(catalogType: CatalogType, data: unknown): string | null {
  if (data === null || data === undefined) {
    return 'Catalog data is required';
  }

  switch (catalogType) {
    case 'combat-constants':
      if (typeof data !== 'object' || Array.isArray(data)) {
        return 'combat-constants data must be an object';
      }
      break;

    case 'class':
    case 'skill':
    case 'status':
    case 'element':
    case 'resonance':
      if (!Array.isArray(data)) {
        return `${catalogType} data must be an array`;
      }
      break;
  }

  return null;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    const auth = await authenticateRequest(event.headers?.authorization);
    if (!auth) {
      return unauthorized('Valid Firebase ID token required');
    }

    const publishMatch = path.match(/^\/catalog\/([^/]+)\/versions$/);
    if (publishMatch && method === 'POST') {
      const catalogType = publishMatch[1];

      if (!isCatalogType(catalogType)) {
        return badRequest(
          `Invalid catalog type: ${catalogType}. Valid types: ${CATALOG_TYPES.join(', ')}`
        );
      }

      const body = parseJsonBody<PublishCatalogRequest>(event.body);
      if (!body) {
        return badRequest('Request body must be valid JSON');
      }

      const validationError = validateCatalogData(catalogType, body.data);
      if (validationError) {
        return badRequest(validationError);
      }

      try {
        const result = await publishNewCatalogVersion(
          catalogType,
          body.data,
          auth.accountId,
          body.releaseNotes
        );
        return json(201, result);
      } catch (err) {
        if (err instanceof VersionConflictError) {
          return json(409, {
            error: `Version ${err.version} already exists for ${err.catalogType}. Retry to allocate a new version.`,
          });
        }
        throw err;
      }
    }

    return notFound('Route not found');
  } catch (err) {
    console.error('catalog-write handler failed', err);
    return serverError(err instanceof Error ? err.message : undefined);
  }
};
