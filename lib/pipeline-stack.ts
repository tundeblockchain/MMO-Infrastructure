import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { pipelines } from 'aws-cdk-lib';
import { CodePipelineSource, ManualApprovalStep, ShellStep } from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { MmoStage } from './mmo-stage';

export interface PipelineStackProps extends cdk.StackProps {
  readonly githubConnectionArn: string;
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly githubBranch: string;
}

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const repoString = `${props.githubOwner}/${props.githubRepo}`;

    const source = CodePipelineSource.connection(repoString, props.githubBranch, {
      connectionArn: props.githubConnectionArn,
    });

    const synthContextArgs = [
      `-c githubConnectionArn=\${GITHUB_CONNECTION_ARN}`,
      `-c githubOwner=${props.githubOwner}`,
      `-c githubRepo=${props.githubRepo}`,
      `-c githubBranch=${props.githubBranch}`,
    ].join(' ');

    const synth = new ShellStep('Synth', {
      input: source,
      env: {
        GITHUB_CONNECTION_ARN: props.githubConnectionArn,
      },
      commands: [
        'node --version',
        'npm ci',
        'npm run build',
        `npx cdk synth ${synthContextArgs}`,
      ],
      primaryOutputDirectory: 'cdk.out',
    });

    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: 'MmoInfrastructure',
      pipelineType: cdk.aws_codepipeline.PipelineType.V2,
      crossAccountKeys: false,
      synth,
      selfMutation: true,
      codeBuildDefaults: {
        buildEnvironment: {
          buildImage: cdk.aws_codebuild.LinuxBuildImage.STANDARD_7_0,
          computeType: cdk.aws_codebuild.ComputeType.SMALL,
        },
        partialBuildSpec: cdk.aws_codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            install: {
              'runtime-versions': {
                nodejs: '22',
              },
            },
          },
        }),
      },
    });

    const devStage = new MmoStage(this, 'Dev', {
      env: props.env,
      stageName: 'dev',
    });

    pipeline.addStage(devStage);

    const prodStage = new MmoStage(this, 'Prod', {
      env: props.env,
      stageName: 'prod',
    });

    pipeline.addStage(prodStage, {
      pre: [new ManualApprovalStep('PromoteToProd')],
    });

    pipeline.buildPipeline();

    this.grantCodeBuildStartBuildToActionRoles(pipeline);
  }

  private grantCodeBuildStartBuildToActionRoles(pipeline: pipelines.CodePipeline): void {
    const underlyingPipeline = pipeline.pipeline;

    for (const stage of underlyingPipeline.stages) {
      for (const action of stage.actions) {
        const actionConfig = action.actionProperties;
        const actionRole = actionConfig.role;

        if (actionRole && actionConfig.provider === 'CodeBuild') {
          const actionName = actionConfig.actionName;
          const projectArn = `arn:aws:codebuild:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:project/*`;

          actionRole.addToPrincipalPolicy(
            new iam.PolicyStatement({
              sid: `CodeBuildStartBuild${actionName.replace(/[^a-zA-Z0-9]/g, '')}`,
              actions: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
              resources: [projectArn],
            })
          );
        }
      }
    }
  }
}
