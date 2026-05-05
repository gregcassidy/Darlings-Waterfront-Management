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
      GUESTS_TABLE: tables.jaysGuests.tableName,
      // Azure AD credentials — baked in as defaults so `cdk deploy` without env vars
      // doesn't wipe them. Override with process.env if rotating.
      AZURE_TENANT_ID: process.env.AZURE_TENANT_ID || '0c92f65f-782b-462f-987e-bfcba4656cb2',
      AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID || '711c8df8-546e-462c-afd3-4392c792a3cb',
      ADMIN_USER_IDS: process.env.ADMIN_USER_IDS || '',
      ADMIN_EMAILS: process.env.ADMIN_EMAILS || 'jay.darling@darlings.com,lorilei.porter@darlings.com',
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

    const createFn = (id: string, folder: string, grantedTables: cdk.aws_dynamodb.ITable[]) => {
      const fn = new lambda.Function(this, id, {
        runtime: lambdaRuntime,
        timeout: lambdaTimeout,
        memorySize: lambdaMemory,
        code: lambda.Code.fromAsset(`lambda/functions/${folder}`),
        handler: 'index.handler',
        environment: commonEnv,
      });
      grantedTables.forEach(t => t.grantReadWriteData(fn));
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      }));
      return fn;
    };

    // Lambda functions
    const concertsFn = createFn('Concerts', 'concerts', [tables.concerts, tables.settings, tables.preferences, tables.assignments]);
    const preferencesFn = createFn('Preferences', 'preferences', [tables.preferences, tables.employees, tables.settings, tables.concerts, tables.assignments]);
    const assignmentsFn = createFn('Assignments', 'assignments', [tables.assignments, tables.concerts, tables.employees, tables.preferences]);
    const notificationsFn = createFn('Notifications', 'notifications', [tables.assignments, tables.employees, tables.concerts, tables.settings]);
    const settingsFn = createFn('Settings', 'settings', [tables.settings, tables.employees]);
    const guestsFn = createFn('Guests', 'guests', [tables.jaysGuests]);

    // /concerts routes
    const concerts = this.api.root.addResource('concerts');
    concerts.addMethod('GET', new apigateway.LambdaIntegration(concertsFn));
    concerts.addMethod('POST', new apigateway.LambdaIntegration(concertsFn), auth);
    concerts.addResource('sync').addMethod('POST', new apigateway.LambdaIntegration(concertsFn), auth);
    concerts.addResource('seed').addMethod('POST', new apigateway.LambdaIntegration(concertsFn), auth);
    const concert = concerts.addResource('{id}');
    concert.addMethod('GET', new apigateway.LambdaIntegration(concertsFn), auth);
    concert.addMethod('PUT', new apigateway.LambdaIntegration(concertsFn), auth);
    concert.addMethod('DELETE', new apigateway.LambdaIntegration(concertsFn), auth);
    concert.addResource('cancel').addMethod('POST', new apigateway.LambdaIntegration(concertsFn), auth);
    concert.addResource('uncancel').addMethod('POST', new apigateway.LambdaIntegration(concertsFn), auth);

    // /public routes (no authorizer — for external one-time submitters)
    const publicRoot = this.api.root.addResource('public');
    publicRoot.addResource('preferences').addMethod('POST', new apigateway.LambdaIntegration(preferencesFn));

    // /preferences routes
    const preferences = this.api.root.addResource('preferences');
    preferences.addMethod('GET', new apigateway.LambdaIntegration(preferencesFn), auth);
    preferences.addMethod('POST', new apigateway.LambdaIntegration(preferencesFn), auth);
    preferences.addResource('me').addMethod('GET', new apigateway.LambdaIntegration(preferencesFn), auth);
    preferences.addResource('{userId}').addMethod('GET', new apigateway.LambdaIntegration(preferencesFn), auth);

    // /assignments routes
    const assignments = this.api.root.addResource('assignments');
    assignments.addMethod('GET', new apigateway.LambdaIntegration(assignmentsFn), auth);
    assignments.addMethod('POST', new apigateway.LambdaIntegration(assignmentsFn), auth);
    assignments.addResource('me').addMethod('GET', new apigateway.LambdaIntegration(assignmentsFn), auth);
    assignments.addResource('concert').addResource('{id}').addMethod('GET', new apigateway.LambdaIntegration(assignmentsFn), auth);
    const assignment = assignments.addResource('{id}');
    assignment.addMethod('PUT', new apigateway.LambdaIntegration(assignmentsFn), auth);
    assignment.addMethod('DELETE', new apigateway.LambdaIntegration(assignmentsFn), auth);

    // /notifications routes
    const notifications = this.api.root.addResource('notifications');
    notifications.addResource('winner').addMethod('POST', new apigateway.LambdaIntegration(notificationsFn), auth);
    notifications.addResource('announce').addMethod('POST', new apigateway.LambdaIntegration(notificationsFn), auth);

    // /settings routes
    const settings = this.api.root.addResource('settings');
    settings.addMethod('GET', new apigateway.LambdaIntegration(settingsFn), auth);
    settings.addResource('{key}').addMethod('PUT', new apigateway.LambdaIntegration(settingsFn), auth);

    // /employees routes
    const employees = this.api.root.addResource('employees');
    employees.addMethod('GET', new apigateway.LambdaIntegration(preferencesFn), auth);
    const employeeMe = employees.addResource('me');
    employeeMe.addMethod('GET', new apigateway.LambdaIntegration(preferencesFn), auth);
    employeeMe.addMethod('PUT', new apigateway.LambdaIntegration(preferencesFn), auth);
    employees.addResource('{userId}').addMethod('PUT', new apigateway.LambdaIntegration(preferencesFn), auth);

    // /admin routes (admin-only views that span tables)
    const adminRoot = this.api.root.addResource('admin');
    adminRoot.addResource('all-submissions').addMethod('GET', new apigateway.LambdaIntegration(preferencesFn), auth);

    // /guests routes (admin only — Jay's external contacts)
    const guests = this.api.root.addResource('guests');
    guests.addMethod('GET', new apigateway.LambdaIntegration(guestsFn), auth);
    guests.addMethod('POST', new apigateway.LambdaIntegration(guestsFn), auth);
    const guest = guests.addResource('{id}');
    guest.addMethod('PUT', new apigateway.LambdaIntegration(guestsFn), auth);
    guest.addMethod('DELETE', new apigateway.LambdaIntegration(guestsFn), auth);
  }
}
