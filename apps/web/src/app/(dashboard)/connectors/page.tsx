'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createApiClient } from '@/lib/api';
import { Connector, ConnectorProvider } from '@ocsuite/types';
import { ConnectorCard } from '@/components/connectors/connector-card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Plus, Loader2, Cable } from 'lucide-react';

const availableProviders = [
  {
    provider: 'google' as ConnectorProvider,
    name: 'Google Workspace',
    description: 'Connect Gmail, Calendar, and Drive',
    icon: '🔗',
  },
  {
    provider: 'gmail' as ConnectorProvider,
    name: 'Gmail',
    description: 'Access your email data',
    icon: '📧',
    disabled: true,
  },
  {
    provider: 'slack' as ConnectorProvider,
    name: 'Slack',
    description: 'Connect your Slack workspace',
    icon: '💬',
    disabled: true,
  },
  {
    provider: 'notion' as ConnectorProvider,
    name: 'Notion',
    description: 'Sync your Notion workspace',
    icon: '📝',
    disabled: true,
  },
  {
    provider: 'stripe' as ConnectorProvider,
    name: 'Stripe',
    description: 'Track payments and revenue',
    icon: '💳',
    disabled: true,
  },
];

export default function ConnectorsPage() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<ConnectorProvider | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadConnectors = useCallback(async () => {
    setLoading(true);
    try {
      const api = createApiClient(getToken);
      const data = await api.getConnectors();
      setConnectors(data);
    } catch (error) {
      console.error('Failed to load connectors:', error);
      toast({
        title: 'Error',
        description: 'Failed to load connectors',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [getToken, toast]);

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  const handleConnect = async (provider: ConnectorProvider) => {
    setConnecting(provider);
    try {
      const api = createApiClient(getToken);
      const { url } = await api.connectProvider(provider);

      // Redirect to OAuth flow
      window.location.href = url;
    } catch (error) {
      console.error('Failed to connect:', error);
      toast({
        title: 'Error',
        description: 'Failed to start connection. Please try again.',
        variant: 'destructive',
      });
      setConnecting(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm('Are you sure you want to disconnect this integration?')) {
      return;
    }

    try {
      const api = createApiClient(getToken);
      await api.disconnectConnector(id);
      toast({
        title: 'Success',
        description: 'Integration disconnected',
      });
      await loadConnectors();
    } catch (error) {
      console.error('Failed to disconnect:', error);
      toast({
        title: 'Error',
        description: 'Failed to disconnect integration',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Connectors</h1>
          <p className="text-muted-foreground">
            Manage your integrations and data sources
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Integration
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add Integration</DialogTitle>
              <DialogDescription>
                Connect your tools to give your AI team access to your business
                data
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {availableProviders.map((provider) => (
                <Card
                  key={provider.provider}
                  className={provider.disabled ? 'opacity-50' : ''}
                >
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="text-3xl">{provider.icon}</div>
                      <div>
                        <h3 className="font-semibold">
                          {provider.name}
                          {provider.disabled && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (Coming Soon)
                            </span>
                          )}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {provider.description}
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={() => handleConnect(provider.provider)}
                      disabled={
                        provider.disabled || connecting !== null
                      }
                    >
                      {connecting === provider.provider ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        'Connect'
                      )}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Connected integrations */}
      {connectors.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold mb-4">
            Connected Integrations ({connectors.length})
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {connectors.map((connector) => (
              <ConnectorCard
                key={connector.id}
                connector={connector}
                onDisconnect={handleDisconnect}
              />
            ))}
          </div>
        </div>
      ) : (
        <Card className="p-12">
          <div className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <Cable className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">No integrations yet</h3>
              <p className="text-muted-foreground mt-1">
                Connect your first integration to get started
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Integration
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
