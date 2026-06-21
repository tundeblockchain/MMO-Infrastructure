import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { issueGameSessionToken, verifyFirebaseIdToken, verifyGameSessionToken } from '../shared/auth';
import {
  createCharacter,
  ensureAccountProfile,
  getCharacter,
  listCharacters,
} from '../shared/dynamo';
import {
  badRequest,
  getBearerToken,
  json,
  notFound,
  serverError,
  unauthorized,
} from '../shared/http';
import { EnterWorldResponse } from '../shared/models';

interface CreateCharacterBody {
  name?: string;
}

async function resolveAccountId(event: Parameters<APIGatewayProxyHandlerV2>[0]): Promise<string | null> {
  const gameToken = getBearerToken(event.headers?.authorization);
  if (!gameToken) {
    return null;
  }

  try {
    const claims = await verifyGameSessionToken(gameToken);
    return claims.accountId;
  } catch {
    // Fall back to Firebase token for list/create before enter-world
  }

  try {
    const decoded = await verifyFirebaseIdToken(gameToken);
    return decoded.uid;
  } catch {
    return null;
  }
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    const accountId = await resolveAccountId(event);

    if (!accountId) {
      return unauthorized('Valid Firebase or game session token required');
    }

    await ensureAccountProfile(accountId);

    if (method === 'GET' && path === '/characters') {
      const characters = await listCharacters(accountId);
      return json(200, { characters });
    }

    if (method === 'POST' && path === '/characters') {
      const body =
        event.body && event.isBase64Encoded
          ? Buffer.from(event.body, 'base64').toString('utf8')
          : event.body;

      const parsed = body ? (JSON.parse(body) as CreateCharacterBody) : {};
      const name = parsed.name?.trim();

      if (!name || name.length < 3 || name.length > 16) {
        return badRequest('Character name must be 3-16 characters');
      }

      const character = await createCharacter(accountId, name);
      return json(201, { character });
    }

    const enterMatch = path.match(/^\/characters\/([^/]+)\/enter$/);
    if (method === 'POST' && enterMatch) {
      const characterId = enterMatch[1];
      const character = await getCharacter(accountId, characterId);

      if (!character) {
        return notFound('Character not found');
      }

      const gameSessionToken = await issueGameSessionToken(accountId, characterId);

      const response: EnterWorldResponse = {
        gameSessionToken,
        character,
        zoneHost: process.env.DEFAULT_ZONE_HOST ?? '127.0.0.1',
        zonePort: Number(process.env.DEFAULT_ZONE_PORT ?? '9050'),
      };

      return json(200, response);
    }

    return notFound('Route not found');
  } catch (err) {
    console.error('characters handler failed', err);
    return serverError(err instanceof Error ? err.message : undefined);
  }
};
