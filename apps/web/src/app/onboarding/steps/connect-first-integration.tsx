'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Cable, Loader2 } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import { createApiClient } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { ConnectorProvider } from '@ocsuite/types';

interface ConnectFirstIntegrationStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

const integrations = [
  {
    provider: 'google' as ConnectorProvider,
    name: 'Google Workspace',
    description: 'Connect Gmail, Calendar, and Drive',
    icon: '🔗',
  },
];

export function ConnectFirstIntegrationStep({
  onNext,
  onBack,
  onSkip,
}: ConnectFirstIntegrationStepProps) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [connecting, setConnecting] = useState<ConnectorProvider | null>(null);

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

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Cable className="h-8 w-8 text-primary" />
        </div>
        <CardTitle>Connect Your First Integration</CardTitle>
        <p className="text-sm text-muted-foreground mt-2">
          Connect your tools to give your AI team access to your business data
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          {integrations.map((integration) => (
            <div
              key={integration.provider}
              className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="text-3xl">{integration.icon}</div>
                <div>
                  <h3 className="font-semibold">{integration.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {integration.description}
                  </p>
                </div>
              </div>
              <Button
                onClick={() => handleConnect(integration.provider)}
                disabled={connecting !== null}
              >
                {connecting === integration.provider ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Connect'
                )}
              </Button>
            </div>
          ))}
        </div>

        <div className="text-center text-sm text-muted-foreground">
          You can connect more integrations later from the Connectors page
        </div>

        <div className="flex justify-between pt-4">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <div className="space-x-2">
            <Button type="button" variant="ghost" onClick={onSkip}>
              Skip for Now
            </Button>
            <Button onClick={onNext}>Continue</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
