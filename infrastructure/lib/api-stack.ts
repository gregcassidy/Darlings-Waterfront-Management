import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { DatabaseTables } from './database-stack';

interface ApiStackProps extends cdk.StackProps {
  tables: DatabaseTables;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { tables } = props;

    const commonEnv = {
      CONCERTS_TABLE: tables.concerts.tableName,
      EMPLOYEES_TABLE: tables.employees.tableName,
      PREFERENCES_TABLE: tables.preferences.tableName,
      ASSIGNMENTS_TABLE: tables.assignments.tableName,
      SETTINGS_TABLE: tables.settings.tableName,
      AZURE_TENANT_ID: process.env.AZURE_TENANT_ID || '',
      AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID || '',
    };

    const lambdaRuntime = lambda.Runtime.NODEJS_22_X;
    const lambdaTimeout = cdk.Duration.seconds(30);
    const lambdaMemory = 256;

    // Authorizer
    const authorizer = new lambda.Function(this, 'Authorizer', {
      runtime: lambdaRuntime,
      timeout: lambdaTimeout,
      memorySize: lambdaMemory,
      code: lambda.Code.fromAsset('lambda/functions/auth'),
      handler: 'authorizer.handler',
      environment: commonEnv,
    });

    const lambdaAuthorizer = new apigateway.TokenAuthorizer(this, 'LambdaAuthorizer', {
      handler: authorizer,
      resultsCacheTtl: cdk.Duration.minutes(5),
    });

    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'DarlingsWaterfront-Api',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    const auth = { authorizer: lambdaAuthorizer };

    // Helper to create a Lambda + grant table access
    const createFn = (id: string, folder: string, tables: cdk.aws_dynamodb.ITable[]) => {
      const fn = new lambda.Function(this, id, {
        runtime: lambdaRuntime,
        timeout: lambdaTimeout,
        memorySize: lambdaMemory,
        code: lambda.Code.fromAsset(`lambda/functions/${folder}`),
        handler: 'index.handler',
        environment: commonEnv,
      });
      tables.forEach(t => t.grantReadWriteData(fn));
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      }));
      return fn;
    };

    // Lambda functions
    const concertsFn = createFn('Concerts', 'concerts', [props.tables.concerts, props.tables.settings]);
    const preferencesFn = createFn('Preferences', 'preferences', [props.tables.preferences, props.tables.employees, props.tables.settings]);
    const assignmentsFn = createFn('Assignments', 'assignments', [props.tables.assignments, props.tables.concerts, props.tables.employees]);
    const notificationsFn = createFn('Notifications', 'notifications', [props.tables.assignments, props.tables.employees, props.tables.concerts, props.tables.settings]);
    const settingsFn = createFn('Settings', 'settings', [props.tables.settings, props.tables.employees]);

    // API routes
    const concerts = this.api.root.addResource('concerts');
    concerts.addMethod('GET');
    concerts.addMethod('POST', new apigateway.LambdaIntegration(concertsFn), auth);
    concerts.addResource('sync').addMethod('POST', new apigateway.LambdaIntegration(concertsFn), auth);
    const concert = concerts.addResource('{id}');
    concert.addMethod('GET');
    concert.addMethod('PUT', new apigateway.LambdaIntegration(concertsFn), auth);
    concert.addMethod('DELETE', new apigateway.LambdaIntegration(concertsFn), auth);

    const preferences = this.api.root.addResource('preferences');
    preferences.addMethod('GET', new apigateway.LambdaIntegration(preferencesFn), auth);
    preferences.addMethod('POST', new apigateway.LambdaIntegration(preferencesFn), auth);
    preferences.addResource('me').addMethod('GET', new apigateway.LambdaIntegration(preferencesFn), auth);
    preferences.addResource('{userId}').addMethod('GET', new apigateway.LambdaIntegration(preferencesFn), auth);

    const assignments = this.api.root.addResource('assignments');
    assignments.addMethod('GET', new apigateway.LambdaIntegration(assignmentsFn), auth);
    assignments.addMethod('POST', new apigateway.LambdaIntegration(assignmentsFn), auth);
    assignments.addResource('me').addMethod('GET', new apigateway.LambdaIntegration(assignmentsFn), auth);
    assignments.addResource('concert').addResource('{id}').addMethod('GET', new apigateway.LambdaIntegration(assignmentsFn), auth);
    const assignment = assignments.addResource('{id}');
    assignment.addMethod('PUT', new apigateway.LambdaIntegration(assignmentsFn), auth);
    assignment.addMethod('DELETE', new apigateway.LambdaIntegration(assignmentsFn), auth);

    const notifications = this.api.root.addResource('notifications');
    notifications.addResource('winner').addMethod('POST', new apigateway.LambdaIntegration(notificationsFn), auth);
    notifications.addResource('announce').addMethod('POST', new apigateway.LambdaIntegration(notificationsFn), auth);

    const settings = this.api.root.addResource('settings');
    settings.addMethod('GET', new apigateway.LambdaIntegration(settingsFn), auth);
    settings.addResource('{key}').addMethod('PUT', new apigateway.LambdaIntegration(settingsFn), auth);
    settings.addResource('submissions').addResource('lock').addResource('{userId}').addMethod('PUT', new apigateway.LambdaIntegration(settingsFn), auth);
  }
}
