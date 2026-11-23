import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export class CognitoStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Get non-sensitive configuration from context
    const applicationName = this.node.tryGetContext('application_name') || process.env.APPLICATION_NAME;
    const domainName = this.node.tryGetContext('domain_name') || process.env.DOMAIN_NAME;
    
    // Get sensitive configuration from SSM Parameter Store or environment variables
    let googleClientId: string;
    let googleClientSecret: string;
    
    // Try to get values from SSM Parameter Store in production
    try {
      googleClientId = ssm.StringParameter.valueForStringParameter(
        this,
        `/${applicationName}/cognito/google-client-id`
      );
      
      googleClientSecret = ssm.StringParameter.valueForStringParameter(
        this,
        `/${applicationName}/cognito/google-client-secret` 
      );
    } catch (error) {
      // Fall back to environment variables for local development
      googleClientId = process.env.COGNITO_GOOGLE_CLIENT_ID || this.node.tryGetContext('cognito_google_client_id');
      googleClientSecret = process.env.COGNITO_GOOGLE_CLIENT_SECRET || this.node.tryGetContext('cognito_google_client_secret');
      
      // Validate that we have the required credentials
      if (!googleClientId || !googleClientSecret) {
        throw new Error(
          'Google OAuth credentials not found. Please set them in SSM Parameter Store ' +
          `as /${applicationName}/cognito/google-client-id and ` +
          `/${applicationName}/cognito/google-client-secret or provide them as environment variables ` +
          'COGNITO_GOOGLE_CLIENT_ID and COGNITO_GOOGLE_CLIENT_SECRET'
        );
      }
    }

    // Create the user pool as specified in requirement IF004
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${applicationName}-user-pool`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true
      },
      autoVerify: {
        email: true
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Set up the domain for the user pool
    const userPoolDomain = this.userPool.addDomain('CognitoDomain', {
      cognitoDomain: {
        domainPrefix: `${applicationName}-auth`
      }
    });

    // Create a user pool client for web applications
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `${applicationName}-web-client`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE
        ],
        callbackUrls: [`https://${domainName}/callback`, 'http://localhost:3000/callback'],
        logoutUrls: [`https://${domainName}`, 'http://localhost:3000']
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.GOOGLE,
        cognito.UserPoolClientIdentityProvider.COGNITO
      ]
    });

    // Add Google as an identity provider
    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
      userPool: this.userPool,
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      scopes: ['profile', 'email', 'openid'],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
        familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
      }
    });

    // Ensure the client depends on the provider being set up
    this.userPoolClient.node.addDependency(googleProvider);

    // Create an identity pool to provide AWS credentials
    this.identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: `${applicationName}IdentityPool`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName
        }
      ]
    });

    // Create authenticated and unauthenticated roles
    const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated'
          }
        },
        'sts:AssumeRoleWithWebIdentity'
      )
    });

    // Set up role mappings for the identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'RoleAttachment', {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn
      }
    });

    // Output the user pool ID and client ID
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'The ID of the Cognito User Pool',
      exportName: `${applicationName}-user-pool-id`
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'The ID of the Cognito User Pool Client',
      exportName: `${applicationName}-user-pool-client-id`
    });

    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: userPoolDomain.domainName,
      description: 'The domain name of the Cognito User Pool',
      exportName: `${applicationName}-user-pool-domain`
    });
  }
}