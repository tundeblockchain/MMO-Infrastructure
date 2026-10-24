import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DataStack } from './data-stack';
import { ApiStack } from './api-stack';

export interface MmoStageProps extends cdk.StageProps {
  readonly stageName: string;
}

/** CloudFormation stack name for a stage's Data or Api stack. Prod only is namespaced. */
export function cloudFormationStackName(
  stageName: string,
  kind: 'Data' | 'Api'
): string {
  if (stageName === 'prod') {
    return `mmo-prod-${kind}`;
  }
  return `${stageName}-${kind}`;
}

export class MmoStage extends cdk.Stage {
  public readonly dataStack: DataStack;
  public readonly apiStack: ApiStack;

  constructor(scope: Construct, id: string, props: MmoStageProps) {
    super(scope, id, props);

    const env = props.env;
    if (!env?.account || !env?.region) {
      throw new Error(
        `MmoStage "${id}" requires env.account and env.region so Data/Api ` +
          'Prepare/Deploy actions get a concrete CloudFormation StackName.'
      );
    }
    if (!props.stageName || props.stageName === 'undefined' || props.stageName === 'null') {
      throw new Error(`MmoStage "${id}" requires a non-empty stageName.`);
    }

    // Prod CloudFormation stack names are namespaced (`mmo-prod-*`) so a
    // leftover `prod-Data` (REVIEW_IN_PROGRESS) and its EarlyValidation
    // collision on `mmo-prod-game` can be sidestepped without replacing the
    // live `dev-Data` / `dev-Api` stacks. Physical resource names still use
    // `mmo-${stageName}-*` from DataStack / ApiStack.
    this.dataStack = new DataStack(this, 'Data', {
      env,
      stageName: props.stageName,
      stackName: cloudFormationStackName(props.stageName, 'Data'),
    });

    this.apiStack = new ApiStack(this, 'Api', {
      env,
      stageName: props.stageName,
      stackName: cloudFormationStackName(props.stageName, 'Api'),
      table: this.dataStack.table,
      firebaseSecret: this.dataStack.firebaseSecret,
      gameJwtSecret: this.dataStack.gameJwtSecret,
      internalSaveApiSecret: this.dataStack.internalSaveApiSecret,
    });

    this.apiStack.addDependency(this.dataStack);
  }
}
