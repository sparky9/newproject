import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Connector, ConnectorStatus } from '@ocsuite/types';
import { Badge } from '@/components/ui/badge';
import { Cable, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConnectorCardProps {
  connector: Connector;
  onDisconnect?: (id: string) => void;
}

const statusConfig: Record<
  ConnectorStatus,
  { label: string; icon: React.ElementType; variant: 'default' | 'destructive' | 'secondary' }
> = {
  active: { label: 'Active', icon: CheckCircle2, variant: 'default' },
  error: { label: 'Error', icon: AlertCircle, variant: 'destructive' },
  disconnected: { label: 'Disconnected', icon: AlertCircle, variant: 'secondary' },
  pending: { label: 'Syncing', icon: Clock, variant: 'secondary' },
};

const providerNames: Record<string, string> = {
  google: 'Google Workspace',
  gmail: 'Gmail',
  slack: 'Slack',
  notion: 'Notion',
  stripe: 'Stripe',
};

export function ConnectorCard({ connector, onDisconnect }: ConnectorCardProps) {
  const status = statusConfig[connector.status];
  const StatusIcon = status.icon;
  const providerName = providerNames[connector.provider] || connector.provider;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Cable className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">{providerName}</h3>
              <Badge variant={status.variant} className="mt-1">
                <StatusIcon className="h-3 w-3 mr-1" />
                {status.label}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {connector.lastSyncedAt && (
          <div className="text-sm text-muted-foreground">
            Last synced:{' '}
            {new Date(connector.lastSyncedAt).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        )}

        {connector.scopes && connector.scopes.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <div className="font-medium mb-1">Permissions:</div>
            <div className="flex flex-wrap gap-1">
              {connector.scopes.slice(0, 3).map((scope) => (
                <span
                  key={scope}
                  className="px-2 py-0.5 bg-muted rounded text-xs"
                >
                  {scope.split('.').pop()}
                </span>
              ))}
              {connector.scopes.length > 3 && (
                <span className="px-2 py-0.5 text-xs">
                  +{connector.scopes.length - 3} more
                </span>
              )}
            </div>
          </div>
        )}

        {onDisconnect && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDisconnect(connector.id)}
            className="w-full"
          >
            Disconnect
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
