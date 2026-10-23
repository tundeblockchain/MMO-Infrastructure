#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack';
import { resolvePipelineContext } from '../lib/pipeline-context';

const app = new cdk.App();
const ctx = resolvePipelineContext(app);

new PipelineStack(app, 'PipelineStack', {
  env: { account: ctx.account, region: ctx.region },
  githubConnectionArn: ctx.githubConnectionArn,
  githubOwner: ctx.githubOwner,
  githubRepo: ctx.githubRepo,
  githubBranch: ctx.githubBranch,
});

app.synth();
