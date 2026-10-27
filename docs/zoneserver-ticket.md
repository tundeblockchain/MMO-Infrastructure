# ZoneServer ticket (MMO-50 / MMO-51)

`POST /auth/session` verifies a Firebase ID token and, when a UsersTable row
exists for that `uid`, returns a **short-lived signed ticket** for the C#
ZoneServer handshake. The Unity client must call `GET` or `POST /users/me`
first; a missing users-table row is **403**.

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
   `ZONE_TICKET_SECRET_ARN`, value fetched at runtime).

The existing `mmo-{stage}/game-session-jwt` secret remains for 24h character /
enter-world JWTs. Do not mix those tokens with this ticket format.

## API

`POST /auth/session`

- Firebase ID token as `Authorization: Bearer <token>` **or** JSON body
  `{ "firebaseIdToken": "<token>" }`.
- **401** — missing, malformed, invalid signature, wrong issuer, wrong
  audience, or expired Firebase token (fail closed).
- **403** — Firebase token is valid but there is no UsersTable row for `uid`.
  Message tells the client to call `/users/me` first.
- **200** — `{ "ticket", "uid", "accountType", "expiresInSeconds" }`.

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
