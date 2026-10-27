# ZoneServer ticket (MMO-50 / MMO-51)

`POST /auth/session` verifies a Firebase ID token (signature, issuer,
audience, expiry, **and revocation** via `verifyIdToken(..., checkRevoked:
true)`) and, when a UsersTable row exists for that `uid` and is not banned,
returns a **short-lived signed ticket** for the C# ZoneServer handshake.

**Response field names:** the client sends **`ticket`** to ZoneServer.
`gameSessionToken` is the older 24h character / enter-world JWT used by
`/characters` and `/characters/{id}/enter`. `/auth/session` does **not**
return `gameSessionToken`. Do not send that older JWT as the ZoneServer
handshake ticket.

The Unity client must call `GET` or `POST /users/me` first; a missing
users-table row is **403** `NO_PROFILE`. A row with `banned: true` is
**403** `BANNED`.

Tokens, tickets, and the HMAC key are **never logged** and **never shipped in
the client**. Do not commit real keys, secret ARNs, account ids, or emails.

## Claims

| Claim | Type | Notes |
|-------|------|--------|
| `uid` | string | Firebase uid |
| `accountType` | string | `player` or `admin` from UsersTable |
| `jti` | string | Unique ticket id (UUID). ZoneServer **must reject replays** of a seen `jti` until `exp` |
| `iat` | integer | Unix seconds (UTC) |
| `exp` | integer | Unix seconds. `exp - iat` is **at most 300** (5 minutes), configurable downward via `ZONE_TICKET_TTL_SECONDS` |
| `aud` | string | Default `zoneserver` (`ZONE_TICKET_AUDIENCE`) |
| `iss` | string | Default `mmo-api` (`ZONE_TICKET_ISSUER`) |

## Canonical encoding (compact JWS, HMAC-SHA256)

Algorithm: **HS256** (HMAC-SHA256). Serialization: RFC 7515 compact JWS.

1. Header JSON, no whitespace, this key order:

   `{"alg":"HS256","typ":"JWT"}`

2. Payload JSON, no whitespace, this key order:

   `{"uid":"...","accountType":"...","jti":"...","iat":<int>,"exp":<int>,"aud":"...","iss":"..."}`

   `iat` and `exp` are JSON numbers (not strings).

3. Base64url (RFC 4648 §5, **no padding**):

   `signingInput = base64url(utf8(headerJson)) + "." + base64url(utf8(payloadJson))`

4. Signature:

   `signature = HMAC-SHA256(keyUtf8, signingInput)`  
   `ticket    = signingInput + "." + base64url(signature)`

Node `Buffer.toString("base64url")` and .NET
`Base64UrlEncoder` / `Base64Url.EncodeToString` produce this alphabet.

### C# verification sketch (MMO-51)

1. Split the ticket on `.` into exactly three segments.
2. Recompute HMAC-SHA256 over `header64 + "." + payload64` with the shared key.
3. Compare the signature with a **constant-time** compare.
4. Parse the payload JSON. Reject if `aud` is not `zoneserver`, `iss` is not
   `mmo-api`, `exp <= now`, `exp - iat > 300`, or any required claim is missing.
5. If `jti` was already accepted, reject as a replay. Remember `jti` until `exp`.
6. Do **not** re-serialize the payload before verifying. HMAC is over the
   original base64url segments.

## Signing key (Secrets Manager)

CDK creates a generated Secrets Manager secret. The value is **not** in git
and is **not** injected as a plaintext Lambda environment variable.

| Stage | Secret name | JSON shape |
|-------|-------------|------------|
| dev | `mmo-dev/zoneserver-ticket` | `{ "secret": "<64-char generated HMAC key>" }` |
| prod | `mmo-prod/zoneserver-ticket` | `{ "secret": "<64-char generated HMAC key>" }` |

Look the secret up **by name** (or the Data-stack output
`ZoneServerTicketSecretName`). Do not hard-code ARNs, account ids, or the
secret value in source or docs.

### How ZoneServer reads the key

1. Give the ZoneServer host / task role **read-only**
   `secretsmanager:GetSecretValue` (and `DescribeSecret` if needed) on
   `mmo-{stage}/zoneserver-ticket`. Do not grant put/update/delete.
2. At process start, call `GetSecretValue` with `SecretId` set to that **name**.
3. Parse `SecretString` as JSON and use the `secret` field as the UTF-8 HMAC key.
4. Cache in memory. Never write it to disk, logs, or client config.
5. The auth-session Lambda uses the same secret (ARN via
   `ZONE_TICKET_SECRET_ARN`, value fetched at runtime). There is no
   `ZONE_TICKET_SECRET` environment-variable fallback.

The existing `mmo-{stage}/game-session-jwt` secret remains for 24h character /
enter-world JWTs. Do not mix those tokens with this ticket format.

## API

`POST /auth/session`

- Firebase ID token as `Authorization: Bearer <token>` **or** JSON body
  `{ "firebaseIdToken": "<token>" }`.
- Firebase Admin is called with `checkRevoked: true`. `auth/id-token-revoked`
  and `auth/user-disabled` fail closed as **401**.
- **200** — `{ "ticket", "uid", "accountType", "expiresInSeconds" }`.
  Send `ticket` to ZoneServer. There is no `gameSessionToken` field.

### UsersTable `banned` flag

Auth-session reads the existing row (`uid` partition key) and does not write.
If `banned` is the boolean `true`, the account is rejected. Missing `banned`,
`false`, or any other value is treated as not banned.

### Error body (`{ code, message }`)

Every `/auth/session` error uses this shape:

```json
{ "code": "UNAUTHORIZED", "message": "Invalid Firebase token" }
```

| `code` | HTTP | Who returns it | When |
|--------|------|----------------|------|
| `UNAUTHORIZED` | 401 | auth-session | Missing, malformed, invalid signature, wrong issuer, wrong audience, expired, revoked (`auth/id-token-revoked`), or disabled (`auth/user-disabled`) Firebase token |
| `NO_PROFILE` | 403 | auth-session | No UsersTable row for `uid`. Client must call `/users/me` first |
| `BANNED` | 403 | auth-session | UsersTable row exists and `banned` is `true` |
| `SERVER_FULL` | — | **ZoneServer only** | Capacity / instance full. Reserved so the client can handle one code set. auth-session never returns this |
| `INTERNAL` | 500 | auth-session | Unexpected server error |

## Fixed test vector (fake key only)

Use this to lock the C# verifier. The key is **test-only**.

| Field | Value |
|-------|--------|
| HMAC key (UTF-8) | `test-only-zoneserver-ticket-hmac-key-do-not-use` |
| `uid` | `firebase-uid-vector-001` |
| `accountType` | `player` |
| `jti` | `11111111-2222-4333-8444-555555555555` |
| `iat` | `1700000000` |
| `exp` | `1700000300` |
| `aud` | `zoneserver` |
| `iss` | `mmo-api` |

Header JSON:

```
{"alg":"HS256","typ":"JWT"}
```

Payload JSON:

```
{"uid":"firebase-uid-vector-001","accountType":"player","jti":"11111111-2222-4333-8444-555555555555","iat":1700000000,"exp":1700000300,"aud":"zoneserver","iss":"mmo-api"}
```

Expected ticket:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJmaXJlYmFzZS11aWQtdmVjdG9yLTAwMSIsImFjY291bnRUeXBlIjoicGxheWVyIiwianRpIjoiMTExMTExMTEtMjIyMi00MzMzLTg0NDQtNTU1NTU1NTU1NTU1IiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjE3MDAwMDAzMDAsImF1ZCI6InpvbmVzZXJ2ZXIiLCJpc3MiOiJtbW8tYXBpIn0.fX5MEKhEupb2JBISENjEHMnDY1ioAEZmk4NzphZ7UfE
```

Expected verification at `now = 1700000000`:

- signature valid
- claims match the table above
- `exp - iat == 300`
- tampering with any segment must fail HMAC compare
- at `now = 1700000300` the ticket is expired
