import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { issueGameSessionToken, verifyFirebaseIdToken } from '../shared/auth';
import { ensureAccountProfile } from '../shared/dynamo';
import { getBearerToken, json, serverError, unauthorized } from '../shared/http';

interface SessionRequestBody {
  firebaseIdToken?: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body =
      event.body && event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;

    const parsed = body ? (JSON.parse(body) as SessionRequestBody) : {};
    const firebaseToken =
      parsed.firebaseIdToken ?? getBearerToken(event.headers?.authorization);

    if (!firebaseToken) {
      return unauthorized('Missing Firebase ID token');
    }

    const decoded = await verifyFirebaseIdToken(firebaseToken);
    const accountId = decoded.uid;

    await ensureAccountProfile(accountId);

    const gameSessionToken = await issueGameSessionToken(accountId);

    return json(200, {
      accountId,
      gameSessionToken,
      expiresInSeconds: Number(process.env.GAME_JWT_TTL_SECONDS ?? '86400'),
    });
  } catch (err) {
    console.error('auth-session failed', err);

    if (err instanceof Error && err.message.includes('Firebase')) {
      return unauthorized('Invalid Firebase token');
    }

    return serverError(err instanceof Error ? err.message : undefined);
  }
};
