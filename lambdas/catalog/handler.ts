/**
 * Catalog Lambda Handler - MMO-6
 *
 * GET APIs for game metadata catalogs so ZoneServer can cache published catalogs.
 * Callers must pass an explicit version they pinned - no always-latest catalog body.
 *
 * Endpoints:
 * - GET /catalog/versions                    - List published versions for all catalog types
 * - GET /catalog/versions/latest             - Get the current published version number (for pinning at boot)
 * - GET /catalog/{catalogType}/v/{version}   - Get full catalog by type and version (published only)
 *
 * All endpoints are unauthenticated (game server reads).
 */

import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { json, notFound, badRequest, serverError } from '../shared/http';

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

interface CatalogVersion {
  catalogType: string;
  version: number;
  status: string;
  publishedAt?: string;
}

interface LatestVersionsResponse {
  versions: Record<string, number>;
  timestamp: string;
}

interface CatalogVersionsResponse {
  versions: CatalogVersion[];
}

/**
 * Get the latest published version number for each catalog type.
 * ZoneServer uses this at boot/session to pin a version.
 */
async function getLatestPublishedVersions(): Promise<LatestVersionsResponse> {
  const versions: Record<string, number> = {};

  for (const catalogType of CATALOG_TYPES) {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :gsi2pk AND begins_with(GSI2SK, :prefix)',
        ExpressionAttributeValues: {
          ':gsi2pk': gsi2Pk('published'),
          ':prefix': `${catalogType}#VERSION#`,
        },
        ScanIndexForward: false,
        Limit: 1,
        ProjectionExpression: 'version',
      })
    );

    if (result.Items && result.Items.length > 0) {
      versions[catalogType] = result.Items[0].version as number;
    }
  }

  return {
    versions,
    timestamp: new Date().toISOString(),
  };
}

/**
 * List all published catalog versions across all types.
 */
async function listPublishedVersions(): Promise<CatalogVersionsResponse> {
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :gsi2pk',
      ExpressionAttributeValues: {
        ':gsi2pk': gsi2Pk('published'),
      },
      ScanIndexForward: false,
      ProjectionExpression: 'catalogType, version, #s, publishedAt',
      ExpressionAttributeNames: {
        '#s': 'status',
      },
    })
  );

  const versions: CatalogVersion[] = (result.Items ?? []).map((item) => ({
    catalogType: item.catalogType as string,
    version: item.version as number,
    status: item.status as string,
    publishedAt: item.publishedAt as string | undefined,
  }));

  return { versions };
}

/**
 * Get a specific published catalog by type and version.
 * Returns 404 if version doesn't exist or is not published.
 */
async function getCatalogByVersion(
  catalogType: CatalogType,
  version: number
): Promise<unknown | null> {
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: catalogPk(catalogType),
        SK: versionSk(version),
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  if (result.Item.status !== 'published') {
    return null;
  }

  const { PK, SK, GSI2PK, GSI2SK, ...catalogData } = result.Item;
  return catalogData;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    if (method !== 'GET') {
      return badRequest('Only GET method is supported');
    }

    if (path === '/catalog/versions') {
      const result = await listPublishedVersions();
      return json(200, result);
    }

    if (path === '/catalog/versions/latest') {
      const result = await getLatestPublishedVersions();
      return json(200, result);
    }

    const catalogMatch = path.match(/^\/catalog\/([^/]+)\/v\/(\d+)$/);
    if (catalogMatch) {
      const catalogType = catalogMatch[1];
      const version = parseInt(catalogMatch[2], 10);

      if (!isCatalogType(catalogType)) {
        return badRequest(
          `Invalid catalog type: ${catalogType}. Valid types: ${CATALOG_TYPES.join(', ')}`
        );
      }

      if (isNaN(version) || version < 1) {
        return badRequest('Version must be a positive integer');
      }

      const catalog = await getCatalogByVersion(catalogType, version);

      if (!catalog) {
        return notFound(
          `Catalog ${catalogType} version ${version} not found or not published`
        );
      }

      return json(200, catalog);
    }

    return notFound('Route not found');
  } catch (err) {
    console.error('catalog handler failed', err);
    return serverError(err instanceof Error ? err.message : undefined);
  }
};
