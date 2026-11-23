# **Project Requirements Document: The Urlist Website**

The following table outlines the detailed functional requirements of The Urlist website.

| Requirement ID | Description               | User Story                                                                                       | Expected Behavior/Outcome                                                                                                     |
|-----------------|---------------------------|--------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| FR001          | Homepage   | As a user, I should be able to login from the homepage.              | The system should provide a clear way for the user to login using Google. |
| IF001          | Infrastructure Init   | As a developer, I should set up AWS CDK project in the infra folder.              | The CDK project should use Typescript. |
| IF002          | Infrastructure Stacks Init   | As a developer, I should set up the infra project with three separate stacks (Cognito user pool, API Gateway, DynamoDB).              | CDK configuration file should have placeholders for domain_name, cognito_google_client_id, cognito_google_client_secret, certificate_arn, application_name. |
| IF003          | DynamoDB tables   | As a developer, I should create dynamodb table for events.              | table name should have the prefix application_name, UserId hash key to store the cognito userid and a string SortKey. |
| IF004          | Cognito User Pool   | As a developer, I should create a cognito identity provider and user pool.              | The user pool should have a domain name and a client id and secret for Google login. |
| IF005          | API Gateway   | As a developer, I should create an API Gateway.              | The API Gateway should have a domain name and for authentication should be connected to Cognito. |
| IF006          | API Gateway Event Resource   | As a developer, I should create an event path which would support GET, PUT, POST and DELETE operations.              | The API Gateway should perform those operations with the DynamoDB events table, for update and delete requests it should only allow if the DB UserID hashkey matches the Congito Request User ID. |
