'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { MarketplaceWidgetWithInstall } from '@ocsuite/types';
import { createApiClient } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BadgeCheck,
  Loader2,
  MinusCircle,
  PlusCircle,
  Puzzle,
  Store,
} from 'lucide-react';

interface OperationState {
  slug: string | null;
  mode: 'install' | 'uninstall' | null;
}

export default function MarketplacePage() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [widgets, setWidgets] = useState<MarketplaceWidgetWithInstall[]>([]);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<OperationState>({ slug: null, mode: null });
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'installed' | 'available'>('all');
  const [query, setQuery] = useState('');

  const api = useMemo(() => createApiClient(getToken), [getToken]);

  const loadWidgets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listMarketplaceWidgets();
      setWidgets(data ?? []);
    } catch (error) {
      console.error('Failed to load marketplace widgets', error);
      toast({
        title: 'Unable to load marketplace',
        description: 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [api, toast]);

  useEffect(() => {
    loadWidgets();
  }, [loadWidgets]);

  const categories = useMemo(() => {
    const unique = new Set<string>();
    for (const widget of widgets) {
      if (widget.category) {
        unique.add(widget.category);
      }
    }
    return ['all', ...Array.from(unique).sort((a, b) => a.localeCompare(b))];
  }, [widgets]);

  const installedCount = useMemo(
    () => widgets.filter((widget) => widget.installed).length,
    [widgets]
  );

  const filteredWidgets = useMemo(() => {
    const search = query.trim().toLowerCase();

    return widgets.filter((widget) => {
      if (categoryFilter !== 'all' && widget.category !== categoryFilter) {
        return false;
      }

      if (statusFilter === 'installed' && !widget.installed) {
        return false;
      }

      if (statusFilter === 'available' && widget.installed) {
        return false;
      }

      if (!search) {
        return true;
      }

      return (
        widget.name.toLowerCase().includes(search) ||
        widget.description.toLowerCase().includes(search) ||
        widget.category.toLowerCase().includes(search)
      );
    });
  }, [widgets, categoryFilter, statusFilter, query]);

  const isOperating = (slug: string, mode: 'install' | 'uninstall') =>
    operation.slug === slug && operation.mode === mode;

  const handleInstall = async (widget: MarketplaceWidgetWithInstall) => {
    setOperation({ slug: widget.slug, mode: 'install' });
    try {
      const updated = await api.installWidget(widget.slug);
      setWidgets((current) =>
        current.map((entry) => (entry.slug === updated.slug ? updated : entry))
      );
      toast({
        title: 'Widget installed',
        description: `${widget.name} has been added to your dashboard.`,
      });
    } catch (error) {
      console.error('Failed to install widget', error);
      toast({
        title: 'Installation failed',
        description: 'Please try again or contact support if the problem persists.',
        variant: 'destructive',
      });
    } finally {
      setOperation({ slug: null, mode: null });
    }
  };

  const handleUninstall = async (widget: MarketplaceWidgetWithInstall) => {
    setOperation({ slug: widget.slug, mode: 'uninstall' });
    try {
      await api.uninstallWidget(widget.slug);
      setWidgets((current) =>
        current.map((entry) =>
          entry.slug === widget.slug
            ? {
                ...entry,
                installed: false,
                enabledAt: undefined,
                settings: null,
              }
            : entry
        )
      );
      toast({
        title: 'Widget removed',
        description: `${widget.name} has been uninstalled.`,
      });
    } catch (error) {
      console.error('Failed to uninstall widget', error);
      toast({
        title: 'Uninstall failed',
        description: 'We were unable to remove this widget. Please retry shortly.',
        variant: 'destructive',
      });
    } finally {
      setOperation({ slug: null, mode: null });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Marketplace</h1>
        <p className="text-muted-foreground">
          Browse and install widgets to extend your executive dashboard.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Store className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold">{widgets.length} widgets available</CardTitle>
              <CardDescription>
                {installedCount} installed • {widgets.length - installedCount} available
              </CardDescription>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search widgets"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="sm:w-[180px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category === 'all' ? 'All categories' : category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) =>
                setStatusFilter(value as 'all' | 'installed' | 'available')
              }
            >
              <SelectTrigger className="sm:w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All widgets</SelectItem>
                <SelectItem value="installed">Installed</SelectItem>
                <SelectItem value="available">Available</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, index) => (
            <Card key={index} className="animate-pulse">
              <CardHeader className="space-y-2">
                <div className="h-4 w-1/2 rounded bg-muted" />
                <div className="h-3 w-1/3 rounded bg-muted" />
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="h-3 w-full rounded bg-muted" />
                <div className="h-3 w-2/3 rounded bg-muted" />
              </CardContent>
              <CardFooter>
                <div className="h-9 w-24 rounded bg-muted" />
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : filteredWidgets.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Puzzle className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">No widgets match your filters</p>
              <p className="text-sm text-muted-foreground">
                Try adjusting your filters or search terms.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredWidgets.map((widget) => (
            <Card key={widget.slug} className="flex h-full flex-col">
              <CardHeader className="space-y-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg font-semibold">
                    {widget.name}
                  </CardTitle>
                  {widget.installed && (
                    <Badge variant="success" className="gap-1">
                      <BadgeCheck className="h-3 w-3" />
                      Installed
                    </Badge>
                  )}
                </div>
                <CardDescription>{widget.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{widget.category}</Badge>
                  {(widget.dashboard?.tags ?? widget.requiredCapabilities).slice(0, 4).map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
                {widget.dashboard?.tile && (
                  <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Dashboard Tile</p>
                    <p>{widget.dashboard.tile.description || 'Adds a new dashboard tile.'}</p>
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {widget.installed && widget.enabledAt ? `Enabled ${new Date(widget.enabledAt).toLocaleDateString()}` : 'Not installed'}
                </div>
                {widget.installed ? (
                  <Button
                    variant="outline"
                    onClick={() => handleUninstall(widget)}
                    disabled={isOperating(widget.slug, 'uninstall')}
                  >
                    {isOperating(widget.slug, 'uninstall') ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <MinusCircle className="mr-2 h-4 w-4" />
                    )}
                    Uninstall
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleInstall(widget)}
                    disabled={isOperating(widget.slug, 'install')}
                  >
                    {isOperating(widget.slug, 'install') ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <PlusCircle className="mr-2 h-4 w-4" />
                    )}
                    Install
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
