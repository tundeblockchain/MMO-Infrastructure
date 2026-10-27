import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface DataStackProps extends cdk.StackProps {
  readonly stageName: string;
}

export class DataStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly usersTable: dynamodb.Table;
  public readonly firebaseSecret: secretsmanager.ISecret;
  public readonly gameJwtSecret: secretsmanager.ISecret;
  public readonly zoneTicketSecret: secretsmanager.ISecret;
  public readonly internalSaveApiSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const prefix = `mmo-${props.stageName}`;
    const tableRemovalPolicy =
      props.stageName === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY;
    const pointInTimeRecoveryEnabled = props.stageName === 'prod';

    this.table = new dynamodb.Table(this, 'GameTable', {
      tableName: `${prefix}-game`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: tableRemovalPolicy,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled,
      },
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: For querying game metadata catalogs by status (published/draft)
    // Used by versioned catalog system (MMO-4)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Users table (MMO-27): Firebase uid → accountType ('player' | 'admin').
    // Additive only — does not rename or replace the game table.
    this.usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: `${prefix}-users`,
      partitionKey: { name: 'uid', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: tableRemovalPolicy,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled,
      },
    });

    // Upload Firebase service account JSON to this secret after first deploy.
    this.firebaseSecret = new secretsmanager.Secret(this, 'FirebaseServiceAccount', {
      secretName: `${prefix}/firebase-service-account`,
      description: 'Firebase Admin SDK service account JSON (paste after deploy)',
    });

    this.gameJwtSecret = new secretsmanager.Secret(this, 'GameSessionJwtSecret', {
      secretName: `${prefix}/game-session-jwt`,
      description: 'HMAC secret for game session JWTs issued to ZoneServer handshakes',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'secret',
        excludePunctuation: true,
        passwordLength: 64,
      },
    });

    // HMAC-SHA256 key for short-lived ZoneServer tickets (MMO-50).
    // Generated at deploy time. Never commit the value; Lambdas and
    // ZoneServer read it from Secrets Manager at runtime.
    this.zoneTicketSecret = new secretsmanager.Secret(this, 'ZoneServerTicketSecret', {
      secretName: `${prefix}/zoneserver-ticket`,
      description:
        'HMAC-SHA256 key for short-lived ZoneServer tickets issued by auth-session',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'secret',
        excludePunctuation: true,
        passwordLength: 64,
      },
    });

    this.internalSaveApiSecret = new secretsmanager.Secret(this, 'InternalSaveApiKey', {
      secretName: `${prefix}/internal-save-api-key`,
      description: 'API key for ZoneServer -> PUT /characters/{id} saves',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'apiKey',
        excludePunctuation: true,
        passwordLength: 48,
      },
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      exportName: `${prefix}-table-name`,
    });

    new cdk.CfnOutput(this, 'UsersTableName', {
      value: this.usersTable.tableName,
      exportName: `${prefix}-users-table-name`,
    });

    new cdk.CfnOutput(this, 'GameJwtSecretArn', {
      value: this.gameJwtSecret.secretArn,
      exportName: `${prefix}-game-jwt-secret-arn`,
    });

    new cdk.CfnOutput(this, 'FirebaseSecretArn', {
      value: this.firebaseSecret.secretArn,
      exportName: `${prefix}-firebase-secret-arn`,
    });

    new cdk.CfnOutput(this, 'InternalSaveApiSecretArn', {
      value: this.internalSaveApiSecret.secretArn,
      exportName: `${prefix}-internal-save-api-secret-arn`,
    });

    new cdk.CfnOutput(this, 'ZoneServerTicketSecretName', {
      value: `${prefix}/zoneserver-ticket`,
      exportName: `${prefix}-zoneserver-ticket-secret-name`,
    });
  }
}
