import * as cdk from 'aws-cdk-lib';
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

    const synth = new ShellStep('Synth', {
      input: source,
      commands: [
        'node --version',
        'npm ci',
        'npm run build',
        'npx cdk synth',
      ],
      primaryOutputDirectory: 'cdk.out',
    });

    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: 'MmoInfrastructure',
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
  }
}
