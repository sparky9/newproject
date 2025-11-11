# Lead Gen App - Complete Module Ecosystem Catalog

**Generated:** November 11, 2025  
**Status:** All 16 modules documented  
**Architecture:** MCP-based modular system for solopreneurs and agencies

---

## ECOSYSTEM OVERVIEW

The lead-gen-app is a comprehensive business automation platform built on Model Context Protocol (MCP). It unifies 16 specialized modules that handle all aspects of business operations from lead generation to financial management.

### Core Integration Pattern
- **Transport:** MCP stdio (Claude Desktop/Mobile compatible)
- **Database:** Shared Neon PostgreSQL (multi-tenant)
- **Orchestration:** VPA Core routes commands to appropriate modules
- **Cost Model:** Per-user monthly subscription with module bundles

### Business Domains Covered
1. **Lead Generation & Prospecting**
2. **Sales Pipeline & CRM**
3. **Communication & Outreach**
4. **Client Management**
5. **Content & Marketing**
6. **Financial Operations**
7. **Time & Billing**
8. **Reputation & Reviews**
9. **Task & Project Management**
10. **Calendar & Meetings**

---

## MODULES (A-Z)

### 1. BOOKKEEPING ASSISTANT MCP
**Purpose:** Deterministic financial management for solopreneurs  
**Category:** Financial Operations

#### Key Features
- Transaction Management (categorized income/expense tracking)
- Professional Invoice Generation (HTML templates with tax handling)
- Expense Tracking with Receipt OCR
- Financial Reporting (P&L, cash flow, balance sheet, tax summaries)
- Multi-Currency Support with automatic USD conversion
- Tax Calculation (deterministic brackets and deductions)
- Account Reconciliation with bank statement matching
- Budget Planning with historical trend analysis
- Cash Flow Forecasting with scenario analysis
- Report Exports (PDF, Excel, CSV) with audit trails

#### Tools (14 total)
1. `add_transaction` - Record income/expense transactions
2. `generate_invoice` - Create professional invoices
3. `track_expense` - Log business expenses with receipts
4. `generate_report` - Financial reports (P&L, cash flow, balance sheet, tax)
5. `calculate_tax` - Estimated tax calculations with deductions
6. `categorize_transactions` - AI-powered transaction categorization
7. `reconcile_accounts` - Match bank statements to recorded transactions
8. `budget_planning` - Create and manage budgets
9. `cash_flow_forecast` - Project future cash flows
10. `scan_receipt` - OCR receipt images and auto-create expenses
11. `export_report` - Export reports in PDF/Excel/CSV
12. `get_audit_trail` - Retrieve transaction change history

#### Problems Solved
- Eliminates manual bookkeeping (deterministic categorization)
- Prevents tax liability surprises (proactive calculations)
- Improves cash flow visibility (forecasting)
- Ensures compliance (audit trails, multi-currency tracking)

#### Integration Points
- **LeadTracker Pro:** Account health scoring uses financial data
- **Time Billing Agent:** Invoice data for profitability analysis
- **Retention Renewal Agent:** Contract renewal financial tracking

**Tech Stack:** TypeScript, PostgreSQL, Node.js MCP SDK, Winston logging

---

### 2. CALENDAR MEETING AGENT MCP
**Purpose:** Intelligent calendar and meeting management  
**Category:** Calendar & Meetings

#### Key Features
- Availability Ingestion (multi-person calendar sync)
- Smart Meeting Slot Proposal (timezone-aware, conflict-free)
- Automated Agenda Generation (meeting-specific structure)
- Meeting Summary Generation (action items, decisions)
- Meeting Insights (participation metrics, decision outcomes)
- Deterministic scheduling engine (no external APIs required)

#### Tools (6 total)
1. `ingest_availability` - Import calendar availability from multiple people
2. `propose_meeting_slots` - Generate conflict-free meeting times
3. `schedule_meeting` - Book the meeting and send confirmations
4. `generate_agenda` - Create meeting-specific agenda
5. `generate_summary` - Summarize completed meetings with action items
6. `generate_insights` - Extract insights and decision outcomes

#### Problems Solved
- Eliminates scheduling back-and-forth (automated proposal)
- Prevents double-booking (conflict detection)
- Ensures productive meetings (structured agendas)
- Captures follow-ups (action item extraction)

#### Integration Points
- **Task Project Manager:** Meeting action items become tasks
- **Email Orchestrator:** Send calendar invites and reminders
- **Client Onboarding Agent:** Kickoff meeting coordination
- **ProspectFinder:** Schedule intro calls with prospects

**Tech Stack:** TypeScript, chrono-node (date parsing), date-fns-tz (timezone), ical.js

---

### 3. CLIENT ONBOARDING AGENT MCP
**Purpose:** AI-powered client onboarding coordination  
**Category:** Client Management

#### Key Features
- Template Library (reusable onboarding playbooks by service/industry/tier)
- Intake Automation (generates checklists, forms, document requests)
- Kickoff Coordination (availability reconciliation, call prep)
- Welcome Sequences (multi-touch first-week communications)
- Progress Digests (internal standups, client updates)
- System Sync (structured payloads for CRMs, project tools)
- Automation Event Tracking (full lifecycle logging)

#### Tools (9 total)
1. `onboarding_template_list` - Browse organization + global templates
2. `onboarding_template_save` - Create/update templates
3. `onboarding_plan_generate` - Create plan from template (logs automation events)
4. `onboarding_plan_status` - Fetch live progress with completion %
5. `onboarding_intake_summary` - Draft customer-facing reminders
6. `onboarding_kickoff_schedule` - Reconcile availability for kickoff
7. `onboarding_welcome_sequence` - Compose first-week communications
8. `onboarding_progress_digest` - Summarize wins, blockers, next actions
9. `onboarding_sync_update` - Emit CRM/project tool integration payloads

#### Problems Solved
- Standardizes client onboarding (reusable templates)
- Prevents missed deliverables (intake automation)
- Speeds up kickoff (automated availability coordination)
- Improves client satisfaction (structured welcome)
- Keeps systems in sync (downstream integrations)

#### Integration Points
- **Email Orchestrator:** Send welcome sequences
- **Task Project Manager:** Create onboarding tasks
- **Support Agent:** Onboarding ticket resolution
- **Calendar Meeting Agent:** Schedule kickoff calls

**Tech Stack:** TypeScript, PostgreSQL, Zod validation, Winston logging

---

### 4. CONTENT WRITER MCP
**Purpose:** AI-powered content generation for marketing and communication  
**Category:** Content & Marketing

#### Key Features
- Email Generation (cold outreach, newsletters, announcements)
- Blog Post Generation (SEO-optimized with structure)
- Social Media Post Generation (platform-optimized)
- Headline Generation (A/B testing variations)
- Knowledge Base Article Generation (FAQ, how-to, troubleshooting)
- Content Rewriting (improve clarity, shorten, professionalize)
- Content Summarization (key points extraction)
- Content Expansion (notes to comprehensive articles)
- Brand Voice Management (store and apply brand guidelines)
- Template Library (reusable content templates with variables)

#### Tools (10 total)
1. `generate_email` - Professional emails for any purpose
2. `generate_blog_post` - SEO-optimized blog content
3. `generate_social_post` - Platform-specific social media posts
4. `generate_headlines` - Multiple headline variations for A/B testing
5. `generate_kb_article` - FAQ, how-to, troubleshooting articles
6. `rewrite_content` - Improve, shorten, or repurpose content
7. `summarize_content` - Extract key points and summaries
8. `expand_content` - Transform notes into comprehensive content
9. `save_brand_voice` - Store brand voice profiles
10. `list_content_templates` - Access reusable templates

#### Problems Solved
- Eliminates writer's block (AI generation)
- Ensures brand consistency (voice profiles)
- Optimizes for search (SEO-aware generation)
- Saves production time (batch generation)
- Enables A/B testing (multiple variations)

#### Integration Points
- **Email Orchestrator:** Generate campaign emails
- **Social Media Manager:** Generate social posts
- **Proposal Contract Agent:** Draft proposal text
- **Client Onboarding Agent:** Generate welcome sequences
- **Support Agent:** Generate KB articles

**Tech Stack:** TypeScript, Anthropic Claude API, Zod validation, Winston logging

---

### 5. EMAIL ORCHESTRATOR MCP
**Purpose:** AI-powered multi-touch email campaign automation  
**Category:** Communication & Outreach

#### Key Features
- Multi-Touch Campaign Creation (email sequences with intelligent timing)
- AI Personalization (Claude-powered dynamic content)
- Email Provider Flexibility (Gmail API or SMTP)
- Smart Automation (auto-pause on reply, timezone-aware scheduling)
- Full Tracking (opens, clicks, replies, bounces)
- CAN-SPAM Compliance (built-in unsubscribe, address, links)
- Campaign Analytics (performance metrics, engagement tracking)
- Template Management (reusable campaign templates)
- One-off Email Sending (outside campaigns)
- Unsubscribe Management (global list, compliance)

#### Tools (9 total)
1. `create_campaign` - New multi-touch email campaign
2. `add_email_sequence` - Add email to campaign sequence
3. `start_campaign` - Launch campaign and enroll prospects
4. `create_template` - Reusable email template
5. `send_email` - One-off email (not part of campaign)
6. `get_campaign_stats` - Detailed analytics and performance
7. `pause_resume_campaign` - Campaign execution control
8. `get_email_history` - All emails sent to prospect
9. `manage_unsubscribes` - Global unsubscribe list management

#### Problems Solved
- Eliminates manual email sending (automation)
- Improves response rates (AI personalization)
- Tracks engagement (opens, clicks, replies)
- Ensures deliverability (CAN-SPAM compliance)
- Prevents over-contact (auto-pause on reply)

#### Integration Points
- **ProspectFinder:** Target prospects from scraping results
- **LeadTracker Pro:** Campaign enrollment from pipeline
- **Content Writer:** Generate personalized email content
- **Calendar Meeting Agent:** Schedule follow-up based on opens
- **Support Agent:** Detect replies and escalate

**Tech Stack:** TypeScript, Gmail API / SMTP, PostgreSQL, Anthropic Claude API

---

### 6. IMAGE STUDIO MCP
**Purpose:** AI-powered image generation, transformation, and real estate staging  
**Category:** Content & Marketing

#### Key Features
- Text-to-Image Generation (reusable style presets)
- Virtual Staging for Real Estate (side-by-side comparisons)
- Image-to-Image Transformations (restyling, lighting, seasonal swaps)
- Deterministic Cost Tracking (Replicate model pricing)
- CLI and MCP Interface (standalone or Claude Desktop)
- Fine-Grained Control (resolution, prompt strength, seeds, negatives)
- Cost Analytics (monthly summaries, CSV exports)
- Custom Style Presets (save and manage)
- WebP Export Variants (automatic optimization)
- Revision History (inspect prior runs)
- Batch Processing (production workflows with CSV templates)

#### Tools (11 total)
1. `generate_image` - Text-to-image generation
2. `transform_image` - Image restyling and transformations
3. `stage_image` - Virtual staging for rooms
4. `batch_stage_images` - Stage entire folder
5. `generate_style_variations` - Multiple preset variants
6. `list_styles` - Reference styling presets
7. `validate_token` - Verify Replicate connectivity
8. `get_cost_summary` - Monthly spend and breakdowns
9. `create_style` - Save custom style presets
10. `remove_style` - Delete custom styles
11. `list_custom_styles` - View saved presets
12. `list_revisions` - Inspect revision history
13. `get_revision` - View specific run metadata

#### Problems Solved
- Eliminates manual Photoshop work (AI generation)
- Improves real estate listing appeal (virtual staging)
- Reduces production costs (batch processing)
- Enables A/B testing (multiple variations)
- Provides cost visibility (built-in analytics)

#### Integration Points
- **Content Writer:** Generate images for blog posts
- **Social Media Manager:** Create social media graphics
- **Proposal Contract Agent:** Generate proposal images
- **Email Orchestrator:** Add images to campaign emails

**Tech Stack:** TypeScript, Replicate API, WebP, Playwright

---

### 7. LEADTRACKER PRO MCP
**Purpose:** MCP-native CRM for B2B sales pipeline management  
**Category:** Sales Pipeline & CRM

#### Key Features
- Pipeline Management (track prospects through sales stages)
- Batch Operations (bulk status/tag updates)
- High-Performance Import (1000+ prospects in 5 seconds)
- Activity Logging (calls, emails, meetings with retention rules)
- Follow-up Reminders (due date tracking)
- Multi-Contact Support (multiple decision makers per company)
- ProspectFinder Integration (direct import)
- Pipeline Analytics (conversion rates, win rates)
- Tunable Scoring (configurable weights without code)
- Next-Action Intelligence (prioritized follow-ups)
- Win/Loss Coaching (identify top sources, deal slippage)
- Client Health Monitoring (engagement, payments, responsiveness)
- Upsell Intelligence (detect expansion opportunities)

#### Tools (16 total)
1. `add_prospect` - Create new prospect in CRM
2. `add_contact` - Add contact person to prospect
3. `update_prospect_status` - Update pipeline status with auto-logging
4. `log_activity` - Record calls, emails, meetings, notes
5. `search_prospects` - Search and filter prospects
6. `get_follow_ups` - View pending follow-up reminders
7. `get_pipeline_stats` - Pipeline metrics and analytics
8. `import_prospects` - Import from ProspectFinder JSON
9. `get_next_actions` - Highest-impact follow-ups with context
10. `get_win_loss_report` - Analyze closed deals for insights
11. `batch_update_status` - Bulk status updates with auto-logging
12. `batch_manage_tags` - Bulk add/remove tags
13. `batch_delete_prospects` - Delete multiple prospects (requires confirmation)
14. `analyze_client_health` - Health score with risk factors
15. `detect_upsell_opportunities` - Find cross-sell opportunities
16. `generate_upsell_pitch` - Create upsell email pitch

#### Problems Solved
- Eliminates spreadsheet chaos (proper CRM)
- Prevents deal slippage (reminder system)
- Accelerates imports (6x faster than before)
- Identifies top sources (win/loss reporting)
- Surfaces expansion opportunities (upsell detection)

#### Integration Points
- **ProspectFinder:** Import scraped prospects
- **Email Orchestrator:** Campaign enrollment
- **Task Project Manager:** Create tasks for follow-ups
- **Bookkeeping Assistant:** Deal value tracking
- **Retention Renewal Agent:** Contract renewal monitoring
- **Support Agent:** Prospect context in support tickets

**Tech Stack:** TypeScript, PostgreSQL (Neon), MCP SDK, Winston logging, Zod validation

---

### 8. PROPOSAL & CONTRACT AGENT MCP
**Purpose:** AI-powered proposal generation and contract workflows  
**Category:** Sales & Legal

#### Key Features
- Template Library (reusable proposal/contract templates with tokens)
- Proposal Builder (merge templates with client data, pricing, clauses)
- Contract Composer (convert proposals to contracts with renewals)
- Signature Tracking (sends, opens, signatures, reminders)
- Follow-up Automation (reminders for unsigned docs, CRM nudges)
- Lifecycle Management (from proposal to signed contract)
- Renewal Support (contract renewal workflows)

#### Tools (9 total)
1. `template_list` - List templates with required tokens
2. `template_save` - Create or update template
3. `proposal_generate` - Merge template with client data
4. `proposal_send` - Mark proposal sent and log event
5. `proposal_status` - Retrieve proposal details and history
6. `contract_generate` - Convert proposal to contract
7. `contract_send` - Send contract with signature link and deadline
8. `contract_status` - Inspect signature status and timeline
9. `signature_remind` - Generate reminder for outstanding signatures

#### Problems Solved
- Standardizes proposal formatting (template library)
- Speeds up proposal creation (template merging)
- Tracks signature status (no more lost contracts)
- Ensures follow-up (reminder automation)
- Automates renewal process (contract lifecycle)

#### Integration Points
- **Content Writer:** Generate proposal text
- **Email Orchestrator:** Send proposals and follow-ups
- **LeadTracker Pro:** Proposal status in pipeline
- **Task Project Manager:** Create signature follow-up tasks
- **Bookkeeping Assistant:** Track contract values

**Tech Stack:** TypeScript, PostgreSQL, MCP SDK, Winston logging

---

### 9. PROSPECT FINDER MCP
**Purpose:** MCP-native B2B prospect finder with web scraping and RAG  
**Category:** Lead Generation & Prospecting

#### Key Features
- Company Search (by industry, location, size)
- Decision Maker Finding (with contact information)
- Company Data Enrichment (LinkedIn, website data)
- Prospect Export (CSV, JSON, Google Sheets)
- Scraping Progress Tracking (data quality metrics)
- Yellow Pages Scraper (100% phone coverage, fully working)
- Proxy Support (provider-agnostic rotation strategies)
- Rate Limiting (per-source, configurable)
- Browser Pool (Playwright with stealth mode)
- RAG Intelligence (pgvector deduplication)
- Standalone Tools (no database required)

#### Tools (9 total)
1. `search_companies` - Find companies by industry and location
2. `find_decision_makers` - Find key contacts at company
3. `enrich_company` - Add missing data (employee count, revenue, LinkedIn)
4. `export_prospects` - Export prospect data (CSV, JSON, Google Sheets)
5. `get_scraping_stats` - View system statistics and data quality
6. `support_rag_query` - Search local knowledge base
7. `support_agent` - Autonomous support agent
8. `find_partnership_opportunities` - Search complementary businesses
9. `generate_partnership_pitch` - Create co-marketing outreach template

#### Problems Solved
- Eliminates manual prospecting (automated scraping)
- Finds hard-to-reach data (phone numbers, email)
- Speeds up list building (bulk export)
- Enriches company data (LinkedIn/website info)
- Prevents duplicates (RAG deduplication)

#### Integration Points
- **LeadTracker Pro:** Import prospects directly
- **Email Orchestrator:** Target prospects with campaigns
- **Calendar Meeting Agent:** Schedule calls with prospects
- **Retention Renewal Agent:** Find partnership opportunities
- **Support Agent:** Knowledge base queries

**Tech Stack:** TypeScript, Playwright, PostgreSQL (Neon), pgvector, Winston logging

---

### 10. REPUTATION & REVIEW AGENT MCP
**Purpose:** Automate testimonial, review, and reputation management  
**Category:** Reputation & Reviews

#### Key Features
- Testimonial Request Automation (post-project requests)
- Testimonial Recording (capture with rating and permissions)
- Review Site Funnel (platform-specific follow-up messaging)
- Review Status Tracking (completion monitoring)
- Negative Feedback Triage (capture before going public)
- Case Study Generation (turn testimonials into content)
- Reputation Analytics (metrics dashboard)
- Testimonial Filtering (search and organize)

#### Tools (8 total)
1. `reputation_request_testimonial` - Create testimonial request
2. `reputation_record_testimonial` - Log received testimonials
3. `reputation_funnel_to_review_site` - Generate review follow-up messaging
4. `reputation_track_review_status` - Track review request completion
5. `reputation_triage_negative_feedback` - Capture negative feedback
6. `reputation_generate_case_study` - Turn testimonials into case studies
7. `reputation_get_stats` - Summarize reputation metrics
8. `reputation_list_testimonials` - Filter and list testimonials

#### Problems Solved
- Increases testimonial quantity (automation)
- Captures negative feedback early (triage)
- Turns testimonials into marketing content (case studies)
- Prevents reputation damage (early warning)
- Creates social proof (organized testimonial library)

#### Integration Points
- **Email Orchestrator:** Send testimonial requests
- **Content Writer:** Generate case studies from testimonials
- **Social Media Manager:** Share testimonials on social
- **Task Project Manager:** Create testimonial follow-up tasks
- **Support Agent:** Alert on negative feedback

**Tech Stack:** TypeScript, PostgreSQL, Zod validation, Winston logging, Vitest

---

### 11. RESEARCH INSIGHTS MCP
**Purpose:** Competitive intelligence and research monitoring  
**Category:** Business Intelligence

#### Key Features
- Source Monitoring (add URLs to track)
- Change Detection (diff previous snapshots)
- Digest Generation (headlines, highlights, narratives)
- On-Demand Scanning (ad-hoc topic research)
- Source Management (add, remove, update)
- Snapshot Persistence (research history)
- Frequency Scheduling (customizable cadence)

#### Tools (7 total)
1. `research_add_source` - Add URL to monitor
2. `research_list_sources` - List all sources with metadata
3. `research_remove_source` - Delete monitored source
4. `research_run_monitor` - Capture sources and diff changes
5. `research_get_digest` - Generate digest from recent captures
6. `research_on_demand` - Ad-hoc scan for topic
7. `research_update_source` - Refresh labels, URLs, notes, cadence

#### Problems Solved
- Eliminates manual research (automated monitoring)
- Stays competitive (intelligence tracking)
- Identifies trends early (change detection)
- Saves research time (automated digests)
- Personalizes intelligence (source organization)

#### Integration Points
- **Content Writer:** Research for blog posts
- **Proposal Contract Agent:** Competitive research
- **Email Orchestrator:** Market research for campaigns
- **Task Project Manager:** Create research tasks
- **Social Media Manager:** Monitor industry trends

**Tech Stack:** TypeScript, PostgreSQL, Playwright, Anthropic Claude API, Winston logging

---

### 12. RETENTION & RENEWAL AGENT MCP
**Purpose:** Protect recurring revenue through proactive renewal management  
**Category:** Customer Management

#### Key Features
- Renewal Horizon Tracking (contract end date monitoring)
- Health Signal Consolidation (product usage, support, NPS/CSAT)
- Risk Detection (at-risk account identification)
- Renewal Playbook Generation (tailored win-back sequences)
- Renewal Pipeline Dashboard (stages, forecast, blockers)
- Downstream Sync (CRM, helpdesk, CSM notes)
- Lifecycle Event Logging (full audit trail)
- Slack Alerts (real-time risk notifications)

#### Tools (Not fully listed in docs, but includes)
- `renewal_get_horizon` - Track upcoming renewal dates
- `renewal_get_health_score` - Consolidate health signals
- `renewal_detect_risk` - Identify at-risk accounts
- `renewal_generate_playbook` - Create renewal playbook
- `renewal_sync_update` - Emit integration payloads

#### Problems Solved
- Prevents revenue churn (proactive renewal)
- Identifies at-risk accounts early (health scoring)
- Personalizes renewal approach (playbook templates)
- Automates follow-ups (task creation)
- Keeps all systems in sync (downstream integrations)

#### Integration Points
- **LeadTracker Pro:** Client health monitoring
- **Email Orchestrator:** Send renewal sequences
- **Proposal Contract Agent:** Generate renewal proposals
- **Task Project Manager:** Create renewal tasks
- **Calendar Meeting Agent:** Schedule renewal calls
- **Support Agent:** Track customer satisfaction signals

**Tech Stack:** TypeScript, PostgreSQL, Zod validation, Winston logging

---

### 13. SOCIAL MEDIA MANAGER MCP
**Purpose:** Deterministic social media management for solopreneurs  
**Category:** Content & Marketing

#### Key Features
- Post Generation (platform-aware with deterministic templates)
- Content Scheduling (optimal engagement windows)
- Performance Analytics (snapshot analytics without API calls)
- Hashtag Research (curated, repeatable suggestions)
- Competitor Analysis (comparative breakdowns)
- Competitor Pricing Intelligence (track competitor rates)
- Content Calendar (multi-week balanced mix)
- Timing Optimization (audience-aware posting)
- Trend Monitoring (industry and keyword trends)
- Thread Generation (multi-post threads)

#### Tools (10+ total)
1. `generate_post` - Platform-optimized social posts
2. `schedule_post` - Schedule posts for optimal times
3. `get_analytics` - Performance analytics and insights
4. `research_hashtags` - Effective hashtag suggestions
5. `analyze_competitors` - Competitive social strategy analysis
6. `generate_content_calendar` - Strategic content calendar
7. `optimize_post_timing` - Best time to post
8. `monitor_trends` - Track trending topics and conversations
9. `monitor_competitor_pricing` - Track competitor pricing
10. `analyze_market_position` - Compare pricing vs competitors
11. `generate_thread` - Multi-post threads for Twitter/LinkedIn

#### Problems Solved
- Eliminates content writer's block (generation)
- Ensures platform compliance (platform-specific output)
- Improves engagement (optimal timing)
- Benchmarks pricing (competitor tracking)
- Maintains consistency (content calendar)

#### Integration Points
- **Content Writer:** Generate social post text
- **Image Studio:** Create social graphics
- **Research Insights:** Monitor industry trends
- **Email Orchestrator:** Share campaigns on social
- **Task Project Manager:** Track social tasks

**Tech Stack:** TypeScript, PostgreSQL, Deterministic templates, Winston logging

---

### 14. SUPPORT AGENT MCP
**Purpose:** Autonomous customer support with local RAG knowledge base  
**Category:** Customer Support

#### Key Features
- RAG-Based Search (local SQLite knowledge base)
- End-to-End Ticket Resolution (draft reply, ask follow-ups, escalate)
- Knowledge Base Query (direct search by question)
- Anthropic Claude Integration (grounded ticket responses)
- Offline Mode (mock responses without API)
- Ticket Metadata Handling (priority, channel, customer context)
- Escalation Workflows (when to escalate with rationale)

#### Tools (2 total)
1. `support_agent` - Resolve ticket end-to-end
2. `support_rag_query` - Search knowledge base directly

#### Problems Solved
- Reduces support ticket volume (automated resolution)
- Improves response time (instant replies)
- Ensures consistent responses (RAG grounding)
- Prevents knowledge loss (searchable knowledge base)
- Enables offline mode (no API required)

#### Integration Points
- **Client Onboarding Agent:** Onboarding ticket support
- **Email Orchestrator:** Detect and handle email replies
- **Task Project Manager:** Escalate to human review
- **Content Writer:** Generate KB articles for knowledge base
- **Research Insights:** Search knowledge base

**Tech Stack:** TypeScript, SQLite (local), Xenova embeddings, Anthropic Claude API, Winston logging

---

### 15. TASK & PROJECT MANAGER MCP
**Purpose:** Keep solopreneurs on top of every commitment  
**Category:** Task & Project Management

#### Key Features
- To-Do Intelligence (normalize, score priority, group into focus lists)
- Deadline Tracking (monitor due dates, flag risk, surface blockers)
- Priority Recommendations (transparent scoring model)
- Progress Reports (daily/weekly summaries with velocity)
- Project Awareness (roll tasks up to projects)
- Focus Lists (Now/Next/Later organization)
- Velocity Metrics (completion tracking)

#### Tools (Core set includes)
- `task_add` - Create task
- `task_update` - Update task status/properties
- `task_get_focus` - Get Now/Next/Later priorities
- `task_recommend` - Get priority recommendations
- `task_report` - Generate progress report
- `project_add` - Create project
- `project_get_status` - Project status summary

#### Problems Solved
- Eliminates task lists getting lost (persistent storage)
- Prioritizes what matters (intelligent scoring)
- Prevents deadline misses (reminder system)
- Provides visibility (progress reports)
- Improves team alignment (project awareness)

#### Integration Points
- **Calendar Meeting Agent:** Convert meeting actions to tasks
- **Client Onboarding Agent:** Onboarding task creation
- **Email Orchestrator:** Follow-up task creation
- **Proposal Contract Agent:** Signature follow-up tasks
- **Support Agent:** Escalation tasks
- **Retention Renewal Agent:** Renewal tasks

**Tech Stack:** TypeScript, PostgreSQL, MCP SDK, Winston logging

---

### 16. TIME & BILLING AGENT MCP
**Purpose:** Track billable hours, manage rates, and generate invoices  
**Category:** Financial Operations

#### Key Features
- Time Tracking (billable hour logging)
- Rate Card Management (service-specific rates)
- Invoice Generation (from tracked time)
- Invoice Sending (with delivery tracking)
- Payment Recording (track received payments)
- Payment Reminders (automated follow-ups)
- Profitability Analytics (hourly rates, project profitability)
- Multi-Currency Support (configurable defaults)
- Invoice Status Tracking (sent, viewed, paid)

#### Tools (10+ total)
1. `time_track_entry` - Log billable hours
2. `time_get_entries` - Retrieve time entries
3. `billing_set_rate_card` - Define service rates
4. `billing_get_rate_cards` - Retrieve rate cards
5. `billing_generate_invoice` - Create invoice from time entries
6. `billing_send_invoice` - Send invoice
7. `billing_track_invoice_status` - Monitor invoice status
8. `billing_record_payment` - Log received payment
9. `billing_generate_payment_reminder` - Create payment reminder
10. `billing_get_profitability_report` - Profitability analytics

#### Problems Solved
- Eliminates manual time tracking (automatic logging)
- Prevents undercharging (rate card management)
- Speeds up invoicing (automatic generation)
- Improves payment collection (reminders)
- Provides profitability visibility (analytics)

#### Integration Points
- **Bookkeeping Assistant:** Invoice data integration
- **Task Project Manager:** Time entries per project
- **Email Orchestrator:** Send invoices and reminders
- **LeadTracker Pro:** Deal profitability tracking
- **Calendar Meeting Agent:** Bill meeting time

**Tech Stack:** TypeScript, PostgreSQL (optional, in-memory fallback), Zod validation, Winston logging

---

## INTEGRATION ARCHITECTURE

### Data Flow Patterns

#### Pattern 1: Lead Generation → Sales Pipeline
```
ProspectFinder → LeadTracker Pro → EmailOrchestrator
   (Scrape)    → (Qualify)      → (Campaign)
                → (Track)        → (Monitor)
```

#### Pattern 2: Sales Execution
```
ProspectFinder
    ↓
LeadTracker Pro → Calendar Meeting Agent → Email Orchestrator
    ↓                  ↓                          ↓
(Pipeline)    (Schedule calls)           (Send follow-ups)
    ↓                  ↓                          ↓
Task Project Manager → Time Billing Agent
(Task tracking)      (Invoice for time)
```

#### Pattern 3: Content & Marketing
```
Research Insights → Content Writer → Social Media Manager
   (Research)    → (Generate)      → (Schedule/Track)
                                         ↓
                                   Email Orchestrator
                                   (Share campaigns)
```

#### Pattern 4: Client Lifecycle
```
Client Onboarding Agent → Support Agent → Retention Renewal Agent
    (Intake)           → (Tickets)      → (Renewals)
         ↓                   ↓                  ↓
Email Orchestrator → Task Project Manager → Bookkeeping Assistant
  (Communications) → (Track progress)      (Financial tracking)
```

### Database Schema Integration

**Shared Tables (Multi-Tenant):**
- `users` - User management
- `user_subscriptions` - Billing/plan info
- `user_usage` - Audit/analytics
- `user_module_config` - Per-module settings

**Module-Specific Tables:**
- **ProspectFinder:** companies, decision_makers, scraping_jobs
- **LeadTracker Pro:** prospects, contacts, activities, follow_ups, upsell_opportunities
- **EmailOrchestrator:** campaigns, email_sequences, sent_emails, email_tracking
- **Bookkeeping:** transactions, invoices, expenses, receipts
- **Calendar:** calendar_events, attendee_availability, meeting_notes
- **Task Manager:** task_projects, task_items
- **Time Billing:** time_entries, rate_cards, invoices, payments
- **Support:** support_tickets, knowledge_base, solutions
- **Client Onboarding:** onboarding_plans, templates, intake_requirements
- **Reputation:** testimonials, reviews, case_studies
- **Retention:** contract_renewals, customer_health_scores
- **Research:** research_sources, research_snapshots

### Security & Multi-Tenancy

**Access Control:**
- All queries scoped by `user_id`
- Module-level access enforcement in VPA Core
- Usage tracking for all operations
- Audit trails for sensitive operations

**Authentication:**
- License key-based activation
- Stripe integration for subscriptions
- Session-based access (Claude Desktop)

---

## USE CASES & WORKFLOWS

### Use Case 1: Complete Lead Generation Pipeline

**Scenario:** Solopreneur wants to find, qualify, and email 100 HVAC contractors in Dallas

**Workflow:**
1. ProspectFinder: Scrape HVAC contractors in Dallas (Yellow Pages)
   ```
   "Find HVAC companies in Dallas with 4+ star ratings"
   ```

2. Export to JSON and import into LeadTracker Pro
   ```
   import_prospects(file: "hvac-dallas.json", tags: ["hvac", "dallas"])
   ```

3. Create Email Campaign in EmailOrchestrator
   ```
   create_campaign(target_tags: ["hvac"], sequences: [...])
   add_email_sequence(personalized templates with AI)
   start_campaign()
   ```

4. Monitor in LeadTracker Pro
   ```
   get_pipeline_stats() → View campaign effectiveness
   get_next_actions() → Prioritize follow-ups
   ```

5. Schedule follow-up calls with Calendar Meeting Agent
   ```
   propose_meeting_slots() → Book calls with interested prospects
   ```

**Result:** End-to-end prospecting workflow without leaving Claude Desktop

---

### Use Case 2: Onboarding New Client

**Scenario:** Agency takes on new SaaS client

**Workflow:**
1. Client Onboarding Agent: Generate onboarding plan
   ```
   onboarding_plan_generate(template: "saas-standard", client: "Acme Corp")
   ```

2. Email Orchestrator: Send welcome sequence
   ```
   onboarding_welcome_sequence() → Send first-week touchpoints
   ```

3. Calendar Meeting Agent: Schedule kickoff
   ```
   onboarding_kickoff_schedule() → Propose meeting times
   ```

4. Task Project Manager: Create onboarding tasks
   ```
   task_add(type: "onboarding", assigned_to: "team_member")
   ```

5. Support Agent: Handle onboarding questions
   ```
   support_agent() → Answer FAQs from knowledge base
   ```

6. Email Orchestrator: Send follow-ups on deliverables
   ```
   onboarding_intake_summary() → Remind of outstanding items
   ```

**Result:** Structured, trackable onboarding process

---

### Use Case 3: Content Marketing Campaign

**Scenario:** Service provider wants to create content marketing assets

**Workflow:**
1. Research Insights: Research topic
   ```
   research_run_monitor() → Find competitive landscape
   research_get_digest() → Get market insights
   ```

2. Content Writer: Generate blog post
   ```
   generate_blog_post(topic: "industry trends", keywords: [...])
   ```

3. Social Media Manager: Create social posts
   ```
   generate_content_calendar(duration: "4 weeks", platforms: ["linkedin", "twitter"])
   generate_thread() → Create LinkedIn thread
   ```

4. Image Studio: Generate graphics
   ```
   generate_image(prompt: "relevant image for post")
   ```

5. Email Orchestrator: Email subscribers
   ```
   create_campaign(type: "newsletter", content: "blog post excerpt")
   ```

6. Social Media Manager: Schedule posts
   ```
   schedule_post(content: [...], optimal: true)
   ```

**Result:** Complete content marketing assets in one workflow

---

### Use Case 4: Proposal to Invoice Workflow

**Scenario:** Consultant needs to propose work and invoice for completion

**Workflow:**
1. Proposal & Contract Agent: Generate proposal
   ```
   proposal_generate(template: "standard-service", client_data: {...})
   proposal_send(campaign_id: "proposal-001")
   ```

2. Email Orchestrator: Send proposal and follow-ups
   ```
   send_email(type: "proposal", tracking: true)
   ```

3. Calendar Meeting Agent: Schedule discovery call
   ```
   schedule_meeting(type: "proposal discussion")
   ```

4. Once signed: Contract Agent: Convert to contract
   ```
   contract_generate(proposal_id: "...", renewal_terms: {...})
   contract_send() → E-signature link
   ```

5. Time & Billing Agent: Track time during project
   ```
   time_track_entry(project_id: "...", hours: 8)
   ```

6. Time & Billing Agent: Generate invoice
   ```
   billing_generate_invoice(project_id: "...")
   billing_send_invoice()
   ```

7. Follow-up: Send payment reminder
   ```
   billing_generate_payment_reminder(invoice_id: "...")
   ```

8. Record payment:
   ```
   billing_record_payment(invoice_id: "...", amount: 5000)
   ```

9. Analytics:
   ```
   billing_get_profitability_report() → Track project ROI
   ```

**Result:** Complete proposal-to-payment workflow

---

## IMPLEMENTATION ROADMAP

### Phase 1: Foundation (COMPLETE)
- [x] 16 individual MCP modules built
- [x] Standalone tools working
- [x] Database schemas in place
- [x] VPA Core orchestrator framework
- [x] Multi-tenant support structure

### Phase 2: Integration (IN PROGRESS)
- [ ] Deep userId filtering in all tools
- [ ] Cross-module data sync
- [ ] Unified CLI interface
- [ ] Web app scaffolding
- [ ] Stripe integration

### Phase 3: Intelligence
- [ ] LLM-based intent parsing
- [ ] Recommendation engine
- [ ] Predictive analytics
- [ ] Workflow suggestions

### Phase 4: Scale
- [ ] SaaS web application
- [ ] Mobile app support
- [ ] Enterprise features
- [ ] White-label options

---

## DEPLOYMENT & COST

### Per User Monthly Cost

**Infrastructure:**
- Neon PostgreSQL: ~$20-50/month (shared across users)
- Anthropic API: ~$0-5/month (usage-based)
- Email sending: ~$10-20/month (SMTP or Gmail)
- Total per user: ~$30-75/month

**Pricing Strategy:**
- **Starter:** $99/month (ProspectFinder + LeadTracker)
- **Professional:** $149/month (+ EmailOrchestrator + Content Writer)
- **Enterprise:** Custom pricing

### Profitability Model

At 100 users ($99/month):
- Revenue: $9,900/month
- Infrastructure cost: ~$200/month (fixed database cost)
- Anthropic API: ~$200/month (variable)
- Total cost: ~$400/month
- Gross margin: 96%

---

## TECHNOLOGY STACK SUMMARY

### Core Technologies
- **Runtime:** Node.js 18+
- **Language:** TypeScript
- **Protocol:** Model Context Protocol (MCP)
- **Database:** PostgreSQL (Neon)
- **API:** Anthropic Claude API
- **Validation:** Zod

### Key Libraries
- `@modelcontextprotocol/sdk` - MCP transport
- `pg` - PostgreSQL client
- `uuid` - Unique identifiers
- `winston` - Logging
- `date-fns` - Date manipulation
- `zod` - Input validation
- `playwright` - Browser automation
- `tsx` - TypeScript runner

### Infrastructure
- **Hosting:** Local (Claude Desktop) or Cloud VM
- **Database:** Neon PostgreSQL (serverless)
- **APIs:** Anthropic, Gmail, SMTP, Replicate
- **File Storage:** Local filesystem or cloud storage

---

## ECOSYSTEM CAPABILITIES SUMMARY

The lead-gen-app ecosystem provides:

✅ **16 fully integrated modules**  
✅ **100+ MCP tools**  
✅ **Multi-tenant architecture**  
✅ **Complete business automation**  
✅ **Deterministic + AI-powered operations**  
✅ **Claude Desktop native interface**  
✅ **PostgreSQL-backed persistence**  
✅ **Modular, extensible design**  

### What This Solves For Solopreneurs

1. **Lead Generation** - Find and qualify prospects automatically
2. **Sales Pipeline** - Organize and track deals from prospect to closed-won
3. **Client Onboarding** - Standardized, documented onboarding process
4. **Communication** - Email, social, calendar all integrated
5. **Content** - Generated and scheduled across multiple channels
6. **Financial** - Time tracking, invoicing, bookkeeping, all tied together
7. **Customer Success** - Retention management, renewal tracking, feedback capture
8. **Business Intelligence** - Analytics, reporting, competitive insights
9. **Task Management** - Priority tracking and deadline management
10. **Customer Support** - Automated ticket resolution with knowledge base

### Unique Advantages

- **MCP-Native:** Purpose-built for Claude Desktop/Mobile
- **No Monthly APIs:** Deterministic processing reduces external API costs
- **Local Privacy:** Runs locally, data stays under user control
- **Multi-Tenant:** Scales to agencies and teams
- **Integrated:** All modules share data in single database
- **Composable:** Workflow any combination of tools
- **Audited:** Full activity logging and compliance tracking

---

## Document Version & Maintenance

**Version:** 1.0  
**Last Updated:** November 11, 2025  
**Next Review:** Quarterly  
**Maintained By:** Forge Architecture Team  

**To Update:** Review each module's README.md for latest tool definitions and features.
