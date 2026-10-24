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

  it('sets USERS_TABLE_NAME on the catalog-write Lambda', () => {
    const app = new cdk.App();
    const stage = new MmoStage(app, 'Dev', { env: ENV, stageName: 'dev' });
    const template = Template.fromStack(stage.apiStack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'mmo-dev-catalog-write',
      Environment: {
        Variables: Match.objectLike({
          USERS_TABLE_NAME: 'mmo-dev-users',
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
