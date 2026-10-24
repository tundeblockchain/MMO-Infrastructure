import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MmoStage } from '../lib/mmo-stage';

const ENV = { account: '123456789012', region: 'eu-west-2' };

/**
 * HTTP API CORS must allow the admin origin to send Authorization + Content-Type
 * on GET (catalog reads) and POST (catalog publish). allowOrigins is `*`, which
 * includes the mmo-admin origin. Preflight is handled by API Gateway (OPTIONS).
 */
describe('HTTP API CORS (MMO-26 / MMO-27)', () => {
  it('allows Authorization and Content-Type on GET and POST for any origin', () => {
    const app = new cdk.App();
    const stage = new MmoStage(app, 'Dev', { env: ENV, stageName: 'dev' });
    const template = Template.fromStack(stage.apiStack);

    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: {
        AllowHeaders: Match.arrayWith(['Authorization', 'Content-Type']),
        AllowMethods: Match.arrayWith(['GET', 'POST', 'OPTIONS']),
        AllowOrigins: ['*'],
      },
    });
  });

  it('derives USERS_TABLE_NAME from the users table construct', () => {
    const app = new cdk.App();
    const stage = new MmoStage(app, 'Dev', { env: ENV, stageName: 'dev' });
    const template = Template.fromStack(stage.apiStack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'mmo-dev-catalog-write',
      Environment: {
        Variables: Match.objectLike({
          USERS_TABLE_NAME: { 'Fn::ImportValue': Match.stringLikeRegexp('UsersTable') },
        }),
      },
    });
  });

  it('sets an empty ADMIN_EMAIL_ALLOWLIST and no AUTO_ADMIN_ON_LOGIN on both stages', () => {
    const app = new cdk.App();
    const dev = new MmoStage(app, 'Dev', { env: ENV, stageName: 'dev' });
    const prod = new MmoStage(app, 'Prod', { env: ENV, stageName: 'prod' });

    const assertAllowlist = (stack: cdk.Stack, functionName: string) => {
      const functions = Template.fromStack(stack).findResources('AWS::Lambda::Function', {
        Properties: { FunctionName: functionName },
      });
      const fn = Object.values(functions)[0] as {
        Properties?: { Environment?: { Variables?: Record<string, unknown> } };
      };
      const variables = fn.Properties?.Environment?.Variables ?? {};
      expect(variables.ADMIN_EMAIL_ALLOWLIST).toBe('');
      expect(variables.AUTO_ADMIN_ON_LOGIN).toBeUndefined();
      expect(variables.USERS_TABLE_NAME).toEqual({
        'Fn::ImportValue': expect.stringMatching(/UsersTable/),
      });
    };

    Template.fromStack(dev.apiStack).hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /users/me',
    });
    assertAllowlist(dev.apiStack, 'mmo-dev-users-me');
    assertAllowlist(prod.apiStack, 'mmo-prod-users-me');
  });

  it('wires per-stage ADMIN_EMAIL_ALLOWLIST from stage props', () => {
    const app = new cdk.App();
    const dev = new MmoStage(app, 'Dev', {
      env: ENV,
      stageName: 'dev',
      adminEmailAllowlist: 'dev-admin@example.com',
    });
    const prod = new MmoStage(app, 'Prod', {
      env: ENV,
      stageName: 'prod',
      adminEmailAllowlist: 'prod-admin@example.com',
    });

    Template.fromStack(dev.apiStack).hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'mmo-dev-users-me',
      Environment: {
        Variables: Match.objectLike({
          ADMIN_EMAIL_ALLOWLIST: 'dev-admin@example.com',
        }),
      },
    });
    Template.fromStack(prod.apiStack).hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'mmo-prod-users-me',
      Environment: {
        Variables: Match.objectLike({
          ADMIN_EMAIL_ALLOWLIST: 'prod-admin@example.com',
        }),
      },
    });
  });

  it('reads per-stage allowlist from CDK context when props are omitted', () => {
    const app = new cdk.App({
      context: {
        adminEmailAllowlistDev: 'dev-admin@example.com',
        adminEmailAllowlistProd: 'prod-admin@example.com',
      },
    });
    const dev = new MmoStage(app, 'Dev', { env: ENV, stageName: 'dev' });
    const prod = new MmoStage(app, 'Prod', { env: ENV, stageName: 'prod' });

    Template.fromStack(dev.apiStack).hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'mmo-dev-users-me',
      Environment: {
        Variables: Match.objectLike({
          ADMIN_EMAIL_ALLOWLIST: 'dev-admin@example.com',
        }),
      },
    });
    Template.fromStack(prod.apiStack).hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'mmo-prod-users-me',
      Environment: {
        Variables: Match.objectLike({
          ADMIN_EMAIL_ALLOWLIST: 'prod-admin@example.com',
        }),
      },
    });
  });

  it('does not set ADMIN_CLAIM_NAME on the catalog-write Lambda', () => {
    const app = new cdk.App();
    const stage = new MmoStage(app, 'Dev', { env: ENV, stageName: 'dev' });
    const template = Template.fromStack(stage.apiStack);
    const functions = template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: 'mmo-dev-catalog-write' },
    });
    const catalogWrite = Object.values(functions)[0] as {
      Properties?: { Environment?: { Variables?: Record<string, unknown> } };
    };
    expect(catalogWrite.Properties?.Environment?.Variables?.ADMIN_CLAIM_NAME).toBeUndefined();
  });
});
