'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  MessageSquare,
  Cable,
  Settings,
  X,
  CheckSquare,
  Users,
  ClipboardList,
  Bell,
  Book,
  Store,
  CreditCard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const navigation = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    name: 'Marketplace',
    href: '/marketplace',
    icon: Store,
  },
  {
    name: 'Billing',
    href: '/billing',
    icon: CreditCard,
  },
  {
    name: 'Chat',
    href: '/chat',
    icon: MessageSquare,
  },
  {
    name: 'Board Meeting',
    href: '/board',
    icon: Users,
  },
  {
    name: 'Actions',
    href: '/actions',
    icon: ClipboardList,
  },
  {
    name: 'Tasks',
    href: '/tasks',
    icon: CheckSquare,
  },
  {
    name: 'Connectors',
    href: '/connectors',
    icon: Cable,
  },
  {
    name: 'Knowledge',
    href: '/knowledge',
    icon: Book,
  },
  {
    name: 'Notifications',
    href: '/notifications',
    icon: Bell,
  },
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
  },
];

export function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        id="dashboard-sidebar"
        className={cn(
          'fixed top-0 left-0 z-50 h-full w-64 bg-card border-r transition-transform duration-300 ease-in-out lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
  aria-hidden={isOpen ? undefined : true}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold">
                CS
              </div>
              <span className="font-semibold text-lg">C-Suite</span>
            </div>
            {onClose && (
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={onClose}
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1" aria-label="Workspace navigation">
            {navigation.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    'flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                  onClick={onClose}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="p-4 border-t">
            <div className="text-xs text-muted-foreground text-center">
              v1.0.0 - Phase 4
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
