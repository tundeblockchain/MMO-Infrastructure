/**
 * Users Me Lambda Handler - MMO-27
 *
 * Authenticated upsert of the signed-in Firebase user into the users table.
 *
 * POST /users/me
 * - 401: missing Bearer token or verifyIdToken failed
 * - 200: { uid, accountType }
 *
 * AUTO_ADMIN_ON_LOGIN (default 'true', temporary):
 * - 'true'  → upsert accountType 'admin'
 * - 'false' → upsert accountType 'player', but never downgrade an existing admin
 *
 * TODO(MMO-27): set AUTO_ADMIN_ON_LOGIN=false to go back to manual admin
 * (put-item on mmo-{stage}-users). The table remains the only publish gate.
 */

import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  getBearerToken,
  json,
  notFound,
  serverError,
  unauthorized,
} from '../shared/http';
import { verifyFirebaseIdToken } from '../shared/auth';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type AccountType = 'player' | 'admin';

export interface UsersMeResponse {
  uid: string;
  accountType: AccountType;
}

/**
 * Temporary auto-admin switch. Default true.
 * TODO(MMO-27): set AUTO_ADMIN_ON_LOGIN=false to go back to manual admin.
 */
function isAutoAdminOnLogin(): boolean {
  return (process.env.AUTO_ADMIN_ON_LOGIN ?? 'true') !== 'false';
}

function readAuthorizationHeader(
  headers?: Record<string, string | undefined>
): string | undefined {
  if (!headers) {
    return undefined;
  }
  return headers.authorization ?? headers.Authorization;
}

async function verifyUid(authorizationHeader?: string): Promise<string | null> {
  const token = getBearerToken(authorizationHeader);
  if (!token) {
    return null;
  }

  try {
    const decoded = await verifyFirebaseIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

async function lookupAccountType(
  usersTableName: string,
  uid: string
): Promise<AccountType | undefined> {
  const result = await client.send(
    new GetCommand({
      TableName: usersTableName,
      Key: { uid },
    })
  );
  const accountType = result.Item?.accountType;
  return accountType === 'admin' || accountType === 'player' ? accountType : undefined;
}

async function putAccountType(
  usersTableName: string,
  uid: string,
  accountType: AccountType
): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: usersTableName,
      Item: { uid, accountType },
    })
  );
}

async function upsertCaller(uid: string): Promise<AccountType> {
  const usersTableName = process.env.USERS_TABLE_NAME;
  if (!usersTableName) {
    throw new Error('USERS_TABLE_NAME is not configured');
  }

  if (isAutoAdminOnLogin()) {
    await putAccountType(usersTableName, uid, 'admin');
    return 'admin';
  }

  const existing = await lookupAccountType(usersTableName, uid);
  if (existing === 'admin') {
    return 'admin';
  }

  await putAccountType(usersTableName, uid, 'player');
  return 'player';
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    if (!(path === '/users/me' && method === 'POST')) {
      return notFound('Route not found');
    }

    const uid = await verifyUid(readAuthorizationHeader(event.headers));
    if (!uid) {
      return unauthorized('Valid Firebase ID token required');
    }

    const accountType = await upsertCaller(uid);
    return json(200, { uid, accountType } satisfies UsersMeResponse);
  } catch (err) {
    console.error('users-me handler failed', err);
    return serverError(err instanceof Error ? err.message : undefined);
  }
};
