import type {
  ApiResponse,
  Tenant,
  Conversation,
  Message,
  Connector,
  Task,
  BusinessProfile,
  PersonaType,
  ConnectorProvider,
  TaskStatus,
  BusinessSize,
  BusinessStage,
  ModuleInsight,
  BoardActionItemWithAssignee,
  BoardMeetingMetrics,
  BoardMeetingRecord,
  BoardMeetingSummary,
  BoardMeetingWithDetails,
  BoardPersonaAnalysis,
  ActionApproval,
  ActionApprovalStatus,
  ActionApprovalRisk,
  Notification,
  NotificationPreference,
  NotificationChannel,
  NotificationStatsSummary,
  Alert,
  AlertListResponse,
  AlertStatus,
  TriggerSeverity,
  MarketplaceWidgetWithInstall,
  BillingUsageSummary,
  VideoJob,
  VideoJobListResponse,
  KnowledgeRetentionPolicy,
  KnowledgeSourceProvider,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  KnowledgeStorageStrategy,
} from '@ocsuite/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const DEFAULT_TENANT_ID = process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID || 'demo-company';
const TENANT_STORAGE_KEY = 'ocsuite.tenantId';

type BoardAgendaInput = {
  id?: string;
  title: string;
  personaId: 'ceo' | 'cfo' | 'cmo';
  dependsOn?: string | null;
};

export interface StartBoardMeetingPayload {
  agenda?: BoardAgendaInput[];
  agendaVersion?: number;
}

export interface BoardMeetingListItem extends BoardMeetingRecord {
  personaCount: number;
  actionItemCounts: Record<'open' | 'in_progress' | 'completed', number>;
}

export interface BoardMeetingListResponse {
  data: BoardMeetingListItem[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

export interface BoardMeetingDetail
  extends Omit<BoardMeetingWithDetails, 'personaTurns' | 'actionItems'> {
  summary: BoardMeetingSummary | null;
  metrics: BoardMeetingMetrics | null;
  personaTurns: BoardPersonaAnalysis[];
  actionItems: BoardActionItemWithAssignee[];
  tokenUsage: Record<string, unknown> | null;
}

export interface KnowledgeSourceStats {
  entryCount: number;
  tokenCount: number;
  lastUpdatedAt: string | null;
  personas: string[];
  tags: string[];
}

export interface KnowledgeSourceSummary {
  id: string;
  tenantId: string | null;
  scope: 'tenant' | 'hq';
  name: string;
  type: KnowledgeSourceType;
  provider: KnowledgeSourceProvider;
  status: KnowledgeSourceStatus;
  storageStrategy: KnowledgeStorageStrategy;
  retentionPolicy: KnowledgeRetentionPolicy;
  configuration: Record<string, unknown> | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  stats: KnowledgeSourceStats;
}

export interface KnowledgeEntryPreview {
  id: string;
  tenantId: string | null;
  sourceId: string | null;
  metadata: Record<string, unknown> | null;
  personas: string[];
  tags: string[];
  preview: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSourceListResponse {
  sources: KnowledgeSourceSummary[];
  totals: {
    sources: number;
    entries: number;
    tokens: number;
  };
}

export interface KnowledgeIngestionSummary {
  sourceId: string;
  sourceName: string;
  chunkCount: number;
  createdEntryIds: string[];
  totalTokens: number;
  skippedChunks: number;
}

export interface KnowledgeUploadPayload {
  filename: string;
  mimeType: string;
  content: string; // base64
  personas?: string[];
  shareWithHq?: boolean;
  retentionPolicy?: KnowledgeRetentionPolicy;
  storageStrategy?: KnowledgeStorageStrategy;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeNotePayload {
  title: string;
  content: string;
  personas?: string[];
  tags?: string[];
  shareWithHq?: boolean;
  retentionPolicy?: KnowledgeRetentionPolicy;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeSearchResultEntry {
  id: string;
  tenantId: string | null;
  source: string;
  sourceId: string | null;
  sourceName: string | null;
  metadata: Record<string, unknown> | null;
  checksum: string | null;
  chunkSize: number | null;
  tokenCount: number | null;
  embeddingMetadata: Record<string, unknown> | null;
  storageKey: string | null;
  retentionExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSearchResult {
  entry: KnowledgeSearchResultEntry;
  content: string;
  score: number;
}

export interface SubmitActionApprovalPayload {
  source: string;
  payload: Record<string, unknown>;
  actionItemId?: string;
  comment?: string;
}

export interface SubmitActionApprovalResponse {
  approval: ActionApproval;
  risk: ActionApprovalRisk;
}

export interface ActionApprovalListResponse {
  approvals: ActionApproval[];
}

export interface ApproveActionApprovalResponse {
  approval: ActionApproval;
  task: Task;
  job: {
    jobId: string;
    queueName: string;
    enqueuedAt: string;
  };
}

export interface NotificationsListResponse {
  notifications: Notification[];
  nextCursor?: string;
}

export interface NotificationPreferenceListResponse {
  preferences: NotificationPreference[];
}

export interface NotificationPreferenceUpdateResponse {
  preference: NotificationPreference;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private baseURL: string;
  private getToken: () => Promise<string | null>;

  constructor(baseURL: string = API_URL, getToken: () => Promise<string | null>) {
    this.baseURL = baseURL;
    this.getToken = getToken;
  }

  private resolveTenantId(): string | null {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(TENANT_STORAGE_KEY);
      if (stored && stored.trim()) {
        return stored.trim();
      }
    }
    return DEFAULT_TENANT_ID;
  }

  private toRecord(headers?: HeadersInit): Record<string, string> | undefined {
    if (!headers) {
      return undefined;
    }

    if (headers instanceof Headers) {
      const record: Record<string, string> = {};
      headers.forEach((value, key) => {
        record[key] = value;
      });
      return record;
    }

    if (Array.isArray(headers)) {
      return headers.reduce<Record<string, string>>((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});
    }

    return headers as Record<string, string>;
  }

  private buildHeaders(
    token: string,
    existing?: Record<string, string>,
    options: { includeJsonContentType?: boolean } = {}
  ): Record<string, string> {
    const { includeJsonContentType = true } = options;

    const headers: Record<string, string> = {
      ...(includeJsonContentType ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
    };

    const tenantId = this.resolveTenantId();
    if (tenantId) {
      headers['X-Tenant-ID'] = tenantId;
    }

    return {
      ...headers,
      ...(existing ?? {}),
    };
  }

  private buildQueryString(
    params?: Record<string, string | number | boolean | undefined | null>
  ): string {
    if (!params) {
      return '';
    }

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }
      search.append(key, String(value));
    }

    const qs = search.toString();
    return qs ? `?${qs}` : '';
  }

  private async fetchJson<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.getToken();

    if (!token) {
      throw new ApiError('AUTH_ERROR', 'No authentication token available');
    }

    const headers = this.buildHeaders(token, this.toRecord(options.headers));

    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers,
    });

    const rawBody = await response.text();
    let data: any = null;

    if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch (error) {
        if (response.ok) {
          throw new ApiError(
            'API_PARSE_ERROR',
            'Failed to parse API response',
            { body: rawBody }
          );
        }
      }
    }

    if (!response.ok) {
      throw new ApiError(
        data?.error?.code || 'API_ERROR',
        data?.error?.message || rawBody || 'An error occurred',
        data?.error?.details
      );
    }

    return (data as T) ?? ({} as T);
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    return this.fetchJson<ApiResponse<T>>(endpoint, options);
  }

  // Tenant endpoints
  async createTenant(data: { name: string; slug: string }): Promise<Tenant> {
    const response = await this.request<Tenant>('/api/tenants', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data!;
  }

  async getCurrentTenant(): Promise<Tenant> {
    const response = await this.request<Tenant>('/api/tenants/current');
    return response.data!;
  }

  async updateTenant(data: Partial<Tenant>): Promise<Tenant> {
    const response = await this.request<Tenant>('/api/tenants/current', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return response.data!;
  }

  // Business Profile endpoints
  async createBusinessProfile(data: {
    industry?: string;
    size?: BusinessSize;
    revenue?: string;
    stage?: BusinessStage;
    goals?: string[];
  }): Promise<BusinessProfile> {
    const response = await this.request<BusinessProfile>(
      '/api/tenants/current/profile',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
    return response.data!;
  }

  async getBusinessProfile(): Promise<BusinessProfile> {
    const response = await this.request<BusinessProfile>(
      '/api/tenants/current/profile'
    );
    return response.data!;
  }

  async updateBusinessProfile(
    data: Partial<BusinessProfile>
  ): Promise<BusinessProfile> {
    const response = await this.request<BusinessProfile>(
      '/api/tenants/current/profile',
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    );
    return response.data!;
  }

  // Conversation endpoints
  async getConversations(): Promise<Conversation[]> {
  const response = await this.request<Conversation[]>('/c-suite/ceo/conversations');
    return response.data!;
  }

  async createConversation(personaType: PersonaType): Promise<Conversation> {
    const response = await this.request<Conversation>('/c-suite/ceo/conversations', {
      method: 'POST',
      body: JSON.stringify({ personaType }),
    });
    return response.data!;
  }

  async getConversation(id: string): Promise<Conversation> {
  const response = await this.request<Conversation>(`/c-suite/ceo/conversations/${id}`);
    return response.data!;
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    const response = await this.request<Message[]>(
      `/c-suite/ceo/conversations/${conversationId}/messages`
    );
    return response.data!;
  }

  // Chat streaming endpoint
  async sendMessage(
    conversationId: string,
    content: string,
    onChunk: (chunk: string) => void,
    onComplete?: (messageId: string) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    const token = await this.getToken();

    if (!token) {
      throw new ApiError('AUTH_ERROR', 'No authentication token available');
    }

    try {
      const headers = this.buildHeaders(token);
      const response = await fetch(
        `${this.baseURL}/c-suite/ceo/chat`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message: content,
            conversationId,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new ApiError(
          error.error?.code || 'API_ERROR',
          error.error?.message || 'Failed to send message'
        );
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new ApiError('STREAM_ERROR', 'No response stream available');
      }

      let messageId = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            if (data === '[DONE]') {
              if (onComplete && messageId) {
                onComplete(messageId);
              }
              return;
            }

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'chunk' && parsed.data?.content) {
                onChunk(parsed.data.content);
              }

              if (parsed.data?.messageId) {
                messageId = parsed.data.messageId;
              }
            } catch (e) {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }
    } catch (error) {
      if (onError) {
        onError(
          error instanceof Error
            ? error
            : new Error('Unknown error occurred')
        );
      } else {
        throw error;
      }
    }
  }

  // Connector endpoints
  async getConnectors(): Promise<Connector[]> {
    const response = await this.request<Connector[]>('/api/connectors');
    return response.data!;
  }

  async getConnector(id: string): Promise<Connector> {
    const response = await this.request<Connector>(`/api/connectors/${id}`);
    return response.data!;
  }

  async connectProvider(provider: ConnectorProvider): Promise<{ url: string }> {
    const response = await this.request<{ url: string }>(
      `/api/connectors/${provider}/connect`,
      {
        method: 'POST',
      }
    );
    return response.data!;
  }

  async disconnectConnector(id: string): Promise<void> {
    await this.request(`/api/connectors/${id}`, {
      method: 'DELETE',
    });
  }

  // Knowledge management endpoints
  async getKnowledgeSources(): Promise<KnowledgeSourceListResponse> {
    return this.fetchJson<KnowledgeSourceListResponse>('/knowledge/sources');
  }

  async getKnowledgeSource(
    id: string,
    options: { limit?: number } = {}
  ): Promise<{ source: KnowledgeSourceSummary; entries: KnowledgeEntryPreview[] }> {
    const params = new URLSearchParams();
    if (typeof options.limit === 'number') {
      params.set('limit', String(options.limit));
    }

    const query = params.toString();
    const endpoint = `/knowledge/sources/${id}${query ? `?${query}` : ''}`;

    return this.fetchJson<{ source: KnowledgeSourceSummary; entries: KnowledgeEntryPreview[] }>(
      endpoint
    );
  }

  async uploadKnowledgeDocument(
    payload: KnowledgeUploadPayload
  ): Promise<KnowledgeIngestionSummary> {
    const response = await this.fetchJson<{ summary: KnowledgeIngestionSummary }>(
      '/knowledge/upload',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    return response.summary;
  }

  async createKnowledgeNote(
    payload: KnowledgeNotePayload
  ): Promise<KnowledgeIngestionSummary> {
    const response = await this.fetchJson<{ summary: KnowledgeIngestionSummary }>(
      '/knowledge/notes',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    return response.summary;
  }

  async deleteKnowledgeSource(id: string): Promise<void> {
    await this.fetchJson<{ success: boolean }>(`/knowledge/sources/${id}`, {
      method: 'DELETE',
    });
  }

  async exportKnowledgeSource(id: string): Promise<Blob> {
    const token = await this.getToken();

    if (!token) {
      throw new ApiError('AUTH_ERROR', 'No authentication token available');
    }

    const headers = this.buildHeaders(
      token,
      {
        Accept: 'application/zip',
      },
      { includeJsonContentType: false }
    );

    const response = await fetch(`${this.baseURL}/knowledge/sources/${id}/export`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      let code = 'KNOWLEDGE_EXPORT_ERROR';
      let message = 'Failed to export knowledge source';

      try {
        const errorBody = await response.json();
        code = errorBody.error?.code ?? code;
        message = errorBody.error?.message ?? message;
      } catch (error) {
        // Ignore parsing errors for non-JSON responses
      }

      throw new ApiError(code, message);
    }

    return await response.blob();
  }

  async searchKnowledge(params: {
    query?: string;
    embedding?: number[];
    persona?: string;
    sourceIds?: string[];
    limit?: number;
  } = {}): Promise<KnowledgeSearchResult[]> {
    const payload: Record<string, unknown> = {};
    if (typeof params.query === 'string' && params.query.trim()) {
      payload.query = params.query.trim();
    }
    if (Array.isArray(params.embedding) && params.embedding.length) {
      payload.embedding = params.embedding;
    }
    if (typeof params.persona === 'string' && params.persona.trim()) {
      payload.persona = params.persona.trim();
    }
    if (Array.isArray(params.sourceIds) && params.sourceIds.length) {
      payload.sourceIds = params.sourceIds;
    }
    if (typeof params.limit === 'number') {
      payload.limit = params.limit;
    }

    const response = await this.fetchJson<{ results: KnowledgeSearchResult[] }>(
      '/knowledge/search',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    return response.results;
  }

  // Task endpoints
  async getTasks(status?: TaskStatus): Promise<Task[]> {
    const query = status ? `?status=${status}` : '';
  const response = await this.request<Task[]>(`/tasks${query}`);
    return response.data!;
  }

  async getTask(id: string): Promise<Task> {
  const response = await this.request<Task>(`/tasks/${id}`);
    return response.data!;
  }

  async approveTask(id: string): Promise<Task> {
  const response = await this.request<Task>(`/tasks/${id}/approve`, {
      method: 'POST',
    });
    return response.data!;
  }

  async rejectTask(id: string): Promise<Task> {
  const response = await this.request<Task>(`/tasks/${id}/reject`, {
      method: 'POST',
    });
    return response.data!;
  }

  async executeTask(
    taskType: string,
    payload: Record<string, unknown>
  ): Promise<{
    taskId: string;
    jobId: string;
    status: string;
    taskType: string;
    enqueuedAt: string;
  }> {
    const response = await this.request<{
      taskId: string;
      jobId: string;
      status: string;
      taskType: string;
      enqueuedAt: string;
  }>('/tasks/execute', {
      method: 'POST',
      body: JSON.stringify({ taskType, payload }),
    });
    return response.data!;
  }

  // Action approval endpoints
  async submitActionApproval(
    payload: SubmitActionApprovalPayload
  ): Promise<SubmitActionApprovalResponse> {
    return this.fetchJson<SubmitActionApprovalResponse>('/actions/submit', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getActionApprovals(filters: {
    status?: ActionApprovalStatus;
    minRisk?: number;
    maxRisk?: number;
    source?: string;
    createdBy?: string;
    limit?: number;
  } = {}): Promise<ActionApproval[]> {
    const params = new URLSearchParams();

    if (filters.status) params.set('status', filters.status);
    if (typeof filters.minRisk === 'number') params.set('minRisk', String(filters.minRisk));
    if (typeof filters.maxRisk === 'number') params.set('maxRisk', String(filters.maxRisk));
    if (filters.source) params.set('source', filters.source);
    if (filters.createdBy) params.set('createdBy', filters.createdBy);
    if (typeof filters.limit === 'number') params.set('limit', String(filters.limit));

    const query = params.toString();
    const endpoint = `/actions/pending${query ? `?${query}` : ''}`;

    const response = await this.fetchJson<ActionApprovalListResponse>(endpoint);
    return response.approvals;
  }

  async approveActionApproval(
    approvalId: string,
    comment?: string
  ): Promise<ApproveActionApprovalResponse> {
    return this.fetchJson<ApproveActionApprovalResponse>(
      `/actions/${approvalId}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ comment }),
      }
    );
  }

  async rejectActionApproval(
    approvalId: string,
    comment?: string
  ): Promise<ActionApproval> {
    const response = await this.fetchJson<{ approval: ActionApproval }>(
      `/actions/${approvalId}/reject`,
      {
        method: 'POST',
        body: JSON.stringify({ comment }),
      }
    );
    return response.approval;
  }

  async getActionApprovalAudit(approvalId: string): Promise<ActionApproval> {
    return this.fetchJson<ActionApproval>(`/actions/${approvalId}/audit`);
  }

  // Notification endpoints
  async getNotifications(params: {
    limit?: number;
    cursor?: string;
    channel?: NotificationChannel;
    unread?: boolean;
  } = {}): Promise<NotificationsListResponse> {
    const search = new URLSearchParams();

    if (typeof params.limit === 'number') search.set('limit', String(params.limit));
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.channel) search.set('channel', params.channel);
    if (typeof params.unread === 'boolean') search.set('unread', String(params.unread));

    const query = search.toString();
    return this.fetchJson<NotificationsListResponse>(
      `/notifications${query ? `?${query}` : ''}`
    );
  }

  async markNotificationRead(notificationId: string): Promise<Notification> {
    const response = await this.fetchJson<{ notification: Notification }>(
      `/notifications/${notificationId}/read`,
      {
        method: 'POST',
      }
    );
    return response.notification;
  }

  async markAllNotificationsRead(): Promise<number> {
    const response = await this.fetchJson<{ updated: number }>(
      '/notifications/read-all',
      {
        method: 'POST',
      }
    );
    return response.updated;
  }

  async getNotificationStats(): Promise<NotificationStatsSummary> {
    return this.fetchJson<NotificationStatsSummary>('/notifications/stats');
  }

  async getNotificationPreferences(): Promise<NotificationPreference[]> {
    const response = await this.fetchJson<NotificationPreferenceListResponse>(
      '/notifications/preferences'
    );
    return response.preferences;
  }

  async updateNotificationPreference(
    channel: NotificationChannel,
    enabled: boolean
  ): Promise<NotificationPreference> {
    const response = await this.fetchJson<NotificationPreferenceUpdateResponse>(
      '/notifications/preferences',
      {
        method: 'POST',
        body: JSON.stringify({ channel, enabled }),
      }
    );
    return response.preference;
  }

  // Alerts
  async listAlerts(params: {
    limit?: number;
    cursor?: string;
    status?: AlertStatus;
    severity?: TriggerSeverity;
  } = {}): Promise<AlertListResponse> {
    const query = this.buildQueryString({
      limit: params.limit,
      cursor: params.cursor,
      status: params.status,
      severity: params.severity,
    });

    return this.fetchJson<AlertListResponse>(`/alerts${query}`);
  }

  async acknowledgeAlert(alertId: string): Promise<Alert> {
    const response = await this.fetchJson<{ alert: Alert }>(
      `/alerts/${alertId}/acknowledge`,
      {
        method: 'POST',
      }
    );

    return response.alert;
  }

  // Marketplace
  async listMarketplaceWidgets(): Promise<MarketplaceWidgetWithInstall[]> {
    const response = await this.fetchJson<{ widgets: MarketplaceWidgetWithInstall[] }>(
      '/marketplace/widgets'
    );

    return response.widgets;
  }

  async installWidget(
    slug: string,
    settings?: Record<string, unknown>
  ): Promise<MarketplaceWidgetWithInstall> {
    const response = await this.fetchJson<{ widget: MarketplaceWidgetWithInstall }>(
      `/marketplace/widgets/${slug}/install`,
      {
        method: 'POST',
        body: JSON.stringify({ settings }),
      }
    );

    return response.widget;
  }

  async uninstallWidget(slug: string): Promise<void> {
    await this.fetchJson<unknown>(`/marketplace/widgets/${slug}/install`, {
      method: 'DELETE',
    });
  }

  // Billing
  async getBillingUsage(params: {
    days?: number;
    from?: string;
    to?: string;
  } = {}): Promise<BillingUsageSummary> {
    const query = this.buildQueryString({
      days: params.days,
      from: params.from,
      to: params.to,
    });

    return this.fetchJson<BillingUsageSummary>(`/billing/usage${query}`);
  }

  // Dashboard metrics (mocked for Phase 1)
  async getDashboardMetrics(): Promise<{
    revenue: number;
    leads: number;
    tasks: number;
    activeConnectors: number;
  }> {
    // This would be a real endpoint in production
    return {
      revenue: 125000,
      leads: 43,
      tasks: 12,
      activeConnectors: 3,
    };
  }

  async getRecentActivity(): Promise<
    Array<{
      id: string;
      type: string;
      description: string;
      timestamp: Date;
    }>
  > {
    // This would be a real endpoint in production
    return [
      {
        id: '1',
        type: 'conversation',
        description: 'New conversation with CEO persona',
        timestamp: new Date(Date.now() - 1000 * 60 * 5),
      },
      {
        id: '2',
        type: 'connector',
        description: 'Connected Google Analytics',
        timestamp: new Date(Date.now() - 1000 * 60 * 30),
      },
      {
        id: '3',
        type: 'task',
        description: 'Task completed: Send weekly report',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
      },
    ];
  }

  // Board Meeting endpoints
  async startBoardMeetingStream(
    payload: StartBoardMeetingPayload = {},
    options: { signal?: AbortSignal } = {}
  ): Promise<Response> {
    const token = await this.getToken();

    if (!token) {
      throw new ApiError('AUTH_ERROR', 'No authentication token available');
    }

    const headers = this.buildHeaders(token, { Accept: 'text/event-stream' });
    const response = await fetch(`${this.baseURL}/c-suite/board-meeting`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload ?? {}),
      signal: options.signal,
    });

    if (!response.ok) {
      let code = 'BOARD_MEETING_ERROR';
      let message = 'Failed to start board meeting stream';

      try {
        const errorBody = await response.json();
        code = errorBody.error?.code ?? code;
        message = errorBody.error?.message ?? message;
      } catch (error) {
        // ignore non-JSON responses
      }

      throw new ApiError(code, message);
    }

    return response;
  }

  async listBoardMeetings(params: {
    page?: number;
    pageSize?: number;
    persona?: 'ceo' | 'cfo' | 'cmo';
    from?: string;
    to?: string;
  } = {}): Promise<BoardMeetingListResponse> {
    const query = new URLSearchParams();

    if (params.page) {
      query.set('page', String(params.page));
    }
    if (params.pageSize) {
      query.set('pageSize', String(params.pageSize));
    }
    if (params.persona) {
      query.set('persona', params.persona);
    }
    if (params.from) {
      query.set('from', params.from);
    }
    if (params.to) {
      query.set('to', params.to);
    }

    const endpoint = `/board/meetings${query.toString() ? `?${query.toString()}` : ''}`;
    const response = await this.request<BoardMeetingListItem[]>(endpoint);

    const meta = response.meta ?? {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? (response.data?.length ?? 0),
      total: response.data?.length ?? 0,
      pageCount: 1,
    };

    return {
      data: (response.data ?? []) as BoardMeetingListItem[],
      meta: meta as BoardMeetingListResponse['meta'],
    };
  }

  async getBoardMeetingDetail(id: string): Promise<BoardMeetingDetail> {
    const response = await this.request<BoardMeetingDetail>(`/board/meetings/${id}`);
    return response.data!;
  }

  async updateBoardActionItem(
    id: string,
    payload: Partial<{
      status: 'open' | 'in_progress' | 'completed';
      assigneeId: string | null;
      dueDate: string | null;
      title: string;
      description: string | null;
      priority: 'low' | 'normal' | 'high' | 'urgent';
    }>
  ): Promise<BoardActionItemWithAssignee> {
    const response = await this.request<BoardActionItemWithAssignee>(
      `/board/action-items/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
    return response.data!;
  }

  async submitBoardMeetingRating(
    meetingId: string,
    rating: number
  ): Promise<{
    id: string;
    rating: number;
    updatedAt: string;
  }> {
    const response = await this.request<{
      id: string;
      rating: number;
      updatedAt: string;
    }>(`/board/meetings/${meetingId}/rating`, {
      method: 'PATCH',
      body: JSON.stringify({ rating }),
    });
    return response.data!;
  }

  // Module Insights endpoints
  async getModuleInsights(moduleSlug?: string): Promise<ModuleInsight[]> {
    const query = moduleSlug ? `?moduleSlug=${moduleSlug}` : '';
    const response = await this.request<ModuleInsight[]>(`/modules/insights${query}`);
    return response.data!;
  }

  async triggerModuleRun(moduleSlug: string): Promise<{
    jobId: string;
    status: string;
    enqueuedAt: string;
  }> {
    const response = await this.request<{
      jobId: string;
      status: string;
      enqueuedAt: string;
    }>(`/modules/${moduleSlug}/run`, {
      method: 'POST',
    });
    return response.data!;
  }

  // Video Production endpoints
  video = {
    transcribe: async (url: string, options?: { language?: string; speakerLabels?: boolean }) => {
      const response = await this.request<VideoJob>('/video/transcribe', {
        method: 'POST',
        body: JSON.stringify({
          url,
          language: options?.language,
          speakerLabels: options?.speakerLabels || false,
          extractViralMoments: true,
        }),
      });
      return response.data!;
    },

    extractClips: async (
      transcriptId: string,
      options?: { count?: number; minDuration?: number; maxDuration?: number }
    ) => {
      const response = await this.request<VideoJob>('/video/extract-clips', {
        method: 'POST',
        body: JSON.stringify({
          transcriptId,
          count: options?.count || 3,
          minDuration: options?.minDuration || 15,
          maxDuration: options?.maxDuration || 60,
        }),
      });
      return response.data!;
    },

    render: async (composition: any, outputFormat?: string, quality?: string) => {
      const response = await this.request<VideoJob>('/video/render', {
        method: 'POST',
        body: JSON.stringify({
          composition,
          outputFormat: outputFormat || 'mp4',
          quality: quality || 'standard',
        }),
      });
      return response.data!;
    },

    addCaptions: async (videoUrl: string, transcriptId: string, style?: any) => {
      const response = await this.request<VideoJob>('/video/add-captions', {
        method: 'POST',
        body: JSON.stringify({
          videoUrl,
          transcriptId,
          style,
        }),
      });
      return response.data!;
    },

    optimize: async (videoUrl: string, platform: string, customSpec?: any) => {
      const response = await this.request<VideoJob>('/video/optimize', {
        method: 'POST',
        body: JSON.stringify({
          videoUrl,
          platform,
          customSpec,
        }),
      });
      return response.data!;
    },

    listJobs: async (options?: { type?: string; status?: string; limit?: number; offset?: number }) => {
      const params = new URLSearchParams();
      if (options?.type) params.append('type', options.type);
      if (options?.status) params.append('status', options.status);
      if (options?.limit) params.append('limit', options.limit.toString());
      if (options?.offset) params.append('offset', options.offset.toString());

      const query = params.toString() ? `?${params.toString()}` : '';
      const response = await this.request<VideoJobListResponse>(`/video/jobs${query}`);
      return response.data!;
    },

    getJob: async (jobId: string) => {
      const response = await this.request<VideoJob>(`/video/jobs/${jobId}`);
      return response.data!;
    },

    deleteJob: async (jobId: string) => {
      await this.request(`/video/jobs/${jobId}`, {
        method: 'DELETE',
      });
    },
  };
}

// Create a singleton instance that will be configured with auth token
let apiClient: ApiClient | null = null;

export function createApiClient(getToken: () => Promise<string | null>): ApiClient {
  if (!apiClient) {
    apiClient = new ApiClient(API_URL, getToken);
  }
  return apiClient;
}

export function getApiClient(): ApiClient {
  if (!apiClient) {
    throw new Error('API client not initialized. Call createApiClient first.');
  }
  return apiClient;
}
