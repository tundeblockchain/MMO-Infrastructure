/**
 * MMO-50: CDK wiring for the ZoneServer ticket secret and auth-session Lambda.
 */

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MmoStage } from '../lib/mmo-stage';

const ENV = { account: '000000000000', region: 'eu-west-2' };

function createDevTemplate(): { data: Template; api: Template } {
  const app = new cdk.App();
  const stage = new MmoStage(app, 'Dev', { env: ENV, stageName: 'dev' });
  return {
    data: Template.fromStack(stage.dataStack),
    api: Template.fromStack(stage.apiStack),
  };
}

function statementsFor(
  template: Template,
  logicalIdPrefix: string
): Array<{ Action?: string | string[]; Resource?: unknown; Effect?: string }> {
  const policies = template.findResources('AWS::IAM::Policy');
  const policy = Object.entries(policies).find(([logicalId]) =>
    logicalId.startsWith(logicalIdPrefix)
  );
  expect(policy).toBeDefined();
  return (
    (
      policy?.[1] as {
        Properties?: {
          PolicyDocument?: {
            Statement?: Array<{ Action?: string | string[]; Resource?: unknown; Effect?: string }>;
          };
        };
      }
    ).Properties?.PolicyDocument?.Statement ?? []
  );
}

function actionList(statement: { Action?: string | string[] }): string[] {
  if (Array.isArray(statement.Action)) {
    return statement.Action;
  }
  return statement.Action ? [statement.Action] : [];
}

describe('MMO-50: ZoneServer ticket secret and auth-session grants', () => {
  it('creates a generated Secrets Manager secret named mmo-{stage}/zoneserver-ticket', () => {
    const { data } = createDevTemplate();
    data.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'mmo-dev/zoneserver-ticket',
      GenerateSecretString: {
        SecretStringTemplate: '{}',
        GenerateStringKey: 'secret',
        PasswordLength: 64,
        ExcludePunctuation: true,
      },
    });

    const outputs = data.findOutputs('ZoneServerTicketSecretName');
    expect(Object.keys(outputs).length).toBeGreaterThan(0);
    const output = Object.values(outputs)[0] as { Value?: string; Export?: { Name?: string } };
    expect(output.Value).toBe('mmo-dev/zoneserver-ticket');
    expect(JSON.stringify(data.toJSON())).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });

  it('does not embed a ticket secret value or ZONE_TICKET_SECRET env on the Lambda', () => {
    const { data, api } = createDevTemplate();
    const combined = JSON.stringify(data.toJSON()) + JSON.stringify(api.toJSON());
    expect(combined).not.toContain('"ZONE_TICKET_SECRET"');
    expect(combined).not.toMatch(/"secret":\s*"[A-Za-z0-9]{16,}"/);

    const functions = api.findResources('AWS::Lambda::Function');
    const authSession = Object.values(functions).find(
      (resource) =>
        (resource as { Properties?: { FunctionName?: string } }).Properties?.FunctionName ===
        'mmo-dev-auth-session'
    ) as { Properties?: { Environment?: { Variables?: Record<string, unknown> } } };
    expect(authSession).toBeDefined();
    const env = authSession.Properties?.Environment?.Variables ?? {};
    expect(env.ZONE_TICKET_SECRET).toBeUndefined();
    expect(env.ZONE_TICKET_SECRET_ARN).toBeDefined();
  });

  it('configures auth-session with users table, ticket ARN, 5-minute TTL, and zoneserver audience', () => {
    const { api } = createDevTemplate();
    api.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'mmo-dev-auth-session',
      Environment: {
        Variables: Match.objectLike({
          USERS_TABLE_NAME: Match.anyValue(),
          ZONE_TICKET_SECRET_ARN: Match.anyValue(),
          ZONE_TICKET_TTL_SECONDS: '300',
          ZONE_TICKET_AUDIENCE: 'zoneserver',
          ZONE_TICKET_ISSUER: 'mmo-api',
        }),
      },
    });
  });

  it('grants auth-session read-only access to the ticket secret and users table', () => {
    const { api } = createDevTemplate();
    const statements = statementsFor(api, 'AuthSessionFnServiceRoleDefaultPolicy');

    const secretStatements = statements.filter((statement) =>
      JSON.stringify(statement.Resource ?? '').includes('ZoneServerTicketSecret')
    );
    expect(secretStatements.length).toBeGreaterThan(0);
    for (const statement of secretStatements) {
      const actions = actionList(statement);
      expect(actions).toEqual(
        expect.arrayContaining(['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'])
      );
      expect(actions).not.toContain('secretsmanager:PutSecretValue');
      expect(actions).not.toContain('secretsmanager:UpdateSecret');
      expect(actions).not.toContain('secretsmanager:DeleteSecret');
    }

    const usersStatements = statements.filter((statement) =>
      JSON.stringify(statement.Resource ?? '').includes('UsersTable')
    );
    expect(usersStatements.length).toBeGreaterThan(0);
    const tableRead = usersStatements.find((statement) =>
      actionList(statement).includes('dynamodb:GetItem')
    );
    expect(tableRead).toBeDefined();
    for (const statement of usersStatements) {
      expect(actionList(statement)).not.toContain('dynamodb:PutItem');
      expect(actionList(statement)).not.toContain('dynamodb:UpdateItem');
      expect(actionList(statement)).not.toContain('dynamodb:DeleteItem');
    }
  });
});
