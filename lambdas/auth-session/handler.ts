/**
 * Auth Session Lambda — MMO-50
 *
 * POST /auth/session
 * 1. Verify the Firebase ID token (signature, issuer, audience, expiry)
 *    via Firebase Admin verifyIdToken. Any failure → 401 (fail closed).
 * 2. Require an existing UsersTable row for that uid. Missing row → 403
 *    and tell the client to call /users/me first.
 * 3. Issue a short-lived HMAC-SHA256 compact JWS ticket for ZoneServer
 *    (uid, accountType, jti, iat, exp ≤ 5 min, aud).
 *
 * Tokens and signing keys are never logged.
 */

import { randomUUID } from 'crypto';
import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { verifyFirebaseIdToken } from '../shared/auth';
import {
  forbidden,
  getBearerToken,
  json,
  serverError,
  unauthorized,
} from '../shared/http';
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

interface SessionRequestBody {
  firebaseIdToken?: string;
}

export interface AuthSessionResponse {
  ticket: string;
  uid: string;
  accountType: AccountType;
  expiresInSeconds: number;
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

async function lookupUserRow(
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
  return isAccountType(accountType) ? accountType : undefined;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const firebaseToken = readFirebaseToken(event.headers, decodeEventBody(event));
    if (!firebaseToken) {
      return unauthorized('Missing Firebase ID token');
    }

    let uid: string;
    try {
      const decoded = await verifyFirebaseIdToken(firebaseToken);
      if (!decoded.uid) {
        return unauthorized('Invalid Firebase token');
      }
      uid = decoded.uid;
    } catch {
      // Fail closed. Do not log the token or Firebase error details that
      // might include token material.
      return unauthorized('Invalid Firebase token');
    }

    const usersTableName = process.env.USERS_TABLE_NAME;
    if (!usersTableName) {
      return serverError('USERS_TABLE_NAME is not configured');
    }

    const accountType = await lookupUserRow(usersTableName, uid);
    if (!accountType) {
      return forbidden('No user profile. Call /users/me first.');
    }

    const ttlSeconds = resolveTicketTtlSeconds(process.env.ZONE_TICKET_TTL_SECONDS);
    const iat = Math.floor(Date.now() / 1000);
    const claims: ZoneTicketClaims = {
      uid,
      accountType,
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
      accountType,
      expiresInSeconds: ttlSeconds,
    } satisfies AuthSessionResponse);
  } catch (err) {
    console.error('auth-session failed', err instanceof Error ? err.name : 'unknown');
    return serverError();
  }
};
