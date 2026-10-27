# MMO Infrastructure

AWS CDK (TypeScript) for the MMO backend: **self-mutating CodePipeline**, API Gateway, Lambda, and DynamoDB. Firebase Auth is verified in Lambda; game session JWTs are issued for ZoneServer handshakes.

## Architecture

```
GitHub (private) ──► CodeStar Connection ──► CodePipeline (self-mutating)
                                              └──► Dev stage (auto)
                                              └──► Prod stage (manual approval)

Dev/Prod stages:
  Data stack  → DynamoDB (game + users) + Secrets Manager (Firebase, JWT, internal save key)
  Api stack   → HTTP API + Lambda handlers
```

## Prerequisites

- Node.js 22+ (local/CDK); Lambdas run **Node.js 24** (`nodejs24.x`)
- AWS CLI configured (`aws sts get-caller-identity`)
- CDK CLI (`npm install -g aws-cdk` or use `npx cdk`)
- A **private GitHub repo** for this project
- A **CodeStar Connections** GitHub connection (see below)
- A **Firebase** project with Authentication enabled

## One-time AWS setup

### 1. Bootstrap CDK

```powershell
cd C:\Users\tunde\Documents\Projects\MMO-Infrastructure
npm install
npx cdk bootstrap aws://ACCOUNT_ID/REGION
```

Default region in docs: `eu-west-2` (override with `CDK_DEFAULT_REGION`).

### 2. Create CodeStar Connection

1. AWS Console → **Developer Tools** → **Connections**
2. **Create connection** → GitHub → name it e.g. `github-mmo`
3. Complete the GitHub app install / authorize flow
4. Copy the connection ARN (`arn:aws:codestar-connections:...`)

Status must be **Available** before the pipeline can pull source.

### 3. Push repo to GitHub

Initialize and push this folder to your private `MMO-Infrastructure` repo. Default branch for dev deploys: **`develop`**.

### 4. Deploy the pipeline (local, once)

```powershell
$env:CDK_DEFAULT_ACCOUNT = "YOUR_ACCOUNT_ID"
$env:CDK_DEFAULT_REGION = "eu-west-2"

npm run deploy:pipeline -- `
  -c githubConnectionArn=arn:aws:codestar-connections:REGION:ACCOUNT:connection/UUID `
  -c githubOwner=YOUR_GITHUB_USER_OR_ORG `
  -c githubRepo=MMO-Infrastructure `
  -c githubBranch=develop
```

After this, the pipeline **self-mutates** on every push to `develop`. Prod deploys require manual approval in the pipeline console.

## Post-deploy configuration

### Firebase service account

1. Firebase Console → Project settings → Service accounts → **Generate new private key**
2. AWS Secrets Manager → secret `mmo-dev/firebase-service-account`
3. **Store secret value** → paste the full JSON file contents

Repeat for `mmo-prod/firebase-service-account` when prod is deployed.

The catalog-write Lambda verifies Firebase ID tokens with the Firebase Admin SDK
(`verifyIdToken`). Audience (`aud`) and issuer (`iss`) must match the **project_id**
in that service-account JSON:

- `aud` = `<project_id>`
- `iss` = `https://securetoken.google.com/<project_id>`

Signature and expiry are also checked. There is no project-id hardcoded in this repo;
it comes from the secret you upload (`mmo-dev/firebase-service-account` or
`mmo-prod/firebase-service-account`).

### Catalog admin (users table)

`POST /catalog/{type}/versions` requires a valid Firebase ID token **and** a users
table row whose `accountType` is `admin`. Partition key is Firebase `uid`. Missing
or invalid/expired tokens return **401**. A valid token whose account is not admin
(no row or `player`) returns **403**. Catalog GET routes stay public and ignore
`Authorization`.

**mmo-admin contract:** right after Firebase sign-in, before any publish, call
`GET` or `POST /users/me` with `Authorization: Bearer <Firebase ID token>`. That
upserts the caller's `uid` (from the verified token only) into the users table
and returns `{ "uid", "accountType" }`. Body `uid` and `accountType` are ignored;
the client cannot set `accountType`. Missing, invalid, expired, or wrong-audience
tokens return **401**.

`/users/me` writes `accountType: admin` only when the verified Firebase token
has `email_verified` true (boolean or the string `"true"`) **and** the email
(lowercased + trimmed) is on that stage's allowlist. Email is read from the
top-level claim, then from `firebase.identities.email` (Google sign-in).
Everyone else is upserted as `player`. A missing or empty allowlist fails
closed (nobody is promoted). An existing `player` row is **promoted** when the
caller is allowlisted and verified. Existing admins are **never** demoted
automatically. Repeat login is idempotent (no duplicate row).

### Admin email allowlist (per stage)

Supply a comma-separated list via CDK context or environment variables. Do not
commit real addresses; use local context / env at deploy time. Placeholders
below use `example.com`.

| Stage | CDK context | Environment variable |
|-------|-------------|----------------------|
| dev | `adminEmailAllowlistDev` | `ADMIN_EMAIL_ALLOWLIST_DEV` |
| prod | `adminEmailAllowlistProd` | `ADMIN_EMAIL_ALLOWLIST_PROD` |
| both (fallback) | `adminEmailAllowlist` | `ADMIN_EMAIL_ALLOWLIST` |

Add or remove emails, then **redeploy `PipelineStack` locally** so the pipeline
synth step keeps the lists. A local `-c adminEmailAllowlistDev=...` flag does
**not** reach the CodeBuild synth inside the pipeline, and self-mutation
re-synths without those CLI flags. The pipeline persists the values from this
deploy as `ADMIN_EMAIL_ALLOWLIST_DEV` / `ADMIN_EMAIL_ALLOWLIST_PROD` on the
synth project and passes them back as `-c` on every later synth.

`npm run deploy:pipeline` must use `--` before `-c`. Without it, npm treats
`-c` as its own `--config` and CDK never sees the allowlist.

```powershell
npm run deploy:pipeline -- `
  -c githubConnectionArn=arn:aws:codestar-connections:REGION:ACCOUNT:connection/UUID `
  -c githubOwner=YOUR_GITHUB_USER_OR_ORG `
  -c githubRepo=MMO-Infrastructure `
  -c githubBranch=main `
  -c adminEmailAllowlistDev=admin@example.com,editor@example.com `
  -c adminEmailAllowlistProd=admin@example.com
```

Equivalent env vars before synth/deploy:

```powershell
$env:ADMIN_EMAIL_ALLOWLIST_DEV = "admin@example.com,editor@example.com"
$env:ADMIN_EMAIL_ALLOWLIST_PROD = "admin@example.com"
```

The users-me Lambda reads `ADMIN_EMAIL_ALLOWLIST` (already normalized per stage
by CDK). Context wins over env when both are set.

### Demote accounts promoted while blanket auto-admin was on

Earlier deploys set every caller to `admin` on login. That flag is off. Demote a
row by hand with placeholder values only:

```
aws dynamodb put-item --table-name mmo-dev-users --item '{"uid":{"S":"<FIREBASE_UID>"},"accountType":{"S":"player"}}' --region <REGION>
aws dynamodb put-item --table-name mmo-prod-users --item '{"uid":{"S":"<FIREBASE_UID>"},"accountType":{"S":"player"}}' --region <REGION>
```

Promote by hand (same command with `"admin"`) only if you must grant admin
without going through the allowlist.

### Unity / ZoneServer config (dev)

After the Dev stage deploys, note CloudFormation outputs:

| Output | Use |
|--------|-----|
| `ApiUrl` | Unity REST base URL |
| `GameJwtSecretArn` | ZoneServer JWT verification (read `secret` key) |
| `mmo-dev/internal-save-api-key` | ZoneServer `PUT /characters/{id}` header `X-Internal-Api-Key` |

## API endpoints (dev)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/session` | Firebase ID token (Bearer or body) | Issue game session JWT |
| GET | `/characters` | Firebase or game JWT | List characters |
| POST | `/characters` | Firebase or game JWT | Create character `{ "name": "..." }` |
| POST | `/characters/{id}/enter` | Game or Firebase JWT | Enter world + scoped JWT + zone host |
| PUT | `/characters/{id}` | `X-Internal-Api-Key` | Save character (ZoneServer) |
| GET | `/catalog/versions/latest` | None | Get latest published version per catalog type |
| GET | `/catalog/versions` | None | List all published catalog versions |
| GET | `/catalog/{type}/v/{ver}` | None | Get catalog data by type and version |
| GET | `/users/me` | Firebase ID token | Same upsert/promote as POST |
| POST | `/users/me` | Firebase ID token | Upsert caller; `admin` only if verified email is on the stage allowlist |
| POST | `/catalog/{type}/versions` | Firebase ID token + users-table admin | Publish new catalog version |

## Documentation

- **[Catalog API Guide](docs/catalog-api.md)** — DynamoDB key design, versioning rules, and endpoint reference
- **[OpenAPI Specification](contracts/openapi.yaml)** — Complete request/response schemas

## Local development

- **API / Lambda / DynamoDB**: deployed to AWS dev (no local API)
- **ZoneServer**: run locally; point at dev API URL and secrets
- **Synth only** (no deploy):

```powershell
npm run synth `
  -c githubConnectionArn=arn:aws:codestar-connections:... `
  -c githubOwner=YOUR_ORG `
  -c githubRepo=MMO-Infrastructure
```

## Project layout

```
bin/app.ts              CDK entry (pipeline stack only)
lib/pipeline-stack.ts   Self-mutating CodePipeline
lib/mmo-stage.ts        Stage wrapper (Data + Api)
lib/data-stack.ts       DynamoDB + secrets
lib/api-stack.ts        HTTP API + Lambda
lambdas/                Handler source (bundled by NodejsFunction)
```

## Branch strategy

| Branch | Pipeline behavior |
|--------|-------------------|
| `develop` | Deploys **Dev** stage automatically |
| `main` | Deploys **Dev**, then **Prod** after manual approval |

Adjust `githubBranch` context if you use a different default branch.

## Next steps (game repos)

1. **MMO-Infrastructure** — this repo
2. **MMORPG-Client** — Firebase login UI + REST before UDP connect
3. **MMO** — extend ZoneServer handshake (game JWT + characterId), save on disconnect
