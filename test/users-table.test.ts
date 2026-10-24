import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MmoStage } from '../lib/mmo-stage';

const ENV = { account: '123456789012', region: 'eu-west-2' };

function createStages(): { dev: MmoStage; prod: MmoStage } {
  const app = new cdk.App();
  return {
    dev: new MmoStage(app, 'Dev', { env: ENV, stageName: 'dev' }),
    prod: new MmoStage(app, 'Prod', { env: ENV, stageName: 'prod' }),
  };
}

function tableByName(
  template: Template,
  tableName: string
): { logicalId: string; resource: { Properties?: Record<string, unknown>; DeletionPolicy?: string; UpdateReplacePolicy?: string } } {
  const tables = template.findResources('AWS::DynamoDB::Table');
  for (const [logicalId, resource] of Object.entries(tables) as Array<
    [string, { Properties?: Record<string, unknown>; DeletionPolicy?: string; UpdateReplacePolicy?: string }]
  >) {
    if (resource.Properties?.TableName === tableName) {
      return { logicalId, resource };
    }
  }
  throw new Error(`Table ${tableName} not found`);
}

/** Frozen snapshot of the existing game table. Must not change when users tables are added. */
const DEV_GAME_TABLE_PROPERTIES = {
  TableName: 'mmo-dev-game',
  BillingMode: 'PAY_PER_REQUEST',
  KeySchema: [
    { AttributeName: 'PK', KeyType: 'HASH' },
    { AttributeName: 'SK', KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'PK', AttributeType: 'S' },
    { AttributeName: 'SK', AttributeType: 'S' },
    { AttributeName: 'GSI1PK', AttributeType: 'S' },
    { AttributeName: 'GSI1SK', AttributeType: 'S' },
    { AttributeName: 'GSI2PK', AttributeType: 'S' },
    { AttributeName: 'GSI2SK', AttributeType: 'S' },
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'GSI1',
      KeySchema: [
        { AttributeName: 'GSI1PK', KeyType: 'HASH' },
        { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    {
      IndexName: 'GSI2',
      KeySchema: [
        { AttributeName: 'GSI2PK', KeyType: 'HASH' },
        { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
  PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
};

const PROD_GAME_TABLE_PROPERTIES = {
  ...DEV_GAME_TABLE_PROPERTIES,
  TableName: 'mmo-prod-game',
  PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
};

describe('MMO-27: users table is additive; existing tables and stacks unchanged', () => {
  it('keeps CloudFormation stack names exactly as on main', () => {
    const { dev, prod } = createStages();
    expect(dev.dataStack.stackName).toBe('dev-Data');
    expect(dev.apiStack.stackName).toBe('dev-Api');
    expect(prod.dataStack.stackName).toBe('mmo-prod-Data');
    expect(prod.apiStack.stackName).toBe('mmo-prod-Api');
  });

  it('does not change the existing game table snapshot', () => {
    const { dev, prod } = createStages();
    const devGame = tableByName(Template.fromStack(dev.dataStack), 'mmo-dev-game');
    const prodGame = tableByName(Template.fromStack(prod.dataStack), 'mmo-prod-game');

    expect(devGame.resource.Properties).toMatchObject(DEV_GAME_TABLE_PROPERTIES);
    expect(devGame.resource.DeletionPolicy).toBe('Delete');
    expect(devGame.resource.UpdateReplacePolicy).toBe('Delete');

    expect(prodGame.resource.Properties).toMatchObject(PROD_GAME_TABLE_PROPERTIES);
    expect(prodGame.resource.DeletionPolicy).toBe('Retain');
    expect(prodGame.resource.UpdateReplacePolicy).toBe('Retain');
  });

  it('adds users tables named mmo-dev-users and mmo-prod-users', () => {
    const { dev, prod } = createStages();
    const devUsers = tableByName(Template.fromStack(dev.dataStack), 'mmo-dev-users');
    const prodUsers = tableByName(Template.fromStack(prod.dataStack), 'mmo-prod-users');

    expect(devUsers.resource.Properties).toMatchObject({
      TableName: 'mmo-dev-users',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [{ AttributeName: 'uid', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'uid', AttributeType: 'S' }],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
    });
    expect(devUsers.resource.DeletionPolicy).toBe('Delete');
    expect(devUsers.resource.UpdateReplacePolicy).toBe('Delete');

    expect(prodUsers.resource.Properties).toMatchObject({
      TableName: 'mmo-prod-users',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [{ AttributeName: 'uid', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'uid', AttributeType: 'S' }],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
    expect(prodUsers.resource.DeletionPolicy).toBe('Retain');
    expect(prodUsers.resource.UpdateReplacePolicy).toBe('Retain');
  });

  it('grants catalog-write read-only access to the users table', () => {
    const { dev } = createStages();
    const template = Template.fromStack(dev.apiStack);
    const users = tableByName(Template.fromStack(dev.dataStack), 'mmo-dev-users');

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: Match.arrayWith(['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan']),
            Resource: Match.anyValue(),
          }),
        ]),
      },
    });

    const policies = template.findResources('AWS::IAM::Policy');
    const serialized = JSON.stringify(policies);
    expect(serialized).toContain(users.logicalId);
    expect(serialized).not.toMatch(
      /"Action":\s*\[(?:[^\]]*"dynamodb:(?:PutItem|UpdateItem|DeleteItem)"[^\]]*)\][^}]*UsersTable/
    );

    const writeActions = ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'];
    for (const policy of Object.values(policies) as Array<{
      Properties?: { PolicyDocument?: { Statement?: Array<{ Action?: string | string[]; Resource?: unknown }> } };
    }>) {
      for (const statement of policy.Properties?.PolicyDocument?.Statement ?? []) {
        const actions = Array.isArray(statement.Action)
          ? statement.Action
          : statement.Action
            ? [statement.Action]
            : [];
        const touchesUsers = JSON.stringify(statement.Resource ?? '').includes(users.logicalId);
        if (touchesUsers) {
          for (const writeAction of writeActions) {
            expect(actions).not.toContain(writeAction);
          }
        }
      }
    }
  });
});
