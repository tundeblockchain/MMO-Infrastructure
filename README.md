# MMO Infrastructure

AWS CDK (TypeScript) for the MMO backend: **self-mutating CodePipeline**, API Gateway, Lambda, and DynamoDB. Firebase Auth is verified in Lambda; game session JWTs are issued for ZoneServer handshakes.

## Architecture

```
GitHub (private) ──► CodeStar Connection ──► CodePipeline (self-mutating)
                                              └──► Dev stage (auto)
                                              └──► Prod stage (manual approval)

Dev/Prod stages:
  Data stack  → DynamoDB + Secrets Manager (Firebase, JWT, internal save key)
  Api stack   → HTTP API + Lambda handlers
```

## Prerequisites

- Node.js 20+
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

npm run deploy:pipeline `
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
