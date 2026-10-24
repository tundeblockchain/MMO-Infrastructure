/**
 * Users Me Lambda Handler
 *
 * Authenticated upsert of the signed-in Firebase user into the users table.
 *
 * GET /users/me and POST /users/me
 * - 401: missing Bearer token or verifyIdToken failed
 * - 200: { uid, accountType }
 *
 * Promotion (fail closed):
 * - accountType admin only when the verified token has email_verified true
 *   (boolean or the string "true") AND the email (lowercased + trimmed) is on
 *   ADMIN_EMAIL_ALLOWLIST. Email is read from the top-level claim, then from
 *   firebase.identities.email (Google sign-in).
 * - missing, empty, or non-matching allowlist → upsert player
 * - an existing player row is promoted when the caller is allowlisted+verified
 * - never downgrade an existing admin
 *
 * Blanket AUTO_ADMIN_ON_LOGIN is ignored. Demote a leftover admin row by hand
 * with put-item accountType player. The table remains the only publish gate.
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

interface VerifiedCaller {
  uid: string;
  email?: string;
  emailVerified: boolean;
}

/** Lowercase + trim each comma-separated entry. Empty / missing → nobody. */
export function parseAdminEmailAllowlist(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  const seen = new Set<string>();
  const emails: string[] = [];
  for (const part of raw.split(',')) {
    const email = part.trim().toLowerCase();
    if (email.length > 0 && !seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  }
  return emails;
}

export function normalizeEmail(email: string | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** Firebase Admin types email_verified as boolean; Google tokens may send "true". */
export function isEmailVerifiedClaim(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

/**
 * Prefer the top-level email claim, then firebase.identities.email[0]
 * (Google sign-in sometimes only populates identities).
 */
export function readEmailClaim(decoded: {
  email?: unknown;
  firebase?: { identities?: { email?: unknown } };
}): string | undefined {
  if (typeof decoded.email === 'string' && decoded.email.trim().length > 0) {
    return decoded.email;
  }
  const identities = decoded.firebase?.identities?.email;
  if (Array.isArray(identities)) {
    const first = identities.find(
      (entry) => typeof entry === 'string' && entry.trim().length > 0
    );
    if (typeof first === 'string') {
      return first;
    }
  }
  return undefined;
}

function isAllowlistedVerifiedEmail(caller: VerifiedCaller): boolean {
  if (caller.emailVerified !== true) {
    return false;
  }
  const email = normalizeEmail(caller.email);
  if (!email) {
    return false;
  }
  return parseAdminEmailAllowlist(process.env.ADMIN_EMAIL_ALLOWLIST).includes(email);
}

function readAuthorizationHeader(
  headers?: Record<string, string | undefined>
): string | undefined {
  if (!headers) {
    return undefined;
  }
  return headers.authorization ?? headers.Authorization;
}

async function verifyCaller(
  authorizationHeader?: string
): Promise<VerifiedCaller | null> {
  const token = getBearerToken(authorizationHeader);
  if (!token) {
    return null;
  }

  try {
    const decoded = await verifyFirebaseIdToken(token);
    if (!decoded.uid) {
      return null;
    }
    return {
      uid: decoded.uid,
      email: readEmailClaim(decoded),
      emailVerified: isEmailVerifiedClaim(decoded.email_verified),
    };
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

async function upsertCaller(caller: VerifiedCaller): Promise<AccountType> {
  const usersTableName = process.env.USERS_TABLE_NAME;
  if (!usersTableName) {
    throw new Error('USERS_TABLE_NAME is not configured');
  }

  if (isAllowlistedVerifiedEmail(caller)) {
    await putAccountType(usersTableName, caller.uid, 'admin');
    return 'admin';
  }

  const existing = await lookupAccountType(usersTableName, caller.uid);
  if (existing === 'admin') {
    return 'admin';
  }

  await putAccountType(usersTableName, caller.uid, 'player');
  return 'player';
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    if (path !== '/users/me' || (method !== 'GET' && method !== 'POST')) {
      return notFound('Route not found');
    }

    const caller = await verifyCaller(readAuthorizationHeader(event.headers));
    if (!caller) {
      return unauthorized('Valid Firebase ID token required');
    }

    const accountType = await upsertCaller(caller);
    return json(200, { uid: caller.uid, accountType } satisfies UsersMeResponse);
  } catch (err) {
    console.error('users-me handler failed', err);
    return serverError(err instanceof Error ? err.message : undefined);
  }
};
