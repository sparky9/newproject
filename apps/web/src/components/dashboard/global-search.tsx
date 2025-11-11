'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type {
  Alert,
  Connector,
  Conversation,
  MarketplaceWidgetWithInstall,
  Task,
} from '@ocsuite/types';
import type { BoardMeetingListItem, KnowledgeSearchResult } from '@/lib/api';
import { createApiClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  BookOpen,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  Plug,
  CheckCircle2,
  Circle,
  ListChecks,
  Bell,
  CalendarRange,
  Store,
} from 'lucide-react';
import {
  buildSearchResults,
  MIN_QUERY_LENGTH,
  type SearchResultItem,
  type SearchResultType,
} from './global-search.helpers';

const GROUP_LABELS: Record<SearchResultType, string> = {
  conversation: 'Conversations',
  task: 'Tasks',
  knowledge: 'Knowledge base',
  alert: 'Alerts',
  connector: 'Integrations',
  'board-meeting': 'Board meetings',
  marketplace: 'Marketplace',
  page: 'Shortcuts',
};

const GROUP_ORDER: SearchResultType[] = [
  'conversation',
  'task',
  'board-meeting',
  'alert',
  'connector',
  'marketplace',
  'knowledge',
  'page',
];

const FEATURED_SHORTCUTS: SearchResultItem[] = [
  {
    id: 'quick-chat',
    type: 'page',
    title: 'Start a conversation',
    description: 'Jump into a strategic chat with your AI leadership team',
    href: '/chat',
    badge: 'Chat',
  },
  {
    id: 'quick-tasks',
    type: 'page',
    title: 'Run a task demo',
    description: 'Trigger automation samples and monitor progress',
    href: '/tasks',
    badge: 'Automation',
  },
  {
    id: 'quick-knowledge',
    type: 'page',
    title: 'Upload knowledge',
    description: 'Centralise documents and notes for better answers',
    href: '/knowledge',
    badge: 'Knowledge',
  },
  {
    id: 'quick-connectors',
    type: 'page',
    title: 'Connect an integration',
    description: 'Sync Google, Slack, and more to enrich intelligence',
    href: '/connectors',
    badge: 'Integrations',
  },
];

export function GlobalSearch() {
  const { getToken } = useAuth();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const trimmedQuery = query.trim();
  const hasSearchQuery = trimmedQuery.length >= MIN_QUERY_LENGTH;

  const conversationsCache = useRef<Conversation[] | null>(null);
  const tasksCache = useRef<Task[] | null>(null);
  const alertsCache = useRef<Alert[] | null>(null);
  const connectorsCache = useRef<Connector[] | null>(null);
  const boardMeetingsCache = useRef<BoardMeetingListItem[] | null>(null);
  const marketplaceCache = useRef<MarketplaceWidgetWithInstall[] | null>(null);

  const actionableItems = useMemo<SearchResultItem[]>(() => {
    if (hasSearchQuery) {
      return results;
    }
    return FEATURED_SHORTCUTS;
  }, [hasSearchQuery, results]);

  const activeItem = actionableItems[activeIndex] ?? null;

  const itemIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    actionableItems.forEach((item, index) => {
      map.set(item.id, index);
    });
    return map;
  }, [actionableItems]);

  const groupedActionableItems = useMemo(
    () =>
      GROUP_ORDER.map((type) => ({
        type,
        label: GROUP_LABELS[type],
        items: actionableItems.filter((item) => item.type === type),
      })).filter((section) => section.items.length > 0),
    [actionableItems]
  );

  const resetState = useCallback(() => {
    setQuery('');
    setResults([]);
    setActiveIndex(0);
    setLoading(false);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      const timeout = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(timeout);
    }
    resetState();
    return undefined;
  }, [open, resetState]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (actionableItems.length === 0) {
      setActiveIndex(0);
    } else if (activeIndex >= actionableItems.length) {
      setActiveIndex(actionableItems.length - 1);
    }
  }, [actionableItems, activeIndex, open]);

  const runSearch = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length < MIN_QUERY_LENGTH) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const api = createApiClient(getToken);

        if (!conversationsCache.current) {
          try {
            conversationsCache.current = await api.getConversations();
          } catch (error) {
            console.error('Failed to load conversations for search', error);
            conversationsCache.current = [];
          }
        }

        if (!tasksCache.current) {
          try {
            tasksCache.current = await api.getTasks();
          } catch (error) {
            console.error('Failed to load tasks for search', error);
            tasksCache.current = [];
          }
        }

        if (!alertsCache.current) {
          try {
            const response = await api.listAlerts({ limit: 20 });
            alertsCache.current = response.alerts ?? [];
          } catch (error) {
            console.error('Failed to load alerts for search', error);
            alertsCache.current = [];
          }
        }

        if (!connectorsCache.current) {
          try {
            connectorsCache.current = await api.getConnectors();
          } catch (error) {
            console.error('Failed to load connectors for search', error);
            connectorsCache.current = [];
          }
        }

        if (!boardMeetingsCache.current) {
          try {
            const response = await api.listBoardMeetings({ page: 1, pageSize: 20 });
            boardMeetingsCache.current = response.data ?? [];
          } catch (error) {
            console.error('Failed to load board meetings for search', error);
            boardMeetingsCache.current = [];
          }
        }

        if (!marketplaceCache.current) {
          try {
            marketplaceCache.current = await api.listMarketplaceWidgets();
          } catch (error) {
            console.error('Failed to load marketplace widgets for search', error);
            marketplaceCache.current = [];
          }
        }

        const knowledgeMatches = await api
          .searchKnowledge({ query: trimmed, limit: 5 })
          .catch<KnowledgeSearchResult[]>(() => []);

        const searchResults = buildSearchResults({
          query: trimmed,
          caches: {
            conversations: conversationsCache.current,
            tasks: tasksCache.current,
            alerts: alertsCache.current,
            connectors: connectorsCache.current,
            boardMeetings: boardMeetingsCache.current,
            marketplace: marketplaceCache.current,
          },
          knowledgeMatches,
        });

        setResults(searchResults);
      } catch (error) {
        console.error('Global search failed', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [getToken]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const handler = window.setTimeout(() => {
      runSearch(query);
    }, 200);

    return () => window.clearTimeout(handler);
  }, [open, query, runSearch]);

  const handleSelect = useCallback(
    (item: SearchResultItem) => {
      setOpen(false);
      router.push(item.href);
    },
    [router]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!hasSearchQuery || !actionableItems.length) {
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % actionableItems.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + actionableItems.length) % actionableItems.length);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const item = actionableItems[activeIndex];
        if (item) {
          handleSelect(item);
        }
      }
    },
    [actionableItems, activeIndex, handleSelect, hasSearchQuery]
  );

  return (
    <>
      <Button
        variant="outline"
        className="hidden items-center gap-2 rounded-full px-3 py-2 text-sm text-muted-foreground sm:flex"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="global-search-dialog"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span>Search workspace…</span>
        <kbd className="ml-1 inline-flex items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
          <span className="text-xs">Ctrl</span>
          <span>K</span>
        </kbd>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="sm:hidden"
        aria-label="Open global search"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="global-search-dialog"
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          id="global-search-dialog"
          className="max-w-xl gap-4 p-0"
          aria-label="Global workspace search"
        >
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search conversations, tasks, and knowledge…"
              className="border-none bg-transparent shadow-none focus-visible:ring-0"
              aria-label="Search the workspace"
              role="combobox"
              aria-expanded={hasSearchQuery && actionableItems.length > 0}
              aria-controls={hasSearchQuery ? 'global-search-results' : undefined}
              aria-activedescendant={
                hasSearchQuery && activeItem
                  ? `global-search-option-${activeItem.id}`
                  : undefined
              }
              aria-autocomplete={hasSearchQuery ? 'list' : 'none'}
            />
            {query && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="text-muted-foreground"
              >
                Clear
              </Button>
            )}
          </div>

          <div
            className="max-h-[60vh] overflow-y-auto px-2 py-2"
            aria-live="polite"
            aria-busy={loading}
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Searching workspace…
              </div>
            ) : !hasSearchQuery ? (
              <div className="space-y-6">
                <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
                  <Sparkles className="h-6 w-6" aria-hidden="true" />
                  <p>Start typing to explore conversations, tasks, and more.</p>
                </div>
                <div className="border-t pt-4">
                  <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Quick links
                  </p>
                  <div className="flex flex-wrap gap-2 px-2">
                    {FEATURED_SHORTCUTS.map((shortcut) => (
                      <Button
                        key={shortcut.id}
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-full px-3 text-xs"
                        asChild
                      >
                        <Link href={shortcut.href}>{shortcut.title}</Link>
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ) : actionableItems.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
                <Sparkles className="h-6 w-6" aria-hidden="true" />
                <p>No matches yet. Try a different keyword.</p>
              </div>
            ) : (
              <div
                id="global-search-results"
                role="listbox"
                aria-label="Search results"
                className="space-y-4"
              >
                {groupedActionableItems.map((section) => (
                  <div
                    key={section.type}
                    role="group"
                    aria-labelledby={`global-search-group-${section.type}`}
                    className="space-y-2"
                  >
                    <div
                      id={`global-search-group-${section.type}`}
                      className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {section.label}
                    </div>
                    <div className="space-y-1">
                      {section.items.map((item) => {
                        const itemIndex = itemIndexMap.get(item.id) ?? 0;
                        const isActive = itemIndex === activeIndex;

                        return (
                          <button
                            key={item.id}
                            type="button"
                            id={`global-search-option-${item.id}`}
                            onClick={() => handleSelect(item)}
                            className={cn(
                              'flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors',
                              isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                            )}
                            role="option"
                            aria-selected={isActive}
                          >
                            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
                              {item.type === 'conversation' && (
                                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              {item.type === 'task' && <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />}
                              {item.type === 'knowledge' && <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />}
                              {item.type === 'alert' && <Bell className="h-3.5 w-3.5" aria-hidden="true" />}
                              {item.type === 'connector' && <Plug className="h-3.5 w-3.5" aria-hidden="true" />}
                              {item.type === 'board-meeting' && (
                                <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              {item.type === 'marketplace' && <Store className="h-3.5 w-3.5" aria-hidden="true" />}
                              {item.type === 'page' && <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
                            </div>

                            <div className="flex flex-1 flex-col gap-1">
                              <div className="flex items-center justify-between">
                                <span className="font-medium leading-tight">{item.title}</span>
                                {item.badge && <Badge variant="secondary">{item.badge}</Badge>}
                              </div>
                              {item.description && (
                                <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
                              )}
                            </div>

                            {isActive ? (
                              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                            ) : (
                              <Circle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
