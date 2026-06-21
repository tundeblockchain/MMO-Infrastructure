import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { getCharacter, saveCharacter } from '../shared/dynamo';
import { badRequest, json, notFound, serverError, unauthorized } from '../shared/http';
import { CharacterRecord } from '../shared/models';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const configuredKey = process.env.INTERNAL_SAVE_API_KEY;
    const providedKey = event.headers?.['x-internal-api-key'];

    if (!configuredKey || providedKey !== configuredKey) {
      return unauthorized('Invalid internal API key');
    }

    const characterId = event.pathParameters?.characterId;
    if (!characterId) {
      return badRequest('Missing characterId');
    }

    const body =
      event.body && event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;

    if (!body) {
      return badRequest('Missing body');
    }

    const payload = JSON.parse(body) as Partial<CharacterRecord>;
    if (!payload.accountId) {
      return badRequest('accountId is required');
    }

    const existing = await getCharacter(payload.accountId, characterId);
    if (!existing) {
      return notFound('Character not found');
    }

    const updated = await saveCharacter({
      ...existing,
      ...payload,
      characterId,
      accountId: payload.accountId,
      name: payload.name ?? existing.name,
      updatedAt: existing.updatedAt,
    });

    return json(200, { character: updated });
  } catch (err) {
    console.error('characters-save failed', err);
    return serverError(err instanceof Error ? err.message : undefined);
  }
};
