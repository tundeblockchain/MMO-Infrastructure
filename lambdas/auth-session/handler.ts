/**
 * Auth Session Lambda — MMO-50
 *
 * POST /auth/session
 * 1. Verify the Firebase ID token (signature, issuer, audience, expiry,
 *    and revocation via verifyIdToken(..., checkRevoked: true)).
 *    Any failure, including auth/id-token-revoked and auth/user-disabled,
 *    is 401 UNAUTHORIZED (fail closed).
 * 2. Require an existing UsersTable row for that uid.
 *    Missing row → 403 NO_PROFILE (call /users/me first).
 *    Row with banned === true → 403 BANNED.
 * 3. Issue a short-lived HMAC-SHA256 compact JWS ticket for ZoneServer
 *    (uid, accountType, jti, iat, exp ≤ 5 min, aud). The JSON field is
 *    `ticket` — that is what the client sends to ZoneServer. This is not
 *    the older 24h `gameSessionToken` used by /characters.
 *
 * Tokens and signing keys are never logged.
 */

import { randomUUID } from 'crypto';
import { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { verifyFirebaseIdToken } from '../shared/auth';
import { getBearerToken, json } from '../shared/http';
import {
  AccountType,
  DEFAULT_ZONE_TICKET_AUD,
  DEFAULT_ZONE_TICKET_ISS,
  getZoneTicketSecret,
  resolveTicketTtlSeconds,
  signZoneTicket,
  ZoneTicketClaims,
} from './ticket';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const AUTH_SESSION_ERROR_CODES = [
  'UNAUTHORIZED',
  'NO_PROFILE',
  'BANNED',
  'SERVER_FULL',
  'INTERNAL',
] as const;

export type AuthSessionErrorCode = (typeof AUTH_SESSION_ERROR_CODES)[number];

export interface AuthSessionErrorBody {
  code: AuthSessionErrorCode;
  message: string;
}

interface SessionRequestBody {
  firebaseIdToken?: string;
}

export interface AuthSessionResponse {
  ticket: string;
  uid: string;
  accountType: AccountType;
  expiresInSeconds: number;
}

interface UserRow {
  accountType: AccountType;
  banned: boolean;
}

function authError(
  statusCode: number,
  code: AuthSessionErrorCode,
  message: string
): APIGatewayProxyResultV2 {
  return json(statusCode, { code, message } satisfies AuthSessionErrorBody);
}

function readAuthorizationHeader(
  headers?: Record<string, string | undefined>
): string | undefined {
  if (!headers) {
    return undefined;
  }
  return headers.authorization ?? headers.Authorization;
}

function readFirebaseToken(
  headers?: Record<string, string | undefined>,
  body?: string | null
): string | null {
  const fromHeader = getBearerToken(readAuthorizationHeader(headers));
  if (fromHeader) {
    return fromHeader;
  }

  if (!body) {
    return null;
  }

  try {
    const parsed = JSON.parse(body) as SessionRequestBody;
    return typeof parsed.firebaseIdToken === 'string' && parsed.firebaseIdToken.length > 0
      ? parsed.firebaseIdToken
      : null;
  } catch {
    return null;
  }
}

function decodeEventBody(event: {
  body?: string | null;
  isBase64Encoded?: boolean;
}): string | null {
  if (!event.body) {
    return null;
  }
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

function isAccountType(value: unknown): value is AccountType {
  return value === 'player' || value === 'admin';
}

function isBannedFlag(value: unknown): boolean {
  return value === true;
}

function firebaseErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

async function lookupUserRow(
  usersTableName: string,
  uid: string
): Promise<UserRow | undefined> {
  const result = await client.send(
    new GetCommand({
      TableName: usersTableName,
      Key: { uid },
    })
  );
  const accountType = result.Item?.accountType;
  if (!isAccountType(accountType)) {
    return undefined;
  }
  return {
    accountType,
    banned: isBannedFlag(result.Item?.banned),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const firebaseToken = readFirebaseToken(event.headers, decodeEventBody(event));
    if (!firebaseToken) {
      return authError(401, 'UNAUTHORIZED', 'Missing Firebase ID token');
    }

    let uid: string;
    try {
      const decoded = await verifyFirebaseIdToken(firebaseToken, { checkRevoked: true });
      if (!decoded.uid) {
        return authError(401, 'UNAUTHORIZED', 'Invalid Firebase token');
      }
      uid = decoded.uid;
    } catch (err) {
      // Fail closed. Do not log the token. Revoked and disabled map to 401.
      const code = firebaseErrorCode(err);
      if (code === 'auth/id-token-revoked' || code === 'auth/user-disabled') {
        return authError(401, 'UNAUTHORIZED', 'Invalid Firebase token');
      }
      return authError(401, 'UNAUTHORIZED', 'Invalid Firebase token');
    }

    const usersTableName = process.env.USERS_TABLE_NAME;
    if (!usersTableName) {
      return authError(500, 'INTERNAL', 'Internal server error');
    }

    const row = await lookupUserRow(usersTableName, uid);
    if (!row) {
      return authError(403, 'NO_PROFILE', 'No user profile. Call /users/me first.');
    }
    if (row.banned) {
      return authError(403, 'BANNED', 'Account is banned');
    }

    const ttlSeconds = resolveTicketTtlSeconds(process.env.ZONE_TICKET_TTL_SECONDS);
    const iat = Math.floor(Date.now() / 1000);
    const claims: ZoneTicketClaims = {
      uid,
      accountType: row.accountType,
      jti: randomUUID(),
      iat,
      exp: iat + ttlSeconds,
      aud: process.env.ZONE_TICKET_AUDIENCE ?? DEFAULT_ZONE_TICKET_AUD,
      iss: process.env.ZONE_TICKET_ISSUER ?? DEFAULT_ZONE_TICKET_ISS,
    };

    const secret = await getZoneTicketSecret();
    const ticket = signZoneTicket(secret, claims);

    return json(200, {
      ticket,
      uid,
      accountType: row.accountType,
      expiresInSeconds: ttlSeconds,
    } satisfies AuthSessionResponse);
  } catch (err) {
    console.error('auth-session failed', err instanceof Error ? err.name : 'unknown');
    return authError(500, 'INTERNAL', 'Internal server error');
  }
};
