/**
 * Catalog Write Lambda Handler - MMO-7 / MMO-27
 *
 * Authenticated APIs for publishing new catalog versions.
 * Requires a Firebase ID token whose uid has accountType === 'admin'
 * in the users table. A missing row is treated as player.
 *
 * Endpoints:
 * - POST /catalog/{catalogType}/versions - Create and publish a new catalog version
 *
 * Design:
 * - Published versions are IMMUTABLE; attempts to overwrite return 409 Conflict
 * - Each publish automatically allocates the next version number
 * - Firebase JWT required; missing/invalid/expired → 401
 * - Users-table accountType === 'admin' required; missing row or player → 403
 * - Body is a full replacement payload (adds and removals vs the previous version)
 * - Empty `data` arrays are rejected with 400
 */

import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  json,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  serverError,
  getBearerToken,
  parseJsonBody,
} from '../shared/http';
import { verifyFirebaseIdToken } from '../shared/auth';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = process.env.TABLE_NAME!;
const usersTableName = process.env.USERS_TABLE_NAME!;

type AccountType = 'player' | 'admin';

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

type AuthSuccess = { ok: true; accountId: string };
type AuthFailure = { ok: false; status: 401 | 403; message: string };

/**
 * Look up accountType for a Firebase uid.
 * Missing row, missing table name, or any value other than 'admin' → player.
 */
async function lookupAccountType(uid: string): Promise<AccountType> {
  if (!usersTableName) {
    return 'player';
  }

  const result = await client.send(
    new GetCommand({
      TableName: usersTableName,
      Key: { uid },
    })
  );

  return result.Item?.accountType === 'admin' ? 'admin' : 'player';
}

/**
 * Verify Firebase JWT from Authorization header, then require users-table admin.
 * 401: missing Bearer token or verifyIdToken failed (signature / aud / iss / expiry).
 * 403: token is valid but the uid is not admin (no row or accountType !== 'admin').
 */
async function authenticateRequest(
  authorizationHeader?: string
): Promise<AuthSuccess | AuthFailure> {
  const token = getBearerToken(authorizationHeader);
  if (!token) {
    return { ok: false, status: 401, message: 'Valid Firebase ID token required' };
  }

  let uid: string;
  try {
    const decoded = await verifyFirebaseIdToken(token);
    uid = decoded.uid;
  } catch {
    return { ok: false, status: 401, message: 'Valid Firebase ID token required' };
  }

  const accountType = await lookupAccountType(uid);
  if (accountType !== 'admin') {
    return { ok: false, status: 403, message: 'Account is not admin' };
  }

  return { ok: true, accountId: uid };
}

function readAuthorizationHeader(
  headers?: Record<string, string | undefined>
): string | undefined {
  if (!headers) {
    return undefined;
  }
  return headers.authorization ?? headers.Authorization;
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
      if (data.length === 0) {
        return `${catalogType} data must not be an empty array`;
      }
      break;
  }

  return null;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    const auth = await authenticateRequest(readAuthorizationHeader(event.headers));
    if (!auth.ok) {
      return auth.status === 403 ? forbidden(auth.message) : unauthorized(auth.message);
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
