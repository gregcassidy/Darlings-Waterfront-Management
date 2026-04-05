---
name: start-project
description: Standardized project initialization for Darling's Auto Group. Use when starting any new software project, when user says "start project", "new project", "initialize project", or asks to set up a new application. Guides through discovery, creates combined PRD/Spec document, sets up AWS infrastructure (CloudFront, S3, DynamoDB, Lambda, API Gateway), and scaffolds the standard Darling's architecture with CDK.
---

# Start Project Skill

Initialize new software projects using Darling's Auto Group standard AWS architecture. All projects share a common infrastructure pattern for consistency and maintainability.

## Workflow Overview

1. **Prerequisites Check** — Verify AWS CLI, CDK, and credentials are configured
2. **Discovery** — Gather project requirements through focused questions
3. **Document** — Create combined PRD/Spec in `docs/PRD-SPEC.md`
4. **Scaffold** — Set up project structure with CDK infrastructure
5. **Deploy** — Guide user through initial AWS deployment

---

## Step 1: Prerequisites Check

Before starting any project, verify the user's environment is ready.

### Required Tools

Run these checks and help user install anything missing:

```bash
# Check AWS CLI
aws --version
# Expected: aws-cli/2.x.x or higher

# Check AWS CDK
cdk --version
# Expected: 2.x.x or higher

# Check Node.js (required for CDK)
node --version
# Expected: v18.x.x or higher

# Check npm
npm --version
```

### Installation Commands (if needed)

**AWS CLI** (if not installed):
```bash
# In Codespaces/Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

**AWS CDK** (if not installed):
```bash
npm install -g aws-cdk
```

### AWS Credentials Setup

Check if credentials are configured:
```bash
aws sts get-caller-identity
```

If not configured, guide user through these steps:

1. **Get AWS Access Keys from Kim or IT**
   - User needs Access Key ID and Secret Access Key
   - These come from IAM user in AWS account 119002863133

2. **Configure AWS CLI**:
```bash
aws configure
# AWS Access Key ID: [enter key]
# AWS Secret Access Key: [enter secret]
# Default region name: us-east-1
# Default output format: json
```

3. **Verify Configuration**:
```bash
aws sts get-caller-identity
# Should show account: 119002863133
```

### IAM Requirements

User's IAM account needs these permissions (inform user to request from Kim if missing):
- CloudFormation (full access)
- S3 (full access)
- DynamoDB (full access)
- Lambda (full access)
- API Gateway (full access)
- CloudFront (full access)
- IAM (limited - for creating Lambda execution roles)
- CloudWatch Logs (full access)
- SES (if email features needed)

---

## Step 2: Discovery Phase

Ask these questions in conversational batches (2-3 at a time):

### Essential Questions (Always Ask)
- What problem are we solving? Who experiences this pain point?
- Who will use this application? (Internal team, specific department?)
- What are the 3-5 core features this must have?
- What user roles/permissions are needed? (All apps use Azure AD SSO)

### Data Questions
- What data does this app need to store? (List the main entities)
- Are there relationships between data types? (e.g., Equipment has many Inspections)
- Any existing data sources to pull from or integrate with?

### Technical Questions
- Does this need file uploads? (Photos, documents, etc.)
- Does it need email notifications? (SES is available)
- Any specific user roles or permissions? (Admin vs regular user)

### Business Questions
- How will we measure success?
- Is there a deadline or timeline?
- Who needs to approve this?

---

## Step 3: Create PRD/Spec Document

After discovery, create `docs/PRD-SPEC.md` using the template in `references/prd-spec-template.md`.

```bash
mkdir -p docs
```

Key sections to include:
- Quick Reference table (will be filled after deployment)
- Architecture diagram (use standard Darling's pattern)
- DynamoDB table designs
- API endpoints list
- Authentication requirements

---

## Step 4: Scaffold Project Structure

Create this exact structure for all Darling's projects:

```
project-name/
├── docs/
│   └── PRD-SPEC.md
├── public/                          # Frontend static files
│   ├── index.html
│   ├── login.html
│   ├── config.json                  # Runtime config (API URL, Azure IDs)
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   ├── auth.js                  # Azure AD authentication
│   │   └── app.js                   # Main application logic
│   └── images/
├── infrastructure/                   # AWS CDK
│   ├── bin/
│   │   └── infrastructure.ts        # CDK app entry point
│   ├── lib/
│   │   ├── database-stack.ts        # DynamoDB tables
│   │   ├── storage-stack.ts         # S3 buckets
│   │   ├── api-stack.ts             # API Gateway + Lambda
│   │   └── frontend-stack.ts        # CloudFront distribution
│   ├── lambda/
│   │   ├── functions/               # Lambda handlers by category
│   │   │   └── auth/
│   │   │       └── authorizer.ts
│   │   └── shared/                  # Shared utilities
│   │       ├── response.ts          # HTTP response helpers
│   │       └── auth.ts              # Role checking
│   ├── cdk.json
│   ├── package.json
│   └── tsconfig.json
├── .env.example
├── .gitignore
├── CLAUDE.md                        # Developer guide (like this example)
└── README.md
```

### Initialize the Structure

```bash
# Create directories
mkdir -p public/{css,js,images}
mkdir -p infrastructure/{bin,lib}
mkdir -p infrastructure/lambda/{functions/auth,shared}
mkdir -p docs

# Initialize CDK project in infrastructure folder
cd infrastructure
npx cdk init app --language typescript
```

---

## Step 5: Configure CDK Stacks

### Shared Configuration

Create `infrastructure/lib/config.ts`:
```typescript
export const config = {
  account: '119002863133',
  region: 'us-east-1',
  projectPrefix: 'ProjectName',  // Replace with actual project name
  
  // Azure AD (required for all apps)
  azureTenantId: process.env.AZURE_TENANT_ID || '',
  azureClientId: process.env.AZURE_CLIENT_ID || '',
};
```

### Database Stack Template

See `references/database-stack-template.ts` for DynamoDB table setup.

### API Stack Template

See `references/api-stack-template.ts` for Lambda + API Gateway setup.

### Frontend Stack Template

See `references/frontend-stack-template.ts` for CloudFront + S3 setup.

---

## Step 6: Initial Deployment

Guide user through first deployment:

### 1. Bootstrap CDK (First time only for the account)
```bash
cd infrastructure
npx cdk bootstrap aws://119002863133/us-east-1
```

### 2. Deploy Stacks in Order
```bash
# Deploy database first (no dependencies)
npx cdk deploy *DbStack --require-approval never

# Deploy storage (S3 buckets)
npx cdk deploy *StorageStack --require-approval never

# Deploy API (Lambda + API Gateway)
npx cdk deploy *ApiStack --require-approval never

# Deploy frontend (CloudFront)
npx cdk deploy *FrontendStack --require-approval never
```

### 3. Capture Resource IDs

After deployment, update `docs/PRD-SPEC.md` Quick Reference with:
- CloudFront Distribution ID
- CloudFront URL
- API Gateway URL
- S3 Bucket names

Get these from CDK output or:
```bash
# Get CloudFront distribution
aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='ProjectName'].{Id:Id,Domain:DomainName}"

# Get API Gateway
aws apigateway get-rest-apis --query "items[?name=='ProjectName-Api'].{Id:id}"
```

### 4. Deploy Frontend Files
```bash
aws s3 sync ./public/ s3://BUCKET_NAME/ --delete --region us-east-1

aws cloudfront create-invalidation --distribution-id DIST_ID --paths "/*"
```

---

## Step 7: Create Developer Guide (CLAUDE.md)

Create `CLAUDE.md` in project root using `references/claude-md-template.md`.

This file is CRITICAL — it's what future Claude sessions (and other developers) use to understand and maintain the project.

Include:
- Quick Reference table with all resource IDs
- Architecture diagram
- Deployment commands
- File structure explanation
- Common tasks guide
- Troubleshooting section

---

## Standard Tech Stack (All Darling's Projects)

| Layer | Technology | Notes |
|-------|------------|-------|
| **AWS Account** | 119002863133 | Shared across all projects |
| **Region** | us-east-1 | Always use this region |
| **Frontend** | Static HTML/JS/CSS | Served via CloudFront |
| **CDN** | CloudFront | Cache + HTTPS |
| **Static Hosting** | S3 | Frontend files |
| **API** | API Gateway (REST) | With Lambda authorizer |
| **Compute** | Lambda (Node.js/TS) | TypeScript preferred |
| **Database** | DynamoDB | On-demand capacity |
| **File Storage** | S3 | For uploads if needed |
| **Auth** | Azure AD SSO | Required — MSAL.js frontend + JWT validation |
| **Email** | SES | If notifications needed |
| **IaC** | AWS CDK (TypeScript) | All infrastructure as code |

---

## Deployment Commands Reference

### Frontend Only (Most Common)
```bash
aws s3 sync ./public/ s3://BUCKET_NAME/ --delete --region us-east-1
aws cloudfront create-invalidation --distribution-id DIST_ID --paths "/*"
```

### Backend (Lambda/API Changes)
```bash
cd infrastructure
npx cdk deploy *ApiStack --require-approval never
```

### Full Deployment
```bash
cd infrastructure
npx cdk deploy --all --require-approval never
```

---

## Important Notes

- **Always create PRD-SPEC.md and CLAUDE.md** before writing application code
- **AWS Account 119002863133** is shared — use unique prefixes for resources
- **us-east-1 region** always — no exceptions
- **CDK for all infrastructure** — no manual AWS console changes
- **Azure AD SSO is required** for all applications — no exceptions
- Keep the CLAUDE.md updated as the project evolves
