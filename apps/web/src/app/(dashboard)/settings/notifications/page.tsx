'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createApiClient } from '@/lib/api';
import type { NotificationChannel, NotificationPreference } from '@ocsuite/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Bell, Mail, Slack } from 'lucide-react';

interface ChannelConfig {
  channel: NotificationChannel;
  label: string;
  description: string;
  icon: JSX.Element;
  disabled?: boolean;
  badge?: string;
}

const channelConfigs: ChannelConfig[] = [
  {
    channel: 'in_app',
    label: 'In-app alerts',
    description: 'Always on. Critical decisions and execution updates surface directly in the dashboard.',
    icon: <Bell className="h-5 w-5" />,
  },
  {
    channel: 'email',
    label: 'Email digests',
    description: 'Receive approvals and execution summaries in your inbox.',
    icon: <Mail className="h-5 w-5" />,
  },
  {
    channel: 'slack_stub',
    label: 'Slack workspace',
    description: 'Route alerts to a channel of your choice once Slack integration launches.',
    icon: <Slack className="h-5 w-5" />,
    disabled: true,
    badge: 'Coming soon',
  },
];

const DEFAULT_PREFERENCES: Record<NotificationChannel, boolean> = {
  in_app: true,
  email: false,
  slack_stub: false,
};

export default function NotificationSettingsPage() {
  const { getToken } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [savingChannel, setSavingChannel] = useState<NotificationChannel | null>(null);

  useEffect(() => {
    void loadPreferences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPreferences() {
    setLoading(true);
    try {
      const api = createApiClient(getToken);
      const response = await api.getNotificationPreferences();
      setPreferences(combineWithDefaults(response));
    } catch (error) {
      console.error('Failed to load notification preferences', error);
      toast({
        title: 'Unable to load preferences',
        description: 'Default notification settings are in use for now.',
        variant: 'destructive',
      });
      setPreferences(DEFAULT_PREFERENCES);
    } finally {
      setLoading(false);
    }
  }

  function combineWithDefaults(list: NotificationPreference[]): Record<NotificationChannel, boolean> {
    return list.reduce<Record<NotificationChannel, boolean>>((acc, pref) => {
      acc[pref.channel] = pref.enabled;
      return acc;
    }, { ...DEFAULT_PREFERENCES });
  }

  async function handleToggle(channel: NotificationChannel, enabled: boolean) {
    if (savingChannel === channel) return;
    if (channel === 'slack_stub') return;

    const previous = preferences[channel];
    setPreferences((current) => ({ ...current, [channel]: enabled }));
    setSavingChannel(channel);

    try {
      const api = createApiClient(getToken);
      await api.updateNotificationPreference(channel, enabled);
      toast({
        title: 'Preference updated',
        description: `${channel === 'email' ? 'Email' : 'In-app'} notifications ${enabled ? 'enabled' : 'disabled'}.`,
      });
    } catch (error) {
      console.error('Failed to update preference', error);
      setPreferences((current) => ({ ...current, [channel]: previous }));
      toast({
        title: 'Update failed',
        description: 'Settings were not changed. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSavingChannel(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Notification preferences</h1>
        <p className="text-muted-foreground">
          Choose where C-Suite sends approval requests and execution updates.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            channelConfigs.map((config) => {
              const enabled = preferences[config.channel];
              const disabled = config.disabled;
              const isSaving = savingChannel === config.channel;

              return (
                <div
                  key={config.channel}
                  className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-1 text-muted-foreground">{config.icon}</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{config.label}</span>
                        {config.badge && (
                          <Badge variant="outline" className="text-xs">
                            {config.badge}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {config.description}
                      </p>
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-muted"
                      checked={enabled}
                      disabled={disabled || isSaving}
                      onChange={(event) =>
                        handleToggle(config.channel, event.target.checked)
                      }
                    />
                    {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    <span>{enabled ? 'Enabled' : 'Disabled'}</span>
                  </label>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
