import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DataStack } from './data-stack';
import { ApiStack } from './api-stack';

export interface MmoStageProps extends cdk.StageProps {
  readonly stageName: string;
}

export class MmoStage extends cdk.Stage {
  public readonly dataStack: DataStack;
  public readonly apiStack: ApiStack;

  constructor(scope: Construct, id: string, props: MmoStageProps) {
    super(scope, id, props);

    this.dataStack = new DataStack(this, 'Data', {
      stageName: props.stageName,
    });

    this.apiStack = new ApiStack(this, 'Api', {
      stageName: props.stageName,
      table: this.dataStack.table,
      firebaseSecret: this.dataStack.firebaseSecret,
      gameJwtSecret: this.dataStack.gameJwtSecret,
      internalSaveApiSecret: this.dataStack.internalSaveApiSecret,
    });

    this.apiStack.addDependency(this.dataStack);
  }
}
