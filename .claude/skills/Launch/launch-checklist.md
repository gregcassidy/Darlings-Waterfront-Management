# Production Launch Checklist

Use this checklist before launching any Darling's application.

---

## 📋 Pre-Launch Checklist

### Code & Git
- [ ] All changes committed
- [ ] All changes pushed to main
- [ ] No merge conflicts
- [ ] Feature branches merged

### Security
- [ ] `/review --security` passed
- [ ] No hardcoded secrets
- [ ] All endpoints authenticated
- [ ] Input validation complete
- [ ] CORS configured properly
- [ ] No sensitive data in logs

### Performance
- [ ] Lambda connections optimized (outside handler)
- [ ] DynamoDB queries use indexes (no scans)
- [ ] Frontend assets minified
- [ ] Images optimized
- [ ] No console.logs in production code

### Scalability (100+ Users)
- [ ] Rate limiting: 100 req/sec
- [ ] Burst limit: 200 requests
- [ ] Pagination on all lists (25-50 default, 100 max)
- [ ] DynamoDB on-demand billing
- [ ] CloudFront caching enabled

### Documentation
- [ ] CLAUDE.md updated with production URLs
- [ ] API endpoints documented
- [ ] Deployment commands correct
- [ ] Architecture diagram current

---

## 🚀 Deployment Steps

```bash
# 1. Commit any remaining changes
git add -A
git commit -m "Pre-launch: Final preparations"
git push origin main

# 2. Deploy infrastructure
cd infrastructure
npx cdk deploy --all --require-approval never

# 3. Deploy frontend
aws s3 sync ./public/ s3://BUCKET_NAME/ --delete --region us-east-1
aws cloudfront create-invalidation --distribution-id DIST_ID --paths "/*"
```

---

## ✅ Post-Deployment Verification

- [ ] App loads at production URL
- [ ] Login/authentication works
- [ ] All main features functional
- [ ] No console errors
- [ ] Mobile responsive (if applicable)
- [ ] Different user roles work correctly

---

## 📊 Recommended Settings

| Setting | Value | Location |
|---------|-------|----------|
| API Rate Limit | 100/sec | api-stack.ts |
| API Burst Limit | 200 | api-stack.ts |
| Lambda Memory | 256MB | api-stack.ts |
| Lambda Timeout | 30s | api-stack.ts |
| Pagination Default | 25 items | Lambda handlers |
| Pagination Max | 100 items | Lambda handlers |
| CloudFront TTL (static) | 1 day | frontend-stack.ts |
| DynamoDB Billing | On-demand | database-stack.ts |

---

## 🔄 Rollback Plan

If issues arise after launch:

### Quick Rollback (Frontend Only)
```bash
# Revert to previous commit
git checkout HEAD~1 -- public/
aws s3 sync ./public/ s3://BUCKET_NAME/ --delete
aws cloudfront create-invalidation --distribution-id DIST_ID --paths "/*"
git checkout main -- public/
```

### Full Rollback
```bash
# Find previous working commit
git log --oneline -10

# Revert to specific commit
git revert [commit-hash]
git push origin main

# Redeploy
cd infrastructure
npx cdk deploy --all --require-approval never
```

---

## 📈 Post-Launch Monitoring

### CloudWatch Dashboards
- Lambda invocations and errors
- API Gateway 4xx/5xx rates
- DynamoDB read/write capacity
- CloudFront cache hit ratio

### Alerts to Set Up
- Lambda error rate > 1%
- API 5xx rate > 0.5%
- DynamoDB throttling events
- Lambda duration > 10s

### Log Commands
```bash
# Check Lambda errors (last hour)
aws logs filter-log-events \
  --log-group-name "/aws/lambda/[FunctionName]" \
  --filter-pattern "ERROR" \
  --start-time $(date -d '1 hour ago' +%s000)

# Check API Gateway logs
aws logs filter-log-events \
  --log-group-name "API-Gateway-Execution-Logs_[api-id]/prod" \
  --start-time $(date -d '1 hour ago' +%s000)
```

---

## 📝 Launch Notes Template

Create `docs/Launch_Notes_YYYY-MM-DD.md`:

```markdown
# Launch Notes - [DATE]

## Production URLs
- App: https://[cloudfront-url]
- API: https://[api-gateway-url]

## Version
- Git commit: [hash]
- Deployed by: [name]

## Security Review
- Completed: [DATE]
- Issues found: [X]
- Issues resolved: [X]

## Performance Settings
- Rate limit: 100 req/sec
- Pagination: 25 default, 100 max

## Known Issues
- [None / List any]

## Rollback Commit
- [Previous stable commit hash]
```
