#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CognitoStack } from '../lib/cognito-stack';
import { ApiGatewayStack } from '../lib/api-gateway-stack';
import { DynamoDBStack } from '../lib/dynamodb-stack';

const app = new cdk.App();

// Environment setup
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
};

// Get application name from context
const applicationName = app.node.tryGetContext('application_name');

// Create the three separate stacks as specified in requirement IF002
const dynamoDBStack = new DynamoDBStack(app, `${applicationName}-DynamoDB-Stack`, { env });
const cognitoStack = new CognitoStack(app, `${applicationName}-Cognito-Stack`, { env });
const apiGatewayStack = new ApiGatewayStack(app, `${applicationName}-ApiGateway-Stack`, {
  env,
  userPool: cognitoStack.userPool,
  eventsTable: dynamoDBStack.eventsTable
});

// Add dependencies between stacks
apiGatewayStack.addDependency(cognitoStack);
apiGatewayStack.addDependency(dynamoDBStack);

// Add tags to all stacks
const tags = {
  Application: applicationName,
  Environment: 'Dev',
  ManagedBy: 'CDK'
};

// Apply tags to all stacks
for (const stack of [dynamoDBStack, cognitoStack, apiGatewayStack]) {
  Object.entries(tags).forEach(([key, value]) => {
    cdk.Tags.of(stack).add(key, value);
  });
}