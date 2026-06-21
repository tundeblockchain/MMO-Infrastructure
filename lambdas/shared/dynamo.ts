import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { CharacterRecord, CharacterSummary, DEFAULT_CHARACTER_STATS } from './models';
import { randomUUID } from 'crypto';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = process.env.TABLE_NAME!;

export function accountPk(accountId: string): string {
  return `ACCOUNT#${accountId}`;
}

export function characterSk(characterId: string): string {
  return `CHAR#${characterId}`;
}

export async function ensureAccountProfile(accountId: string): Promise<void> {
  const now = new Date().toISOString();

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: accountPk(accountId),
        SK: 'PROFILE',
        accountId,
        createdAt: now,
        updatedAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  ).catch((err: { name?: string }) => {
    if (err.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
  });
}

export async function listCharacters(accountId: string): Promise<CharacterSummary[]> {
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': accountPk(accountId),
        ':skPrefix': 'CHAR#',
      },
    })
  );

  return (result.Items ?? []).map((item) => ({
    characterId: item.characterId as string,
    name: item.name as string,
    level: item.level as number,
    zoneId: item.zoneId as string,
  }));
}

export async function createCharacter(accountId: string, name: string): Promise<CharacterRecord> {
  const characterId = randomUUID();
  const now = new Date().toISOString();

  const record: CharacterRecord = {
    characterId,
    accountId,
    name,
    ...DEFAULT_CHARACTER_STATS,
    createdAt: now,
    updatedAt: now,
  };

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: accountPk(accountId),
        SK: characterSk(characterId),
        GSI1PK: `NAME#${name.toLowerCase()}`,
        GSI1SK: accountPk(accountId),
        ...record,
      },
      ConditionExpression: 'attribute_not_exists(SK)',
    })
  );

  return record;
}

export async function getCharacter(
  accountId: string,
  characterId: string
): Promise<CharacterRecord | null> {
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: accountPk(accountId),
        SK: characterSk(characterId),
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return result.Item as CharacterRecord;
}

export async function saveCharacter(record: CharacterRecord): Promise<CharacterRecord> {
  const updated: CharacterRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
  };

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: accountPk(updated.accountId),
        SK: characterSk(updated.characterId),
        GSI1PK: `NAME#${updated.name.toLowerCase()}`,
        GSI1SK: accountPk(updated.accountId),
        ...updated,
      },
    })
  );

  return updated;
}
