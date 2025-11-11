/**
 * Persona Tool Registry
 *
 * Defines which tools each C-suite persona can access.
 * This is the security boundary that controls what executives can do.
 */

import type {
  PersonaId,
  PersonaToolAccess,
  ToolDefinition,
  VPAToolName,
  ModuleId,
} from './types.js';

/**
 * Complete tool catalog with metadata
 */
const TOOL_CATALOG: ToolDefinition[] = [
  {
    tool: 'vpa_prospects',
    name: 'Prospect Finder',
    description: 'Find, scrape, and enrich B2B prospects with contact information',
    actions: ['search', 'find_decision_makers', 'enrich', 'export', 'stats'],
    modules: ['prospect-finder'],
    example: 'Search for 50 HVAC companies in Dallas with contact details',
  },
  {
    tool: 'vpa_pipeline',
    name: 'Sales Pipeline',
    description: 'Manage leads, track progress, log activities, and analyze win/loss',
    actions: [
      'add',
      'update_status',
      'log_activity',
      'get_stats',
      'get_follow_ups',
      'import',
      'analyze_health',
      'detect_upsell',
    ],
    modules: ['leadtracker-pro'],
    example: 'Add 50 prospects to pipeline and set them as "new" status',
  },
  {
    tool: 'vpa_email',
    name: 'Email Campaigns',
    description: 'Create campaigns, send emails, manage sequences, and track engagement',
    actions: [
      'create_campaign',
      'compose',
      'send',
      'read_inbox',
      'search',
      'suggest_reply',
      'summarize_thread',
    ],
    modules: ['email-orchestrator'],
    example: 'Create a welcome email campaign for new HVAC leads',
  },
  {
    tool: 'vpa_tasks',
    name: 'Task & Project Manager',
    description: 'Manage tasks, track projects, and plan focus time',
    actions: ['add', 'list', 'update', 'get_next_actions', 'plan_focus'],
    modules: ['task-project-manager'],
    example: 'Create a task to follow up with top 10 prospects by Friday',
  },
  {
    tool: 'vpa_research',
    name: 'Research & Insights',
    description: 'Monitor competitors, track market trends, generate research briefs',
    actions: ['add_source', 'list_sources', 'get_digest', 'generate_brief'],
    modules: ['research-insights'],
    example: 'Add competitor website to monitoring and generate weekly digest',
  },
  {
    tool: 'vpa_metrics_dashboard',
    name: 'Metrics Dashboard',
    description: 'View consolidated KPIs across all modules',
    actions: ['get_all', 'get_module', 'get_trend'],
    modules: ['prospect-finder', 'leadtracker-pro', 'email-orchestrator'],
    example: 'Show me pipeline value and email open rates for this month',
  },
  {
    tool: 'vpa_status',
    name: 'System Status',
    description: 'Check system health, usage stats, and subscription info',
    actions: ['health', 'usage', 'subscription'],
    modules: [],
    example: 'Show my current usage and remaining quota',
  },
  {
    tool: 'vpa_modules',
    name: 'Module Catalog',
    description: 'Browse available modules and their capabilities',
    actions: ['list', 'info', 'quick_actions'],
    modules: [],
    example: 'What modules do I have access to?',
  },
];

/**
 * Bookkeeping tools (CFO specialty)
 */
const BOOKKEEPING_TOOLS: ToolDefinition[] = [
  {
    tool: 'vpa_bookkeeping' as VPAToolName,
    name: 'Bookkeeping Assistant',
    description: 'Track expenses, generate invoices, create financial reports, calculate taxes',
    actions: [
      'add_transaction',
      'track_expense',
      'generate_invoice',
      'generate_report',
      'calculate_tax',
      'reconcile_accounts',
      'forecast_cash_flow',
    ],
    modules: ['bookkeeping-assistant'],
    example: 'Generate invoices for all unpaid clients and show me cash flow forecast',
  },
  {
    tool: 'vpa_time_billing' as VPAToolName,
    name: 'Time & Billing',
    description: 'Track billable hours, generate time-based invoices',
    actions: ['log_time', 'get_billable', 'generate_invoice', 'get_utilization'],
    modules: ['time-billing-agent'],
    example: 'Show me total billable hours this month and generate invoices',
  },
];

/**
 * Marketing tools (CMO specialty)
 */
const MARKETING_TOOLS: ToolDefinition[] = [
  {
    tool: 'vpa_content' as VPAToolName,
    name: 'Content Writer',
    description: 'Generate blog posts, emails, social content, and headlines',
    actions: [
      'generate_blog',
      'generate_email',
      'generate_social',
      'generate_headlines',
      'rewrite',
      'expand',
    ],
    modules: ['content-writer'],
    example: 'Write a blog post about HVAC maintenance tips for homeowners',
  },
  {
    tool: 'vpa_social' as VPAToolName,
    name: 'Social Media Manager',
    description: 'Schedule posts, analyze engagement, manage multiple platforms',
    actions: ['create_post', 'schedule', 'get_analytics', 'suggest_times'],
    modules: ['social-media-manager'],
    example: 'Schedule 5 posts about our new HVAC service across all platforms',
  },
  {
    tool: 'vpa_images' as VPAToolName,
    name: 'Image Studio',
    description: 'Generate, edit, and optimize images for marketing',
    actions: ['generate', 'edit', 'batch_process', 'optimize'],
    modules: ['image-studio-mcp'],
    example: 'Generate hero images for our HVAC landing page',
  },
];

/**
 * Client management tools (CEO/Operations)
 */
const CLIENT_TOOLS: ToolDefinition[] = [
  {
    tool: 'vpa_onboarding' as VPAToolName,
    name: 'Client Onboarding',
    description: 'Automate client onboarding with templates and workflows',
    actions: ['create_plan', 'start_onboarding', 'track_progress', 'generate_welcome'],
    modules: ['client-onboarding-agent'],
    example: 'Start onboarding process for new HVAC client with custom checklist',
  },
  {
    tool: 'vpa_support' as VPAToolName,
    name: 'Support Agent',
    description: 'Manage support tickets, knowledge base, and customer queries',
    actions: ['create_ticket', 'respond', 'search_kb', 'analyze_trends'],
    modules: ['support-agent'],
    example: 'Create support ticket for client reporting heating issue',
  },
  {
    tool: 'vpa_retention' as VPAToolName,
    name: 'Retention & Renewal',
    description: 'Track renewals, detect churn risk, manage retention campaigns',
    actions: ['get_renewals', 'detect_churn_risk', 'create_retention_campaign'],
    modules: ['retention-renewal-agent'],
    example: 'Show clients at risk of churning and suggest retention actions',
  },
  {
    tool: 'vpa_reputation' as VPAToolName,
    name: 'Reputation & Reviews',
    description: 'Monitor reviews, request feedback, respond to reviews',
    actions: ['request_review', 'monitor_reviews', 'suggest_response', 'get_sentiment'],
    modules: ['reputation-review-agent'],
    example: 'Request reviews from happy clients and monitor our Google ratings',
  },
];

/**
 * Operational tools (CTO specialty)
 */
const OPERATIONAL_TOOLS: ToolDefinition[] = [
  {
    tool: 'vpa_calendar' as VPAToolName,
    name: 'Calendar & Meetings',
    description: 'Schedule meetings, find time slots, generate agendas',
    actions: [
      'propose_slots',
      'schedule_meeting',
      'generate_agenda',
      'generate_summary',
      'get_insights',
    ],
    modules: ['calendar-meeting-agent'],
    example: 'Find time for team meeting next week and create agenda',
  },
  {
    tool: 'vpa_proposals' as VPAToolName,
    name: 'Proposals & Contracts',
    description: 'Generate proposals, manage contracts, track signatures',
    actions: [
      'create_proposal',
      'create_contract',
      'send_for_signature',
      'track_status',
      'generate_reminder',
    ],
    modules: ['proposal-contract-agent'],
    example: 'Generate HVAC service proposal for prospect and send for e-signature',
  },
];

/**
 * Persona access control definitions
 */
export const PERSONA_TOOL_REGISTRY: PersonaToolAccess[] = [
  {
    personaId: 'ceo',
    allowedModules: '*', // CEO has access to everything
    preferredTools: [
      ...TOOL_CATALOG,
      ...CLIENT_TOOLS,
      BOOKKEEPING_TOOLS[0], // Access to financials for overview
      MARKETING_TOOLS[0], // Access to content for strategic messaging
    ],
    restrictedTools: [], // CEO has no restrictions
  },
  {
    personaId: 'cfo',
    allowedModules: [
      'bookkeeping-assistant',
      'time-billing-agent',
      'leadtracker-pro', // For revenue/pipeline metrics
      'prospect-finder', // For pipeline value calculation
    ],
    preferredTools: [
      ...BOOKKEEPING_TOOLS,
      TOOL_CATALOG.find((t) => t.tool === 'vpa_pipeline')!,
      TOOL_CATALOG.find((t) => t.tool === 'vpa_metrics_dashboard')!,
    ],
    restrictedTools: ['vpa_email', 'vpa_content', 'vpa_social', 'vpa_images'] as any[],
  },
  {
    personaId: 'cmo',
    allowedModules: [
      'prospect-finder',
      'leadtracker-pro',
      'email-orchestrator',
      'content-writer',
      'social-media-manager',
      'image-studio-mcp',
      'reputation-review-agent',
    ],
    preferredTools: [
      TOOL_CATALOG.find((t) => t.tool === 'vpa_prospects')!,
      TOOL_CATALOG.find((t) => t.tool === 'vpa_pipeline')!,
      TOOL_CATALOG.find((t) => t.tool === 'vpa_email')!,
      ...MARKETING_TOOLS,
      CLIENT_TOOLS[3], // Reputation tool
    ],
    restrictedTools: ['vpa_bookkeeping', 'vpa_time_billing'] as any[],
  },
  {
    personaId: 'cto',
    allowedModules: [
      'task-project-manager',
      'research-insights',
      'calendar-meeting-agent',
      'support-agent',
    ],
    preferredTools: [
      TOOL_CATALOG.find((t) => t.tool === 'vpa_tasks')!,
      TOOL_CATALOG.find((t) => t.tool === 'vpa_research')!,
      OPERATIONAL_TOOLS[0], // Calendar
      CLIENT_TOOLS[1], // Support
    ],
    restrictedTools: [
      'vpa_bookkeeping',
      'vpa_time_billing',
      'vpa_email',
      'vpa_content',
    ] as any[],
  },
];

/**
 * Get tools available to a specific persona
 */
export function getPersonaTools(personaId: PersonaId): ToolDefinition[] {
  const access = PERSONA_TOOL_REGISTRY.find((a) => a.personaId === personaId);

  if (!access) {
    throw new Error(`Unknown persona: ${personaId}`);
  }

  return access.preferredTools;
}

/**
 * Check if a persona can access a specific tool
 */
export function canPersonaAccessTool(personaId: PersonaId, tool: VPAToolName): boolean {
  const access = PERSONA_TOOL_REGISTRY.find((a) => a.personaId === personaId);

  if (!access) {
    return false;
  }

  // Check if explicitly restricted
  if (access.restrictedTools?.includes(tool)) {
    return false;
  }

  // If allowedModules is '*', persona can access everything
  if (access.allowedModules === '*') {
    return true;
  }

  // Check if tool is in preferred tools
  return access.preferredTools.some((t) => t.tool === tool);
}

/**
 * Get modules a persona can access
 */
export function getPersonaModules(personaId: PersonaId): ModuleId[] | '*' {
  const access = PERSONA_TOOL_REGISTRY.find((a) => a.personaId === personaId);

  if (!access) {
    throw new Error(`Unknown persona: ${personaId}`);
  }

  return access.allowedModules;
}

/**
 * Get all tool definitions (for documentation/UI)
 */
export function getAllTools(): ToolDefinition[] {
  return [
    ...TOOL_CATALOG,
    ...BOOKKEEPING_TOOLS,
    ...MARKETING_TOOLS,
    ...CLIENT_TOOLS,
    ...OPERATIONAL_TOOLS,
  ];
}

/**
 * Get tool definition by name
 */
export function getToolDefinition(toolName: VPAToolName): ToolDefinition | undefined {
  return getAllTools().find((t) => t.tool === toolName);
}

/**
 * Format tools for LLM prompt
 */
export function formatToolsForPrompt(tools: ToolDefinition[]): string {
  return tools
    .map(
      (tool) => `
**${tool.name}** (${tool.tool})
${tool.description}
Available actions: ${tool.actions.join(', ')}
Example: ${tool.example || 'N/A'}
`
    )
    .join('\n');
}
