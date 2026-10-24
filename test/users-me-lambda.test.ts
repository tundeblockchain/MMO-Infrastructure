/**
 * Users Me Lambda Tests - MMO-27
 *
 * POST /users/me upserts the Firebase uid into the users table.
 * AUTO_ADMIN_ON_LOGIN default true (temporary auto-admin).
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

function decodedToken() {
  return {
    uid: VALID_ACCOUNT_ID,
    aud: 'test-project',
    auth_time: 1704067200,
    exp: 1704153600,
    iat: 1704067200,
    iss: 'https://securetoken.google.com/test-project',
    sub: VALID_ACCOUNT_ID,
    firebase: {
      identities: {},
      sign_in_provider: 'password',
    },
  };
}

function createMockEvent(
  method: string,
  path: string,
  options?: { authorization?: string }
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {
      ...(options?.authorization ? { authorization: options.authorization } : {}),
    },
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

describe('POST /users/me (MMO-27)', () => {
  beforeAll(() => {
    process.env.USERS_TABLE_NAME = USERS_TABLE_NAME;
  });

  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
    process.env.AUTO_ADMIN_ON_LOGIN = 'true';
  });

  afterEach(() => {
    process.env.AUTO_ADMIN_ON_LOGIN = 'true';
  });

  it('should return 401 when no Authorization header is provided', async () => {
    const result = await handler(createMockEvent('POST', '/users/me'), {} as never, {} as never);
    const response = result as { statusCode: number; body: string };

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error).toContain('Firebase ID token required');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should return 401 when the Firebase token is invalid', async () => {
    mockVerifyFirebaseIdToken.mockRejectedValueOnce(new Error('Token expired'));

    const result = await handler(
      createMockEvent('POST', '/users/me', { authorization: 'Bearer expired-token' }),
      {} as never,
      {} as never
    );
    const response = result as { statusCode: number; body: string };

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error).toContain('Firebase ID token required');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('should upsert accountType admin when AUTO_ADMIN_ON_LOGIN is true', async () => {
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(decodedToken());
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent('POST', '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    const response = result as { statusCode: number; body: string };

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
  });

  it('should upsert accountType player when AUTO_ADMIN_ON_LOGIN is false', async () => {
    process.env.AUTO_ADMIN_ON_LOGIN = 'false';
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(decodedToken());
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(
      createMockEvent('POST', '/users/me', { authorization: VALID_TOKEN }),
      {} as never,
      {} as never
    );
    const response = result as { statusCode: number; body: string };

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
  });

  it('should not downgrade an existing admin when AUTO_ADMIN_ON_LOGIN is false', async () => {
    process.env.AUTO_ADMIN_ON_LOGIN = 'false';
    mockVerifyFirebaseIdToken.mockResolvedValueOnce(decodedToken());
    ddbMock.on(GetCommand).resolves({
      Item: { uid: VALID_ACCOUNT_ID, accountType: 'admin' },
    });

    const result = await handler(
      createMockEvent('POST', '/users/me', { authorization: VALID_TOKEN }),
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
});
