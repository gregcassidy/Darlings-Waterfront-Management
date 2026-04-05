# Darling's Waterfront Ticket Management — Developer Guide

## Quick Reference
| Resource | Value |
|----------|-------|
| AWS Account | 119002863133 |
| Region | us-east-1 |
| App URL | *(post-deploy)* |
| API Gateway URL | *(post-deploy)* |
| CloudFront Distribution ID | *(post-deploy)* |
| S3 Bucket | `darlings-waterfront-frontend-119002863133` |
| CDK Stack Prefix | `DarlingsWaterfront` |
| Concert Source | https://www.waterfrontconcerts.com/ |
| Azure Tenant ID | *(get from IT)* |
| Azure Client ID | *(get from IT)* |

---

## What This App Does

Darling's employees select their top-5 concert preferences for the Maine Savings Pavilion season. Admins manage the concert list (synced from waterfrontconcerts.com), assign tickets, issue parking passes, track attendance, and send winner notifications via SES.

---

## User Roles

| Role | Access |
|------|--------|
| `admin` | Full access — concerts, preferences, assignments, parking, notifications, settings |
| `employee` | Submit/view top-5 preferences, view own ticket assignments |
| `guest` | Employees without Azure AD — manually enter name + personal email to submit preferences |

---

## Architecture

```
CloudFront → S3 (static HTML/JS/CSS)
           → API Gateway → Lambda Authorizer → Lambda Functions → DynamoDB
                                                                → SES (emails)
```

Concert sync scrapes https://www.waterfrontconcerts.com/ (admin-triggered).

---

## DynamoDB Tables

| Table | PK | SK | Purpose |
|-------|----|----|---------|
| `WF-Concerts` | concertId | — | Season concert lineup |
| `WF-Employees` | userId | — | Employee profiles |
| `WF-Preferences` | userId | season | Top-5 submissions per season |
| `WF-Assignments` | assignmentId | — | Tickets + parking passes + attendance |
| `WF-Settings` | settingKey | — | App config (submissionsOpen, currentSeason, etc.) |

Key settings keys: `submissionsOpen`, `currentSeason`, `notificationFromEmail`

---

## File Structure

```
├── docs/
│   └── PRD-SPEC.md              # Full requirements & data model
├── public/                      # Frontend → deployed to S3
│   ├── index.html               # Main SPA (sections: preferences, my-tickets, concerts, reports, assignments, notifications, settings)
│   ├── login.html               # Login + guest entry form
│   ├── config.json              # Runtime config — update after deploy
│   ├── css/styles.css
│   └── js/
│       ├── auth.js              # Azure AD SSO + guest login flow
│       └── app.js               # Main app logic
├── infrastructure/
│   ├── bin/infrastructure.ts    # CDK entry point
│   ├── lib/
│   │   ├── database-stack.ts    # DynamoDB (5 tables)
│   │   ├── storage-stack.ts     # S3 bucket
│   │   ├── api-stack.ts         # API Gateway + all Lambda functions
│   │   └── frontend-stack.ts   # CloudFront distribution
│   └── lambda/
│       ├── functions/
│       │   ├── auth/            # Lambda authorizer (validates Azure AD JWT + guest tokens)
│       │   ├── concerts/        # Concert CRUD + sync from waterfrontconcerts.com
│       │   ├── preferences/     # Employee preference submissions
│       │   ├── assignments/     # Ticket + parking pass + attendance management
│       │   ├── notifications/   # SES emails (winner details + all-employee announcements)
│       │   └── settings/        # App settings + submission window control
│       └── shared/
│           ├── response.ts      # HTTP response helpers
│           └── auth.ts          # Role checking, user context
└── CLAUDE.md
```

---

## Deployment Commands

### First-time setup
```bash
aws configure
# Account: 119002863133 | Region: us-east-1

cd infrastructure && npm install
npx cdk bootstrap aws://119002863133/us-east-1
```

### Deploy infrastructure
```bash
cd infrastructure
npx cdk deploy --all --require-approval never
# Or individually:
npx cdk deploy DarlingsWaterfrontDbStack --require-approval never
npx cdk deploy DarlingsWaterfrontStorageStack --require-approval never
npx cdk deploy DarlingsWaterfrontApiStack --require-approval never
npx cdk deploy DarlingsWaterfrontFrontendStack --require-approval never
```

### Deploy frontend
```bash
aws s3 sync ./public/ s3://darlings-waterfront-frontend-119002863133/ --delete --region us-east-1
aws cloudfront create-invalidation --distribution-id DIST_ID --paths "/*"
```

### Deploy Lambda/API changes only
```bash
cd infrastructure && npx cdk deploy DarlingsWaterfrontApiStack --require-approval never
```

---

## Common Tasks

### Open/close employee submissions
Use the admin Settings panel in the app, or via CLI:
```bash
aws dynamodb put-item --table-name WF-Settings \
  --item '{"settingKey":{"S":"submissionsOpen"},"value":{"S":"true"}}' \
  --region us-east-1
```

### View all preferences for current season
```bash
aws dynamodb query --table-name WF-Preferences \
  --index-name season-index \
  --key-condition-expression "season = :s" \
  --expression-attribute-values '{":s":{"S":"2026"}}' \
  --region us-east-1
```

### View Lambda logs
```bash
aws logs tail /aws/lambda/DarlingsWaterfrontApiStack-Concerts --follow
```

---

## After First Deploy — Update These

1. **`public/config.json`** — set `apiUrl`, `azureTenantId`, `azureClientId`
2. **Quick Reference table above** — add CloudFront Distribution ID, App URL, API URL
3. **Verify SES sender email** in AWS console before notifications will work

---

## Open Items
- [ ] Get Azure AD App Registration client ID + tenant ID from IT
- [ ] Verify SES sender email address in AWS console
- [ ] Share last year's Excel spreadsheet → confirm ticket types + data model
- [ ] Confirm employee count (affects how many use guest vs Azure AD login)

---

## Coding Standards
- Max 1,000 lines per file — split if approaching 800
- No hardcoded secrets — environment variables only
- Validate all inputs at Lambda boundaries
- Keep CLAUDE.md updated after architectural changes
- `us-east-1` always, account `119002863133` always
