/**
 * MMO-50: ZoneServer ticket encoding and the MMO-51 test vector.
 */

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DEFAULT_ZONE_TICKET_AUD,
  DEFAULT_ZONE_TICKET_ISS,
  encodeHeaderJson,
  encodePayloadJson,
  getZoneTicketSecret,
  resetZoneTicketSecretCache,
  resolveTicketTtlSeconds,
  signZoneTicket,
  verifyZoneTicket,
  ZoneTicketClaims,
  ZoneTicketError,
} from '../lambdas/auth-session/ticket';

const secretsMock = mockClient(SecretsManagerClient);

/** Fake key only. Never a production secret. */
export const TEST_VECTOR_SECRET = 'test-only-zoneserver-ticket-hmac-key-do-not-use';

export const TEST_VECTOR_CLAIMS: ZoneTicketClaims = {
  uid: 'firebase-uid-vector-001',
  accountType: 'player',
  jti: '11111111-2222-4333-8444-555555555555',
  iat: 1700000000,
  exp: 1700000300,
  aud: 'zoneserver',
  iss: 'mmo-api',
};

export const TEST_VECTOR_TICKET =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJmaXJlYmFzZS11aWQtdmVjdG9yLTAwMSIsImFjY291bnRUeXBlIjoicGxheWVyIiwianRpIjoiMTExMTExMTEtMjIyMi00MzMzLTg0NDQtNTU1NTU1NTU1NTU1IiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjE3MDAwMDAzMDAsImF1ZCI6InpvbmVzZXJ2ZXIiLCJpc3MiOiJtbW8tYXBpIn0.fX5MEKhEupb2JBISENjEHMnDY1ioAEZmk4NzphZ7UfE';

describe('ZoneServer ticket format', () => {
  it('uses compact JSON with the documented key order', () => {
    expect(encodeHeaderJson()).toBe('{"alg":"HS256","typ":"JWT"}');
    expect(encodePayloadJson(TEST_VECTOR_CLAIMS)).toBe(
      '{"uid":"firebase-uid-vector-001","accountType":"player","jti":"11111111-2222-4333-8444-555555555555","iat":1700000000,"exp":1700000300,"aud":"zoneserver","iss":"mmo-api"}'
    );
  });

  it('matches the fixed MMO-51 test vector', () => {
    expect(signZoneTicket(TEST_VECTOR_SECRET, TEST_VECTOR_CLAIMS)).toBe(TEST_VECTOR_TICKET);
  });

  it('verifies the test vector at iat and returns the expected claims', () => {
    const claims = verifyZoneTicket(TEST_VECTOR_SECRET, TEST_VECTOR_TICKET, {
      nowSeconds: TEST_VECTOR_CLAIMS.iat,
    });
    expect(claims).toEqual(TEST_VECTOR_CLAIMS);
    expect(claims.exp - claims.iat).toBe(300);
    expect(claims.aud).toBe(DEFAULT_ZONE_TICKET_AUD);
    expect(claims.iss).toBe(DEFAULT_ZONE_TICKET_ISS);
  });

  it('rejects a tampered payload', () => {
    const [header, payload, signature] = TEST_VECTOR_TICKET.split('.');
    const tamperedPayload = Buffer.from(
      '{"uid":"tampered","accountType":"admin","jti":"11111111-2222-4333-8444-555555555555","iat":1700000000,"exp":1700000300,"aud":"zoneserver","iss":"mmo-api"}',
      'utf8'
    ).toString('base64url');
    const tampered = `${header}.${tamperedPayload}.${signature}`;

    expect(() =>
      verifyZoneTicket(TEST_VECTOR_SECRET, tampered, { nowSeconds: TEST_VECTOR_CLAIMS.iat })
    ).toThrow(ZoneTicketError);
    expect(() =>
      verifyZoneTicket(TEST_VECTOR_SECRET, tampered, { nowSeconds: TEST_VECTOR_CLAIMS.iat })
    ).toThrow(/signature/i);
  });

  it('rejects a tampered signature', () => {
    const flipped = TEST_VECTOR_TICKET.slice(0, -1) + (TEST_VECTOR_TICKET.endsWith('E') ? 'A' : 'E');
    expect(() =>
      verifyZoneTicket(TEST_VECTOR_SECRET, flipped, { nowSeconds: TEST_VECTOR_CLAIMS.iat })
    ).toThrow(/signature/i);
  });

  it('rejects the test vector after exp', () => {
    expect(() =>
      verifyZoneTicket(TEST_VECTOR_SECRET, TEST_VECTOR_TICKET, {
        nowSeconds: TEST_VECTOR_CLAIMS.exp,
      })
    ).toThrow(/expired/i);
  });

  it('rejects a ticket whose lifetime exceeds 5 minutes', () => {
    const longLived: ZoneTicketClaims = {
      ...TEST_VECTOR_CLAIMS,
      exp: TEST_VECTOR_CLAIMS.iat + 301,
    };
    const ticket = signZoneTicket(TEST_VECTOR_SECRET, longLived);
    expect(() =>
      verifyZoneTicket(TEST_VECTOR_SECRET, ticket, { nowSeconds: longLived.iat })
    ).toThrow(/5 minutes/i);
  });

  it('caps configured TTL at 300 seconds', () => {
    expect(resolveTicketTtlSeconds('86400')).toBe(300);
    expect(resolveTicketTtlSeconds('120')).toBe(120);
    expect(resolveTicketTtlSeconds(undefined)).toBe(300);
  });

  it('loads the HMAC key only from Secrets Manager and ignores ZONE_TICKET_SECRET', async () => {
    secretsMock.reset();
    resetZoneTicketSecretCache();
    process.env.ZONE_TICKET_SECRET = 'must-not-be-used-from-env';
    process.env.ZONE_TICKET_SECRET_ARN = 'arn:aws:secretsmanager:eu-west-2:000000000000:secret:test';
    secretsMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({ secret: 'from-secrets-manager-only' }),
    });

    await expect(getZoneTicketSecret()).resolves.toBe('from-secrets-manager-only');
    expect(secretsMock.commandCalls(GetSecretValueCommand)).toHaveLength(1);

    delete process.env.ZONE_TICKET_SECRET;
    delete process.env.ZONE_TICKET_SECRET_ARN;
    resetZoneTicketSecretCache();
  });
});
