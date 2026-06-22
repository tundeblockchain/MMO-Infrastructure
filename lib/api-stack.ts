import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ApiStackProps extends cdk.StackProps {
  readonly stageName: string;
  readonly table: dynamodb.ITable;
  readonly firebaseSecret: secretsmanager.ISecret;
  readonly gameJwtSecret: secretsmanager.ISecret;
  readonly internalSaveApiSecret: secretsmanager.ISecret;
}

export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const prefix = `mmo-${props.stageName}`;
    const lambdasDir = path.join(__dirname, '..', 'lambdas');

    const commonEnv = {
      STAGE_NAME: props.stageName,
      TABLE_NAME: props.table.tableName,
      FIREBASE_SECRET_ARN: props.firebaseSecret.secretArn,
      GAME_JWT_SECRET_ARN: props.gameJwtSecret.secretArn,
      GAME_JWT_TTL_SECONDS: '86400',
      DEFAULT_ZONE_HOST: '127.0.0.1',
      DEFAULT_ZONE_PORT: '9050',
    };

    const lambdaDefaults: Partial<lambdaNodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node24',
        externalModules: [],
      },
      environment: commonEnv,
    };

    const createLambda = (
      id: string,
      props: Pick<lambdaNodejs.NodejsFunctionProps, 'functionName' | 'entry' | 'description'>
    ) => {
      const logGroup = new logs.LogGroup(this, `${id}Logs`, {
        retention: logs.RetentionDays.ONE_MONTH,
      });
      return new lambdaNodejs.NodejsFunction(this, id, {
        ...lambdaDefaults,
        logGroup,
        handler: 'handler',
        ...props,
      });
    };

    const authSessionFn = createLambda('AuthSessionFn', {
      functionName: `${prefix}-auth-session`,
      entry: path.join(lambdasDir, 'auth-session', 'handler.ts'),
      description: 'Verify Firebase ID token and issue game session JWT',
    });

    const charactersFn = createLambda('CharactersFn', {
      functionName: `${prefix}-characters`,
      entry: path.join(lambdasDir, 'characters', 'handler.ts'),
      description: 'List/create characters and enter world',
    });

    const charactersSaveFn = createLambda('CharactersSaveFn', {
      functionName: `${prefix}-characters-save`,
      entry: path.join(lambdasDir, 'characters-save', 'handler.ts'),
      description: 'Save character snapshot (ZoneServer or internal)',
    });

    const lambdaFunctions = [authSessionFn, charactersFn, charactersSaveFn];

    for (const fn of lambdaFunctions) {
      props.table.grantReadWriteData(fn);
      props.firebaseSecret.grantRead(fn);
      props.gameJwtSecret.grantRead(fn);
    }

    props.internalSaveApiSecret.grantRead(charactersSaveFn);
    charactersSaveFn.addEnvironment(
      'INTERNAL_SAVE_API_KEY',
      props.internalSaveApiSecret.secretValueFromJson('apiKey').unsafeUnwrap()
    );

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `${prefix}-api`,
      description: `MMO character API (${props.stageName})`,
      corsPreflight: {
        allowHeaders: ['Authorization', 'Content-Type', 'X-Internal-Api-Key'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ['*'],
        maxAge: cdk.Duration.days(1),
      },
    });

    const authIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      'AuthSessionIntegration',
      authSessionFn
    );
    const charactersIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      'CharactersIntegration',
      charactersFn
    );
    const saveIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      'CharactersSaveIntegration',
      charactersSaveFn
    );

    this.httpApi.addRoutes({
      path: '/auth/session',
      methods: [apigwv2.HttpMethod.POST],
      integration: authIntegration,
    });

    this.httpApi.addRoutes({
      path: '/characters',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: charactersIntegration,
    });

    this.httpApi.addRoutes({
      path: '/characters/{characterId}/enter',
      methods: [apigwv2.HttpMethod.POST],
      integration: charactersIntegration,
    });

    this.httpApi.addRoutes({
      path: '/characters/{characterId}',
      methods: [apigwv2.HttpMethod.PUT],
      integration: saveIntegration,
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.httpApi.apiEndpoint,
      exportName: `${prefix}-api-url`,
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.httpApi.apiId,
      exportName: `${prefix}-api-id`,
    });
  }
}
