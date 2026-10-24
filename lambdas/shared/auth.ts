import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import * as admin from 'firebase-admin';
import * as jwt from 'jsonwebtoken';

const secretsClient = new SecretsManagerClient({});

let firebaseInitialized = false;
let cachedGameJwtSecret: string | null = null;

export interface GameSessionClaims {
  sub: string;
  accountId: string;
  characterId?: string;
  stage: string;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
  await ensureFirebaseInitialized();
  return admin.auth().verifyIdToken(idToken);
}

export async function issueGameSessionToken(
  accountId: string,
  characterId?: string
): Promise<string> {
  const secret = await getGameJwtSecret();
  const ttlSeconds = Number(process.env.GAME_JWT_TTL_SECONDS ?? '86400');

  const payload: GameSessionClaims = {
    sub: accountId,
    accountId,
    stage: process.env.STAGE_NAME ?? 'dev',
  };

  if (characterId) {
    payload.characterId = characterId;
  }

  return jwt.sign(payload, secret, {
    expiresIn: ttlSeconds,
    issuer: 'mmo-api',
    audience: 'mmo-zone',
  });
}

export async function verifyGameSessionToken(token: string): Promise<GameSessionClaims> {
  const secret = await getGameJwtSecret();
  const decoded = jwt.verify(token, secret, {
    issuer: 'mmo-api',
    audience: 'mmo-zone',
  });

  return decoded as GameSessionClaims;
}

async function ensureFirebaseInitialized(): Promise<void> {
  if (firebaseInitialized) {
    return;
  }

  const secretArn = process.env.FIREBASE_SECRET_ARN;
  if (!secretArn) {
    throw new Error('FIREBASE_SECRET_ARN is not configured');
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error(
      'Firebase secret is empty. Upload service account JSON to Secrets Manager.'
    );
  }

  const serviceAccount = JSON.parse(response.SecretString) as admin.ServiceAccount;
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  firebaseInitialized = true;
}

async function getGameJwtSecret(): Promise<string> {
  if (cachedGameJwtSecret) {
    return cachedGameJwtSecret;
  }

  const secretArn = process.env.GAME_JWT_SECRET_ARN;
  if (!secretArn) {
    throw new Error('GAME_JWT_SECRET_ARN is not configured');
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error('Game JWT secret is empty');
  }

  const parsed = JSON.parse(response.SecretString) as { secret?: string };
  if (!parsed.secret) {
    throw new Error('Game JWT secret JSON must contain a "secret" key');
  }

  cachedGameJwtSecret = parsed.secret;
  return cachedGameJwtSecret;
}
