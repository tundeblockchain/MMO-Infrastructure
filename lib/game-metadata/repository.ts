/**
 * Game Metadata Repository - MMO-4
 *
 * DynamoDB operations for versioned game metadata catalogs.
 * Enforces immutability: published catalog versions cannot be modified.
 */

import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CatalogType,
  CatalogVersion,
  CombatConstantsCatalog,
  ClassCatalog,
  SkillCatalog,
  StatusCatalog,
  ElementCatalog,
  ResonanceCatalog,
  GameCatalog,
  CatalogStatus,
} from './models/index';

// ============================================================================
// DynamoDB Key Structure
// ============================================================================

/**
 * Partition key for catalog items:
 * PK = "CATALOG#{catalogType}"
 *
 * Sort key for catalog versions:
 * SK = "VERSION#{version:08d}" (zero-padded for lexicographic sorting)
 *
 * GSI2 for querying published catalogs across all types:
 * GSI2PK = "CATALOG#PUBLISHED" or "CATALOG#DRAFT"
 * GSI2SK = "{catalogType}#VERSION#{version:08d}"
 */

export function catalogPk(catalogType: CatalogType): string {
  return `CATALOG#${catalogType}`;
}

export function versionSk(version: number): string {
  return `VERSION#${version.toString().padStart(8, '0')}`;
}

export function gsi2Pk(status: CatalogStatus): string {
  return `CATALOG#${status.toUpperCase()}`;
}

export function gsi2Sk(catalogType: CatalogType, version: number): string {
  return `${catalogType}#VERSION#${version.toString().padStart(8, '0')}`;
}

// ============================================================================
// Error Types
// ============================================================================

export class CatalogNotFoundError extends Error {
  constructor(catalogType: CatalogType, version: number) {
    super(`Catalog ${catalogType} version ${version} not found`);
    this.name = 'CatalogNotFoundError';
  }
}

export class PublishedCatalogImmutableError extends Error {
  constructor(catalogType: CatalogType, version: number) {
    super(
      `Cannot modify published catalog ${catalogType} version ${version}. ` +
        'Published catalogs are immutable. Create a new version instead.'
    );
    this.name = 'PublishedCatalogImmutableError';
  }
}

export class CatalogVersionConflictError extends Error {
  constructor(catalogType: CatalogType, version: number) {
    super(
      `Catalog ${catalogType} version ${version} already exists. ` +
        'Use a different version number.'
    );
    this.name = 'CatalogVersionConflictError';
  }
}

// ============================================================================
// Repository Class
// ============================================================================

export interface GameMetadataRepositoryConfig {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

export class GameMetadataRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(config: GameMetadataRepositoryConfig) {
    this.tableName = config.tableName;
    this.client =
      config.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  /**
   * Create a new catalog version (draft status).
   * Fails if the version already exists.
   */
  async createCatalogVersion<T extends GameCatalog>(
    catalog: Omit<T, 'status' | 'createdAt'> & { catalogType: T['catalogType'] }
  ): Promise<T> {
    const now = new Date().toISOString();
    const fullCatalog = {
      ...catalog,
      status: 'draft' as const,
      createdAt: now,
    } as T;

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: catalogPk(catalog.catalogType),
            SK: versionSk(catalog.version),
            GSI2PK: gsi2Pk('draft'),
            GSI2SK: gsi2Sk(catalog.catalogType, catalog.version),
            ...fullCatalog,
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        })
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new CatalogVersionConflictError(catalog.catalogType, catalog.version);
      }
      throw err;
    }

    return fullCatalog;
  }

  /**
   * Update a draft catalog version.
   * Fails if the catalog is published (immutable) or doesn't exist.
   */
  async updateDraftCatalog<T extends GameCatalog>(
    catalogType: CatalogType,
    version: number,
    updates: Partial<Pick<T, 'data' | 'releaseNotes' | 'createdBy'>>
  ): Promise<T> {
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {
      ':draft': 'draft',
    };

    if (updates.data !== undefined) {
      updateExpressions.push('#data = :data');
      expressionAttributeNames['#data'] = 'data';
      expressionAttributeValues[':data'] = updates.data;
    }

    if (updates.releaseNotes !== undefined) {
      updateExpressions.push('releaseNotes = :releaseNotes');
      expressionAttributeValues[':releaseNotes'] = updates.releaseNotes;
    }

    if (updates.createdBy !== undefined) {
      updateExpressions.push('createdBy = :createdBy');
      expressionAttributeValues[':createdBy'] = updates.createdBy;
    }

    if (updateExpressions.length === 0) {
      const existing = await this.getCatalogVersion<T>(catalogType, version);
      if (!existing) {
        throw new CatalogNotFoundError(catalogType, version);
      }
      return existing;
    }

    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            PK: catalogPk(catalogType),
            SK: versionSk(version),
          },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
          ConditionExpression: 'attribute_exists(PK) AND #status = :draft',
          ExpressionAttributeNames: {
            ...expressionAttributeNames,
            '#status': 'status',
          },
          ExpressionAttributeValues: expressionAttributeValues,
          ReturnValues: 'ALL_NEW',
        })
      );

      const { PK, SK, GSI2PK, GSI2SK, ...catalogData } = result.Attributes ?? {};
      return catalogData as T;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        const existing = await this.getCatalogVersion<T>(catalogType, version);
        if (!existing) {
          throw new CatalogNotFoundError(catalogType, version);
        }
        throw new PublishedCatalogImmutableError(catalogType, version);
      }
      throw err;
    }
  }

  /**
   * Publish a draft catalog version, making it immutable.
   * Fails if already published or doesn't exist.
   */
  async publishCatalogVersion(
    catalogType: CatalogType,
    version: number
  ): Promise<CatalogVersion> {
    const now = new Date().toISOString();

    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            PK: catalogPk(catalogType),
            SK: versionSk(version),
          },
          UpdateExpression:
            'SET #status = :published, publishedAt = :publishedAt, ' +
            'GSI2PK = :gsi2pk, GSI2SK = :gsi2sk',
          ConditionExpression: 'attribute_exists(PK) AND #status = :draft',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':published': 'published',
            ':draft': 'draft',
            ':publishedAt': now,
            ':gsi2pk': gsi2Pk('published'),
            ':gsi2sk': gsi2Sk(catalogType, version),
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      const { PK, SK, GSI2PK, GSI2SK, ...catalogData } = result.Attributes ?? {};
      return catalogData as CatalogVersion;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        const existing = await this.getCatalogVersion(catalogType, version);
        if (!existing) {
          throw new CatalogNotFoundError(catalogType, version);
        }
        throw new PublishedCatalogImmutableError(catalogType, version);
      }
      throw err;
    }
  }

  /**
   * Get a specific catalog version.
   */
  async getCatalogVersion<T extends GameCatalog>(
    catalogType: CatalogType,
    version: number
  ): Promise<T | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: catalogPk(catalogType),
          SK: versionSk(version),
        },
      })
    );

    if (!result.Item) {
      return null;
    }

    const { PK, SK, GSI2PK, GSI2SK, ...catalogData } = result.Item;
    return catalogData as T;
  }

  /**
   * Get the latest published version of a catalog type.
   */
  async getLatestPublishedCatalog<T extends GameCatalog>(
    catalogType: CatalogType
  ): Promise<T | null> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :gsi2pk AND begins_with(GSI2SK, :prefix)',
        ExpressionAttributeValues: {
          ':gsi2pk': gsi2Pk('published'),
          ':prefix': `${catalogType}#VERSION#`,
        },
        ScanIndexForward: false,
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    const { PK, SK, GSI2PK, GSI2SK, ...catalogData } = result.Items[0];
    return catalogData as T;
  }

  /**
   * List all versions of a catalog type.
   */
  async listCatalogVersions(
    catalogType: CatalogType,
    options?: { status?: CatalogStatus; limit?: number }
  ): Promise<CatalogVersion[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: options?.status ? '#status = :status' : undefined,
        ExpressionAttributeNames: options?.status ? { '#status': 'status' } : undefined,
        ExpressionAttributeValues: {
          ':pk': catalogPk(catalogType),
          ':skPrefix': 'VERSION#',
          ...(options?.status ? { ':status': options.status } : {}),
        },
        ScanIndexForward: false,
        Limit: options?.limit,
      })
    );

    return (result.Items ?? []).map((item) => {
      const { PK, SK, GSI2PK, GSI2SK, ...catalogData } = item;
      return catalogData as CatalogVersion;
    });
  }

  /**
   * Attempt to overwrite a published catalog (for testing immutability).
   * This method deliberately tries to bypass the published check and should fail.
   * Only exposed for testing purposes.
   */
  async _testOverwritePublished<T extends GameCatalog>(
    catalog: T
  ): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: catalogPk(catalog.catalogType),
          SK: versionSk(catalog.version),
          GSI2PK: gsi2Pk(catalog.status),
          GSI2SK: gsi2Sk(catalog.catalogType, catalog.version),
          ...catalog,
        },
        ConditionExpression: 'attribute_not_exists(PK) OR #status <> :published',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':published': 'published',
        },
      })
    );
  }
}
