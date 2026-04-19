import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface DatabaseTables {
  concerts: dynamodb.Table;
  employees: dynamodb.Table;
  preferences: dynamodb.Table;
  assignments: dynamodb.Table;
  settings: dynamodb.Table;
  jaysGuests: dynamodb.Table;
}

export class DatabaseStack extends cdk.Stack {
  public readonly tables: DatabaseTables;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const concerts = new dynamodb.Table(this, 'Concerts', {
      tableName: 'WF-Concerts',
      partitionKey: { name: 'concertId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    concerts.addGlobalSecondaryIndex({
      indexName: 'season-date-index',
      partitionKey: { name: 'season', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
    });

    const employees = new dynamodb.Table(this, 'Employees', {
      tableName: 'WF-Employees',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const preferences = new dynamodb.Table(this, 'Preferences', {
      tableName: 'WF-Preferences',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'season', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    preferences.addGlobalSecondaryIndex({
      indexName: 'season-index',
      partitionKey: { name: 'season', type: dynamodb.AttributeType.STRING },
    });

    const assignments = new dynamodb.Table(this, 'Assignments', {
      tableName: 'WF-Assignments',
      partitionKey: { name: 'assignmentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    assignments.addGlobalSecondaryIndex({
      indexName: 'concertId-index',
      partitionKey: { name: 'concertId', type: dynamodb.AttributeType.STRING },
    });
    assignments.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    });

    const settings = new dynamodb.Table(this, 'Settings', {
      tableName: 'WF-Settings',
      partitionKey: { name: 'settingKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const jaysGuests = new dynamodb.Table(this, 'JaysGuests', {
      tableName: 'WF-JaysGuests',
      partitionKey: { name: 'guestId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.tables = { concerts, employees, preferences, assignments, settings, jaysGuests };
  }
}
