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

Write endpoints require **Firebase JWT authentication**.

### Publish a New Version

```
POST /catalog/{catalogType}/versions
Authorization: Bearer <firebase-id-token>
```

Creates and publishes a new version of the catalog. The version number is automatically allocated.

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
| 400 | Invalid catalog type, missing data, or wrong data format |
| 401 | Missing or invalid Firebase token |
| 409 | Version conflict (race condition — retry the request) |

---

## Authentication

Write endpoints require a **Firebase ID token** in the `Authorization` header:

```
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

The token is verified against Firebase Auth. The user's Firebase UID is recorded as the `createdBy` field.

**Getting a Firebase Token:**

1. User signs in via Firebase Auth (email/password, Google, etc.)
2. Client calls `firebase.auth().currentUser.getIdToken()`
3. Client includes the token in API requests

Read endpoints do **not** require authentication.

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
| Publish new version | `POST /catalog/{type}/versions` | Firebase JWT | Auto-allocates version |
