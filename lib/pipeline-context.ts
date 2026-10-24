import * as cdk from 'aws-cdk-lib';

export interface ContextScope {
  readonly node: { tryGetContext(key: string): unknown };
}

export interface PipelineContext {
  readonly githubConnectionArn: string;
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly githubBranch: string;
  readonly account: string;
  readonly region: string;
  /** Comma-separated admin emails for the dev users-me Lambda. Empty = promote nobody. */
  readonly adminEmailAllowlistDev: string;
  /** Comma-separated admin emails for the prod users-me Lambda. Empty = promote nobody. */
  readonly adminEmailAllowlistProd: string;
}

const UNSET = new Set(['', 'undefined', 'null']);

/**
 * Read a context key or environment variable, rejecting empty / "undefined" / "null".
 * Context wins so pipeline `-c` flags cannot be overwritten by the CDK CLI's
 * CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION injection.
 */
export function readContextOrEnv(
  scope: ContextScope,
  contextKey: string,
  envVars: readonly string[] = []
): string | undefined {
  const fromContext = scope.node.tryGetContext(contextKey);
  if (isUsable(fromContext)) {
    return String(fromContext).trim();
  }

  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (isUsable(value)) {
      return value.trim();
    }
  }

  return undefined;
}

export function isUsable(value: unknown): value is string {
  return typeof value === 'string' && !UNSET.has(value.trim());
}

/**
 * Resolve every value the pipeline app needs. Throws with an actionable
 * message instead of synthesizing stacks whose names/env would be undefined.
 */
export function resolvePipelineContext(app: cdk.App): PipelineContext {
  const githubConnectionArn = readContextOrEnv(app, 'githubConnectionArn', [
    'GITHUB_CONNECTION_ARN',
  ]);
  const githubOwner = readContextOrEnv(app, 'githubOwner', ['GITHUB_OWNER']);
  const githubRepo = readContextOrEnv(app, 'githubRepo', ['GITHUB_REPO']);
  const githubBranch =
    readContextOrEnv(app, 'githubBranch', ['GITHUB_BRANCH']) ?? 'main';
  const account = readContextOrEnv(app, 'account', ['CDK_DEFAULT_ACCOUNT']);
  const region =
    readContextOrEnv(app, 'region', ['CDK_DEFAULT_REGION']) ?? 'eu-west-2';
  const adminEmailAllowlistDev = resolveStageAdminEmailAllowlist(app, 'dev');
  const adminEmailAllowlistProd = resolveStageAdminEmailAllowlist(app, 'prod');

  if (!githubConnectionArn) {
    throw new Error(
      'Missing required context "githubConnectionArn". ' +
        'Create a CodeStar connection in AWS Console, then deploy with:\n' +
        '  cdk deploy PipelineStack -c githubConnectionArn=arn:aws:codestar-connections:... ' +
        '-c githubOwner=YOUR_ORG -c githubRepo=MMO-Infrastructure ' +
        '-c account=YOUR_ACCOUNT_ID -c region=eu-west-2'
    );
  }

  if (!githubOwner || !githubRepo) {
    throw new Error(
      'Missing required context "githubOwner" and/or "githubRepo". ' +
        'Pass -c githubOwner=YOUR_ORG -c githubRepo=MMO-Infrastructure'
    );
  }

  if (!account) {
    throw new Error(
      'Missing required context "account" (or CDK_DEFAULT_ACCOUNT). ' +
        'Pass -c account=YOUR_ACCOUNT_ID so pipeline stages get a real env and StackName.'
    );
  }

  if (!isUsable(region)) {
    throw new Error(
      'Missing required context "region" (or CDK_DEFAULT_REGION). ' +
        'Pass -c region=eu-west-2.'
    );
  }

  return {
    githubConnectionArn,
    githubOwner,
    githubRepo,
    githubBranch,
    account,
    region,
    adminEmailAllowlistDev,
    adminEmailAllowlistProd,
  };
}

/**
 * Per-stage admin email allowlist from CDK context / env.
 * Stage keys (`adminEmailAllowlistDev`, `ADMIN_EMAIL_ALLOWLIST_DEV`) win, then
 * the shared `adminEmailAllowlist` / `ADMIN_EMAIL_ALLOWLIST` fallback.
 * Missing or empty values fail closed (empty string — nobody is promoted).
 */
export function resolveStageAdminEmailAllowlist(
  scope: ContextScope,
  stageName: string
): string {
  const capitalized = stageName.charAt(0).toUpperCase() + stageName.slice(1);
  const fromStage = readContextOrEnv(
    scope,
    `adminEmailAllowlist${capitalized}`,
    [`ADMIN_EMAIL_ALLOWLIST_${stageName.toUpperCase()}`]
  );
  if (fromStage !== undefined) {
    return fromStage;
  }
  return readContextOrEnv(scope, 'adminEmailAllowlist', ['ADMIN_EMAIL_ALLOWLIST']) ?? '';
}
