'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ComponentType, SVGProps } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import {
  Building2,
  Plug,
  BookOpen,
  MessageSquare,
  Store,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { createApiClient } from '@/lib/api';
import type { KnowledgeSourceListResponse } from '@/lib/api';
import type {
  BusinessProfile,
  Connector,
  Conversation,
  MarketplaceWidgetWithInstall,
} from '@ocsuite/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  complete: boolean;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

interface ChecklistState {
  items: ChecklistItem[];
  loading: boolean;
  error?: string;
}

export function OnboardingChecklist() {
  const { getToken } = useAuth();
  const [state, setState] = useState<ChecklistState>({ items: [], loading: true });

  useEffect(() => {
    let cancelled = false;

    async function loadChecklist() {
      try {
        const api = createApiClient(getToken);

        const [profile, connectors, knowledge, conversations, marketplace] = await Promise.all([
          api.getBusinessProfile().catch<BusinessProfile | null>(() => null),
          api.getConnectors().catch<Connector[]>(() => []),
          api
            .getKnowledgeSources()
            .catch<KnowledgeSourceListResponse>(() => ({
              sources: [],
              totals: { sources: 0, entries: 0, tokens: 0 },
            })),
          api.getConversations().catch<Conversation[]>(() => []),
          api.listMarketplaceWidgets().catch<MarketplaceWidgetWithInstall[]>(() => []),
        ]);

        if (cancelled) {
          return;
        }

        const hasBusinessProfile = Boolean(
          profile?.industry || profile?.size || profile?.stage || profile?.goals?.length
        );
        const hasConnector = connectors.length > 0;
        const hasKnowledge = (knowledge.sources ?? []).length > 0;
        const hasConversation = conversations.length > 0;
        const hasMarketplaceInstall = marketplace.some((widget) => widget.installed);

        const items: ChecklistItem[] = [
          {
            id: 'profile',
            title: 'Set up your company profile',
            description: 'Tell C-Suite about your industry, size, and goals to personalise insights.',
            href: '/onboarding',
            cta: hasBusinessProfile ? 'Review profile' : 'Complete profile',
            complete: hasBusinessProfile,
            icon: Building2,
          },
          {
            id: 'connector',
            title: 'Connect an integration',
            description: 'Sync Google Workspace or other tools so data flows into decisioning.',
            href: '/connectors',
            cta: hasConnector ? 'Manage integrations' : 'Connect now',
            complete: hasConnector,
            icon: Plug,
          },
          {
            id: 'knowledge',
            title: 'Upload your first knowledge source',
            description: 'Import documents or notes so the AI board can reference your playbooks.',
            href: '/knowledge',
            cta: hasKnowledge ? 'View knowledge' : 'Upload content',
            complete: hasKnowledge,
            icon: BookOpen,
          },
          {
            id: 'conversation',
            title: 'Start a leadership conversation',
            description: 'Ask the AI C-Suite a strategic question to see recommendations.',
            href: '/chat',
            cta: hasConversation ? 'Continue chat' : 'Start chatting',
            complete: hasConversation,
            icon: MessageSquare,
          },
          {
            id: 'marketplace',
            title: 'Install a marketplace widget',
            description: 'Enable an automation tile to unlock cross-functional insights.',
            href: '/marketplace',
            cta: hasMarketplaceInstall ? 'Manage widgets' : 'Explore marketplace',
            complete: hasMarketplaceInstall,
            icon: Store,
          },
        ];

        setState({ items, loading: false });
      } catch (error) {
        console.error('Failed to load onboarding checklist', error);
        if (!cancelled) {
          setState({
            items: [],
            loading: false,
            error: 'Unable to load onboarding progress. Please try again later.',
          });
        }
      }
    }

    loadChecklist();

    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const completedItems = useMemo(
    () => state.items.filter((item) => item.complete).length,
    [state.items]
  );
  const progress = state.items.length ? Math.round((completedItems / state.items.length) * 100) : 0;

  if (state.loading) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Getting started</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking your workspace progress…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.error) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Getting started</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{state.error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-base font-semibold">Getting started checklist</CardTitle>
        <div className="flex items-center gap-3">
          <Progress value={progress} className="h-2 flex-1" aria-hidden="true" />
          <span className="text-sm font-medium text-muted-foreground" aria-label={`Checklist ${progress}% complete`}>
            {progress}% complete
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className={cn(
                'flex flex-col gap-3 rounded-lg border p-4 transition-colors md:flex-row md:items-center md:justify-between',
                item.complete ? 'border-muted bg-muted/40' : 'border-border'
              )}
            >
              <div className="flex flex-1 items-start gap-3">
                <span
                  className={cn(
                    'mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border text-muted-foreground',
                    item.complete && 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600'
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium leading-tight">{item.title}</p>
                    {item.complete && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        Done
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>
              <Button
                asChild
                variant={item.complete ? 'outline' : 'default'}
                size="sm"
                className="md:mt-0"
              >
                <Link href={item.href}>{item.cta}</Link>
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
