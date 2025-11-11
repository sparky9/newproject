# Online C Suite - VEA Setup Guide

Complete setup instructions for getting the Online C Suite with VEA (Virtual Executive Assistant) up and running.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Setup](#detailed-setup)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Running the Application](#running-the-application)
- [Testing VEA](#testing-vea)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

- **Node.js** 18+ (20+ recommended)
- **pnpm** 8+ (package manager)
- **PostgreSQL** 14+ (database)
- **Git** (version control)

### Required Accounts/Services

- **Clerk** account for authentication ([clerk.com](https://clerk.com))
- **Fireworks AI** API key ([fireworks.ai](https://fireworks.ai))
- **PostgreSQL** database (local or hosted)

### Optional Services (for production)

- **AWS S3** for file storage
- **Sentry** for error tracking
- **PostHog** for analytics

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/online-csuite.git
cd online-csuite

# 2. Install dependencies
pnpm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your actual values

# 4. Set up the database
pnpm db:migrate

# 5. Generate Prisma client
pnpm db:generate

# 6. Start development servers
pnpm dev
```

---

## Detailed Setup

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/online-csuite.git
cd online-csuite

# Install dependencies (this will take a few minutes)
pnpm install

# Verify installation
pnpm --version  # Should show 8.x or higher
node --version  # Should show v18.x or higher
```

### 2. Database Setup

#### Option A: Local PostgreSQL

```bash
# Install PostgreSQL (if not already installed)
# macOS
brew install postgresql@14
brew services start postgresql@14

# Ubuntu/Debian
sudo apt-get install postgresql-14
sudo systemctl start postgresql

# Create database and user
psql postgres
CREATE DATABASE online_csuite;
CREATE USER csuite_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE online_csuite TO csuite_user;
\q
```

#### Option B: Hosted PostgreSQL

Sign up for a managed PostgreSQL service:
- **Neon** ([neon.tech](https://neon.tech)) - Free tier available
- **Supabase** ([supabase.com](https://supabase.com)) - Free tier available
- **Railway** ([railway.app](https://railway.app)) - Free tier available

Get your connection string and add it to `.env`:
```
DATABASE_URL="postgresql://user:password@host:port/database?schema=public"
```

### 3. Environment Configuration

Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` and fill in these REQUIRED variables:

```env
# Database
DATABASE_URL="postgresql://csuite_user:your_secure_password@localhost:5432/online_csuite?schema=public"

# Clerk Authentication
CLERK_PUBLISHABLE_KEY="pk_test_..."  # From Clerk Dashboard
CLERK_SECRET_KEY="sk_test_..."       # From Clerk Dashboard

# Fireworks AI
FIREWORKS_API_KEY="fw_..."  # From Fireworks AI Dashboard

# API Server
PORT="3001"
API_URL="http://localhost:3001"
CORS_ORIGINS="http://localhost:3000,http://localhost:5173"
```

Optional VEA configuration:
```env
# VEA Configuration
VEA_ENABLED="true"
VEA_USE_MOCK_ORCHESTRATOR="true"  # Start with mock, switch to real later
VEA_REQUIRE_APPROVAL="false"      # Enable in production
VEA_RISK_THRESHOLD="75"
```

### 4. Run Database Migrations

```bash
# Navigate to the database package
cd packages/db

# Run migrations to create tables
pnpm migrate:dev

# Generate Prisma client
pnpm generate

# Return to root
cd ../..
```

Expected tables created:
- `Tenant` - Multi-tenant isolation
- `User` - User accounts
- `BusinessProfile` - Business information
- `Conversation` - Chat conversations
- `Message` - Chat messages
- `PersonaAction` - VEA action audit trail
- And more...

### 5. Verify VEA Core Setup

```bash
# Navigate to VEA Core package
cd packages/vea-core

# Run tests to verify everything works
pnpm build
node test-simple.js

# You should see: "✅ All tests passed!"

# Run the integration demo
node demo-integration.js

# You should see all 5 scenarios complete successfully
```

### 6. Start Development Servers

From the root directory:

```bash
# Start all services (API + Web)
pnpm dev

# Or start individually:
pnpm dev:api   # API server on http://localhost:3001
pnpm dev:web   # Web app on http://localhost:3000
```

---

## Environment Configuration

### Required Environment Variables

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `DATABASE_URL` | PostgreSQL connection string | Your PostgreSQL setup |
| `CLERK_PUBLISHABLE_KEY` | Clerk public key | [Clerk Dashboard](https://dashboard.clerk.com) |
| `CLERK_SECRET_KEY` | Clerk secret key | [Clerk Dashboard](https://dashboard.clerk.com) |
| `FIREWORKS_API_KEY` | Fireworks AI API key | [Fireworks AI](https://fireworks.ai/api-keys) |

### VEA Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VEA_ENABLED` | `true` | Enable VEA tool execution |
| `VEA_USE_MOCK_ORCHESTRATOR` | `true` | Use mock MCP responses (recommended for development) |
| `VEA_REQUIRE_APPROVAL` | `false` | Require user approval for high-risk actions |
| `VEA_RISK_THRESHOLD` | `75` | Risk score (0-100) threshold for approval |

### Development vs Production

**Development** (`.env.development`):
```env
NODE_ENV="development"
VEA_USE_MOCK_ORCHESTRATOR="true"
VEA_REQUIRE_APPROVAL="false"
LOG_LEVEL="debug"
```

**Production** (`.env.production`):
```env
NODE_ENV="production"
VEA_USE_MOCK_ORCHESTRATOR="false"
VEA_REQUIRE_APPROVAL="true"
VEA_RISK_THRESHOLD="50"
LOG_LEVEL="info"
```

---

## Database Setup

### Schema Overview

The VEA integration adds the `PersonaAction` table:

```prisma
model PersonaAction {
  id               String   @id @default(cuid())
  tenantId         String   @map("tenant_id")
  userId           String   @map("user_id")
  personaId        String   @map("persona_id")  // 'ceo', 'cfo', 'cmo', 'cto'
  tool             String   // 'vpa_prospects', 'vpa_email', etc.
  action           String   // 'search', 'create_campaign', etc.
  parameters       Json     // Action parameters
  status           PersonaActionStatus @default(pending)
  riskScore        Int      @map("risk_score")
  requiresApproval Boolean  @default(false)
  result           Json?    // Action result
  createdAt        DateTime @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id])
}
```

### Running Migrations

```bash
# Development migrations
pnpm db:migrate:dev --name add-persona-actions

# Production migrations
pnpm db:migrate:deploy

# Reset database (WARNING: deletes all data)
pnpm db:migrate:reset
```

### Seed Data (Optional)

```bash
# Run seed script to add demo data
pnpm db:seed
```

---

## Running the Application

### Development Mode

```bash
# Start all services
pnpm dev

# Access the application:
# - Web App: http://localhost:3000
# - API: http://localhost:3001
# - API Docs: http://localhost:3001/api/docs
```

### Production Build

```bash
# Build all packages
pnpm build

# Start production server
pnpm start
```

### Docker (Optional)

```bash
# Build Docker image
docker build -t online-csuite .

# Run with Docker Compose
docker-compose up

# Includes:
# - PostgreSQL database
# - API server
# - Web application
```

---

## Testing VEA

### 1. Run Unit Tests

```bash
cd packages/vea-core
pnpm build
node test-simple.js
```

Expected output:
```
✅ CEO has access to multiple tools
✅ CFO has financial tools
✅ CMO has marketing tools
... (all 12 tests pass)
```

### 2. Run Integration Demo

```bash
cd packages/vea-core
node demo-integration.js
```

This runs 5 real-world scenarios:
1. CEO lead generation workflow
2. CFO financial management
3. CMO content marketing
4. Board meeting simulation
5. Access control validation

### 3. Test via API

```bash
# Start the API server
pnpm dev:api

# Send a chat request with VEA enabled
curl -X POST http://localhost:3001/api/c-suite/vea/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN" \
  -d '{
    "message": "Find me 10 HVAC companies in Dallas",
    "personaType": "ceo",
    "veaEnabled": true
  }'
```

The CEO should:
1. Understand the request
2. Execute `vpa_prospects.search` action
3. Return both advice AND action results

### 4. Test in Web UI

1. Navigate to http://localhost:3000
2. Log in with Clerk
3. Start a chat with the CEO
4. Ask: "Find me prospects in the HVAC industry"
5. Watch for:
   - CEO's response
   - Action execution indicator
   - Action results displayed
   - Success/error notifications

---

## Troubleshooting

### Database Connection Issues

**Error:** `Error: P1001: Can't reach database server`

**Solutions:**
1. Verify PostgreSQL is running:
   ```bash
   pg_isready
   ```

2. Check connection string in `.env`:
   ```env
   DATABASE_URL="postgresql://USER:PASS@HOST:PORT/DB?schema=public"
   ```

3. Test connection directly:
   ```bash
   psql "postgresql://USER:PASS@HOST:PORT/DB"
   ```

### Prisma Client Not Generated

**Error:** `Cannot find module '@prisma/client'`

**Solution:**
```bash
cd packages/db
pnpm generate
cd ../..
pnpm install
```

### VEA Not Executing Actions

**Check:**
1. VEA is enabled in `.env`:
   ```env
   VEA_ENABLED="true"
   ```

2. Chat route is using VEA endpoints:
   ```
   POST /api/c-suite/vea/chat  (not /api/c-suite/chat)
   ```

3. Check logs for action detection:
   ```bash
   # Look for:
   [VEA] Action detected in response
   ```

### Mock Orchestrator Not Working

**Check:**
1. Environment variable:
   ```env
   VEA_USE_MOCK_ORCHESTRATOR="true"
   ```

2. Check logs:
   ```bash
   [MockOrchestrator] Executing tool
   ```

3. Verify persona executor initialization:
   ```bash
   [VEA] Persona executor initialized
   ```

### Port Already in Use

**Error:** `Error: listen EADDRINUSE: address already in use :::3001`

**Solution:**
```bash
# Find process using port 3001
lsof -i :3001

# Kill the process
kill -9 PID

# Or use a different port in .env
PORT="3002"
```

### Clerk Authentication Failing

**Check:**
1. Clerk keys are correct in `.env`
2. Clerk app is in development mode
3. CORS origins include your frontend URL:
   ```env
   CORS_ORIGINS="http://localhost:3000"
   ```

4. JWT verification key is set (if using)

### Build Errors

**TypeScript errors:**
```bash
# Clean build artifacts
pnpm clean

# Rebuild everything
pnpm build
```

**Dependency issues:**
```bash
# Clear pnpm cache
pnpm store prune

# Reinstall
rm -rf node_modules
rm pnpm-lock.yaml
pnpm install
```

---

## Next Steps

Once setup is complete:

1. **Explore the Application**
   - Chat with different personas (CEO, CFO, CMO, CTO)
   - Test VEA tool execution
   - Review action audit trail

2. **Connect Real MCP Servers** (when ready)
   - Set `VEA_USE_MOCK_ORCHESTRATOR="false"`
   - Configure individual MCP module endpoints
   - Test with real data

3. **Deploy to Production**
   - Follow [DEPLOYMENT.md](./DEPLOYMENT.md)
   - Set up monitoring and alerts
   - Configure approval workflow

4. **Customize**
   - Add custom persona prompts
   - Create new tool integrations
   - Build approval UI

---

## Support

- **Documentation:** [README.md](./README.md)
- **Architecture:** [VEA_ARCHITECTURE.md](./VEA_ARCHITECTURE.md)
- **Deployment:** [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Issues:** [GitHub Issues](https://github.com/YOUR_USERNAME/online-csuite/issues)

---

**Happy building! 🚀**
