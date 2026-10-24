# Game Catalog API

This document describes how the MMO backend stores and serves versioned game data (classes, skills, combat constants, and more). It covers the DynamoDB storage design, version immutability rules, and how to read or publish catalog data through the API.

## Overview

The catalog system stores **versioned game metadata** that the ZoneServer and other services need to run the game. Examples include:

- **combat-constants** — global damage formulas, scaling factors
- **class** — playable class definitions (Vanguard, Ranger, etc.)
- **skill** — skill definitions with damage, costs, cooldowns
- **status** — buff/debuff effect definitions
- **element** — elemental damage types
- **resonance** — class synergy mechanics

Each catalog type can have multiple versions. Once a version is **published**, it becomes **immutable** — you cannot change it. To update game data, you publish a new version.

---

## Why Versioned Catalogs?

**Stability:** The ZoneServer pins a specific version at boot or session start. This guarantees that all players in a session see the same game rules, even if a new version is published mid-session.

**Rollback:** If a new version causes problems, you can tell servers to use an older version without changing any data.

**Auditability:** Every version is preserved, so you can always see what changed and when.

---

## DynamoDB Key Design

All catalog data lives in a single DynamoDB table alongside other game data. Each catalog version is one item.

### Primary Key (PK / SK)

| Attribute | Pattern | Example |
|-----------|---------|---------|
| **PK** | `CATALOG#{catalogType}` | `CATALOG#class` |
| **SK** | `VERSION#{paddedVersion}` | `VERSION#00000001` |

The version number is **zero-padded to 8 digits** so that DynamoDB's string sorting keeps versions in numeric order.

### Example Item

```json
{
  "PK": "CATALOG#class",
  "SK": "VERSION#00000001",
  "catalogType": "class",
  "version": 1,
  "status": "published",
  "createdAt": "2024-06-15T10:30:00.000Z",
  "publishedAt": "2024-06-15T10:30:00.000Z",
  "createdBy": "firebase-uid-abc123",
  "releaseNotes": "Initial class definitions",
  "data": [
    {
      "classId": "vanguard",
      "displayName": "Vanguard",
      "primaryResource": "resolve",
      "startingStats": {
        "strength": 12, "finesse": 7, "vitality": 12, "intellect": 4,
        "precision": 6, "luck": 5, "tech": 4, "hp": 150, "resourcePool": 100,
        "armor": 20, "attackPower": 26, "spellPower": 9, "movementSpeed": 5.0
      },
      "resonance": "valor",
      "roles": ["tank", "dps"]
    }
  ]
}
```

### GSI2 — Query by Status

To list all published versions or find the latest published version, we use a Global Secondary Index:

| Attribute | Pattern | Example |
|-----------|---------|---------|
| **GSI2PK** | `CATALOG#PUBLISHED` or `CATALOG#DRAFT` | `CATALOG#PUBLISHED` |
| **GSI2SK** | `{catalogType}#VERSION#{paddedVersion}` | `class#VERSION#00000002` |

This lets us:
- List all published versions across all catalog types in one query
- Find the latest published version for a specific catalog type by querying with `begins_with` and sorting descending

### Users table (MMO-27)

Catalog publish authorization lives in a **separate** DynamoDB table. Existing
game-table keys, GSIs, and names are unchanged.

| Attribute | Type | Notes |
|-----------|------|--------|
| **uid** (partition key) | string | Firebase UID |
| **accountType** | string | `player` or `admin` |

Table names: `mmo-dev-users` (dev), `mmo-prod-users` (prod). A missing row is
treated as `player` by catalog publish. `POST /users/me` upserts the signed-in
caller. Promotion to `admin` requires `email_verified === true` on the Firebase
token **and** a match on the per-stage allowlist (email is lowercased + trimmed).
A missing or empty allowlist fails closed. Existing admins are never demoted.

See [Admin email allowlist](#admin-email-allowlist-per-stage) for add/remove
and how to demote leftover blanket auto-admin rows.

---

## Version Immutability

**Published versions cannot be changed.** This is enforced at the database level using a conditional write:

```
ConditionExpression: attribute_not_exists(PK) AND attribute_not_exists(SK)
```

If you try to write to an existing version, the write fails with a **409 Conflict** error.

### How New Versions Are Allocated

When you publish new catalog data:

1. The API queries existing versions for that catalog type
2. It takes the highest existing version number and adds 1
3. It writes the new version with a conditional check to prevent overwrites
4. If two requests race, one succeeds and the other gets a 409 — retry and it will allocate the next number

This guarantees version numbers are sequential and never reused.

---

## Reading Catalogs (GET)

Read endpoints are **unauthenticated** — they're designed for ZoneServer and other internal services to cache catalog data.

### Get Latest Version Numbers

```
GET /catalog/versions/latest
```

Returns the current highest published version for each catalog type. ZoneServer typically calls this at boot to pin versions.

**Response (200):**

```json
{
  "versions": {
    "combat-constants": 3,
    "class": 2,
    "skill": 1,
    "status": 1,
    "element": 1,
    "resonance": 1
  },
  "timestamp": "2024-06-15T10:30:00.000Z"
}
```

### List All Published Versions

```
GET /catalog/versions
```

Returns metadata for all published versions (without the actual data). Useful for admin tools.

**Response (200):**

```json
{
  "versions": [
    {
      "catalogType": "class",
      "version": 2,
      "status": "published",
      "publishedAt": "2024-06-15T10:30:00.000Z"
    },
    {
      "catalogType": "class",
      "version": 1,
      "status": "published",
      "publishedAt": "2024-06-01T00:00:00.000Z"
    }
  ]
}
```

### Get Catalog by Version

```
GET /catalog/{catalogType}/v/{version}
```

Returns the full catalog data for a specific version.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `catalogType` | string | One of: `combat-constants`, `class`, `skill`, `status`, `element`, `resonance` |
| `version` | integer | Version number (must be ≥ 1) |

**Response (200):**

```json
{
  "catalogType": "class",
  "version": 1,
  "status": "published",
  "createdAt": "2024-06-15T10:30:00.000Z",
  "publishedAt": "2024-06-15T10:30:00.000Z",
  "createdBy": "firebase-uid-abc123",
  "releaseNotes": "Initial class definitions",
  "data": [
    {
      "classId": "vanguard",
      "displayName": "Vanguard",
      "description": "A stalwart frontline defender...",
      "primaryResource": "resolve",
      "startingStats": {
        "strength": 12,
        "finesse": 7,
        "vitality": 12,
        "intellect": 4,
        "precision": 6,
        "luck": 5,
        "tech": 4,
        "hp": 150,
        "resourcePool": 100,
        "armor": 20,
        "attackPower": 26,
        "spellPower": 9,
        "movementSpeed": 5.0
      },
      "resonance": "valor",
      "roles": ["tank", "dps"]
    }
  ]
}
```

**Errors:**

| Status | Meaning |
|--------|---------|
| 400 | Invalid catalog type or version number |
| 404 | Version not found or not published |

---

## Publishing Catalogs (POST)

Write endpoints require **Firebase JWT authentication** plus a users-table row
with `accountType` === `admin`. A missing row is treated as player.
GET catalog routes stay unauthenticated and **ignore** an `Authorization` header if present
(so mmo-admin can send `Bearer` on every request without breaking ZoneServer).

### Publish a New Version

```
POST /catalog/{catalogType}/versions
Authorization: Bearer <firebase-id-token>
```

Creates and publishes a new version of the catalog. The version number is automatically allocated.

The request body is a **full replacement** of that catalog type. There is no PATCH.
To add, edit, or remove entries, POST the complete new `data` array (or object for
`combat-constants`). Omitted entries from the previous version are simply not present
in the new version; old versions remain immutable. New entity ids are accepted —
runtime validation only checks that `data` is an object (combat-constants) or a
non-empty array (all other types). An empty `data` array returns **400**.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `catalogType` | string | One of: `combat-constants`, `class`, `skill`, `status`, `element`, `resonance` |

**Request Body:**

- For `combat-constants`, `data` must be an **object**
- For all other types (`class`, `skill`, `status`, `element`, `resonance`), `data` must be an **array**

Example for `class`:

```json
{
  "data": [
    {
      "classId": "vanguard",
      "displayName": "Vanguard",
      "description": "A stalwart frontline defender...",
      "primaryResource": "resolve",
      "startingStats": {
        "strength": 12, "finesse": 7, "vitality": 12, "intellect": 4,
        "precision": 6, "luck": 5, "tech": 4, "hp": 150, "resourcePool": 100,
        "armor": 20, "attackPower": 26, "spellPower": 9, "movementSpeed": 5.0
      },
      "resonance": "valor",
      "roles": ["tank", "dps"]
    }
  ],
  "releaseNotes": "Initial class definitions"
}
```

Example for `combat-constants`:

```json
{
  "data": {
    "powerScaling": {
      "physicalPower": { "strengthMultiplier": 2, "levelMultiplier": 1.5 },
      "spellPower": { "intellectMultiplier": 2, "levelMultiplier": 1 }
    },
    "critical": {
      "baseCritChance": 0.05,
      "criticalDamageMultiplier": 1.50
    },
    "additionalConstants": {
      "defaultAttackRange": 2.5,
      "targetRange": 30
    }
  },
  "releaseNotes": "Combat constants v2"
}
```

Note: Percentages are expressed as decimals (e.g., 150% → `1.50`, 5% → `0.05`).

**Response (201):**

```json
{
  "catalogType": "class",
  "version": 2,
  "status": "published",
  "createdAt": "2024-06-16T08:00:00.000Z",
  "publishedAt": "2024-06-16T08:00:00.000Z",
  "createdBy": "firebase-uid-abc123",
  "releaseNotes": "Updated starting stats"
}
```

**Errors:**

| Status | Meaning |
|--------|---------|
| 400 | Invalid catalog type, missing data, empty `data` array, or wrong data format |
| 401 | Missing, malformed (`Bearer` prefix required), invalid, or expired Firebase token |
| 403 | Account is not admin (no users-table row, or `accountType` is not `admin`) |
| 409 | Version conflict (race condition — retry the request) |

---

## Authentication

Write endpoints require a **Firebase ID token** in the `Authorization` header:

```
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

The token is verified with Firebase Admin `verifyIdToken` (signature, expiry, and
`aud`/`iss` for the Firebase project in Secrets Manager
`mmo-{stage}/firebase-service-account`). The user's Firebase UID is recorded as `createdBy`.

**mmo-admin contract:** after Firebase sign-in, call `POST /users/me` with
`Authorization: Bearer <Firebase ID token>` **before any publish**. Response
`200 { "uid", "accountType" }`. Missing/invalid token → **401**.

**Admin-only publish:** after the token is verified, catalog-write looks up `uid`
in the users table (`mmo-dev-users` / `mmo-prod-users`). Publish is allowed only
when `accountType` === `admin`. A missing row is treated as player and returns
**403** (do not treat this as "refresh token and retry"). Expired or invalid
tokens return **401** (client should force-refresh the ID token and retry once).

### Admin email allowlist (per stage)

`POST /users/me` writes `admin` only when the verified Firebase token has
`email_verified === true` and the email (lowercased + trimmed) appears on that
stage's comma-separated allowlist. Everyone else is upserted as `player`.
Missing or empty allowlist → nobody is promoted. Existing admins are never
demoted automatically. Blanket `AUTO_ADMIN_ON_LOGIN` is off for both stages.

Supply the list via CDK context or env (never hardcode real addresses in the
repo). Then **redeploy** so the users-me Lambda environment updates.

| Stage | CDK context | Environment variable |
|-------|-------------|----------------------|
| dev | `adminEmailAllowlistDev` | `ADMIN_EMAIL_ALLOWLIST_DEV` |
| prod | `adminEmailAllowlistProd` | `ADMIN_EMAIL_ALLOWLIST_PROD` |
| both (fallback) | `adminEmailAllowlist` | `ADMIN_EMAIL_ALLOWLIST` |

```powershell
npx cdk deploy PipelineStack `
  -c githubConnectionArn=arn:aws:codestar-connections:REGION:ACCOUNT:connection/UUID `
  -c githubOwner=YOUR_ORG `
  -c githubRepo=MMO-Infrastructure `
  -c adminEmailAllowlistDev=admin@example.com,editor@example.com `
  -c adminEmailAllowlistProd=admin@example.com
```

Or set `$env:ADMIN_EMAIL_ALLOWLIST_DEV` / `$env:ADMIN_EMAIL_ALLOWLIST_PROD`
before synth/deploy. The Lambda reads `ADMIN_EMAIL_ALLOWLIST` for its stage.

**Demote leftover blanket auto-admin rows** (placeholder values only):

```
aws dynamodb put-item --table-name mmo-dev-users --item '{"uid":{"S":"<FIREBASE_UID>"},"accountType":{"S":"player"}}' --region <REGION>
aws dynamodb put-item --table-name mmo-prod-users --item '{"uid":{"S":"<FIREBASE_UID>"},"accountType":{"S":"player"}}' --region <REGION>
```

**Getting a Firebase Token:**

1. User signs in via Firebase Auth (email/password, Google, etc.)
2. Client calls `firebase.auth().currentUser.getIdToken()`
3. Client calls `POST /users/me` with that token, then includes it on publish

Read endpoints do **not** require authentication. They accept an `Authorization` header
without error and do not verify it, so unauthenticated ZoneServer reads keep working.

**CORS:** HTTP API preflight allows `Authorization` and `Content-Type` on GET and POST
from any origin (`*`), including the admin app origin.

---

## Request/Response Schemas

For complete request and response schemas, including all catalog data structures, see the [OpenAPI specification](../contracts/openapi.yaml).

---

## Summary

| Action | Endpoint | Auth | Notes |
|--------|----------|------|-------|
| Get latest versions | `GET /catalog/versions/latest` | None | Pin these at boot |
| List all versions | `GET /catalog/versions` | None | Version metadata only |
| Get catalog data | `GET /catalog/{type}/v/{ver}` | None | Full catalog payload |
| Upsert signed-in user | `POST /users/me` | Firebase JWT | Call after sign-in, before publish |
| Publish new version | `POST /catalog/{type}/versions` | Firebase JWT + users-table admin | Auto-allocates version |
