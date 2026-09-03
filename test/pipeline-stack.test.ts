import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { PipelineStack, PipelineStackProps } from '../lib/pipeline-stack';

function createTestStack(propsOverride: Partial<PipelineStackProps> = {}): cdk.Stack {
  const app = new cdk.App();
  const defaultProps: PipelineStackProps = {
    env: { account: '123456789012', region: 'eu-west-2' },
    githubConnectionArn: 'arn:aws:codestar-connections:eu-west-2:123456789012:connection/test-conn-id',
    githubOwner: 'test-owner',
    githubRepo: 'test-repo',
    githubBranch: 'master',
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

    it('synth command includes all four context flags', () => {
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
                      'npx cdk synth.*-c githubConnectionArn=.*-c githubOwner=tundeblockchain.*-c githubRepo=MMO-Infrastructure.*-c githubBranch=master'
                    ),
                  ]),
                }),
              }),
            })
          ),
        },
      });
    });
  });

  describe('githubBranch defaults to master for auto-build', () => {
    it('uses master branch when props specify master', () => {
      const stack = createTestStack({ githubBranch: 'master' });
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
        Stages: Match.arrayWith([
          Match.objectLike({
            Name: 'Source',
            Actions: Match.arrayWith([
              Match.objectLike({
                Configuration: Match.objectLike({
                  BranchName: 'master',
                }),
              }),
            ]),
          }),
        ]),
      });
    });

    it('source stage uses the provided branch name from props', () => {
      const stack = createTestStack({ githubBranch: 'main' });
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
});
