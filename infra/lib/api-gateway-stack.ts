import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';

export interface ApiGatewayStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  eventsTable: dynamodb.Table;
}

export class ApiGatewayStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiGatewayStackProps) {
    super(scope, id, props);

    // Get configuration from context
    const applicationName = this.node.tryGetContext('application_name');
    const domainName = this.node.tryGetContext('domain_name');
    const certificateArn = this.node.tryGetContext('certificate_arn');

    // Import the certificate
    const certificate = acm.Certificate.fromCertificateArn(
      this, 'Certificate', certificateArn
    );

    // Create the API Gateway
    this.api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: `${applicationName}-api`,
      description: 'API Gateway for the Urlist application',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: apigateway.Cors.DEFAULT_HEADERS.concat([
          'Authorization', 'Content-Type', 'X-Amz-Date', 'X-Api-Key'
        ])
      },
      domainName: {
        domainName: `api.${domainName}`,
        certificate,
        securityPolicy: apigateway.SecurityPolicy.TLS_1_2,
        endpointType: apigateway.EndpointType.EDGE
      }
    });

    // Create a Cognito User Pool authorizer for the API Gateway
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: `${applicationName}-user-pool-authorizer`,
      identitySource: 'method.request.header.Authorization'
    });

    // Create IAM role for API Gateway to access DynamoDB
    const apiGatewayRole = new iam.Role(this, 'ApiGatewayDynamoDBRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com')
    });

    // Grant the role permissions to access the DynamoDB table based on requirement IF006
    props.eventsTable.grantReadWriteData(apiGatewayRole);

    // Create a validator for request validation
    const validator = this.api.addRequestValidator('DefaultValidator', {
      validateRequestBody: true,
      validateRequestParameters: true
    });

    // Create a model for the event resource
    const eventModel = this.api.addModel('EventModel', {
      contentType: 'application/json',
      modelName: 'EventModel',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['title', 'description'],
        properties: {
          title: { type: apigateway.JsonSchemaType.STRING },
          description: { type: apigateway.JsonSchemaType.STRING },
          startDate: { type: apigateway.JsonSchemaType.STRING },
          endDate: { type: apigateway.JsonSchemaType.STRING },
          location: { type: apigateway.JsonSchemaType.STRING },
          participants: { 
            type: apigateway.JsonSchemaType.ARRAY,
            items: { type: apigateway.JsonSchemaType.STRING }
          }
        }
      }
    });

    // Create 'events' resource
    const eventsResource = this.api.root.addResource('events');

    // Add GET method for listing events (with Cognito authorization)
    eventsResource.addMethod('GET', 
      new apigateway.Integration({
        type: apigateway.IntegrationType.AWS,
        integrationHttpMethod: 'POST',
        uri: `arn:aws:apigateway:${this.region}:dynamodb:action/Scan`,
        options: {
          credentialsRole: apiGatewayRole,
          requestTemplates: {
            'application/json': JSON.stringify({
              TableName: props.eventsTable.tableName,
              FilterExpression: "UserId = :userId",
              ExpressionAttributeValues: {
                ":userId": { "S": "$context.authorizer.claims.sub" }
              }
            })
          },
          integrationResponses: [
            {
              statusCode: '200',
              responseTemplates: {
                'application/json': `
                #set($inputRoot = $input.path('$'))
                {
                  "events": [
                    #foreach($item in $inputRoot.Items)
                    {
                      "userId": "$item.UserId.S",
                      "sortKey": "$item.SortKey.S",
                      #foreach($key in $item.keySet())
                        #if($key != "UserId" && $key != "SortKey")
                          "$key": 
                          #if($item.get($key).S)
                            "$item.get($key).S"
                          #elseif($item.get($key).N)
                            $item.get($key).N
                          #elseif($item.get($key).BOOL)
                            $item.get($key).BOOL
                          #elseif($item.get($key).L)
                            $util.escapeJavaScript($item.get($key).L)
                          #else
                            "$item.get($key)"
                          #end
                          #if($foreach.hasNext),#end
                        #end
                      #end
                    }#if($foreach.hasNext),#end
                    #end
                  ]
                }
                `
              }
            }
          ]
        }
      }),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO
      }
    );

    // Add POST method for creating events
    eventsResource.addMethod('POST',
      new apigateway.Integration({
        type: apigateway.IntegrationType.AWS,
        integrationHttpMethod: 'POST',
        uri: `arn:aws:apigateway:${this.region}:dynamodb:action/PutItem`,
        options: {
          credentialsRole: apiGatewayRole,
          requestTemplates: {
            'application/json': `
              #set($inputRoot = $input.path('$'))
              {
                "TableName": "${props.eventsTable.tableName}",
                "Item": {
                  "UserId": { "S": "$context.authorizer.claims.sub" },
                  "SortKey": { "S": "EVENT#$util.autoId()" },
                  "Title": { "S": "$inputRoot.title" },
                  "Description": { "S": "$inputRoot.description" },
                  #if($inputRoot.startDate) "StartDate": { "S": "$inputRoot.startDate" }, #end
                  #if($inputRoot.endDate) "EndDate": { "S": "$inputRoot.endDate" }, #end
                  #if($inputRoot.location) "Location": { "S": "$inputRoot.location" } #end
                  #if($inputRoot.participants)
                    ,"Participants": {
                      "L": [
                        #foreach($participant in $inputRoot.participants)
                          { "S": "$participant" }#if($foreach.hasNext),#end
                        #end
                      ]
                    }
                  #end
                }
              }
            `
          },
          integrationResponses: [
            {
              statusCode: '201',
              responseTemplates: {
                'application/json': `
                {
                  "message": "Event created successfully",
                  "eventId": "$input.path('$')"
                }
                `
              }
            }
          ]
        }
      }),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator: validator,
        requestModels: {
          'application/json': eventModel
        }
      }
    );

    // Add individual event resource
    const eventResource = eventsResource.addResource('{eventId}');

    // Add GET method for retrieving a specific event
    eventResource.addMethod('GET',
      new apigateway.Integration({
        type: apigateway.IntegrationType.AWS,
        integrationHttpMethod: 'POST',
        uri: `arn:aws:apigateway:${this.region}:dynamodb:action/GetItem`,
        options: {
          credentialsRole: apiGatewayRole,
          requestTemplates: {
            'application/json': `
              {
                "TableName": "${props.eventsTable.tableName}",
                "Key": {
                  "UserId": { "S": "$context.authorizer.claims.sub" },
                  "SortKey": { "S": "$method.request.path.eventId" }
                }
              }
            `
          },
          integrationResponses: [
            {
              statusCode: '200',
              responseTemplates: {
                'application/json': `
                #set($inputRoot = $input.path('$'))
                #if($inputRoot.Item)
                {
                  "userId": "$inputRoot.Item.UserId.S",
                  "sortKey": "$inputRoot.Item.SortKey.S",
                  #foreach($key in $inputRoot.Item.keySet())
                    #if($key != "UserId" && $key != "SortKey")
                      "$key": 
                      #if($inputRoot.Item.get($key).S)
                        "$inputRoot.Item.get($key).S"
                      #elseif($inputRoot.Item.get($key).N)
                        $inputRoot.Item.get($key).N
                      #elseif($inputRoot.Item.get($key).BOOL)
                        $inputRoot.Item.get($key).BOOL
                      #elseif($inputRoot.Item.get($key).L)
                        $util.escapeJavaScript($inputRoot.Item.get($key).L)
                      #else
                        "$inputRoot.Item.get($key)"
                      #end
                      #if($foreach.hasNext),#end
                    #end
                  #end
                }
                #else
                {
                  "message": "Event not found"
                }
                #end
                `
              }
            }
          ]
        }
      }),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.path.eventId': true
        }
      }
    );

    // Add PUT method for updating an event
    eventResource.addMethod('PUT',
      new apigateway.Integration({
        type: apigateway.IntegrationType.AWS,
        integrationHttpMethod: 'POST',
        uri: `arn:aws:apigateway:${this.region}:dynamodb:action/UpdateItem`,
        options: {
          credentialsRole: apiGatewayRole,
          requestTemplates: {
            'application/json': `
              #set($inputRoot = $input.path('$'))
              {
                "TableName": "${props.eventsTable.tableName}",
                "Key": {
                  "UserId": { "S": "$context.authorizer.claims.sub" },
                  "SortKey": { "S": "$method.request.path.eventId" }
                },
                "UpdateExpression": "SET 
                  #Title = :title, 
                  #Description = :description
                  #if($inputRoot.startDate), #StartDate = :startDate #end
                  #if($inputRoot.endDate), #EndDate = :endDate #end
                  #if($inputRoot.location), #Location = :location #end
                  #if($inputRoot.participants), #Participants = :participants #end
                ",
                "ExpressionAttributeNames": {
                  "#Title": "Title",
                  "#Description": "Description"
                  #if($inputRoot.startDate), "#StartDate": "StartDate" #end
                  #if($inputRoot.endDate), "#EndDate": "EndDate" #end
                  #if($inputRoot.location), "#Location": "Location" #end
                  #if($inputRoot.participants), "#Participants": "Participants" #end
                },
                "ExpressionAttributeValues": {
                  ":title": { "S": "$inputRoot.title" },
                  ":description": { "S": "$inputRoot.description" }
                  #if($inputRoot.startDate), ":startDate": { "S": "$inputRoot.startDate" } #end
                  #if($inputRoot.endDate), ":endDate": { "S": "$inputRoot.endDate" } #end
                  #if($inputRoot.location), ":location": { "S": "$inputRoot.location" } #end
                  #if($inputRoot.participants)
                    , ":participants": {
                      "L": [
                        #foreach($participant in $inputRoot.participants)
                          { "S": "$participant" }#if($foreach.hasNext),#end
                        #end
                      ]
                    }
                  #end
                },
                "ConditionExpression": "attribute_exists(UserId) AND attribute_exists(SortKey)",
                "ReturnValues": "ALL_NEW"
              }
            `
          },
          integrationResponses: [
            {
              statusCode: '200',
              responseTemplates: {
                'application/json': `
                #set($inputRoot = $input.path('$'))
                {
                  "message": "Event updated successfully",
                  "event": {
                    "userId": "$inputRoot.Attributes.UserId.S",
                    "sortKey": "$inputRoot.Attributes.SortKey.S",
                    #foreach($key in $inputRoot.Attributes.keySet())
                      #if($key != "UserId" && $key != "SortKey")
                        "$key": 
                        #if($inputRoot.Attributes.get($key).S)
                          "$inputRoot.Attributes.get($key).S"
                        #elseif($inputRoot.Attributes.get($key).N)
                          $inputRoot.Attributes.get($key).N
                        #elseif($inputRoot.Attributes.get($key).BOOL)
                          $inputRoot.Attributes.get($key).BOOL
                        #elseif($inputRoot.Attributes.get($key).L)
                          $util.escapeJavaScript($inputRoot.Attributes.get($key).L)
                        #else
                          "$inputRoot.Attributes.get($key)"
                        #end
                        #if($foreach.hasNext),#end
                      #end
                    #end
                  }
                }
                `
              }
            },
            {
              selectionPattern: '.*ConditionalCheckFailedException.*',
              statusCode: '404',
              responseTemplates: {
                'application/json': JSON.stringify({ message: 'Event not found or you do not have permission to update it' })
              }
            }
          ]
        }
      }),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator: validator,
        requestModels: {
          'application/json': eventModel
        },
        requestParameters: {
          'method.request.path.eventId': true
        }
      }
    );

    // Add DELETE method for removing an event
    eventResource.addMethod('DELETE',
      new apigateway.Integration({
        type: apigateway.IntegrationType.AWS,
        integrationHttpMethod: 'POST',
        uri: `arn:aws:apigateway:${this.region}:dynamodb:action/DeleteItem`,
        options: {
          credentialsRole: apiGatewayRole,
          requestTemplates: {
            'application/json': `
              {
                "TableName": "${props.eventsTable.tableName}",
                "Key": {
                  "UserId": { "S": "$context.authorizer.claims.sub" },
                  "SortKey": { "S": "$method.request.path.eventId" }
                },
                "ConditionExpression": "attribute_exists(UserId) AND attribute_exists(SortKey)"
              }
            `
          },
          integrationResponses: [
            {
              statusCode: '200',
              responseTemplates: {
                'application/json': JSON.stringify({ message: 'Event deleted successfully' })
              }
            },
            {
              selectionPattern: '.*ConditionalCheckFailedException.*',
              statusCode: '404',
              responseTemplates: {
                'application/json': JSON.stringify({ message: 'Event not found or you do not have permission to delete it' })
              }
            }
          ]
        }
      }),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.path.eventId': true
        }
      }
    );

    // Output the API Gateway URL
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.api.url,
      description: 'The URL of the API Gateway',
      exportName: `${applicationName}-api-url`
    });

    // Output the custom domain URL
    new cdk.CfnOutput(this, 'ApiCustomDomainUrl', {
      value: `https://api.${domainName}`,
      description: 'The custom domain URL of the API',
      exportName: `${applicationName}-api-domain-url`
    });
  }
}