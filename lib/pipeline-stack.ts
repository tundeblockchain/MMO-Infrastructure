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

    const account = props.env?.account ?? cdk.Stack.of(this).account;
    const region = props.env?.region ?? cdk.Stack.of(this).region;
    if (
      !account ||
      !region ||
      account === 'undefined' ||
      region === 'undefined' ||
      cdk.Token.isUnresolved(account) ||
      cdk.Token.isUnresolved(region)
    ) {
      throw new Error(
        'PipelineStack requires env.account and env.region. ' +
          'Pass -c account=ACCOUNT_ID -c region=eu-west-2 (or set CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION).'
      );
    }

    const repoString = `${props.githubOwner}/${props.githubRepo}`;

    const source = CodePipelineSource.connection(repoString, props.githubBranch, {
      connectionArn: props.githubConnectionArn,
    });

    // Pin account/region as -c flags. The CDK CLI overwrites CDK_DEFAULT_REGION
    // from the SDK (often us-east-1), which would otherwise synth application
    // stacks for the wrong env and leave CodePipeline Prepare actions with no
    // usable StackName ("Stack [null] does not exist").
    const synthContextArgs = [
      `-c githubConnectionArn=\${GITHUB_CONNECTION_ARN}`,
      `-c githubOwner=${props.githubOwner}`,
      `-c githubRepo=${props.githubRepo}`,
      `-c githubBranch=${props.githubBranch}`,
      `-c account=\${CDK_DEFAULT_ACCOUNT}`,
      `-c region=\${CDK_DEFAULT_REGION}`,
    ].join(' ');

    const synth = new ShellStep('Synth', {
      input: source,
      env: {
        GITHUB_CONNECTION_ARN: props.githubConnectionArn,
        CDK_DEFAULT_ACCOUNT: account,
        CDK_DEFAULT_REGION: region,
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
