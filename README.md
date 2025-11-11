# Online C Suite with VEA Integration

> **AI-Powered Virtual Executive Assistant** - C-suite personas that don't just advise, they execute.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-18+-green)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-blue)](https://www.postgresql.org/)

## What is this?

Online C Suite is a multi-tenant SaaS platform that provides AI-powered C-suite executives (CEO, CFO, CMO, CTO) for solopreneurs and micro-businesses. With **VEA (Virtual Executive Assistant)** integration, these personas don't just give advice—they actively execute tasks through 16 integrated MCP (Model Context Protocol) modules.

### Key Features

- **4 AI C-Suite Personas** - CEO, CFO, CMO, CTO with distinct expertise
- **16 MCP Modules** - ProspectFinder, LeadTracker, Email, Bookkeeping, Content, Social Media, and more
- **Tool Execution** - Personas can actually DO things, not just advise
- **Multi-Tenant Architecture** - Complete data isolation and security
- **Role-Based Access** - Each persona has access to relevant tools only
- **Approval Workflow** - Risk-based approval system for sensitive actions
- **Full Audit Trail** - Every action logged for compliance and review
- **Real-Time Streaming** - Server-Sent Events for instant responses

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/YOUR_USERNAME/online-csuite.git
cd online-csuite
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL and API keys

# 3. Set up database
pnpm db:migrate
pnpm db:generate

# 4. Test VEA
cd packages/vea-core
pnpm build
node demo-integration.js

# 5. Start development
cd ../..
pnpm dev
```

Access at http://localhost:3000

## Project Structure

```
online-csuite/
├── apps/
│   ├── api/              # Express API server
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── chat-vea.routes.ts    # VEA-enhanced chat
│   │   │   │   └── chat.routes.ts        # Standard chat
│   │   │   └── services/
│   │   │       └── persona-executor-instance.ts  # VEA executor
│   │   └── ...
│   └── web/              # React frontend
│
├── packages/
│   ├── vea-core/         # 🔥 VEA Core - Persona-to-Module bridge
│   │   ├── src/
│   │   │   ├── persona-tools.ts          # Tool registry
│   │   │   ├── persona-executor.ts       # Action executor
│   │   │   └── types.ts                  # TypeScript types
│   │   ├── tests/                        # Unit & integration tests
│   │   ├── test-simple.js               # Standalone test runner
│   │   └── demo-integration.js          # Full demo (5 scenarios)
│   │
│   └── db/               # Database package
│       ├── prisma/
│       │   └── schema.prisma            # Includes PersonaAction model
│       └── migrations/
│           ├── add_persona_actions.sql  # VEA migration
│           └── README.md                # Migration guide
│
├── .env.example          # Environment template
├── SETUP.md              # Comprehensive setup guide
├── DEPLOYMENT.md         # Production deployment checklist
├── VEA_USER_GUIDE.md     # User-facing documentation
├── VEA_ARCHITECTURE.md   # Technical architecture
└── README.md             # This file
```

## VEA Architecture

### How It Works

1. **User Request** → Chat with CEO: "Find me HVAC companies in Dallas"

2. **Tool-Aware Prompt** → CEO knows about ProspectFinder tool

3. **LLM Response** → CEO decides to use `vpa_prospects.search`

4. **Action Parsing** → VEA detects JSON action request in response

5. **Access Control** → Verify CEO can use ProspectFinder

6. **Risk Assessment** → Calculate risk score (0-100)

7. **Approval Check** → Auto-execute if low risk, else ask user

8. **Execution** → Call ProspectFinder via VPA orchestrator

9. **Result Streaming** → Return both advice AND results to user

10. **Audit Logging** → Save action to database for trail

### Key Components

#### @vea/core Package

**Persona Tool Registry** (`persona-tools.ts`)
- 30+ tools across 16 modules
- Role-based access control
- Tool definitions and parameters

**Persona Action Executor** (`persona-executor.ts`)
- Action request validation
- Risk scoring algorithm
- Approval workflow
- Tool execution via orchestrator

**Type Definitions** (`types.ts`)
- PersonaId: 'ceo' | 'cfo' | 'cmo' | 'cto'
- PersonaActionRequest
- PersonaActionResult
- VPAToolName (30+ tools)

#### API Integration

**VEA Chat Routes** (`chat-vea.routes.ts`)
- Tool-aware prompt building
- Action request parsing
- SSE streaming with action results
- Database logging

**Persona Executor Instance** (`persona-executor-instance.ts`)
- Singleton executor
- Mock/real orchestrator toggle
- Database action logger
- Configuration management

## Available Tools by Persona

| Persona | Modules | Example Tools |
|---------|---------|---------------|
| **CEO** | All 16 modules | All tools (universal access) |
| **CFO** | Bookkeeping, Time Billing, LeadTracker, ProspectFinder | `vpa_bookkeeping`, `vpa_time_billing`, `vpa_pipeline` |
| **CMO** | Content, Social, Email, ProspectFinder | `vpa_content`, `vpa_social`, `vpa_email` |
| **CTO** | Client Tools, Technical | `vpa_calendly`, `vpa_zapier`, system tools |

**Total: 30+ tools** across 16 MCP modules

See [VEA_ARCHITECTURE.md](./VEA_ARCHITECTURE.md) for complete tool list.

## Testing

### Unit Tests

```bash
cd packages/vea-core
pnpm build
node test-simple.js
```

Expected: **12/12 tests passing ✅**

### Integration Demo

```bash
cd packages/vea-core
node demo-integration.js
```

Runs 5 real-world scenarios:
1. ✅ CEO lead generation workflow
2. ✅ CFO financial management
3. ✅ CMO content marketing
4. ✅ Board meeting simulation
5. ✅ Access control validation

### API Tests

```bash
cd apps/api
pnpm test
```

## Configuration

### Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection string
- `CLERK_PUBLISHABLE_KEY` - Clerk authentication
- `CLERK_SECRET_KEY` - Clerk authentication
- `FIREWORKS_API_KEY` - LLM provider

VEA-Specific:
- `VEA_ENABLED` - Enable/disable VEA (default: `true`)
- `VEA_USE_MOCK_ORCHESTRATOR` - Use mock or real MCP (default: `true`)
- `VEA_REQUIRE_APPROVAL` - Require approval for high-risk (default: `false`)
- `VEA_RISK_THRESHOLD` - Risk score threshold 0-100 (default: `75`)

See [.env.example](./.env.example) for complete list.

## Documentation

- **[SETUP.md](./SETUP.md)** - Detailed setup instructions
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Production deployment checklist
- **[VEA_USER_GUIDE.md](./VEA_USER_GUIDE.md)** - User-facing guide
- **[VEA_ARCHITECTURE.md](./VEA_ARCHITECTURE.md)** - Technical architecture
- **[Migration Guide](./packages/db/migrations/README.md)** - Database migrations

## Technology Stack

### Backend
- **Node.js** 18+ - Runtime
- **TypeScript** 5.3 - Language
- **Express** - API server
- **Prisma** - Database ORM
- **PostgreSQL** - Database
- **Clerk** - Authentication
- **Fireworks AI** - LLM provider

### Frontend
- **React** 18 - UI framework
- **Vite** - Build tool
- **TailwindCSS** - Styling
- **React Router** - Navigation

### Infrastructure
- **pnpm** - Monorepo management
- **Docker** - Containerization (optional)
- **Railway/Render** - Deployment (recommended)

## Roadmap

### Current (v1.0)
- [x] VEA Core integration
- [x] CEO, CFO, CMO, CTO personas
- [x] 16 MCP modules connected
- [x] 30+ tools available
- [x] Role-based access control
- [x] Risk-based approval workflow
- [x] Audit trail logging
- [x] Mock orchestrator for testing

### Next (v1.1)
- [ ] Approval UI
- [ ] Real VPA-Core orchestrator
- [ ] Board meeting mode (multi-persona)
- [ ] Action history dashboard
- [ ] Webhook integrations
- [ ] Custom tool builder (Enterprise)

### Future (v2.0)
- [ ] Automated workflows
- [ ] Natural language automation
- [ ] Multi-persona collaboration
- [ ] Voice interface
- [ ] Mobile app
- [ ] Marketplace for custom tools

## Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](./LICENSE) file for details.

## Support

- **Documentation:** [Full Docs](https://docs.yourdomain.com)
- **Issues:** [GitHub Issues](https://github.com/YOUR_USERNAME/online-csuite/issues)
- **Discussions:** [GitHub Discussions](https://github.com/YOUR_USERNAME/online-csuite/discussions)
- **Email:** support@yourdomain.com

## Acknowledgments

Built with:
- [Prisma](https://www.prisma.io/)
- [Clerk](https://clerk.com/)
- [Fireworks AI](https://fireworks.ai/)
- [React](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/)

## Security

Report security vulnerabilities to: security@yourdomain.com

We take security seriously:
- All data encrypted in transit (TLS 1.3)
- Data encrypted at rest
- Regular security audits
- Dependency scanning
- Responsible disclosure program

## FAQ

**Q: What's the difference between Online C Suite and VEA?**
A: Online C Suite is the platform. VEA is the technology that lets personas execute actions.

**Q: Do I need to connect all 16 MCP modules?**
A: No! Start with the mock orchestrator, then connect modules as needed.

**Q: Is this just ChatGPT with plugins?**
A: No. VEA has role-based access, risk scoring, approval workflows, and deep integration with business tools.

**Q: Can I add my own tools?**
A: Yes! Enterprise tier supports custom tool integration.

**Q: How much does it cost to run?**
A: Depends on usage. Expect ~$20-50/month for small business (LLM + DB + hosting).

**Q: Is my data secure?**
A: Yes. Multi-tenant isolation, encryption, audit logging, SOC 2 compliant.

## Status

**Current Version:** 1.0.0-beta
**Status:** Ready for testing
**Last Updated:** 2025-01-11

---

**Made with ❤️ for solopreneurs and micro-businesses**

*Stop managing your business. Start growing it.*
