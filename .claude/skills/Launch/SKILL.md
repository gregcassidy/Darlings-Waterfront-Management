---
name: launch
description: Prepare an application for production launch with real users. Use when user says "launch", "go live", "deploy to production", "ready for users", or wants to release their app. Runs security review, optimizes for performance and multi-user load (100+ concurrent users), implements rate limiting and pagination, and ensures all changes are committed.
---

# Launch Skill

Prepare an application for production launch with real users. This skill ensures the app is secure, performant, and ready for multi-user load.

## Pre-Launch Checklist Overview

1. **Save & Commit** — Ensure all changes are on main
2. **Security Review** — Run Claude Code's security review mode
3. **Performance Optimization** — Optimize for 100+ concurrent users
4. **Rate Limiting** — Protect APIs from abuse
5. **Pagination** — Handle large data sets efficiently
6. **Final Deployment** — Deploy and verify

---

## Phase 1: Save and Commit All Changes

### Step 1: Check for Uncommitted Changes

```bash
git status
```

If there are uncommitted changes:

```bash
git add -A
git commit -m "Pre-launch: Final changes before production release"
```

### Step 2: Ensure We're on Main Branch

```bash
git branch --show-current
```

If not on main:
```bash
git checkout main
git merge [current-branch] --no-ff -m "Merge [branch] for production launch"
```

### Step 3: Push to Remote

```bash
git push origin main
```

---

## Phase 2: Security Review

### Trigger Claude Code Security Review

Run the built-in security review:

```
/review --security
```

Or manually review with focus on security:

### Security Audit Checklist

#### 🔐 Authentication & Authorization
- [ ] All protected endpoints check authentication
- [ ] Role-based access control implemented correctly
- [ ] JWT tokens validated properly
- [ ] Session timeout configured appropriately
- [ ] No authentication bypasses possible

#### 🛡️ Input Validation
- [ ] All user inputs validated on backend (never trust frontend)
- [ ] SQL/NoSQL injection prevented (parameterized queries)
- [ ] XSS prevention (sanitize outputs)
- [ ] File upload validation (type, size, content)
- [ ] URL parameters validated

#### 🔑 Secrets & Configuration
- [ ] No hardcoded secrets in code
- [ ] API keys in environment variables only
- [ ] `.env` files in `.gitignore`
- [ ] No secrets in git history
- [ ] Production config separate from dev

#### 🌐 API Security
- [ ] CORS configured correctly (not wildcard in production)
- [ ] Rate limiting implemented
- [ ] Request size limits set
- [ ] HTTPS enforced (CloudFront handles this)
- [ ] Sensitive data not logged

#### 📊 Data Protection
- [ ] Sensitive data encrypted at rest (DynamoDB/S3)
- [ ] PII handled appropriately
- [ ] Data retention policies considered
- [ ] Backup/recovery plan exists

### Run Security Scan Commands

```bash
# Check for secrets in code
grep -r "password\|secret\|api_key\|apikey" --include="*.ts" --include="*.js" .

# Check for console.logs that might leak data
grep -r "console.log" --include="*.ts" --include="*.js" infrastructure/lambda/

# Check for TODO/FIXME security items
grep -r "TODO\|FIXME\|HACK" --include="*.ts" --include="*.js" .
```

---

## Phase 3: Performance Optimization

### 3.1 Frontend Optimization

#### Enable Compression & Caching
CloudFront should already handle this, but verify:
- Gzip compression enabled
- Cache headers set appropriately
- Static assets cached aggressively

#### JavaScript Optimization
```bash
# Check for large JS files
wc -l public/js/*.js | sort -n
```

- [ ] Minify JavaScript for production (if not already)
- [ ] Remove console.log statements
- [ ] Lazy load non-critical scripts
- [ ] Bundle related scripts if many small files

#### Image Optimization
- [ ] Images compressed and properly sized
- [ ] Use appropriate formats (WebP where supported)
- [ ] Lazy load images below the fold

#### CSS Optimization
- [ ] Remove unused CSS
- [ ] Minify CSS for production
- [ ] Critical CSS inlined if needed

### 3.2 Backend Optimization (Lambda)

#### Cold Start Reduction
```typescript
// Keep connections outside handler for reuse
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  // Handler code - connection reused across invocations
};
```

- [ ] Database connections initialized outside handler
- [ ] SDK clients created outside handler
- [ ] Minimize package size (remove unused dependencies)
- [ ] Use appropriate memory allocation (256MB default, adjust if needed)

#### Lambda Configuration Review
```typescript
// In CDK api-stack.ts - verify these settings
timeout: cdk.Duration.seconds(30),  // Appropriate timeout
memorySize: 256,                     // Adjust based on workload
```

### 3.3 Database Optimization (DynamoDB)

#### Index Review
- [ ] All query patterns have appropriate indexes (GSIs)
- [ ] No full table scans for common operations
- [ ] Partition keys distribute load evenly

#### Query Optimization
- [ ] Use `Query` instead of `Scan` wherever possible
- [ ] Project only needed attributes
- [ ] Use `Limit` for bounded queries

```typescript
// Good - Query with projection
const result = await docClient.send(new QueryCommand({
  TableName: 'MyTable',
  KeyConditionExpression: 'pk = :pk',
  ExpressionAttributeValues: { ':pk': id },
  ProjectionExpression: 'id, name, status',  // Only needed fields
  Limit: 50,  // Bounded result
}));
```

---

## Phase 4: Rate Limiting

### API Gateway Throttling

Verify throttling is configured in CDK:

```typescript
// In api-stack.ts
this.api = new apigateway.RestApi(this, 'Api', {
  // ...
  deployOptions: {
    stageName: 'prod',
    throttlingRateLimit: 100,    // Requests per second
    throttlingBurstLimit: 200,   // Burst capacity
  },
});
```

### Recommended Limits for 100 Users

| Setting | Value | Rationale |
|---------|-------|-----------|
| Rate Limit | 100 req/sec | ~1 req/sec per user |
| Burst Limit | 200 req | Handle spikes |
| Lambda Concurrency | 100 | Match expected users |
| Lambda Timeout | 30 sec | Prevent hung requests |

### Per-User Rate Limiting (Optional)

For stricter control, implement per-user limiting in Lambda:

```typescript
// Consider adding if abuse is a concern
// Track requests per user in DynamoDB with TTL
```

---

## Phase 5: Pagination

### Frontend Pagination

Implement pagination for all list views:

```javascript
// Pagination state
let currentPage = 1;
const pageSize = 25;
let lastEvaluatedKey = null;

async function loadPage(direction) {
  const params = new URLSearchParams({
    limit: pageSize,
  });
  
  if (lastEvaluatedKey && direction === 'next') {
    params.append('startKey', JSON.stringify(lastEvaluatedKey));
  }
  
  const data = await apiGet(`/api/items?${params}`);
  lastEvaluatedKey = data.lastEvaluatedKey;
  
  renderItems(data.items);
  updatePaginationControls(data.hasMore);
}
```

### Backend Pagination

All list endpoints should support pagination:

```typescript
export const handler = async (event: APIGatewayProxyEvent) => {
  const limit = Math.min(
    parseInt(event.queryStringParameters?.limit || '25'),
    100  // Max 100 items per request
  );
  
  const startKey = event.queryStringParameters?.startKey
    ? JSON.parse(event.queryStringParameters.startKey)
    : undefined;

  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    Limit: limit,
    ExclusiveStartKey: startKey,
  }));

  return success({
    items: result.Items,
    lastEvaluatedKey: result.LastEvaluatedKey,
    hasMore: !!result.LastEvaluatedKey,
  });
};
```

### Pagination Checklist

- [ ] All list endpoints accept `limit` parameter
- [ ] All list endpoints accept `startKey` for cursor pagination
- [ ] Frontend has pagination controls (prev/next or infinite scroll)
- [ ] Default page size is reasonable (25-50 items)
- [ ] Maximum page size enforced (100 items)
- [ ] Empty state handled gracefully

---

## Phase 6: Load Testing Considerations

### Expected Load Profile

For 100 concurrent users:
- ~100 requests/second peak
- ~50 simultaneous Lambda invocations
- ~1000 DynamoDB read units/second (estimate)

### DynamoDB Capacity

Verify on-demand capacity is enabled (handles auto-scaling):

```typescript
// In database-stack.ts
billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
```

### CloudFront Caching

Ensure static assets are cached:
- HTML: Short TTL (5 min) or no-cache for SPA
- JS/CSS: Long TTL with cache busting (?v=timestamp)
- Images: Long TTL (1 day+)

---

## Phase 7: Final Deployment

### Deploy All Stacks

```bash
cd infrastructure
npx cdk deploy --all --require-approval never
```

### Deploy Frontend

```bash
aws s3 sync ./public/ s3://BUCKET_NAME/ --delete --region us-east-1
aws cloudfront create-invalidation --distribution-id DIST_ID --paths "/*"
```

### Smoke Test

After deployment, verify:

- [ ] App loads at production URL
- [ ] Login works
- [ ] Core features function
- [ ] API responds correctly
- [ ] No console errors

---

## Phase 8: Documentation & Handoff

### Update CLAUDE.md

- [ ] Quick Reference table has correct production URLs
- [ ] All deployment commands documented
- [ ] Troubleshooting section updated
- [ ] Architecture diagram current

### Create Launch Notes

Add to `docs/Launch_Notes_[DATE].md`:

```markdown
# Launch Notes - [DATE]

## Production URLs
- App: https://[cloudfront-url]
- API: https://[api-gateway-url]

## Configuration
- Rate Limit: 100 req/sec
- Pagination: 25 items default, 100 max
- Lambda Memory: 256MB
- Lambda Timeout: 30s

## Security Review
- [x] Completed on [DATE]
- [x] All issues addressed

## Known Limitations
- [Any known issues or constraints]

## Rollback Plan
1. Redeploy previous version from git tag
2. [Specific rollback steps]
```

---

## Launch Confirmation

After completing all phases:

```
🚀 LAUNCH COMPLETE!

✅ All changes committed and pushed to main
✅ Security review passed
✅ Performance optimized for 100+ users
✅ Rate limiting configured (100 req/sec)
✅ Pagination implemented
✅ Final deployment successful
✅ Documentation updated

📍 Production URL: https://[your-cloudfront-url]

The app is ready for real users!
```

---

## Post-Launch Monitoring

Remind user to monitor:

- **CloudWatch Logs** — Lambda errors and performance
- **CloudWatch Metrics** — API Gateway 4xx/5xx rates
- **DynamoDB Metrics** — Throttling events
- **User Feedback** — Actual user experience

```bash
# Quick check for Lambda errors
aws logs filter-log-events \
  --log-group-name "/aws/lambda/[FunctionName]" \
  --filter-pattern "ERROR" \
  --start-time $(date -d '1 hour ago' +%s000)
```
