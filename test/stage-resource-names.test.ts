import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MmoStage } from '../lib/mmo-stage';

const ENV = { account: '123456789012', region: 'eu-west-2' };

const NAMED_RESOURCE_KEYS: Record<string, string> = {
  'AWS::DynamoDB::Table': 'TableName',
  'AWS::SecretsManager::Secret': 'Name',
  'AWS::Lambda::Function': 'FunctionName',
  'AWS::ApiGatewayV2::Api': 'Name',
  'AWS::Logs::LogGroup': 'LogGroupName',
  'AWS::IAM::Role': 'RoleName',
  'AWS::S3::Bucket': 'BucketName',
};

interface NamedResource {
  stackName: string;
  type: string;
  logicalId: string;
  physicalName: string;
}

function collectHardcodedNames(stack: cdk.Stack): NamedResource[] {
  const template = Template.fromStack(stack);
  const names: NamedResource[] = [];

  for (const [type, property] of Object.entries(NAMED_RESOURCE_KEYS)) {
    const resources = template.findResources(type);
    for (const [logicalId, resource] of Object.entries(resources) as Array<
      [string, { Properties?: Record<string, unknown> }]
    >) {
      const value = resource.Properties?.[property];
      if (typeof value !== 'string' || value.trim() === '') {
        continue;
      }
      names.push({
        stackName: stack.stackName,
        type,
        logicalId,
        physicalName: value,
      });
    }
  }

  return names;
}

function createStages(): { dev: MmoStage; prod: MmoStage } {
  const app = new cdk.App();
  return {
    dev: new MmoStage(app, 'Dev', { env: ENV, stageName: 'dev' }),
    prod: new MmoStage(app, 'Prod', { env: ENV, stageName: 'prod' }),
  };
}

describe('MMO-23: stage-scoped physical names', () => {
  it('uses mmo-dev / mmo-prod stack names', () => {
    const { dev, prod } = createStages();

    expect(dev.dataStack.stackName).toBe('mmo-dev-Data');
    expect(dev.apiStack.stackName).toBe('mmo-dev-Api');
    expect(prod.dataStack.stackName).toBe('mmo-prod-Data');
    expect(prod.apiStack.stackName).toBe('mmo-prod-Api');
  });

  it('hardcodes every Data/Api physical name with the stage prefix', () => {
    const { dev, prod } = createStages();
    const devNames = [
      ...collectHardcodedNames(dev.dataStack),
      ...collectHardcodedNames(dev.apiStack),
    ];
    const prodNames = [
      ...collectHardcodedNames(prod.dataStack),
      ...collectHardcodedNames(prod.apiStack),
    ];

    expect(devNames.length).toBeGreaterThan(0);
    expect(prodNames.length).toBeGreaterThan(0);

    expect(devNames.map((row) => row.physicalName).sort()).toEqual([
      'mmo-dev-api',
      'mmo-dev-auth-session',
      'mmo-dev-catalog',
      'mmo-dev-catalog-write',
      'mmo-dev-characters',
      'mmo-dev-characters-save',
      'mmo-dev-firebase-service-account',
      'mmo-dev-game-session-jwt',
      'mmo-dev-game-v2',
      'mmo-dev-internal-save-api-key',
    ]);

    expect(prodNames.map((row) => row.physicalName).sort()).toEqual([
      'mmo-prod-api',
      'mmo-prod-auth-session',
      'mmo-prod-catalog',
      'mmo-prod-catalog-write',
      'mmo-prod-characters',
      'mmo-prod-characters-save',
      'mmo-prod-firebase-service-account',
      'mmo-prod-game-session-jwt',
      'mmo-prod-game-v2',
      'mmo-prod-internal-save-api-key',
    ]);

    for (const row of devNames) {
      expect(row.physicalName.startsWith('mmo-dev')).toBe(true);
    }
    for (const row of prodNames) {
      expect(row.physicalName.startsWith('mmo-prod')).toBe(true);
    }
  });

  it('never reuses a physical name between dev and prod', () => {
    const { dev, prod } = createStages();
    const devNames = [
      dev.dataStack.stackName,
      dev.apiStack.stackName,
      ...collectHardcodedNames(dev.dataStack).map((row) => row.physicalName),
      ...collectHardcodedNames(dev.apiStack).map((row) => row.physicalName),
    ];
    const prodNames = [
      prod.dataStack.stackName,
      prod.apiStack.stackName,
      ...collectHardcodedNames(prod.dataStack).map((row) => row.physicalName),
      ...collectHardcodedNames(prod.apiStack).map((row) => row.physicalName),
    ];

    const collisions = devNames.filter((name) => prodNames.includes(name));
    expect(collisions).toEqual([]);
  });

  it('uses -v2 table names so retained mmo-*-game leftovers are not reused', () => {
    const { dev, prod } = createStages();
    const devData = Template.fromStack(dev.dataStack);
    const prodData = Template.fromStack(prod.dataStack);
    const devApi = Template.fromStack(dev.apiStack);
    const prodApi = Template.fromStack(prod.apiStack);

    devData.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'mmo-dev-game-v2',
    });
    prodData.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'mmo-prod-game-v2',
    });

    const allTableNames = [
      ...Object.values(devData.findResources('AWS::DynamoDB::Table')),
      ...Object.values(prodData.findResources('AWS::DynamoDB::Table')),
    ].map((resource) => (resource as { Properties?: { TableName?: string } }).Properties?.TableName);

    expect(allTableNames).not.toContain('mmo-dev-game');
    expect(allTableNames).not.toContain('mmo-prod-game');

    const assertLambdaTableEnv = (template: Template, dataStackName: string) => {
      const functions = template.findResources('AWS::Lambda::Function');
      const tableEnvs = Object.values(functions).map((resource) => {
        const vars = (resource as {
          Properties?: { Environment?: { Variables?: { TABLE_NAME?: unknown } } };
        }).Properties?.Environment?.Variables;
        return vars?.TABLE_NAME;
      });
      expect(tableEnvs.length).toBeGreaterThan(0);
      for (const value of tableEnvs) {
        expect(value).toEqual({
          'Fn::ImportValue': expect.stringContaining(`${dataStackName}:`),
        });
        expect(JSON.stringify(value)).not.toContain('mmo-dev-game"');
        expect(JSON.stringify(value)).not.toContain('mmo-prod-game"');
      }
    };

    assertLambdaTableEnv(devApi, 'mmo-dev-Data');
    assertLambdaTableEnv(prodApi, 'mmo-prod-Data');
  });
});
