# Darling's Waterfront Ticket Management — Developer Guide

## Quick Reference
| Resource | Value |
|----------|-------|
| AWS Account | 119002863133 |
| Region | us-east-1 |
| App URL | https://d2ih87vneh642g.cloudfront.net |
| API Gateway URL | https://r7wuhspii5.execute-api.us-east-1.amazonaws.com/prod/ |
| CloudFront Distribution ID | E32EW6VUY7FGE7 |
| S3 Bucket | `darlings-waterfront-frontend-119002863133` |
| CDK Stack Prefix | `DarlingsWaterfront` |
| Concert Source | https://www.waterfrontconcerts.com/ |
| Azure Tenant ID | *(get from IT — update config.json + CDK env)* |
| Azure Client ID | *(get from IT — update config.json + CDK env)* |

---

## What This App Does

Darling's employees log in via Microsoft SSO and submit their **top-5 ranked concert preferences** for the Maine Savings Amphitheater season. Admins manage the concert list, assign employees (or VIP guests) to numbered ticket/parking slots, track attendance, and send notifications via SES.

Employees only see concert names — ticket type (suite vs. club) is invisible to them. Admin is fully in control of who gets what seat.

---

## User Roles

| Role | Access |
|------|--------|
| `admin` | Full access — concerts, assignments, Jay's Guests, settings |
| `employee` | Submit/view top-5 preferences, view own ticket assignments |

Admin is determined by: (1) Azure AD app role `WaterfrontAdmin` in JWT, or (2) `ADMIN_USER_IDS` env var (comma-separated Azure OIDs).

---

## Architecture

```
CloudFront → S3 (login.html, index.html, admin.html, css/, js/)
           → API Gateway → Lambda Authorizer (Azure AD JWT) → Lambda Functions → DynamoDB
                                                                                → SES (emails)
```

**Auth flow:** MSAL.js (CDN) → Azure AD → Bearer token → Lambda Authorizer validates JWT using Node.js built-in `crypto` (no external deps). Dev mode: if `REPLACE_WITH_TENANT_ID` is still in env, all requests pass as admin.

---

## DynamoDB Tables

| Table | PK | SK | Purpose |
|-------|----|----|---------|
| `WF-Concerts` | concertId | — | Season lineup. concertId format: `2026-01` through `2026-25` |
| `WF-Employees` | userId | — | Auto-created on first preference submission |
| `WF-Preferences` | userId | season | Top-5 submissions. `preferences` = [{rank, concertId}] |
| `WF-Assignments` | assignmentId | — | Per-slot assignments (suite/club/bsbParking/suiteParking) |
| `WF-Settings` | settingKey | — | `submissionsOpen`, `currentSeason`, `notificationFromEmail` |
| `WF-JaysGuests` | guestId | — | Jay's private external contact list (admin-only) |

Concert slot counts per show (admin-configurable): `suiteTicketCount`, `clubTicketCount`, `bsbParkingCount`, `suiteParkingCount`. Defaults: 20/10/20/8.

---

## File Structure

```
├── docs/
│   ├── PRD-SPEC.md              # Full requirements & data model
│   └── 2026 WFC Tickets.xlsx   # Admin's spreadsheet — source of truth for season data
├── public/                      # Frontend → deployed to S3
│   ├── login.html               # Microsoft SSO login (MSAL.js)
│   ├── index.html               # Employee portal (preferences + my tickets)
│   ├── admin.html               # Admin interface (concerts, Jay's Guests, settings)
│   ├── config.json              # Runtime config (apiUrl, azureTenantId, azureClientId)
│   ├── css/styles.css           # Shared styles (navy/blue theme)
│   └── js/
│       ├── auth.js              # MSAL wrapper + apiRequest() helper
│       ├── app.js               # Employee portal logic
│       └── admin.js             # Admin portal logic
├── infrastructure/
│   ├── bin/infrastructure.ts    # CDK entry point
│   ├── lib/
│   │   ├── database-stack.ts    # DynamoDB (6 tables incl. WF-JaysGuests)
│   │   ├── api-stack.ts         # API Gateway + 6 Lambda functions + authorizer
│   │   └── frontend-stack.ts    # CloudFront + S3
│   └── lambda/
│       ├── functions/
│       │   ├── auth/            # Lambda authorizer — Azure AD JWT via Node crypto
│       │   ├── concerts/        # CRUD + /seed (2026 data) + /sync (stub)
│       │   ├── preferences/     # Submit/get top-5
│       │   ├── assignments/     # Slot management + request tallies
│       │   ├── guests/          # Jay's Guests CRUD
│       │   ├── notifications/   # SES emails (stub — needs SES setup)
│       │   └── settings/        # submissionsOpen, currentSeason, fromEmail
│       └── shared/
│           ├── response.ts      # HTTP response helpers (TypeScript)
│           └── auth.ts          # UserContext type + getUserFromEvent
└── CLAUDE.md
```

---

## Deployment Commands

### Deploy infrastructure (includes new WF-JaysGuests table)
```bash
cd infrastructure
npx cdk deploy DarlingsWaterfrontDbStack --require-approval never
npx cdk deploy DarlingsWaterfrontApiStack --require-approval never
```

### Deploy frontend
```bash
aws s3 sync ./public/ s3://darlings-waterfront-frontend-119002863133/ --delete --region us-east-1
aws cloudfront create-invalidation --distribution-id E32EW6VUY7FGE7 --paths "/*"
```

### Seed 2026 concert data (run once after deploy)
```bash
# Via the admin interface: Admin → Concerts → "Seed 2026 Data"
# Or via CLI:
curl -X POST https://r7wuhspii5.execute-api.us-east-1.amazonaws.com/prod/concerts/seed \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{}'
```

### Set admin user by Azure OID
```bash
# After Greg logs in, find his OID in CloudWatch logs or DynamoDB WF-Employees
# Then update Lambda env var ADMIN_USER_IDS via CDK or console
```

---

## Common Tasks

### Open/close employee submissions
Admin Settings panel, or CLI:
```bash
aws dynamodb put-item --table-name WF-Settings \
  --item '{"settingKey":{"S":"submissionsOpen"},"value":{"S":"true"}}' --region us-east-1
```

### View Lambda logs
```bash
aws logs tail /aws/lambda/DarlingsWaterfrontApiStack-Concerts --follow
aws logs tail /aws/lambda/DarlingsWaterfrontApiStack-Authorizer --follow
```

### View all preferences for current season
```bash
aws dynamodb query --table-name WF-Preferences \
  --index-name season-index \
  --key-condition-expression "season = :s" \
  --expression-attribute-values '{":s":{"S":"2026"}}' --region us-east-1
```

---

## After Deploy — Complete These Steps

1. **Azure AD** — Create App Registration → get Tenant ID + Client ID
2. **`public/config.json`** — set `azureTenantId` + `azureClientId`, redeploy frontend
3. **CDK env** — set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` env vars, redeploy API stack
4. **Admin access** — log in once, find your Azure OID in logs, set `ADMIN_USER_IDS` env var
5. **SES** — verify sender email in AWS console
6. **Seed concerts** — click "Seed 2026 Data" in admin interface

---

## Open Items
- [ ] Get Azure AD App Registration client ID + tenant ID
- [ ] Verify SES sender email address in AWS console
- [ ] Deploy updated stacks (WF-JaysGuests table + guests Lambda are new this session)
- [ ] Seed 2026 concert data after deploy
- [ ] Set ADMIN_USER_IDS after first login

---

## Coding Standards
- Max 1,000 lines per file — split if approaching 800
- No hardcoded secrets — environment variables only
- Validate all inputs at Lambda boundaries
- Keep CLAUDE.md updated after architectural changes
- `us-east-1` always, account `119002863133` always
