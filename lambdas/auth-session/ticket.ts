/**
 * Short-lived ZoneServer ticket (MMO-50).
 *
 * Compact JWS (RFC 7515) signed with HMAC-SHA256 (alg HS256).
 * Canonical encoding is specified in docs/zoneserver-ticket.md so the
 * C# ZoneServer (MMO-51) can verify tickets and reject replays by jti.
 *
 * The signing key is never logged. Do not put real keys in git.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({});

let cachedSecret: string | null = null;

export const ZONE_TICKET_TYP = 'JWT';
export const ZONE_TICKET_ALG = 'HS256';
export const DEFAULT_ZONE_TICKET_AUD = 'zoneserver';
export const DEFAULT_ZONE_TICKET_ISS = 'mmo-api';
export const MAX_ZONE_TICKET_TTL_SECONDS = 300;

export type AccountType = 'player' | 'admin';

export interface ZoneTicketClaims {
  uid: string;
  accountType: AccountType;
  jti: string;
  iat: number;
  exp: number;
  aud: string;
  iss: string;
}

export interface ZoneTicketHeader {
  alg: typeof ZONE_TICKET_ALG;
  typ: typeof ZONE_TICKET_TYP;
}

export class ZoneTicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZoneTicketError';
  }
}

/**
 * Compact JSON with a fixed key order. Do not pretty-print or sort
 * differently — the HMAC is over these exact UTF-8 bytes (base64url).
 */
export function encodeHeaderJson(): string {
  return JSON.stringify({
    alg: ZONE_TICKET_ALG,
    typ: ZONE_TICKET_TYP,
  } satisfies ZoneTicketHeader);
}

export function encodePayloadJson(claims: ZoneTicketClaims): string {
  return JSON.stringify({
    uid: claims.uid,
    accountType: claims.accountType,
    jti: claims.jti,
    iat: claims.iat,
    exp: claims.exp,
    aud: claims.aud,
    iss: claims.iss,
  } satisfies ZoneTicketClaims);
}

export function base64UrlEncode(input: string | Buffer): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf.toString('base64url');
}

export function base64UrlDecodeToString(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function hmacSha256(secret: string, signingInput: string): Buffer {
  return createHmac('sha256', secret).update(signingInput, 'utf8').digest();
}

export function signingInputFor(headerJson: string, payloadJson: string): string {
  return `${base64UrlEncode(headerJson)}.${base64UrlEncode(payloadJson)}`;
}

export function signEncodedTicket(secret: string, headerJson: string, payloadJson: string): string {
  const signingInput = signingInputFor(headerJson, payloadJson);
  const signature = hmacSha256(secret, signingInput);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export function signZoneTicket(secret: string, claims: ZoneTicketClaims): string {
  return signEncodedTicket(secret, encodeHeaderJson(), encodePayloadJson(claims));
}

function timingSafeEqualBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function parseTicketParts(ticket: string): {
  headerB64: string;
  payloadB64: string;
  signatureB64: string;
} {
  const parts = ticket.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new ZoneTicketError('Ticket must be a compact JWS with three segments');
  }
  return {
    headerB64: parts[0],
    payloadB64: parts[1],
    signatureB64: parts[2],
  };
}

export function verifyZoneTicket(
  secret: string,
  ticket: string,
  options?: { nowSeconds?: number; audience?: string; issuer?: string }
): ZoneTicketClaims {
  const { headerB64, payloadB64, signatureB64 } = parseTicketParts(ticket);
  const signingInput = `${headerB64}.${payloadB64}`;
  const expected = hmacSha256(secret, signingInput);
  const actual = Buffer.from(signatureB64, 'base64url');
  if (!timingSafeEqualBytes(expected, actual)) {
    throw new ZoneTicketError('Ticket signature is invalid');
  }

  let header: ZoneTicketHeader;
  let payload: ZoneTicketClaims;
  try {
    header = JSON.parse(base64UrlDecodeToString(headerB64)) as ZoneTicketHeader;
    payload = JSON.parse(base64UrlDecodeToString(payloadB64)) as ZoneTicketClaims;
  } catch {
    throw new ZoneTicketError('Ticket JSON is invalid');
  }

  if (header.alg !== ZONE_TICKET_ALG || header.typ !== ZONE_TICKET_TYP) {
    throw new ZoneTicketError('Ticket header alg/typ is not HS256 JWT');
  }

  if (typeof payload.uid !== 'string' || payload.uid.length === 0) {
    throw new ZoneTicketError('Ticket uid is missing');
  }
  if (payload.accountType !== 'player' && payload.accountType !== 'admin') {
    throw new ZoneTicketError('Ticket accountType is invalid');
  }
  if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
    throw new ZoneTicketError('Ticket jti is missing');
  }
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) {
    throw new ZoneTicketError('Ticket iat/exp must be unix seconds');
  }

  const audience = options?.audience ?? DEFAULT_ZONE_TICKET_AUD;
  const issuer = options?.issuer ?? DEFAULT_ZONE_TICKET_ISS;
  if (payload.aud !== audience) {
    throw new ZoneTicketError('Ticket audience is invalid');
  }
  if (payload.iss !== issuer) {
    throw new ZoneTicketError('Ticket issuer is invalid');
  }

  const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (payload.exp <= payload.iat) {
    throw new ZoneTicketError('Ticket exp must be after iat');
  }
  if (payload.exp - payload.iat > MAX_ZONE_TICKET_TTL_SECONDS) {
    throw new ZoneTicketError('Ticket lifetime exceeds 5 minutes');
  }
  if (now >= payload.exp) {
    throw new ZoneTicketError('Ticket is expired');
  }
  if (now < payload.iat) {
    throw new ZoneTicketError('Ticket iat is in the future');
  }

  return payload;
}

export function resolveTicketTtlSeconds(raw: string | undefined): number {
  const parsed = Number(raw ?? String(MAX_ZONE_TICKET_TTL_SECONDS));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return MAX_ZONE_TICKET_TTL_SECONDS;
  }
  return Math.min(Math.floor(parsed), MAX_ZONE_TICKET_TTL_SECONDS);
}

/**
 * Production: Secrets Manager JSON `{ "secret": "..." }` via ZONE_TICKET_SECRET_ARN.
 * Tests only: ZONE_TICKET_SECRET (never set this on the deployed Lambda).
 */
export async function getZoneTicketSecret(): Promise<string> {
  if (cachedSecret) {
    return cachedSecret;
  }

  const testSecret = process.env.ZONE_TICKET_SECRET;
  if (testSecret) {
    cachedSecret = testSecret;
    return cachedSecret;
  }

  const secretArn = process.env.ZONE_TICKET_SECRET_ARN;
  if (!secretArn) {
    throw new Error('ZONE_TICKET_SECRET_ARN is not configured');
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error('ZoneServer ticket secret is empty');
  }

  const parsed = JSON.parse(response.SecretString) as { secret?: string };
  if (!parsed.secret) {
    throw new Error('ZoneServer ticket secret JSON must contain a "secret" key');
  }

  cachedSecret = parsed.secret;
  return cachedSecret;
}

/** Test-only: drop the in-process cache. */
export function resetZoneTicketSecretCache(): void {
  cachedSecret = null;
}
