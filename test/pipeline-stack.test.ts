import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { PipelineStack, PipelineStackProps } from '../lib/pipeline-stack';
import { resolvePipelineContext } from '../lib/pipeline-context';

function createTestStack(propsOverride: Partial<PipelineStackProps> = {}): cdk.Stack {
  const app = new cdk.App();
  const defaultProps: PipelineStackProps = {
    env: { account: '123456789012', region: 'eu-west-2' },
    githubConnectionArn: 'arn:aws:codestar-connections:eu-west-2:123456789012:connection/test-conn-id',
    githubOwner: 'test-owner',
    githubRepo: 'test-repo',
    githubBranch: 'main',
  };
  return new PipelineStack(app, 'TestPipelineStack', { ...defaultProps, ...propsOverride });
}

describe('PipelineStack', () => {
  describe('Synth ShellStep context flags', () => {
    it('passes githubConnectionArn via environment variable to synth step', () => {
      const stack = createTestStack();
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Source: {
          BuildSpec: Match.serializedJson(
            Match.objectLike({
              phases: Match.objectLike({
                build: Match.objectLike({
                  commands: Match.arrayWith([
                    Match.stringLikeRegexp('-c githubConnectionArn=\\$\\{GITHUB_CONNECTION_ARN\\}'),
                  ]),
                }),
              }),
            })
          ),
        },
        Environment: Match.objectLike({
          EnvironmentVariables: Match.arrayWith([
            Match.objectLike({
              Name: 'GITHUB_CONNECTION_ARN',
              Type: 'PLAINTEXT',
              Value: 'arn:aws:codestar-connections:eu-west-2:123456789012:connection/test-conn-id',
            }),
          ]),
        }),
      });
    });

    it('passes githubOwner context flag from props', () => {
      const stack = createTestStack({ githubOwner: 'my-org' });
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Source: {
          BuildSpec: Match.serializedJson(
            Match.objectLike({
              phases: Match.objectLike({
                build: Match.objectLike({
                  commands: Match.arrayWith([Match.stringLikeRegexp('-c githubOwner=my-org')]),
                }),
              }),
            })
          ),
        },
      });
    });

    it('passes githubRepo context flag from props', () => {
      const stack = createTestStack({ githubRepo: 'my-repo' });
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Source: {
          BuildSpec: Match.serializedJson(
            Match.objectLike({
              phases: Match.objectLike({
                build: Match.objectLike({
                  commands: Match.arrayWith([Match.stringLikeRegexp('-c githubRepo=my-repo')]),
                }),
              }),
            })
          ),
        },
      });
    });

    it('passes githubBranch context flag from props', () => {
      const stack = createTestStack({ githubBranch: 'master' });
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Source: {
          BuildSpec: Match.serializedJson(
            Match.objectLike({
              phases: Match.objectLike({
                build: Match.objectLike({
                  commands: Match.arrayWith([Match.stringLikeRegexp('-c githubBranch=master')]),
                }),
              }),
            })
          ),
        },
      });
    });

    it('synth command includes github and account/region context flags', () => {
      const stack = createTestStack({
        githubOwner: 'tundeblockchain',
        githubRepo: 'MMO-Infrastructure',
        githubBranch: 'master',
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Source: {
          BuildSpec: Match.serializedJson(
            Match.objectLike({
              phases: Match.objectLike({
                build: Match.objectLike({
                  commands: Match.arrayWith([
                    Match.stringLikeRegexp(
                      'npx cdk synth.*-c githubConnectionArn=.*-c githubOwner=tundeblockchain.*-c githubRepo=MMO-Infrastructure.*-c githubBranch=master.*-c account=\\$\\{CDK_DEFAULT_ACCOUNT\\}.*-c region=\\$\\{CDK_DEFAULT_REGION\\}'
                    ),
                  ]),
                }),
              }),
            })
          ),
        },
        Environment: Match.objectLike({
          EnvironmentVariables: Match.arrayWith([
            Match.objectLike({
              Name: 'CDK_DEFAULT_ACCOUNT',
              Type: 'PLAINTEXT',
              Value: '123456789012',
            }),
            Match.objectLike({
              Name: 'CDK_DEFAULT_REGION',
              Type: 'PLAINTEXT',
              Value: 'eu-west-2',
            }),
          ]),
        }),
      });
    });
  });

  describe('githubBranch defaults to main for auto-build', () => {
    it('uses BranchName main by default', () => {
      const stack = createTestStack();
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
        Stages: Match.arrayWith([
          Match.objectLike({
            Name: 'Source',
            Actions: Match.arrayWith([
              Match.objectLike({
                Configuration: Match.objectLike({
                  BranchName: 'main',
                }),
              }),
            ]),
          }),
        ]),
      });
    });

    it('source stage uses the provided branch name from props', () => {
      const stack = createTestStack({ githubBranch: 'develop' });
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
        Stages: Match.arrayWith([
          Match.objectLike({
            Name: 'Source',
            Actions: Match.arrayWith([
              Match.objectLike({
                Configuration: Match.objectLike({
                  BranchName: 'develop',
                }),
              }),
            ]),
          }),
        ]),
      });
    });
  });

  describe('resolvePipelineContext githubBranch', () => {
    const requiredContext = {
      githubConnectionArn:
        'arn:aws:codestar-connections:eu-west-2:123456789012:connection/test',
      githubOwner: 'test-owner',
      githubRepo: 'test-repo',
      account: '123456789012',
      region: 'eu-west-2',
    };

    function withUnsetGithubBranch(fn: () => void): void {
      const previous = process.env.GITHUB_BRANCH;
      delete process.env.GITHUB_BRANCH;
      try {
        fn();
      } finally {
        if (previous === undefined) {
          delete process.env.GITHUB_BRANCH;
        } else {
          process.env.GITHUB_BRANCH = previous;
        }
      }
    }

    it('resolves githubBranch to main when no context and no env var is set', () => {
      withUnsetGithubBranch(() => {
        const app = new cdk.App({ context: requiredContext });
        expect(resolvePipelineContext(app).githubBranch).toBe('main');
      });
    });

    it('uses the githubBranch context override when provided', () => {
      withUnsetGithubBranch(() => {
        const app = new cdk.App({
          context: { ...requiredContext, githubBranch: 'develop' },
        });
        expect(resolvePipelineContext(app).githubBranch).toBe('develop');
      });
    });
  });

  describe('Pipeline configuration', () => {
    it('creates a CodePipeline with self-mutation enabled', () => {
      const stack = createTestStack();
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
        Name: 'MmoInfrastructure',
      });

      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Description: Match.stringLikeRegexp('SelfMutate'),
      });
    });

    it('uses CodeStar connection for GitHub source', () => {
      const stack = createTestStack();
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
        Stages: Match.arrayWith([
          Match.objectLike({
            Name: 'Source',
            Actions: Match.arrayWith([
              Match.objectLike({
                ActionTypeId: Match.objectLike({
                  Provider: 'CodeStarSourceConnection',
                }),
                Configuration: Match.objectLike({
                  ConnectionArn:
                    'arn:aws:codestar-connections:eu-west-2:123456789012:connection/test-conn-id',
                }),
              }),
            ]),
          }),
        ]),
      });
    });
  });

  describe('MMO-14: CodeBuild StartBuild permissions for Assets stage', () => {
    it('grants codebuild:StartBuild permission to CodeBuild action roles', () => {
      const stack = createTestStack();
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
              Effect: 'Allow',
              Resource: Match.stringLikeRegexp('arn:aws:codebuild:.*:.*:project/\\*'),
            }),
          ]),
        },
      });
    });

    it('attaches StartBuild policy to action roles used by CodeBuild actions', () => {
      const stack = createTestStack();
      const template = Template.fromStack(stack);

      const policyResources = template.findResources('AWS::IAM::Policy', {
        Properties: {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
              }),
            ]),
          },
        },
      });

      expect(Object.keys(policyResources).length).toBeGreaterThan(0);
    });

    it('grants StartBuild on all CodeBuild projects in the account/region', () => {
      const stack = createTestStack();
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
              Resource: 'arn:aws:codebuild:eu-west-2:123456789012:project/*',
            }),
          ]),
        },
      });
    });
  });

  describe('MMO-21: Prepare/Deploy StackName and required context', () => {
    it('every CloudFormation Prepare/Deploy action has a non-empty StackName', () => {
      const stack = createTestStack();
      const template = Template.fromStack(stack);
      const pipelines = template.findResources('AWS::CodePipeline::Pipeline');
      const actions: Array<{ stage: string; name: string; stackName: unknown }> = [];

      for (const resource of Object.values(pipelines) as Array<{
        Properties?: { Stages?: Array<{ Name: string; Actions?: Array<any> }> };
      }>) {
        for (const stage of resource.Properties?.Stages ?? []) {
          for (const action of stage.Actions ?? []) {
            if (action.ActionTypeId?.Provider !== 'CloudFormation') {
              continue;
            }
            if (!/\.(Prepare|Deploy)$/.test(action.Name ?? '')) {
              continue;
            }
            actions.push({
              stage: stage.Name,
              name: action.Name,
              stackName: action.Configuration?.StackName,
            });
          }
        }
      }

      expect(actions.length).toBeGreaterThan(0);
      const empty = actions.filter(
        (action) =>
          typeof action.stackName !== 'string' ||
          action.stackName.trim() === '' ||
          action.stackName === 'null' ||
          action.stackName === 'undefined'
      );
      expect(empty).toEqual([]);
      expect(actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stage: 'dev',
            name: 'Data.Prepare',
            stackName: 'dev-Data',
          }),
          expect.objectContaining({
            stage: 'dev',
            name: 'Data.Deploy',
            stackName: 'dev-Data',
          }),
          expect.objectContaining({
            stage: 'dev',
            name: 'Api.Prepare',
            stackName: 'dev-Api',
          }),
          expect.objectContaining({
            stage: 'dev',
            name: 'Api.Deploy',
            stackName: 'dev-Api',
          }),
        ])
      );

      const prodStackNames = actions
        .filter((action) => action.stage === 'prod')
        .map((action) => action.stackName);
      expect(prodStackNames).not.toContain('prod-Data');
      expect(prodStackNames).not.toContain('prod-Api');
    });

    it('prod Prepare/Deploy actions target mmo-prod-Data and mmo-prod-Api', () => {
      const stack = createTestStack();
      const template = Template.fromStack(stack);
      const pipelines = template.findResources('AWS::CodePipeline::Pipeline');
      const prodActions: Array<{
        name: string;
        stackName: unknown;
        changeSetName: unknown;
        templatePath: unknown;
      }> = [];

      for (const resource of Object.values(pipelines) as Array<{
        Properties?: { Stages?: Array<{ Name: string; Actions?: Array<any> }> };
      }>) {
        for (const stage of resource.Properties?.Stages ?? []) {
          if (stage.Name !== 'prod') {
            continue;
          }
          for (const action of stage.Actions ?? []) {
            if (action.ActionTypeId?.Provider !== 'CloudFormation') {
              continue;
            }
            prodActions.push({
              name: action.Name,
              stackName: action.Configuration?.StackName,
              changeSetName: action.Configuration?.ChangeSetName,
              templatePath: action.Configuration?.TemplatePath,
            });
          }
        }
      }

      const pairs = [
        {
          prepare: ['Data.Prepare', 'mmo-prod-Data.Prepare'],
          deploy: ['Data.Deploy', 'mmo-prod-Data.Deploy'],
          stackName: 'mmo-prod-Data',
        },
        {
          prepare: ['Api.Prepare', 'mmo-prod-Api.Prepare'],
          deploy: ['Api.Deploy', 'mmo-prod-Api.Deploy'],
          stackName: 'mmo-prod-Api',
        },
      ];

      for (const pair of pairs) {
        const prepare = prodActions.find(
          (action) =>
            pair.prepare.includes(action.name) || action.stackName === pair.stackName
        );
        const deploy = prodActions.find(
          (action) =>
            pair.deploy.includes(action.name) && action.stackName === pair.stackName
        );
        const prepareByStack = prodActions.find(
          (action) =>
            action.stackName === pair.stackName && /\.Prepare$/.test(action.name)
        );
        const deployByStack = prodActions.find(
          (action) =>
            action.stackName === pair.stackName && /\.Deploy$/.test(action.name)
        );
        expect(prepareByStack ?? prepare).toBeDefined();
        expect(deployByStack ?? deploy).toBeDefined();
        expect(prepareByStack?.stackName ?? prepare?.stackName).toBe(pair.stackName);
        expect(deployByStack?.stackName ?? deploy?.stackName).toBe(pair.stackName);
        expect(prepareByStack?.changeSetName ?? prepare?.changeSetName).toBe(
          'PipelineChange'
        );
        expect(deployByStack?.changeSetName ?? deploy?.changeSetName).toBe(
          'PipelineChange'
        );
        const templatePath = String(
          prepareByStack?.templatePath ?? prepare?.templatePath ?? ''
        );
        expect(templatePath.length).toBeGreaterThan(0);
        expect(templatePath).toMatch(/assembly-.*-Prod\/.*\.template\.json$/);
      }
    });

    it('dev Prepare/Deploy stack names stay exactly dev-Data and dev-Api', () => {
      const stack = createTestStack();
      const template = Template.fromStack(stack);
      const pipelines = template.findResources('AWS::CodePipeline::Pipeline');
      const devStackNames = new Set<string>();

      for (const resource of Object.values(pipelines) as Array<{
        Properties?: { Stages?: Array<{ Name: string; Actions?: Array<any> }> };
      }>) {
        for (const stage of resource.Properties?.Stages ?? []) {
          if (stage.Name !== 'dev') {
            continue;
          }
          for (const action of stage.Actions ?? []) {
            if (action.ActionTypeId?.Provider !== 'CloudFormation') {
              continue;
            }
            if (!/\.(Prepare|Deploy)$/.test(action.Name ?? '')) {
              continue;
            }
            expect(typeof action.Configuration?.StackName).toBe('string');
            devStackNames.add(action.Configuration.StackName);
          }
        }
      }

      expect([...devStackNames].sort()).toEqual(['dev-Api', 'dev-Data']);
    });

    it('synth fails loudly if required githubConnectionArn context is missing', () => {
      const app = new cdk.App({
        context: {
          githubOwner: 'test-owner',
          githubRepo: 'test-repo',
          account: '123456789012',
          region: 'eu-west-2',
        },
      });
      expect(() => resolvePipelineContext(app)).toThrow(/githubConnectionArn/);
    });

    it('synth fails loudly if required account context is missing', () => {
      const app = new cdk.App({
        context: {
          githubConnectionArn:
            'arn:aws:codestar-connections:eu-west-2:123456789012:connection/test',
          githubOwner: 'test-owner',
          githubRepo: 'test-repo',
          region: 'eu-west-2',
        },
      });
      const previous = process.env.CDK_DEFAULT_ACCOUNT;
      delete process.env.CDK_DEFAULT_ACCOUNT;
      try {
        expect(() => resolvePipelineContext(app)).toThrow(/account/);
      } finally {
        if (previous === undefined) {
          delete process.env.CDK_DEFAULT_ACCOUNT;
        } else {
          process.env.CDK_DEFAULT_ACCOUNT = previous;
        }
      }
    });

    it('synth fails loudly if required context is the string "undefined" or "null"', () => {
      const app = new cdk.App({
        context: {
          githubConnectionArn: 'undefined',
          githubOwner: 'null',
          githubRepo: 'test-repo',
          account: 'undefined',
          region: 'null',
        },
      });
      expect(() => resolvePipelineContext(app)).toThrow(/Missing required context/);
    });

    it('rejects PipelineStack construction without env', () => {
      const app = new cdk.App();
      expect(
        () =>
          new PipelineStack(app, 'BrokenPipeline', {
            githubConnectionArn:
              'arn:aws:codestar-connections:eu-west-2:123456789012:connection/test',
            githubOwner: 'test-owner',
            githubRepo: 'test-repo',
            githubBranch: 'master',
          })
      ).toThrow(/env\.account and env\.region/);
    });
  });
});
