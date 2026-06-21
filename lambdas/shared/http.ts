import { APIGatewayProxyResultV2 } from 'aws-lambda';

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

export function badRequest(message: string): APIGatewayProxyResultV2 {
  return json(400, { error: message });
}

export function unauthorized(message = 'Unauthorized'): APIGatewayProxyResultV2 {
  return json(401, { error: message });
}

export function notFound(message = 'Not found'): APIGatewayProxyResultV2 {
  return json(404, { error: message });
}

export function serverError(message = 'Internal server error'): APIGatewayProxyResultV2 {
  return json(500, { error: message });
}

export function getBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function parseJsonBody<T>(body?: string | null): T | null {
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}
