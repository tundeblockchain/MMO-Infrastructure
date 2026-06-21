#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();

const githubConnectionArn = app.node.tryGetContext('githubConnectionArn') as string | undefined;
const githubOwner = app.node.tryGetContext('githubOwner') as string | undefined;
const githubRepo = app.node.tryGetContext('githubRepo') as string | undefined;
const githubBranch = (app.node.tryGetContext('githubBranch') as string | undefined) ?? 'develop';

if (!githubConnectionArn) {
  throw new Error(
    'Missing context "githubConnectionArn". ' +
      'Create a CodeStar connection in AWS Console, then deploy with:\n' +
      '  cdk deploy PipelineStack -c githubConnectionArn=arn:aws:codestar-connections:... ' +
      '-c githubOwner=YOUR_ORG -c githubRepo=MMO-Infrastructure'
  );
}

if (!githubOwner || !githubRepo) {
  throw new Error(
    'Missing context "githubOwner" and/or "githubRepo". ' +
      'Pass -c githubOwner=YOUR_ORG -c githubRepo=MMO-Infrastructure'
  );
}

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? 'eu-west-2';

if (!account) {
  throw new Error('CDK_DEFAULT_ACCOUNT is not set. Run `aws sts get-caller-identity` and export credentials.');
}

new PipelineStack(app, 'PipelineStack', {
  env: { account, region },
  githubConnectionArn,
  githubOwner,
  githubRepo,
  githubBranch,
});

app.synth();
