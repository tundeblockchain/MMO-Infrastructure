import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DataStack } from './data-stack';
import { ApiStack } from './api-stack';
import { resolveStageAdminEmailAllowlist } from './pipeline-context';

export interface MmoStageProps extends cdk.StageProps {
  readonly stageName: string;
  /** Comma-separated verified emails that POST /users/me may promote. Empty = nobody. */
  readonly adminEmailAllowlist?: string;
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

    // Prod CloudFormation stack names are namespaced (`mmo-prod-*`) so the
    // pipeline targets a new stack instead of the stuck `prod-Data`
    // (REVIEW_IN_PROGRESS), without replacing live `dev-Data` / `dev-Api`.
    // The ResourceExistenceCheck collision is the leftover `mmo-prod-game`
    // table; renaming the stack alone does not fix it. That RETAIN'd table
    // must be deleted before mmo-prod-Data is prepared, or the same check
    // fails. Physical names still use `mmo-${stageName}-*` from DataStack
    // / ApiStack (no table or secret renames).
    this.dataStack = new DataStack(this, 'Data', {
      env,
      stageName: props.stageName,
      stackName: cloudFormationStackName(props.stageName, 'Data'),
    });

    const adminEmailAllowlist =
      props.adminEmailAllowlist !== undefined
        ? props.adminEmailAllowlist
        : resolveStageAdminEmailAllowlist(this, props.stageName);

    this.apiStack = new ApiStack(this, 'Api', {
      env,
      stageName: props.stageName,
      stackName: cloudFormationStackName(props.stageName, 'Api'),
      table: this.dataStack.table,
      usersTable: this.dataStack.usersTable,
      firebaseSecret: this.dataStack.firebaseSecret,
      gameJwtSecret: this.dataStack.gameJwtSecret,
      zoneTicketSecret: this.dataStack.zoneTicketSecret,
      internalSaveApiSecret: this.dataStack.internalSaveApiSecret,
      adminEmailAllowlist,
    });

    this.apiStack.addDependency(this.dataStack);
  }
}
