# Session Notes - 2026-04-05

## Summary
Initialized the Darling's Waterfront Ticket Management project from scratch. Completed full discovery, scaffolded the AWS CDK infrastructure, and successfully deployed all three CloudFormation stacks to production.

## Changes Made
- Conducted full product discovery (roles, features, data model, concert sync from waterfrontconcerts.com)
- Created `docs/PRD-SPEC.md` with complete requirements, data model, and API endpoint design
- Created `CLAUDE.md` developer guide
- Scaffolded CDK infrastructure: DatabaseStack (5 DynamoDB tables), ApiStack (API Gateway + 6 Lambda functions), FrontendStack (CloudFront + S3)
- Created Lambda shared utilities (`response.ts`, `auth.ts`)
- Created stub Lambda handlers for all 6 function areas to enable initial deploy
- Fixed CDK circular dependency by merging S3 bucket into FrontendStack
- Installed AWS CLI v2 and AWS CDK in this codespace
- Configured AWS credentials for `darlings-waterfront-management-deployer` IAM user
- Bootstrapped CDK and deployed all stacks successfully
- Configured SessionStart hook to auto-load project skills each session

## Files Modified
- `docs/PRD-SPEC.md` - Created: full product & technical spec
- `CLAUDE.md` - Created: developer guide with deployed resource IDs
- `infrastructure/bin/infrastructure.ts` - CDK app entry point
- `infrastructure/lib/database-stack.ts` - 5 DynamoDB tables
- `infrastructure/lib/api-stack.ts` - API Gateway + 6 Lambda functions
- `infrastructure/lib/frontend-stack.ts` - CloudFront + S3 (merged from storage-stack)
- `infrastructure/lambda/shared/response.ts` - HTTP response helpers
- `infrastructure/lambda/shared/auth.ts` - Role checking, user context
- `infrastructure/lambda/functions/auth/authorizer.js` - Stub authorizer
- `infrastructure/lambda/functions/concerts|preferences|assignments|notifications|settings/index.js` - Stub handlers
- `public/config.json` - Updated with real API URL post-deploy
- `.gitignore`, `.env.example` - Created

## Current Status
Infrastructure is fully deployed. All 3 CloudFormation stacks are live. The app currently serves stub Lambda responses — no real functionality yet.

## Deployed Resources
| Resource | Value |
|----------|-------|
| App URL | https://d2ih87vneh642g.cloudfront.net |
| API Gateway | https://r7wuhspii5.execute-api.us-east-1.amazonaws.com/prod/ |
| CloudFront ID | E32EW6VUY7FGE7 |
| S3 Bucket | darlings-waterfront-frontend-119002863133 |

## Next Steps
- [ ] Create Azure AD App Registration (client ID + tenant ID) in Azure Portal
- [ ] Verify SES sender email in AWS Console
- [ ] Phase 2: Build Lambda authorizer (Azure AD JWT validation + guest token support)
- [ ] Phase 2: Build login page (`login.html`) — Azure AD SSO + guest form for non-AD employees
- [ ] Share last year's Excel spreadsheet to validate data model (ticket types, fields)
- [ ] Rotate the IAM access key that was briefly visible in this session

## Notes
- User is IT admin — has full AWS and Azure AD access, no need to involve others for setup
- Guest login flow: employees without Azure AD enter name + personal email on login page; issued a short-lived guest token; stored in WF-Employees with `isGuest: true`
- Concert sync pulls from https://www.waterfrontconcerts.com/ — main page for name/date, individual pages for time; admin-triggered via "Sync Concerts" button
