# VEA Production Deployment Checklist

Complete checklist for deploying Online C Suite with VEA to production.

## Pre-Deployment

### Environment Setup

- [ ] **Database**
  - [ ] PostgreSQL 14+ instance provisioned
  - [ ] Connection pooling configured (e.g., PgBouncer)
  - [ ] Database backups automated
  - [ ] Point-in-time recovery enabled
  - [ ] Connection limits appropriate for scale

- [ ] **Environment Variables**
  - [ ] All required variables set in production `.env`
  - [ ] No development/test credentials in production
  - [ ] Secrets stored securely (e.g., AWS Secrets Manager, Vault)
  - [ ] Environment-specific configuration verified

- [ ] **Authentication**
  - [ ] Clerk production instance configured
  - [ ] Production API keys generated
  - [ ] Allowed domains/origins configured
  - [ ] Webhook endpoints registered

- [ ] **LLM Provider**
  - [ ] Fireworks AI production API key
  - [ ] Rate limits and quotas confirmed
  - [ ] Fallback/redundancy configured
  - [ ] Cost monitoring alerts set up

### VEA Configuration

- [ ] **Orchestrator Setup**
  - [ ] `VEA_USE_MOCK_ORCHESTRATOR="false"` in production
  - [ ] Real VPA-Core orchestrator deployed and accessible
  - [ ] All 16 MCP modules configured and tested
  - [ ] Module health checks implemented

- [ ] **Security**
  - [ ] `VEA_REQUIRE_APPROVAL="true"` for high-risk actions
  - [ ] `VEA_RISK_THRESHOLD` set appropriately (recommended: 50-60)
  - [ ] Approval workflow UI deployed
  - [ ] Audit logging enabled

- [ ] **MCP Modules**
  - [ ] ProspectFinder API configured
  - [ ] LeadTracker Pro connected
  - [ ] Email Orchestrator SMTP configured
  - [ ] Bookkeeping Assistant integrated
  - [ ] Content Creator API keys set
  - [ ] Social Media Manager credentials configured
  - [ ] Time Billing Agent connected
  - [ ] All module endpoints tested

### Code & Build

- [ ] **Dependencies**
  - [ ] All dependencies up to date
  - [ ] Security vulnerabilities fixed (`pnpm audit`)
  - [ ] Lock file committed
  - [ ] Production dependencies only in build

- [ ] **Build Process**
  - [ ] All TypeScript compiles without errors
  - [ ] Build succeeds: `pnpm build`
  - [ ] Dead code eliminated
  - [ ] Source maps generated (for debugging)

- [ ] **Testing**
  - [ ] All unit tests pass
  - [ ] Integration tests pass
  - [ ] VEA tests complete successfully
  - [ ] End-to-end tests run
  - [ ] Load testing completed

### Database

- [ ] **Schema**
  - [ ] All migrations run successfully
  - [ ] PersonaAction table created
  - [ ] Indexes optimized for queries
  - [ ] Foreign keys and constraints in place

- [ ] **Migrations**
  - [ ] Migration files reviewed
  - [ ] Rollback plan prepared
  - [ ] Backup created before migration
  - [ ] Run migrations: `pnpm db:migrate:deploy`

- [ ] **Performance**
  - [ ] Query performance analyzed
  - [ ] Slow query logging enabled
  - [ ] Connection pooling configured
  - [ ] Database statistics up to date

### Monitoring & Observability

- [ ] **Error Tracking**
  - [ ] Sentry (or alternative) configured
  - [ ] Source maps uploaded
  - [ ] Error alerts configured
  - [ ] Team notifications set up

- [ ] **Logging**
  - [ ] Structured logging implemented
  - [ ] Log aggregation configured (e.g., CloudWatch, Datadog)
  - [ ] Log retention policy set
  - [ ] PII scrubbing implemented

- [ ] **Metrics**
  - [ ] Application metrics exported
  - [ ] Database metrics monitored
  - [ ] VEA action metrics tracked
  - [ ] Dashboards created

- [ ] **Uptime Monitoring**
  - [ ] Health check endpoints implemented
  - [ ] Uptime monitoring service configured (e.g., UptimeRobot)
  - [ ] Incident response plan documented
  - [ ] On-call rotation established

### Security

- [ ] **HTTPS/SSL**
  - [ ] SSL certificates installed
  - [ ] HTTPS enforced
  - [ ] Certificate auto-renewal configured
  - [ ] HTTP to HTTPS redirect enabled

- [ ] **CORS**
  - [ ] Production origins whitelisted
  - [ ] Development origins removed
  - [ ] Credentials properly configured
  - [ ] Preflight requests handled

- [ ] **Rate Limiting**
  - [ ] Rate limits configured per endpoint
  - [ ] Abuse prevention implemented
  - [ ] Rate limit headers sent
  - [ ] Premium tier limits differentiated

- [ ] **Input Validation**
  - [ ] All inputs validated
  - [ ] SQL injection protection verified
  - [ ] XSS prevention implemented
  - [ ] File upload restrictions enforced

- [ ] **Secrets Management**
  - [ ] No secrets in code repository
  - [ ] Environment variables properly secured
  - [ ] API keys rotated regularly
  - [ ] Access to secrets limited

### Compliance & Legal

- [ ] **Privacy**
  - [ ] GDPR compliance reviewed
  - [ ] Privacy policy updated
  - [ ] Data retention policy implemented
  - [ ] User data deletion workflow

- [ ] **Terms of Service**
  - [ ] ToS updated with VEA features
  - [ ] User consent for AI actions
  - [ ] Liability disclaimers included

## Deployment

### Pre-Deploy

- [ ] **Communication**
  - [ ] Deployment window announced
  - [ ] Stakeholders notified
  - [ ] Maintenance page prepared
  - [ ] Support team briefed

- [ ] **Backup**
  - [ ] Database backup created
  - [ ] Current deployment tagged in Git
  - [ ] Rollback procedure documented
  - [ ] Previous version artifacts saved

### Deploy Steps

- [ ] **1. Database Migration**
  ```bash
  # Connect to production database
  psql $DATABASE_URL

  # Verify current schema version
  SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;

  # Run migrations
  pnpm db:migrate:deploy

  # Verify migrations succeeded
  ```

- [ ] **2. Build Application**
  ```bash
  # Build all packages
  pnpm build

  # Verify build artifacts
  ls -la apps/api/dist
  ls -la apps/web/dist
  ls -la packages/vea-core/dist
  ```

- [ ] **3. Deploy API Server**
  - [ ] Upload build artifacts
  - [ ] Update environment variables
  - [ ] Restart server process
  - [ ] Verify health check endpoint
  - [ ] Check logs for errors

- [ ] **4. Deploy Web Application**
  - [ ] Upload static assets to CDN
  - [ ] Update API endpoints
  - [ ] Clear CDN cache
  - [ ] Verify loading in browser

- [ ] **5. Smoke Tests**
  ```bash
  # Test API health
  curl https://api.yourdomain.com/health

  # Test authentication
  curl https://api.yourdomain.com/api/auth/me -H "Authorization: Bearer $TOKEN"

  # Test VEA chat
  curl -X POST https://api.yourdomain.com/api/c-suite/vea/chat \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"message":"Test message","personaType":"ceo"}'
  ```

### Post-Deploy

- [ ] **Verification**
  - [ ] Application loads successfully
  - [ ] Authentication works
  - [ ] Chat with CEO works
  - [ ] VEA actions execute
  - [ ] Database queries succeed
  - [ ] No errors in logs

- [ ] **Monitoring**
  - [ ] Error rate normal
  - [ ] Response times acceptable
  - [ ] Database connections stable
  - [ ] Memory/CPU usage healthy

- [ ] **Documentation**
  - [ ] Deployment notes recorded
  - [ ] Issues documented
  - [ ] Rollback procedure tested
  - [ ] Team debriefed

## VEA-Specific Deployment

### Enabling VEA in Production

1. **Start with Read-Only Mode**
   ```env
   VEA_ENABLED="true"
   VEA_USE_MOCK_ORCHESTRATOR="true"  # Safe testing
   VEA_REQUIRE_APPROVAL="true"
   ```

2. **Test with Mock Orchestrator**
   - Verify action parsing works
   - Test approval workflow
   - Validate audit logging
   - Check user experience

3. **Connect Real MCP Modules (Gradually)**
   ```env
   VEA_USE_MOCK_ORCHESTRATOR="false"
   ```

   Enable modules one at a time:
   - Start with low-risk (ProspectFinder)
   - Test thoroughly
   - Enable next module
   - Repeat

4. **Adjust Risk Threshold**
   ```env
   # Conservative start
   VEA_RISK_THRESHOLD="40"  # Most actions require approval

   # After proven stable
   VEA_RISK_THRESHOLD="60"  # Balanced
   ```

### MCP Module Deployment

For each module:

- [ ] **ProspectFinder**
  - [ ] API endpoint configured
  - [ ] API key set
  - [ ] Rate limits verified
  - [ ] Test search action

- [ ] **LeadTracker Pro**
  - [ ] Database connected
  - [ ] Import tested
  - [ ] Export tested
  - [ ] Permissions verified

- [ ] **Email Orchestrator**
  - [ ] SMTP configured
  - [ ] Send limits set
  - [ ] Templates loaded
  - [ ] Test email sent

- [ ] **Bookkeeping Assistant**
  - [ ] Accounting system integrated
  - [ ] Permissions configured
  - [ ] Test invoice generation
  - [ ] Verify sync

- [ ] **Content Creator**
  - [ ] API keys configured
  - [ ] Test content generation
  - [ ] Verify quality
  - [ ] Check costs

- [ ] **Social Media Manager**
  - [ ] Platform APIs connected
  - [ ] OAuth configured
  - [ ] Post permissions verified
  - [ ] Test posting

- [ ] **Time Billing Agent**
  - [ ] Time tracking integrated
  - [ ] Billing rules configured
  - [ ] Test timesheet creation
  - [ ] Verify calculations

## Rollback Procedure

If issues arise:

### Immediate Rollback

1. **Revert to Previous Version**
   ```bash
   # Git rollback
   git checkout <previous-tag>

   # Rebuild
   pnpm build

   # Redeploy
   ./deploy.sh
   ```

2. **Disable VEA (if needed)**
   ```env
   VEA_ENABLED="false"
   ```

3. **Rollback Database**
   ```bash
   # Restore from backup
   psql $DATABASE_URL < backup.sql
   ```

### Verify Rollback

- [ ] Application functioning
- [ ] No errors in logs
- [ ] Users can access system
- [ ] Data integrity maintained

## Post-Deployment Monitoring

### First 24 Hours

- [ ] Monitor error rates every hour
- [ ] Check VEA action success rates
- [ ] Review user feedback
- [ ] Watch resource utilization

### First Week

- [ ] Daily error rate review
- [ ] Approval workflow metrics
- [ ] User adoption tracking
- [ ] Cost monitoring

### Ongoing

- [ ] Weekly metrics review
- [ ] Monthly security audit
- [ ] Quarterly performance optimization
- [ ] Continuous improvement

## Performance Benchmarks

Target metrics for production:

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| API Response Time | < 200ms | > 500ms |
| Database Query Time | < 50ms | > 200ms |
| VEA Action Execution | < 3s | > 10s |
| Error Rate | < 0.1% | > 1% |
| Uptime | > 99.9% | < 99.5% |
| Chat Response Start | < 1s | > 3s |

## Support & Escalation

### Issue Priority

**P0 - Critical**
- Site down
- Data loss
- Security breach
Response: Immediate

**P1 - High**
- VEA not executing actions
- Authentication failing
- Major feature broken
Response: < 1 hour

**P2 - Medium**
- Slow performance
- Minor feature issues
- UI glitches
Response: < 4 hours

**P3 - Low**
- Enhancement requests
- Non-critical bugs
Response: < 24 hours

### On-Call Rotation

- [ ] On-call schedule published
- [ ] Escalation path documented
- [ ] Contact information updated
- [ ] Runbooks accessible

## Success Criteria

Deployment is successful when:

- [ ] All smoke tests pass
- [ ] Error rate < 0.1%
- [ ] Response times within targets
- [ ] VEA actions executing successfully
- [ ] No critical issues reported
- [ ] Users can complete core workflows
- [ ] Monitoring shows healthy metrics

---

**Deployment Date:** _______________

**Deployed By:** _______________

**Issues Encountered:** _______________

**Resolution Notes:** _______________

---

## Additional Resources

- [Setup Guide](./SETUP.md)
- [Architecture Docs](./VEA_ARCHITECTURE.md)
- [API Documentation](./API.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)
