import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class DynamoDBStack extends cdk.Stack {
  public readonly eventsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Get application name from context
    const applicationName = this.node.tryGetContext('application_name');

    // Create the events table as specified in requirement IF003
    this.eventsTable = new dynamodb.Table(this, 'EventsTable', {
      tableName: `${applicationName}-events`,
      partitionKey: {
        name: 'UserId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'SortKey',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand capacity
      encryption: dynamodb.TableEncryption.DEFAULT, // Enable encryption
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Protect against accidental deletion
    });

    // Output the events table name
    new cdk.CfnOutput(this, 'EventsTableName', {
      value: this.eventsTable.tableName,
      description: 'The name of the events table',
      exportName: `${applicationName}-events-table-name`,
    });
  }
}