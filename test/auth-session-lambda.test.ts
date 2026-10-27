/**
 * MMO-50: POST /auth/session issues a short-lived signed ZoneServer ticket.
 *
 * - Valid Firebase token + UsersTable row → ticket with claims and exp ≤ 5 min
 * - Bad, expired, wrong-audience, revoked, or disabled Firebase token → 401 UNAUTHORIZED
 * - Missing UsersTable row → 403 NO_PROFILE
 * - UsersTable row with banned: true → 403 BANNED
 * - Each ticket has a unique jti
 * - HMAC-SHA256 verifies with the key and fails when tampered
 */

import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { verifyZoneTicket } from '../lambdas/auth-session/ticket';

const ddbMock = mockClient(DynamoDBDocumentClient);

jest.mock('../lambdas/shared/auth', () => {
  const actual = jest.requireActual('../lambdas/shared/auth') as typeof import('../lambdas/shared/auth');
  return {
    ...actual,
    verifyFirebaseIdToken: jest.fn(),
  };
});

import { verifyFirebaseIdToken } from '../lambdas/shared/auth';
import { handler } from '../lambdas/auth-session/handler';
import {
  resetZoneTicketSecretCache,
  setZoneTicketSecretForTests,
} from '../lambdas/auth-session/ticket';

const mockVerifyFirebaseIdToken = verifyFirebaseIdToken as jest.MockedFunction<
  typeof verifyFirebaseIdToken
>;

const VALID_UID = 'firebase-user-123';
const USERS_TABLE_NAME = 'test-users';
const TICKET_SECRET = 'test-only-auth-session-hmac-key-do-not-use';

function decodedToken(overrides?: { uid?: string }) {
  return {
    uid: overrides?.uid ?? VALID_UID,
    aud: 'test-project',
    auth_time: 1704067200,
    exp: 1704153600,
    iat: 1704067200,
    iss: 'https://securetoken.google.com/test-project',
    sub: overrides?.uid ?? VALID_UID,
  } as never;
}

function firebaseAuthError(code: string, message: string): Error {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  err.name = 'FirebaseAuthError';
  return err;
}

function createMockEvent(options?: {
  authorization?: string;
  body?: unknown;
  rawBody?: string;
}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /auth/session',
    rawPath: '/auth/session',
    rawQueryString: '',
    headers: {
      ...(options?.authorization ? { authorization: options.authorization } : {}),
    },
    body:
      options?.rawBody ??
      (options?.body !== undefined ? JSON.stringify(options.body) : undefined),
    requestContext: {
      accountId: '000000000000',
      apiId: 'api123',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'POST',
        path: '/auth/session',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req123',
      routeKey: 'POST /auth/session',
      stage: 'test',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  };
}

function mockUserRow(
  accountType: 'player' | 'admin' | undefined,
  extras?: { banned?: boolean }
): void {
  if (accountType === undefined) {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    return;
  }
  ddbMock.on(GetCommand).resolves({
    Item: { uid: VALID_UID, accountType, ...(extras?.banned ? { banned: true } : {}) },
  });
}

function parseError(response: { statusCode: number; body: string }): {
  statusCode: number;
  code: string;
  message: string;
} {
  const body = JSON.parse(response.body) as { code: string; message: string };
  return { statusCode: response.statusCode, code: body.code, message: body.message };
}

describe('POST /auth/session', () => {
  beforeAll(() => {
    process.env.USERS_TABLE_NAME = USERS_TABLE_NAME;
    process.env.ZONE_TICKET_TTL_SECONDS = '300';
    process.env.ZONE_TICKET_AUDIENCE = 'zoneserver';
    process.env.ZONE_TICKET_ISSUER = 'mmo-api';
    delete process.env.ZONE_TICKET_SECRET;
  });

  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
    resetZoneTicketSecretCache();
    setZoneTicketSecretForTests(TICKET_SECRET);
  });

  it('returns a ticket with correct claims and exp ≤ 5 minutes for a valid token', async () => {
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(decodedToken());
    mockUserRow('player');
    const before = Math.floor(Date.now() / 1000);

    const result = await handler(
      createMockEvent({ authorization: 'Bearer valid-firebase-token' }),
      {} as never,
      {} as never
    );
    const response = result as { statusCode: number; body: string };
    const after = Math.floor(Date.now() / 1000);

    expect(response.statusCode).toBe(200);
    expect(mockVerifyFirebaseIdToken).toHaveBeenCalledWith('valid-firebase-token', {
      checkRevoked: true,
    });
    const body = JSON.parse(response.body) as {
      ticket: string;
      uid: string;
      accountType: string;
      expiresInSeconds: number;
      gameSessionToken?: string;
    };
    expect(body.uid).toBe(VALID_UID);
    expect(body.accountType).toBe('player');
    expect(body.expiresInSeconds).toBe(300);
    expect(body.expiresInSeconds).toBeLessThanOrEqual(300);
    expect(body.ticket).toEqual(expect.any(String));
    expect(body.gameSessionToken).toBeUndefined();

    const claims = verifyZoneTicket(TICKET_SECRET, body.ticket, { nowSeconds: before });
    expect(claims.uid).toBe(VALID_UID);
    expect(claims.accountType).toBe('player');
    expect(claims.aud).toBe('zoneserver');
    expect(claims.iss).toBe('mmo-api');
    expect(claims.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(claims.exp).toBe(claims.iat + 300);
    expect(claims.exp - before).toBeLessThanOrEqual(300);
    expect(claims.exp).toBeGreaterThanOrEqual(after);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(300);

    const get = ddbMock.commandCalls(GetCommand);
    expect(get).toHaveLength(1);
    expect(get[0].args[0].input).toEqual({
      TableName: USERS_TABLE_NAME,
      Key: { uid: VALID_UID },
    });
  });

  it('accepts the Firebase token from the JSON body', async () => {
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(decodedToken());
    mockUserRow('admin');

    const result = await handler(
      createMockEvent({ body: { firebaseIdToken: 'body-firebase-token' } }),
      {} as never,
      {} as never
    );
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).accountType).toBe('admin');
    expect(mockVerifyFirebaseIdToken).toHaveBeenCalledWith('body-firebase-token', {
      checkRevoked: true,
    });
  });

  it('returns 401 UNAUTHORIZED when the token is missing', async () => {
    const result = await handler(createMockEvent(), {} as never, {} as never);
    expect(parseError(result as { statusCode: number; body: string })).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Missing Firebase ID token',
    });
    expect(mockVerifyFirebaseIdToken).not.toHaveBeenCalled();
  });

  it('returns 401 UNAUTHORIZED when the Firebase token is invalid (bad signature)', async () => {
    mockVerifyFirebaseIdToken.mockRejectedValueOnce(
      new Error('Firebase ID token has invalid signature')
    );

    const result = await handler(
      createMockEvent({ authorization: 'Bearer bad-signature-token' }),
      {} as never,
      {} as never
    );
    expect(parseError(result as { statusCode: number; body: string })).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid Firebase token',
    });
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    expect(mockVerifyFirebaseIdToken).toHaveBeenCalledWith('bad-signature-token', {
      checkRevoked: true,
    });
  });

  it('returns 401 UNAUTHORIZED when the Firebase token is expired', async () => {
    mockVerifyFirebaseIdToken.mockRejectedValueOnce(
      new Error('Firebase ID token has expired')
    );

    const result = await handler(
      createMockEvent({ authorization: 'Bearer expired-token' }),
      {} as never,
      {} as never
    );
    expect(parseError(result as { statusCode: number; body: string })).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid Firebase token',
    });
  });

  it('returns 401 UNAUTHORIZED when the Firebase token audience is wrong', async () => {
    mockVerifyFirebaseIdToken.mockRejectedValueOnce(
      new Error('Firebase ID token has incorrect "aud" (audience) claim.')
    );

    const result = await handler(
      createMockEvent({ authorization: 'Bearer wrong-aud-token' }),
      {} as never,
      {} as never
    );
    expect(parseError(result as { statusCode: number; body: string })).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid Firebase token',
    });
  });

  it('returns 401 UNAUTHORIZED when the Firebase token is revoked', async () => {
    mockVerifyFirebaseIdToken.mockRejectedValueOnce(
      firebaseAuthError('auth/id-token-revoked', 'Firebase ID token has been revoked.')
    );

    const result = await handler(
      createMockEvent({ authorization: 'Bearer revoked-token' }),
      {} as never,
      {} as never
    );
    expect(parseError(result as { statusCode: number; body: string })).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid Firebase token',
    });
    expect(mockVerifyFirebaseIdToken).toHaveBeenCalledWith('revoked-token', {
      checkRevoked: true,
    });
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
  });

  it('returns 401 UNAUTHORIZED when the Firebase user is disabled', async () => {
    mockVerifyFirebaseIdToken.mockRejectedValueOnce(
      firebaseAuthError('auth/user-disabled', 'The user account has been disabled.')
    );

    const result = await handler(
      createMockEvent({ authorization: 'Bearer disabled-user-token' }),
      {} as never,
      {} as never
    );
    expect(parseError(result as { statusCode: number; body: string })).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid Firebase token',
    });
    expect(mockVerifyFirebaseIdToken).toHaveBeenCalledWith('disabled-user-token', {
      checkRevoked: true,
    });
  });

  it('returns 403 NO_PROFILE when the UsersTable row is missing', async () => {
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(decodedToken());
    mockUserRow(undefined);

    const result = await handler(
      createMockEvent({ authorization: 'Bearer valid-firebase-token' }),
      {} as never,
      {} as never
    );
    expect(parseError(result as { statusCode: number; body: string })).toEqual({
      statusCode: 403,
      code: 'NO_PROFILE',
      message: 'No user profile. Call /users/me first.',
    });
  });

  it('returns 403 BANNED when the UsersTable row has banned: true', async () => {
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(decodedToken());
    mockUserRow('player', { banned: true });

    const result = await handler(
      createMockEvent({ authorization: 'Bearer valid-firebase-token' }),
      {} as never,
      {} as never
    );
    expect(parseError(result as { statusCode: number; body: string })).toEqual({
      statusCode: 403,
      code: 'BANNED',
      message: 'Account is banned',
    });
  });

  it('issues tickets with unique jti values', async () => {
    mockVerifyFirebaseIdToken.mockResolvedValue(decodedToken());
    mockUserRow('player');

    const first = (await handler(
      createMockEvent({ authorization: 'Bearer valid-firebase-token' }),
      {} as never,
      {} as never
    )) as { body: string };
    const second = (await handler(
      createMockEvent({ authorization: 'Bearer valid-firebase-token' }),
      {} as never,
      {} as never
    )) as { body: string };

    const now = Math.floor(Date.now() / 1000);
    const a = verifyZoneTicket(TICKET_SECRET, JSON.parse(first.body).ticket, { nowSeconds: now });
    const b = verifyZoneTicket(TICKET_SECRET, JSON.parse(second.body).ticket, { nowSeconds: now });
    expect(a.jti).not.toBe(b.jti);
  });

  it('verifies the issued ticket with the key and fails when tampered', async () => {
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(decodedToken());
    mockUserRow('player');

    const result = await handler(
      createMockEvent({ authorization: 'Bearer valid-firebase-token' }),
      {} as never,
      {} as never
    );
    const ticket = JSON.parse((result as { body: string }).body).ticket as string;
    const now = Math.floor(Date.now() / 1000);
    expect(verifyZoneTicket(TICKET_SECRET, ticket, { nowSeconds: now }).uid).toBe(VALID_UID);

    const [header, payload, signature] = ticket.split('.');
    const tampered = `${header}.${payload}.${signature.slice(0, -2)}aa`;
    expect(() => verifyZoneTicket(TICKET_SECRET, tampered, { nowSeconds: now })).toThrow(
      /signature/i
    );
  });
});
