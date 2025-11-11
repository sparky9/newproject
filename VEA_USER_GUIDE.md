# VEA User Guide

**Virtual Executive Assistant (VEA)** - Your AI-powered C-Suite that doesn't just advise, but actually executes tasks for you.

## What is VEA?

VEA transforms your Online C Suite personas (CEO, CFO, CMO, CTO) from passive advisors into active assistants. Instead of just telling you what to do, they can actually do it through 16 integrated MCP modules.

### Before VEA
**You:** "Find me HVAC companies in Dallas"
**CEO:** "I recommend using ProspectFinder to search for HVAC companies in Dallas. You should filter by location and industry."

### With VEA
**You:** "Find me HVAC companies in Dallas"
**CEO:** "I'll search for HVAC companies in Dallas right now."
*[Executes vpa_prospects.search]*
**CEO:** "I found 50 HVAC companies in Dallas. Here are the top prospects..."

## Getting Started

### 1. Access VEA

Navigate to your Online C Suite dashboard and start a conversation with any C-suite persona:
- **CEO** - Strategic overview, all modules
- **CFO** - Financial management
- **CMO** - Marketing and content
- **CTO** - Technical operations

### 2. Make Action Requests

Simply ask your persona to do something:

**Examples:**
- "Find 25 plumbing companies in Austin"
- "Add these prospects to my sales pipeline"
- "Create an email campaign for new leads"
- "Generate an invoice for Acme Corp"
- "Write a blog post about HVAC maintenance"
- "Schedule a social media post"

### 3. Review Results

When VEA executes an action, you'll see:
- **Action Indicator:** Visual confirmation that something is being executed
- **Progress Updates:** Real-time status
- **Results:** Detailed output from the tool
- **Next Steps:** Suggested follow-up actions

## Available Tools by Persona

### CEO - All Access

The CEO has access to all 16 modules:
- ProspectFinder - Find new leads
- LeadTracker Pro - Manage pipeline
- Email Orchestrator - Send campaigns
- Bookkeeping Assistant - Financial management
- Content Creator - Generate content
- Social Media Manager - Post to social
- Time Billing - Track billable hours
- And 9 more...

### CFO - Financial Focus

The CFO specializes in:
- **Bookkeeping** - Invoices, expenses, reports
- **Time Billing** - Timesheets, billing
- **LeadTracker** - Pipeline value tracking
- **ProspectFinder** - Revenue forecasting

**Example Actions:**
- "Generate an invoice for $2,500"
- "Show me this month's expenses"
- "Create a timesheet for Client ABC"
- "What's our pipeline value?"

### CMO - Marketing Master

The CMO excels at:
- **Content Creation** - Blog posts, articles
- **Social Media** - Posts, scheduling
- **Email Marketing** - Campaigns, templates
- **ProspectFinder** - Audience research

**Example Actions:**
- "Write a blog post about industry trends"
- "Create a LinkedIn post about our new service"
- "Draft an email campaign for leads"
- "Find content ideas for next month"

### CTO - Technical Operations

The CTO handles:
- **System Integration** - API connections
- **Automation** - Workflow setup
- **Data Management** - Exports, imports
- **Technical Support** - System configuration

**Example Actions:**
- "Set up an automation for new leads"
- "Export our prospect data to CSV"
- "Check API integration status"
- "Configure email SMTP settings"

## Real-World Workflows

### Workflow 1: Lead Generation to Email Campaign

**You to CEO:**
> "I need to reach out to HVAC companies in Dallas. Can you find prospects and set up an email campaign?"

**What VEA Does:**
1. Searches ProspectFinder for HVAC companies in Dallas (50 results)
2. Imports prospects into LeadTracker Pro
3. Creates an email campaign with 50 recipients
4. Provides you with campaign preview for approval

**Result:** Complete lead generation and outreach setup in one conversation.

### Workflow 2: Invoice Generation

**You to CFO:**
> "Generate an invoice for HVAC Company #5 for $2,500 for monthly service"

**What VEA Does:**
1. Creates invoice in Bookkeeping Assistant
2. Generates PDF
3. Optionally sends via Email Orchestrator
4. Updates accounting records

**Result:** Professional invoice generated and delivered in seconds.

### Workflow 3: Content Marketing

**You to CMO:**
> "Create a blog post about energy-efficient HVAC systems and share it on social media"

**What VEA Does:**
1. Generates 1200-word SEO-optimized blog post
2. Creates social media posts for LinkedIn and Twitter
3. Schedules posts for optimal engagement times
4. Provides analytics tracking

**Result:** Complete content marketing campaign executed.

## Action Approval System

For your protection, VEA includes a risk-based approval system.

### Low Risk (Auto-Execute)
Actions that are safe and reversible execute automatically:
- Searching for prospects
- Generating content drafts
- Reading data
- Creating reports

### Medium Risk (Optional Approval)
Actions that modify data but are recoverable:
- Adding prospects to pipeline
- Scheduling emails
- Creating timesheets
- Generating invoices

### High Risk (Always Requires Approval)
Actions that have significant impact:
- Sending bulk emails immediately
- Deleting data
- Making financial transactions
- Publishing content publicly

### Approval Workflow

When approval is required:
1. **Action Request:** VEA explains what it wants to do
2. **Risk Assessment:** Shows why approval is needed (risk score)
3. **Your Decision:** Approve, deny, or modify
4. **Execution:** VEA proceeds based on your choice

**Example:**
```
🔔 Approval Required

CEO wants to: Send email campaign to 50 recipients
Tool: vpa_email.send_campaign
Risk Score: 65 (Medium-High)

Reason: Bulk email send cannot be undone

[View Details] [Approve] [Deny] [Modify]
```

## Tips for Best Results

### Be Specific

❌ "Find some companies"
✅ "Find 25 HVAC companies in Dallas, Texas"

❌ "Send emails"
✅ "Create an email campaign for plumbers with subject 'Special Offer'"

### Combine Actions

Instead of multiple requests:
❌
1. "Find prospects"
2. "Add them to pipeline"
3. "Send emails"

Combine into one:
✅ "Find 50 HVAC prospects in Dallas, add them to pipeline, and create an email campaign"

### Review Before Approving

For high-risk actions:
- Check the parameters
- Review recipients/targets
- Verify amounts
- Confirm timing

### Use Follow-Up Questions

VEA remembers context:
```
You: "Find HVAC companies in Dallas"
CEO: [Executes search, finds 50 companies]

You: "Now add the top 10 to my pipeline"
CEO: [Knows which companies you mean]
```

## Action History & Audit Trail

All VEA actions are logged for your review.

### View Action History

Navigate to **Settings → VEA Actions** to see:
- All actions executed
- Who executed them (which persona)
- When they ran
- Results and status
- Approval/denial decisions

### Export Actions

Download your action history:
- CSV format
- JSON format
- PDF report

Useful for:
- Compliance
- Billing
- Performance tracking
- Training

## Common Scenarios

### Scenario: New Business Outreach

**Goal:** Find and contact potential clients

**Commands:**
1. "Find 50 [industry] companies in [location]"
2. "Add the most promising 20 to my pipeline"
3. "Create an introduction email campaign"
4. "Schedule to send tomorrow at 9 AM"

**VEA Actions:**
- vpa_prospects.search
- vpa_pipeline.import
- vpa_email.create_campaign
- vpa_email.schedule

### Scenario: Month-End Billing

**Goal:** Generate and send invoices

**Commands:**
1. "Show me all unbilled time entries for November"
2. "Generate invoices for all clients"
3. "Email invoices to clients"

**VEA Actions:**
- vpa_time_billing.get_unbilled
- vpa_bookkeeping.batch_invoice
- vpa_email.send_invoices

### Scenario: Content Marketing Sprint

**Goal:** Create week's worth of content

**Commands:**
1. "Generate 3 blog post ideas about [topic]"
2. "Write the first blog post"
3. "Create social media posts from the blog"
4. "Schedule posts throughout the week"

**VEA Actions:**
- vpa_content.generate_ideas
- vpa_content.write_blog
- vpa_social.create_posts
- vpa_social.schedule

## Troubleshooting

### Action Didn't Execute

**Possible Causes:**
1. VEA is disabled - Check settings
2. Permission denied - Persona doesn't have access to that tool
3. Missing parameters - Request wasn't specific enough
4. Service unavailable - MCP module offline

**Solutions:**
- Check VEA status in settings
- Try with different persona (CEO has all access)
- Provide more details in your request
- Contact support if service is down

### Unexpected Results

**What to Do:**
1. Review action details in history
2. Check parameters sent to tool
3. Verify data input was correct
4. Retry with clearer instructions

### Approval Not Working

**Check:**
1. Approval workflow is enabled
2. Email notifications are on
3. You have permission to approve
4. Action hasn't expired

## Safety Features

VEA includes multiple safety layers:

### 1. Role-Based Access Control
Each persona can only access tools relevant to their role.

### 2. Risk Scoring
Every action is scored 0-100 for risk level.

### 3. Approval Workflow
High-risk actions always require human approval.

### 4. Audit Logging
Every action is permanently logged.

### 5. Undo/Rollback
Many actions can be reversed if needed.

### 6. Rate Limiting
Prevents accidental bulk operations.

## Advanced Features

### Board Meetings (Coming Soon)

Have multiple personas collaborate:
```
You: "Let's discuss Q4 strategy"

CEO: "I'll find target companies in our top 3 markets"
[Executes vpa_prospects.search]

CMO: "I'll create content for those markets"
[Executes vpa_content.generate]

CFO: "I'll project revenue based on this pipeline"
[Executes vpa_pipeline.forecast]
```

### Automated Workflows (Coming Soon)

Set up recurring VEA actions:
- Weekly prospect reports
- Monthly invoice generation
- Daily social media posts
- Automatic follow-ups

### Custom Tools (Enterprise)

Connect your own services:
- Internal CRM
- Custom databases
- Proprietary tools
- Legacy systems

## Getting Help

### In-App Help
- **?** icon for contextual help
- **Examples** button for common commands
- **History** to see what works

### Documentation
- [Setup Guide](./SETUP.md)
- [Architecture Docs](./VEA_ARCHITECTURE.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [API Reference](./API.md)

### Support
- Email: support@yourdomain.com
- Docs: https://docs.yourdomain.com
- Community: https://community.yourdomain.com

## Privacy & Security

### Your Data
- VEA actions are private to your tenant
- Data is encrypted in transit and at rest
- No data shared between tenants
- You can delete action history anytime

### Third-Party Services
- MCP modules use your API keys
- Credentials stored securely
- You control what services to connect
- Can revoke access anytime

### Compliance
- SOC 2 Type II certified
- GDPR compliant
- HIPAA available (Enterprise)
- Regular security audits

## Pricing

### Included Actions
Free tier includes:
- 100 actions/month
- All personas
- Basic modules
- 30-day history

### Paid Plans
**Professional:** 500 actions/month
**Business:** 2,000 actions/month
**Enterprise:** Unlimited actions

See [Pricing](https://yourdomain.com/pricing) for details.

---

**Welcome to VEA - Your Virtual Executive Assistant!**

Get started by asking your CEO to find some prospects in your target market. 🚀
