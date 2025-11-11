'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createApiClient } from '@/lib/api';
import type { Notification, NotificationChannel } from '@ocsuite/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useNotificationBell } from '@/hooks/use-notification-bell';
import { Bell, Loader2, CheckCheck, Mail, Slack, XCircle } from 'lucide-react';

const channelLabels: Record<NotificationChannel, string> = {
  in_app: 'In-app',
  email: 'Email',
  slack_stub: 'Slack (coming soon)',
};

const channelIcons: Record<NotificationChannel, JSX.Element> = {
  in_app: <Bell className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  slack_stub: <Slack className="h-4 w-4" />,
};

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function notificationTitle(notification: Notification): string {
  const payload = notification.payload as Record<string, unknown>;
  const title = payload.title;
  if (typeof title === 'string' && title.trim().length > 0) {
    return title;
  }
  const summary = payload.summary;
  if (typeof summary === 'string' && summary.trim().length > 0) {
    return summary;
  }
  return notification.type.replace(/_/g, ' ');
}

function notificationBody(notification: Notification): string {
  const payload = notification.payload as Record<string, unknown>;
  const message = (payload.message ?? payload.description ?? payload.body) as unknown;
  if (typeof message === 'string' && message.trim().length > 0) {
    return message;
  }
  return 'No additional details provided.';
}

export default function NotificationsPage() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { refresh, optimisticDecrement } = useNotificationBell();

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);

  useEffect(() => {
    void fetchNotifications(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly]);

  async function fetchNotifications(reset = false) {
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const api = createApiClient(getToken);
      const response = await api.getNotifications({
        limit: 20,
        cursor: reset ? undefined : cursor,
        unread: unreadOnly || undefined,
      });

      setNotifications((prev) =>
        reset ? response.notifications : [...prev, ...response.notifications]
      );
      setCursor(response.nextCursor);
      setHasMore(Boolean(response.nextCursor));
    } catch (error) {
      console.error('Failed to load notifications', error);
      toast({
        title: 'Unable to load notifications',
        description: 'Please try again shortly.',
        variant: 'destructive',
      });
    } finally {
      if (reset) {
        setLoading(false);
      } else {
        setLoadingMore(false);
      }
    }
  }

  async function markAsRead(notificationId: string) {
    try {
      const api = createApiClient(getToken);
      const updated = await api.markNotificationRead(notificationId);
      setNotifications((prev) =>
        prev.map((notification) =>
          notification.id === notificationId
            ? { ...updated, readAt: updated.readAt ?? new Date().toISOString() }
            : notification
        )
      );
      optimisticDecrement();
      void refresh();
    } catch (error) {
      console.error('Failed to mark notification read', error);
      toast({
        title: 'Mark read failed',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      const api = createApiClient(getToken);
      await api.markAllNotificationsRead();
      setNotifications((prev) =>
        prev.map((notification) => ({
          ...notification,
          readAt: notification.readAt ?? new Date().toISOString(),
        }))
      );
      void refresh();
      toast({ title: 'All notifications marked as read' });
    } catch (error) {
      console.error('Failed to mark all notifications read', error);
      toast({
        title: 'Unable to mark all read',
        description: 'Please try again shortly.',
        variant: 'destructive',
      });
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bell className="h-7 w-7" />
            Notifications
          </h1>
          <p className="text-muted-foreground">
            Stay on top of approvals, execution updates, and AI activity.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-muted"
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
            />
            Show unread only
          </label>
          <Button
            variant="outline"
            onClick={markAllRead}
            disabled={markingAll || notifications.every((n) => n.readAt)}
          >
            {markingAll ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCheck className="h-4 w-4 mr-2" />
            )}
            Mark all read
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity feed</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <XCircle className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="font-medium">No notifications yet</p>
              <p className="text-sm text-muted-foreground">
                When actions execute or require attention, they will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => {
                const unread = !notification.readAt;
                return (
                  <div
                    key={notification.id}
                    className={cn(
                      'rounded-lg border p-4 transition-colors',
                      unread
                        ? 'bg-primary/5 border-primary/20'
                        : 'bg-card'
                    )}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={unread ? 'warning' : 'outline'}>
                            {notificationTitle(notification)}
                          </Badge>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            {channelIcons[notification.channel]}
                            <span>{channelLabels[notification.channel]}</span>
                          </div>
                        </div>
                        <p className="text-sm text-foreground">
                          {notificationBody(notification)}
                        </p>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(notification.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {unread && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => markAsRead(notification.id)}
                          >
                            Mark read
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {hasMore && (
                <div className="pt-2">
                  <Button
                    variant="outline"
                    onClick={() => fetchNotifications(false)}
                    disabled={loadingMore}
                  >
                    {loadingMore && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    Load more
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
