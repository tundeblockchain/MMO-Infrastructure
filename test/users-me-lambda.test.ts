/**
 * Users Me Lambda Tests
 *
 * GET/POST /users/me upserts the Firebase uid into the users table.
 * Admin promotion requires a verified email (boolean true or string "true")
 * AND a normalized email on ADMIN_EMAIL_ALLOWLIST. Missing/empty allowlist
 * fails closed. Existing player rows are promoted; existing admins are
 * never demoted. AUTO_ADMIN_ON_LOGIN is ignored. Body uid / accountType
 * are ignored. Bad, expired, or wrong-audience tokens fail closed with 401.
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../lambdas/users-me/handler';

const ddbMock = mockClient(DynamoDBDocumentClient);

jest.mock('../lambdas/shared/auth', () => {
  const actual = jest.requireActual('../lambdas/shared/auth') as typeof import('../lambdas/shared/auth');
  return {
    ...actual,
    verifyFirebaseIdToken: jest.fn(),
  };
});

import { verifyFirebaseIdToken } from '../lambdas/shared/auth';
const mockVerifyFirebaseIdToken = verifyFirebaseIdToken as jest.MockedFunction<
  typeof verifyFirebaseIdToken
>;

const VALID_TOKEN = 'Bearer valid-firebase-token';
const VALID_ACCOUNT_ID = 'firebase-user-123';
const USERS_TABLE_NAME = 'test-users';
const LISTED_EMAIL = 'admin@example.com';

function decodedToken(overrides?: {
  email?: string;
  email_verified?: boolean | string;
  identitiesEmail?: string[];
  omitEmail?: boolean;
  sign_in_provider?: string;
}) {
  return {
    uid: VALID_ACCOUNT_ID,
    aud: 'test-project',
    auth_time: 1704067200,
    exp: 1704153600,
    iat: 1704067200,
    iss: 'https://securetoken.google.com/test-project',
    sub: VALID_ACCOUNT_ID,
    ...(overrides?.omitEmail ? {} : { email: overrides?.email ?? LISTED_EMAIL }),
    email_verified: overrides?.email_verified ?? true,
    firebase: {
      identities: {
        ...(overrides?.identitiesEmail ? { email: overrides.identitiesEmail } : {}),
      },
      sign_in_provider: overrides?.sign_in_provider ?? 'password',
    },
  } as never;
}

function createMockEvent(
  method: string,
  path: string,
  options?: { authorization?: string; body?: unknown }
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {
      ...(options?.authorization ? { authorization: options.authorization } : {}),
    },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api123',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req123',
      routeKey: `${method} ${path}`,
      stage: 'test',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  };
}

const USERS_ME_METHODS = ['GET', 'POST'] as const;

describe.each(USERS_ME_METHODS)('%s /users/me', (method) => {
  beforeAll(() => {
    process.env.USERS_TABLE_NAME = USERS_TABLE_NAME;
  });

  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
    delete process.env.AUTO_ADMIN_ON_LOGIN;
    delete process.env.ADMIN_EMAIL_ALLOWLIST;
  });

  function expectPlayerUpsert(response: { statusCode: number; body: string }) {
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      uid: VALID_ACCOUNT_ID,
      accountType: 'player',
    });
    const puts = ddbMock.commandCalls(PutCommand);
    expect(puts).toHaveLength(1);
    expect(puts[0].args[0].input).toEqual({
      TableName: USERS_TABLE_NAME,
      Item: { uid: VALID_ACCOUNT_ID, accountType: 'player' },
    });
  }

  function expectAdminUpsert(response: { statusCode: number; body: string }) {
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      uid: VALID_ACCOUNT_ID,
      accountType: 'admin',
    });
    const puts = ddbMock.commandCalls(PutCommand);
    expect(puts).toHaveLength(1);
    expect(puts[0].args[0].input).toEqual({
      TableName: USERS_TABLE_NAME,
      Item: { uid: VALID_ACCOUNT_ID, accountType: 'admin' },
    });
  }

  it('should return 401 when no Authorization header is provided', async () => {
    const result = await handler(createMockEvent(method, '/users/me'), {} as never, {} as never);
    const response = result as { statusCode: number; body: string };

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error).toContain('Firebase ID token required');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should return 401 when the Firebase token is invalid', async () => {
    mockVerifyFirebaseIdToken.mockRejectedValueOnce(new Error('Token expired'));

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: 'Bearer expired-token' }),
      {} as never,
      {} as never
    );
    const response = result as { statusCode: number; body: string };

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error).toContain('Firebase ID token required');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should return 401 when the token is malformed', async () => {
    mockVerifyFirebaseIdToken.mockRejectedValueOnce(
      new Error('Decoding Firebase ID token failed')
    );

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: 'Bearer not-a-jwt' }),
      {} as never,
      {} as never
    );
    const response = result as { statusCode: number; body: string };

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error).toContain('Firebase ID token required');
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should return 401 when the token is expired', async () => {
    mockVerifyFirebaseIdToken.mockRejectedValueOnce(new Error('Firebase ID token has expired'));

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: 'Bearer expired-id-token' }),
      {} as never,
      {} as never
    );
    const response = result as { statusCode: number; body: string };

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error).toContain('Firebase ID token required');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should return 401 when the token audience is wrong', async () => {
    mockVerifyFirebaseIdToken.mockRejectedValueOnce(
      new Error('Firebase ID token has incorrect "aud" (audience) claim')
    );

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: 'Bearer wrong-audience-token' }),
      {} as never,
      {} as never
    );
    const response = result as { statusCode: number; body: string };

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error).toContain('Firebase ID token required');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should create a player row for a new uid', async () => {
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(
      decodedToken({ email: 'player@example.com', email_verified: true })
    );
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    expectPlayerUpsert(result as { statusCode: number; body: string });
  });

  it('should not write a second row on repeat player login', async () => {
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(
      decodedToken({ email: 'player@example.com', email_verified: true })
    );
    ddbMock.on(GetCommand).resolves({
      Item: { uid: VALID_ACCOUNT_ID, accountType: 'player' },
    });

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    const response = result as { statusCode: number; body: string };

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      uid: VALID_ACCOUNT_ID,
      accountType: 'player',
    });
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(1);
    expect(ddbMock.commandCalls(GetCommand)[0].args[0].input).toEqual({
      TableName: USERS_TABLE_NAME,
      Key: { uid: VALID_ACCOUNT_ID },
    });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should ignore body-supplied uid and accountType', async () => {
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(
      decodedToken({ email: 'player@example.com', email_verified: true })
    );
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent(method, '/users/me', {
        authorization: VALID_TOKEN,
        body: { uid: 'attacker-uid', accountType: 'admin' },
      }),
      {} as never,
      {} as never
    );
    expectPlayerUpsert(result as { statusCode: number; body: string });
    expect(mockVerifyFirebaseIdToken).toHaveBeenCalledTimes(1);
    const putItem = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as
      | { uid?: string; accountType?: string }
      | undefined;
    expect(putItem?.uid).toBe(VALID_ACCOUNT_ID);
    expect(putItem?.uid).not.toBe('attacker-uid');
    expect(putItem?.accountType).toBe('player');
  });

  it('should not promote an unverified email even when it is on the allowlist', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = LISTED_EMAIL;
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(
      decodedToken({ email: LISTED_EMAIL, email_verified: false })
    );
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    expectPlayerUpsert(result as { statusCode: number; body: string });
  });

  it('should not promote a verified email that is not on the allowlist', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = LISTED_EMAIL;
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(
      decodedToken({ email: 'player@example.com', email_verified: true })
    );
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    expectPlayerUpsert(result as { statusCode: number; body: string });
  });

  it('should promote when case and whitespace differ from the allowlist entry', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = '  Admin@Example.com  , other@example.com ';
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(
      decodedToken({ email: ' admin@example.com ', email_verified: true })
    );
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    expectAdminUpsert(result as { statusCode: number; body: string });
  });

  it('should promote nobody when the allowlist is empty', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = '   ,  ';
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(decodedToken());
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    expectPlayerUpsert(result as { statusCode: number; body: string });
  });

  it('should promote nobody when the allowlist is missing', async () => {
    delete process.env.ADMIN_EMAIL_ALLOWLIST;
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(decodedToken());
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    expectPlayerUpsert(result as { statusCode: number; body: string });
  });

  it('should promote a listed verified email to admin', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = LISTED_EMAIL;
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(
      decodedToken({ email: LISTED_EMAIL, email_verified: true })
    );
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    expectAdminUpsert(result as { statusCode: number; body: string });
  });

  it('should not demote an existing admin when the caller is not allowlisted', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = LISTED_EMAIL;
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(
      decodedToken({ email: 'player@example.com', email_verified: false })
    );
    ddbMock.on(GetCommand).resolves({
      Item: { uid: VALID_ACCOUNT_ID, accountType: 'admin' },
    });

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    const response = result as { statusCode: number; body: string };

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      uid: VALID_ACCOUNT_ID,
      accountType: 'admin',
    });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should ignore AUTO_ADMIN_ON_LOGIN=true and fail closed without an allowlist', async () => {
    process.env.AUTO_ADMIN_ON_LOGIN = 'true';
    delete process.env.ADMIN_EMAIL_ALLOWLIST;
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(decodedToken());
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    expectPlayerUpsert(result as { statusCode: number; body: string });
  });

  it('should promote an existing player row when the caller is allowlisted and verified', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = LISTED_EMAIL;
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(
      decodedToken({ email: LISTED_EMAIL, email_verified: true })
    );
    ddbMock.on(GetCommand).resolves({
      Item: { uid: VALID_ACCOUNT_ID, accountType: 'player' },
    });
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    expectAdminUpsert(result as { statusCode: number; body: string });
  });

  it('should promote when email_verified is the string true (Google sign-in tokens)', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = LISTED_EMAIL;
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(
      decodedToken({
        email: LISTED_EMAIL,
        email_verified: 'true',
        sign_in_provider: 'google.com',
      })
    );
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    expectAdminUpsert(result as { statusCode: number; body: string });
  });

  it('should not promote when email_verified is the string false', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = LISTED_EMAIL;
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(
      decodedToken({ email: LISTED_EMAIL, email_verified: 'false' })
    );
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    expectPlayerUpsert(result as { statusCode: number; body: string });
  });

  it('should read email from firebase.identities.email when the top-level claim is missing', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = LISTED_EMAIL;
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(
      decodedToken({
        omitEmail: true,
        email_verified: true,
        identitiesEmail: [' admin@example.com '],
        sign_in_provider: 'google.com',
      })
    );
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent(method, '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    expectAdminUpsert(result as { statusCode: number; body: string });
  });
});

describe('users-me route matching', () => {
  beforeAll(() => {
    process.env.USERS_TABLE_NAME = USERS_TABLE_NAME;
  });

  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
    delete process.env.ADMIN_EMAIL_ALLOWLIST;
  });

  it('should return 404 for methods other than GET and POST', async () => {
    const result = await handler(createMockEvent('PUT', '/users/me'), {} as never, {} as never);
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(404);
  });
});
