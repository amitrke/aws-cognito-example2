# AWS Cognito Example Project

## Project Overview
This project demonstrates a serverless web application architecture using:
- **Frontend**: React web application with Google Sign-in
- **Backend**: AWS services including API Gateway, Cognito, and DynamoDB
- **Infrastructure**: AWS CDK for infrastructure as code (Node.js)

## Project Structure
```
aws-cognito-example2/
├── .github/               # GitHub-related files
├── webapp/                # React frontend application
│   ├── public/            # Static files
│   ├── src/               # React source code
│   │   ├── components/    # React components
│   │   ├── pages/         # App pages/routes
│   │   ├── services/      # API services
│   │   ├── auth/          # Authentication utilities
│   │   └── App.js         # Main application component
├── infra/                 # AWS CDK infrastructure code
│   ├── lib/               # CDK stack definitions
│   │   ├── cognito-stack.js       # Cognito user pool configuration
│   │   ├── api-gateway-stack.js   # API Gateway resources
│   │   └── dynamodb-stack.js      # DynamoDB tables
│   ├── bin/               # CDK application entry point
│   └── cdk.json           # CDK configuration
└── README.md              # Project documentation
```

## Development Guidelines

### Frontend (webapp/)
- Built with React
- Implement Google Sign-in integration with AWS Cognito
- Use environment variables for configuration
- Structure API calls through service classes

#### Authentication Flow
1. User signs in with Google
2. Exchange Google token with AWS Cognito token
3. Use Cognito token for all API Gateway requests

### Infrastructure (infra/)
- Use AWS CDK (Node.js) for all infrastructure provisioning
- Define all resources in separate stacks for modularity

#### Cognito Configuration
- Set up Cognito User Pool with Google as an identity provider
- Configure app client settings for frontend integration
- Set up appropriate OAuth scopes and callback URLs

#### API Gateway Configuration
- Use Cognito User Pools Authorizer for endpoint protection
- Define REST API resources and methods
- Enable CORS for web application access
- Connect directly to DynamoDB without Lambda for simple CRUD operations

#### DynamoDB Configuration
- Define appropriate table structure with primary/sort keys
- Set up GSIs (Global Secondary Indexes) as needed
- Configure auto-scaling for production readiness

## Key Implementation Notes

### Direct API Gateway to DynamoDB Integration
- Use API Gateway's direct integration with DynamoDB for simple operations
- This avoids Lambda for basic CRUD, improving performance and reducing cost
- Use mapping templates to transform request/response data

### Security Best Practices
- Scope down IAM permissions to least privilege
- Validate all input at API Gateway level
- Use environment-specific settings for dev/test/prod
- Implement proper token handling in frontend

### Google Authentication Setup
1. Create a project in Google Cloud Console
2. Configure OAuth consent screen
3. Create OAuth 2.0 Client IDs
4. Add authorized JavaScript origins and redirect URIs
5. Configure Cognito to use Google as an identity provider