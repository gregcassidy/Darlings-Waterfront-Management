# Darling's Real Conversations - Developer Guide

**Project**: Employee Performance Review Portal ("Real Conversations")
**Owner**: Darling's Auto Group
**AWS Account**: 119002863133
**Region**: us-east-1
**Status**: In Development
**Started**: 2026-02-13

---

## Quick Reference

| Resource | Value |
|----------|-------|
| **CloudFront Distribution ID** | `E3NCWYPJ2IBNG2` |
| **CloudFront URL** | `https://d3l5phpi5h0ug1.cloudfront.net` |
| **Production URL** | `https://realconversations.darlings.com` |
| **API Gateway URL** | `https://7glups7mh6.execute-api.us-east-1.amazonaws.com/prod/` |
| **API Gateway ID** | `7glups7mh6` |
| **Frontend S3 Bucket** | `darlingsrealconv-frontend-119002863133` |
| **Azure Tenant ID** | `0c92f65f-782b-462f-987e-bfcba4656cb2` |
| **Azure Client ID** | `84cfca12-5877-4eec-a2da-540ef1b58e96` |
| **Manager Group** | `All Managers` — Object ID: `0786b804-d7f2-4a74-87aa-e2d480c54cf0` |
| **Admin Group** | `Corp IT Department` — Object ID: `06c02c8f-c9d9-4b98-99d2-902357961ea9` |

---

## Project Overview

### What We're Building

A modern web portal for managing employee performance reviews at Darling's Auto Group. The system:

- Digitizes the paper-based "Real Conversations" process
- Integrates with Microsoft Entra (Azure AD) for SSO authentication
- Provides role-based access (Employee, Manager, HR/Admin)
- Features dynamic conversation templates based on job roles
- Automates Outlook calendar integration and reminders
- Tracks 6-month conversation cadence
- Offers multi-level reporting (Location → Department → Company)

### Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | Vanilla JS + HTML/CSS | React-like premium UX |
| Authentication | Azure AD (MSAL.js) | SSO with group-based roles |
| CDN | CloudFront | Global distribution, HTTPS |
| API | API Gateway (REST) | RESTful endpoints |
| Compute | Lambda (Node.js/TypeScript) | Serverless functions |
| Database | DynamoDB | NoSQL, pay-per-request |
| Storage | S3 | Static frontend files |
| Calendar | Microsoft Graph API | Outlook integration |
| IaC | AWS CDK (TypeScript) | Infrastructure as code |

---

## File Structure

```
darlings-real-conversations/
├── docs/
│   └── PRD-SPEC.md              # Complete product & technical spec
├── public/                       # Frontend (static files)
│   ├── index.html               # Main entry point
│   ├── config.json              # Runtime config (API URL, Azure IDs)
│   ├── css/
│   │   └── styles.css           # Global styles (#25408f brand color)
│   ├── js/
│   │   ├── auth.js              # Azure AD authentication (MSAL.js)
│   │   └── app.js               # Main application logic
│   └── images/
├── infrastructure/               # AWS CDK
│   ├── bin/
│   │   └── infrastructure.ts    # CDK app entry point (stacks)
│   ├── lib/
│   │   ├── config.ts            # Shared configuration
│   │   ├── database-stack.ts    # DynamoDB tables (8 tables)
│   │   ├── storage-stack.ts     # S3 buckets
│   │   ├── api-stack.ts         # API Gateway + Lambda
│   │   └── frontend-stack.ts    # CloudFront distribution
│   ├── lambda/
│   │   ├── functions/           # Lambda handlers by feature
│   │   │   ├── auth/
│   │   │   │   └── authorizer.ts         # JWT validation
│   │   │   ├── users/
│   │   │   │   └── get-me.ts             # GET /users/me
│   │   │   ├── conversations/            # (to be built)
│   │   │   ├── templates/                # (to be built)
│   │   │   └── reports/                  # (to be built)
│   │   └── shared/              # Shared utilities
│   │       ├── response.ts      # HTTP response helpers
│   │       └── auth.ts          # Role checking
│   ├── package.json
│   ├── tsconfig.json
│   └── cdk.json
├── .gitignore
├── .env.example
├── CLAUDE.md                     # This file
└── README.md
```

---

## Getting Started

### Prerequisites

Ensure these are installed:

```bash
node --version    # v18+ required
npm --version     # v9+ required
aws --version     # AWS CLI v2
cdk --version     # AWS CDK v2
```

### Initial Setup

1. **Clone and Install**

```bash
cd /workspaces/Darlings-Real-Conversations
cd infrastructure
npm install
```

2. **Configure AWS Credentials**

```bash
aws configure
# AWS Access Key ID: [your-key]
# AWS Secret Access Key: [your-secret]
# Default region: us-east-1
# Default output format: json

# Verify
aws sts get-caller-identity
# Should show Account: 119002863133
```

3. **Bootstrap CDK** (first time only)

```bash
cd infrastructure
npx cdk bootstrap aws://119002863133/us-east-1
```

4. **Set Up Azure AD** (see Azure Configuration section below)

---

## Deployment

### Deploy All Stacks

```bash
cd infrastructure
npm run deploy
# Deploys all 4 stacks in order
```

### Deploy Individual Stacks

```bash
# Database only
npm run deploy:db

# Storage only
npm run deploy:storage

# API only (after database)
npm run deploy:api

# Frontend only (after storage)
npm run deploy:frontend
```

### After First Deployment

1. **Capture Resource IDs**

```bash
# Get CloudFront distribution
aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='DarlingsRealConv Frontend Distribution'].{Id:Id,Domain:DomainName}"

# Get API Gateway URL (or from CDK output)
# It will be printed after deployment
```

2. **Update public/config.json**

```json
{
  "azureTenantId": "your-actual-tenant-id",
  "azureClientId": "your-actual-client-id",
  "apiBaseUrl": "https://[api-id].execute-api.us-east-1.amazonaws.com/prod"
}
```

3. **Deploy Frontend Files**

```bash
# From project root
aws s3 sync ./public/ s3://darlingsrealconv-frontend-119002863133/ \
  --delete \
  --region us-east-1

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id [DISTRIBUTION_ID] \
  --paths "/*"
```

---

## Azure AD Configuration

### Create App Registration

1. Go to Azure Portal → Azure Active Directory → App registrations
2. Click "New registration"
3. Name: `Darlings-Real-Conversations`
4. Supported account types: Single tenant
5. Redirect URI:
   - Type: Single-page application (SPA)
   - URL: `https://[cloudfront-url]/` (production)
   - Also add: `http://localhost:3000/` (for local dev)
6. Click Register

### Configure API Permissions

1. In your app registration, go to "API permissions"
2. Add these Microsoft Graph permissions (Delegated):
   - `User.Read` - Read user profile
   - `Calendars.ReadWrite` - Manage calendar events
   - `Group.Read.All` - Read group membership
3. Grant admin consent

### Configure Token

1. Go to "Token configuration"
2. Add optional claim: `groups`
3. Save

### Create Entra Groups

1. Azure AD → Groups → New group
2. Create these groups:
   - Name: `RealConv-Managers`
     - Members: All managers
   - Name: `RealConv-Admins`
     - Members: HR/Admin users
3. Add users to appropriate groups

### Get IDs

- **Tenant ID**: App registration → Overview → Directory (tenant) ID
- **Client ID**: App registration → Overview → Application (client) ID

---

## Database Schema

### 8 DynamoDB Tables

All tables use on-demand billing and have point-in-time recovery enabled.

#### 1. Users
- **PK**: `userId` (Azure AD object ID)
- **Attributes**: email, displayName, jobRole, departmentId, managerId, entraGroups, isActive
- **GSI**: departmentId-userId-index, managerId-userId-index

#### 2. Locations
- **PK**: `locationId`
- **Attributes**: name, address, isActive
- Example: "Bangor Ford", "Ellsworth Toyota"

#### 3. Departments
- **PK**: `departmentId`
- **Attributes**: name, locationId, managerId, isActive
- **GSI**: locationId-departmentId-index
- Example: "Parts", "Service", "Sales"

#### 4. JobRoles
- **PK**: `jobRoleId`
- **Attributes**: name, templateId, isActive
- Example: "Service Technician", "Sales Manager"

#### 5. Templates
- **PK**: `templateId`
- **Attributes**: jobRoleId, version, coreValues[], yesNoQuestions[], openEndedQuestions[], isActive
- **GSI**: jobRoleId-version-index

#### 6. Conversations
- **PK**: `conversationId`
- **Attributes**: employeeId, managerId, templateId, scheduledDate, status, coreValuesScores[], yesNoAnswers[], openEndedAnswers[], outlookEventId, nextDueDate
- **GSI**: employeeId-scheduledDate-index, managerId-scheduledDate-index, status-nextDueDate-index

#### 7. ChangeRequests
- **PK**: `requestId`
- **Attributes**: templateId, requestedBy, status, changeDescription, proposedChanges, reviewedBy
- **GSI**: status-createdAt-index, requestedBy-createdAt-index

#### 8. Reminders
- **PK**: `reminderId`
- **Attributes**: conversationId, reminderType, scheduledFor, sentAt, status
- **GSI**: status-scheduledFor-index

---

## API Endpoints

Base URL: `https://[api-id].execute-api.us-east-1.amazonaws.com/prod`

All endpoints require `Authorization: Bearer [Azure AD JWT]` header.

### Implemented

- `GET /users/me` - Get current user profile

### To Be Implemented

#### Users
- `GET /users/{userId}` - Get user by ID (manager/admin)
- `GET /users/team` - Get direct reports (managers)
- `POST /users/sync` - Sync user from Azure AD (admin)

#### Conversations
- `GET /conversations` - List conversations (filtered by role)
- `GET /conversations/{id}` - Get conversation details
- `POST /conversations` - Create conversation (managers)
- `PUT /conversations/{id}/manager-section` - Manager completes scorecard
- `PUT /conversations/{id}/employee-section` - Employee completes feedback
- `POST /conversations/{id}/complete` - Mark completed
- `POST /conversations/{id}/reschedule` - Reschedule meeting

#### Templates
- `GET /templates` - List active templates
- `GET /templates/by-role/{jobRoleId}` - Get template for job role
- `POST /templates/{id}/change-request` - Submit change request
- `GET /templates/change-requests` - List change requests (admin)
- `PUT /templates/change-requests/{id}` - Approve/reject (admin)

#### Reports
- `GET /reports/completion` - Completion statistics (by location/department)

#### Calendar
- `POST /calendar/send-invite` - Send Outlook invite via Graph API

See `docs/PRD-SPEC.md` for complete API documentation.

---

## Frontend Development

### Authentication Flow

1. User visits site → `auth.initAuth()` checks if logged in
2. If not → Show login page → `auth.login()` redirects to Azure AD
3. Azure AD authenticates → Redirects back with token
4. MSAL stores token → `auth.getAccessToken()` retrieves it
5. API calls include `Authorization: Bearer [token]`
6. Lambda authorizer validates JWT → Attaches user context
7. Lambda functions use `event.requestContext.authorizer.userId`

### Making API Calls

```javascript
// Uses auth.apiCall() which automatically includes JWT
const profile = await auth.apiCall('/users/me');

const conversations = await auth.apiCall('/conversations?status=upcoming');

await auth.apiCall('/conversations', {
  method: 'POST',
  body: JSON.stringify({ employeeId: '123', scheduledDate: '...' }),
});
```

### Role-Based UI

```javascript
const isManager = userProfile.roles.includes('manager');
const isAdmin = userProfile.roles.includes('admin');

if (isManager) {
  // Show manager dashboard
}

if (isAdmin) {
  // Show admin panel
}
```

---

## Common Tasks

### Deploy Frontend Changes Only

```bash
# From project root
aws s3 sync ./public/ s3://darlingsrealconv-frontend-119002863133/ \
  --delete \
  --region us-east-1

aws cloudfront create-invalidation \
  --distribution-id [DIST_ID] \
  --paths "/*"
```

**Note**: CloudFront invalidations take 5-15 minutes to propagate.

### Deploy Backend Changes

```bash
cd infrastructure
npm run deploy:api
# API changes are immediate (no cache)
```

### Add a New Lambda Function

1. Create handler in `infrastructure/lambda/functions/[category]/[name].ts`

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, serverError } from '../../shared/response';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const userId = event.requestContext.authorizer?.userId;
    // Your logic here
    return success({ data: 'response' });
  } catch (error) {
    console.error('Error:', error);
    return serverError('Something went wrong');
  }
}
```

2. Add to API Stack (`infrastructure/lib/api-stack.ts`)

```typescript
const myFunction = new lambda.Function(this, 'MyFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'my-handler.handler',
  code: lambda.Code.fromAsset('lambda/functions/category'),
  environment: commonEnv,
});

props.myTable.grantReadWriteData(myFunction);

const myResource = this.api.root.addResource('my-resource');
myResource.addMethod('GET', new apigateway.LambdaIntegration(myFunction), {
  authorizer,
});
```

3. Deploy

```bash
npm run deploy:api
```

### View Logs

```bash
# API Gateway logs
aws logs tail /aws/apigateway/DarlingsRealConv-Api --follow

# Lambda logs
aws logs tail /aws/lambda/[function-name] --follow
```

### Import Employee Roster

(To be implemented)

```bash
# Upload CSV via admin panel
# Or use CLI:
aws dynamodb batch-write-item --request-items file://employees.json
```

---

## Troubleshooting

### "Unauthorized" Error

**Symptoms**: API calls return 401 Unauthorized

**Causes**:
- JWT token expired → MSAL should auto-refresh, but may need to sign in again
- Token not included in request → Check `auth.apiCall()` is used
- Lambda authorizer failing → Check CloudWatch logs

**Fix**:
```bash
# Check authorizer logs
aws logs tail /aws/lambda/DarlingsRealConvApiStack-Authorizer --follow

# Sign out and back in
auth.logout()
```

### "Forbidden" Error (403)

**Symptoms**: API calls return 403 Forbidden

**Causes**:
- User lacks required role (e.g., trying to access manager endpoint as employee)
- Entra group membership not configured

**Fix**:
1. Check user's groups in Azure AD
2. Ensure they're in `RealConv-Managers` or `RealConv-Admins` if needed
3. Sign out and back in to refresh token

### CloudFront Shows Old Content

**Symptoms**: Frontend changes not visible after deployment

**Causes**:
- CloudFront cache hasn't been invalidated
- Browser cache

**Fix**:
```bash
# Invalidate CloudFront
aws cloudfront create-invalidation \
  --distribution-id [DIST_ID] \
  --paths "/*"

# Hard refresh browser: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
```

### CDK Deploy Fails

**Symptoms**: `cdk deploy` errors

**Common Issues**:

1. **Not bootstrapped**:
```bash
npx cdk bootstrap aws://119002863133/us-east-1
```

2. **AWS credentials expired**:
```bash
aws sts get-caller-identity
# If error, run: aws configure
```

3. **TypeScript compilation errors**:
```bash
cd infrastructure
npm run build
# Fix any TS errors shown
```

### Lambda Function Errors

**Symptoms**: API returns 500 Internal Server Error

**Debug**:
```bash
# View Lambda logs
aws logs tail /aws/lambda/[function-name] --follow --since 10m

# Common issues:
# - Missing environment variables
# - DynamoDB permissions not granted
# - Syntax errors in TypeScript
```

---

## Development Workflow

### Making Changes

1. **Frontend Changes**:
   - Edit files in `public/`
   - Test locally by serving with a local server: `npx http-server public -p 3000`
   - Deploy: `aws s3 sync ./public/ s3://[bucket]/ --delete && cloudfront invalidate`

2. **Backend Changes**:
   - Edit Lambda functions in `infrastructure/lambda/`
   - Or edit CDK stacks in `infrastructure/lib/`
   - Deploy: `cd infrastructure && npm run deploy:api`

3. **Infrastructure Changes**:
   - Edit CDK stacks in `infrastructure/lib/`
   - Preview: `cd infrastructure && npm run diff`
   - Deploy: `npm run deploy`

### Testing

1. **Test Authentication**:
   - Open CloudFront URL
   - Click "Sign in with Microsoft"
   - Should redirect to Azure AD → Back to app

2. **Test API**:
   - Open browser DevTools → Network tab
   - Perform action in UI
   - Check API calls (should return 200, not 401/403)

3. **Test Roles**:
   - Sign in as employee → Should see employee dashboard
   - Sign in as manager → Should see manager + employee dashboards
   - Sign in as admin → Should see all panels

### Git Workflow

```bash
# Create feature branch
git checkout -b feature/conversation-scheduling

# Make changes
# ...

# Commit
git add .
git commit -m "Add conversation scheduling feature"

# Push
git push origin feature/conversation-scheduling

# Create PR
gh pr create --title "Add conversation scheduling" --body "..."
```

---

## Security Considerations

### Authentication
- All API endpoints require valid Azure AD JWT
- JWT validated by Lambda authorizer (signature, issuer, audience, expiration)
- Group membership determines roles

### Authorization
- Role checks in Lambda functions: `requireManager(user)`, `requireAdmin(user)`
- Employees can only access their own data
- Managers can access their direct reports' data
- Admins can access all data

### Data Protection
- DynamoDB encryption at rest (AWS-managed keys)
- S3 encryption at rest (S3-managed keys)
- CloudFront enforces HTTPS
- API Gateway enforces HTTPS
- No sensitive data in logs

### Secrets Management
- Azure AD credentials in `config.json` (client ID only, not secret)
- AWS credentials via IAM roles (Lambda execution role)
- Never commit `config.json` with real values to git

---

## Performance Optimization

### Frontend
- CloudFront global edge caching (assets cached at edge locations)
- Gzip compression enabled
- Minimal dependencies (MSAL.js only)
- CSS optimized for mobile-first responsive design

### Backend
- Lambda cold start: ~1-2s (first invocation)
- Lambda warm: ~50-200ms
- DynamoDB single-digit millisecond latency
- API Gateway caching disabled (data changes frequently)

### Monitoring
- CloudWatch dashboards for Lambda errors
- API Gateway request metrics
- DynamoDB capacity monitoring

---

## Cost Estimation

### Monthly Costs (Estimated)

Based on 250 employees, 125 conversations/month:

| Service | Usage | Cost |
|---------|-------|------|
| DynamoDB | 125 writes/mo, 5000 reads/mo | ~$1 |
| Lambda | 10,000 invocations/mo | ~$0.20 |
| API Gateway | 10,000 requests/mo | ~$0.035 |
| CloudFront | 10 GB transfer/mo | ~$1 |
| S3 | 1 GB storage, 10,000 requests | ~$0.25 |
| **Total** | | **~$2.50/month** |

**Note**: Costs are estimates. Actual costs depend on usage. DynamoDB on-demand scales automatically.

---

## Roadmap & Future Enhancements

### MVP (Current Phase)
- [x] Infrastructure setup
- [x] Azure AD authentication
- [x] Basic frontend
- [ ] Conversation CRUD
- [ ] Calendar integration
- [ ] Template management
- [ ] Reporting dashboard
- [ ] Data import tools

### Phase 2
- [ ] Mobile app (React Native)
- [ ] Email notifications (SES)
- [ ] Advanced analytics
- [ ] Goal tracking
- [ ] PDF export

### Phase 3
- [ ] AI-powered insights
- [ ] Integration with HRIS
- [ ] Custom branding per location
- [ ] Multi-language support

---

## Support & Contacts

**Project Owner**: You
**AWS Account Admin**: Kim/IT
**Azure AD Admin**: IT Department

**Resources**:
- **Full Specification**: `docs/PRD-SPEC.md`
- **AWS Console**: https://console.aws.amazon.com (Account: 119002863133)
- **Azure Portal**: https://portal.azure.com

**For Issues**:
1. Check this guide's Troubleshooting section
2. Check CloudWatch logs
3. Check `docs/PRD-SPEC.md` for detailed specs
4. Contact project owner

---

## Important Notes

### Never Commit These Files
- `public/config.json` (contains Azure IDs)
- `.env` files
- `cdk.out/` (CDK build artifacts)
- `node_modules/`

### Always Use
- `us-east-1` region (no exceptions)
- Account `119002863133`
- Azure AD SSO (no other auth methods)
- On-demand DynamoDB billing
- TypeScript for all Lambda functions

### Before Pushing Code
- Test locally
- Run `npm run build` to check TypeScript errors
- Check CloudWatch logs for errors
- Create PR for review

---

**Last Updated**: 2026-02-13
**Version**: 1.0
**Status**: Initial Setup Complete
