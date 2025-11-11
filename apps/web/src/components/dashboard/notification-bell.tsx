'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { Notification } from '@ocsuite/types';
import { Bell, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { createApiClient } from '@/lib/api';
import { useNotificationBell } from '@/hooks/use-notification-bell';

function formatCount(count: number): string {
  if (count > 99) return '99+';
  if (count > 9) return '9+';
  return String(count);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

function notificationPreview(notification: Notification): string {
  const payload = notification.payload as Record<string, unknown>;
  const body = (payload.message ?? payload.description ?? payload.body) as unknown;
  if (typeof body === 'string' && body.trim().length > 0) {
    return body;
  }
  return 'No additional details provided.';
}

export function NotificationBell() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { unreadCount, loading: countLoading, refresh, optimisticDecrement } =
    useNotificationBell();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [markingId, setMarkingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    void loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function loadRecent() {
    setListLoading(true);
    try {
      const api = createApiClient(getToken);
      const response = await api.getNotifications({ limit: 5 });
      setNotifications(response.notifications);
    } catch (error) {
      console.error('Failed to load recent notifications', error);
      toast({
        title: 'Unable to load notifications',
        description: 'Please try again shortly.',
        variant: 'destructive',
      });
    } finally {
      setListLoading(false);
    }
  }

  async function handleMarkRead(event: React.MouseEvent<HTMLButtonElement>, id: string) {
    event.preventDefault();
    event.stopPropagation();

    const target = notifications.find((item) => item.id === id);
    if (!target || target.readAt) {
      return;
    }

    setMarkingId(id);
    try {
      const api = createApiClient(getToken);
      const updated = await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, ...updated, readAt: updated.readAt ?? new Date().toISOString() }
            : item
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
    } finally {
      setMarkingId(null);
    }
  }

  const hasUnread = unreadCount > 0;

  return (
    <div ref={containerRef} className='relative'>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='relative'
        aria-haspopup='dialog'
        aria-expanded={isOpen}
        aria-label='Notifications menu'
        onClick={() => setIsOpen((open) => !open)}
      >
        {countLoading ? (
          <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
        ) : (
          <Bell className='h-5 w-5' />
        )}
        {hasUnread && (
          <Badge
            variant='destructive'
            className='absolute -right-1 -top-1 h-5 min-w-[1.25rem] justify-center px-1 text-[0.65rem] font-semibold'
          >
            {formatCount(unreadCount)}
          </Badge>
        )}
      </Button>

      {isOpen && (
        <div className='absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-md border bg-popover shadow-lg'>
          <div className='flex items-center justify-between border-b px-3 py-2 text-sm font-semibold'>
            <span>Notifications</span>
            <Link
              href='/notifications'
              className='text-xs font-normal text-primary hover:underline'
              onClick={() => setIsOpen(false)}
            >
              View all
            </Link>
          </div>

          <div className='max-h-96 overflow-y-auto p-3'>
            {listLoading ? (
              <div className='flex items-center justify-center py-8 text-muted-foreground'>
                <Loader2 className='h-5 w-5 animate-spin' />
              </div>
            ) : notifications.length === 0 ? (
              <div className='py-6 text-center text-sm text-muted-foreground'>
                You&apos;re all caught up.
              </div>
            ) : (
              <div className='space-y-3'>
                {notifications.map((notification) => {
                  const unread = !notification.readAt;
                  return (
                    <div
                      key={notification.id}
                      className={cn(
                        'rounded-md border px-3 py-2 text-sm transition-colors',
                        unread ? 'bg-primary/5 border-primary/20' : 'bg-card'
                      )}
                    >
                      <div className='flex flex-col gap-2'>
                        <div className='flex items-start justify-between gap-2'>
                          <p className='font-medium text-foreground'>{notificationTitle(notification)}</p>
                          {unread && (
                            <Button
                              size='sm'
                              variant='outline'
                              onClick={(event) => handleMarkRead(event, notification.id)}
                              disabled={markingId === notification.id}
                            >
                              {markingId === notification.id ? (
                                <Loader2 className='h-3.5 w-3.5 animate-spin' />
                              ) : (
                                'Mark read'
                              )}
                            </Button>
                          )}
                        </div>
                        <p className='text-xs text-muted-foreground'>
                          {notificationPreview(notification)}
                        </p>
                        <span className='text-[0.65rem] text-muted-foreground'>
                          {formatTimestamp(notification.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
