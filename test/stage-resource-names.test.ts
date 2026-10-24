import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { cloudFormationStackName, MmoStage } from '../lib/mmo-stage';
import { PipelineStack } from '../lib/pipeline-stack';

const ENV = { account: '123456789012', region: 'eu-west-2' };

const NAMED_RESOURCE_KEYS: Record<string, string> = {
  'AWS::DynamoDB::Table': 'TableName',
  'AWS::SecretsManager::Secret': 'Name',
  'AWS::Lambda::Function': 'FunctionName',
  'AWS::ApiGatewayV2::Api': 'Name',
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

/** Physical names on main (MMO-22). Must stay identical for both stages. */
const MAIN_DEV_PHYSICAL_NAMES = [
  'mmo-dev-api',
  'mmo-dev-auth-session',
  'mmo-dev-catalog',
  'mmo-dev-catalog-write',
  'mmo-dev-characters',
  'mmo-dev-characters-save',
  'mmo-dev/firebase-service-account',
  'mmo-dev/game-session-jwt',
  'mmo-dev-game',
  'mmo-dev/internal-save-api-key',
].sort();

const MAIN_PROD_PHYSICAL_NAMES = [
  'mmo-prod-api',
  'mmo-prod-auth-session',
  'mmo-prod-catalog',
  'mmo-prod-catalog-write',
  'mmo-prod-characters',
  'mmo-prod-characters-save',
  'mmo-prod/firebase-service-account',
  'mmo-prod/game-session-jwt',
  'mmo-prod-game',
  'mmo-prod/internal-save-api-key',
].sort();

describe('MMO-24: prod CloudFormation stack names only', () => {
  it('namespaces only the prod CloudFormation stack names', () => {
    expect(cloudFormationStackName('dev', 'Data')).toBe('dev-Data');
    expect(cloudFormationStackName('dev', 'Api')).toBe('dev-Api');
    expect(cloudFormationStackName('prod', 'Data')).toBe('mmo-prod-Data');
    expect(cloudFormationStackName('prod', 'Api')).toBe('mmo-prod-Api');
  });

  it('keeps dev stack names exactly dev-Data / dev-Api and namespaces prod', () => {
    const { dev, prod } = createStages();

    expect(dev.dataStack.stackName).toBe('dev-Data');
    expect(dev.apiStack.stackName).toBe('dev-Api');
    expect(prod.dataStack.stackName).toBe('mmo-prod-Data');
    expect(prod.apiStack.stackName).toBe('mmo-prod-Api');
  });

  it('keeps the prod Data construct path at Prod/Data for manual deploy', () => {
    const { prod } = createStages();
    expect(prod.dataStack.node.path).toBe('Prod/Data');
    expect(prod.dataStack.node.id).toBe('Data');
  });

  it('keeps the pipeline-hosted prod Data construct path at PipelineStack/Prod/Data', () => {
    const app = new cdk.App();
    const pipeline = new PipelineStack(app, 'PipelineStack', {
      env: ENV,
      githubConnectionArn:
        'arn:aws:codestar-connections:eu-west-2:123456789012:connection/test-conn-id',
      githubOwner: 'test-owner',
      githubRepo: 'test-repo',
      githubBranch: 'main',
    });
    const prodData = pipeline.node.findAll().find((node) => node.node.path === 'PipelineStack/Prod/Data');
    expect(prodData).toBeDefined();
    expect((prodData as cdk.Stack).stackName).toBe('mmo-prod-Data');
  });

  it('dev physical names are unchanged vs main', () => {
    const { dev } = createStages();
    const devNames = [
      ...collectHardcodedNames(dev.dataStack),
      ...collectHardcodedNames(dev.apiStack),
    ].map((row) => row.physicalName);

    expect(devNames.sort()).toEqual(MAIN_DEV_PHYSICAL_NAMES);
  });

  it('prod table name stays mmo-prod-game and other prod physical names stay on main', () => {
    const { prod } = createStages();
    const prodData = Template.fromStack(prod.dataStack);
    prodData.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'mmo-prod-game',
    });

    const prodNames = [
      ...collectHardcodedNames(prod.dataStack),
      ...collectHardcodedNames(prod.apiStack),
    ].map((row) => row.physicalName);

    expect(prodNames.sort()).toEqual(MAIN_PROD_PHYSICAL_NAMES);
    expect(prodNames).toContain('mmo-prod-game');
    expect(prodNames).not.toContain('mmo-prod-game-v2');
  });

  it('does not rename tables, secrets, or lambdas when only prod stack names change', () => {
    const { dev, prod } = createStages();
    const byType = (stage: MmoStage, type: string) =>
      [
        ...collectHardcodedNames(stage.dataStack),
        ...collectHardcodedNames(stage.apiStack),
      ]
        .filter((row) => row.type === type)
        .map((row) => row.physicalName)
        .sort();

    expect(byType(dev, 'AWS::DynamoDB::Table')).toEqual(['mmo-dev-game']);
    expect(byType(prod, 'AWS::DynamoDB::Table')).toEqual(['mmo-prod-game']);
    expect(byType(dev, 'AWS::SecretsManager::Secret')).toEqual([
      'mmo-dev/firebase-service-account',
      'mmo-dev/game-session-jwt',
      'mmo-dev/internal-save-api-key',
    ]);
    expect(byType(prod, 'AWS::SecretsManager::Secret')).toEqual([
      'mmo-prod/firebase-service-account',
      'mmo-prod/game-session-jwt',
      'mmo-prod/internal-save-api-key',
    ]);
    expect(byType(dev, 'AWS::Lambda::Function')).toEqual([
      'mmo-dev-auth-session',
      'mmo-dev-catalog',
      'mmo-dev-catalog-write',
      'mmo-dev-characters',
      'mmo-dev-characters-save',
    ]);
    expect(byType(prod, 'AWS::Lambda::Function')).toEqual([
      'mmo-prod-auth-session',
      'mmo-prod-catalog',
      'mmo-prod-catalog-write',
      'mmo-prod-characters',
      'mmo-prod-characters-save',
    ]);
  });
});
