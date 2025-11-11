'use client';

import { useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { UserButton } from '@clerk/nextjs';
import { Sidebar } from '@/components/dashboard/sidebar';
import { NotificationBell } from '@/components/dashboard/notification-bell';
import { GlobalSearch } from '@/components/dashboard/global-search';
import { AppFooter } from '@/components/dashboard/app-footer';
import { NotificationBellProvider } from '@/hooks/use-notification-bell';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useUser();

  return (
    <NotificationBellProvider>
      <a
        href="#dashboard-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <div className="min-h-screen bg-background">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main content */}
        <div className="lg:pl-64">
          <div className="flex min-h-screen flex-col">
            {/* Top bar */}
            <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:px-6 lg:px-8">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open navigation"
                  aria-expanded={sidebarOpen}
                  aria-controls="dashboard-sidebar"
                >
                  <Menu className="h-6 w-6" />
                </Button>
                <span className="text-sm font-medium text-muted-foreground hidden sm:inline-flex">
                  {user?.firstName ? `Welcome back, ${user.firstName}` : 'C-Suite Command Center'}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <GlobalSearch />
                <NotificationBell />
                <UserButton afterSignOutUrl="/sign-in" />
              </div>
            </header>

            {/* Page content */}
            <main id="dashboard-main" className="flex-1 p-4 sm:p-6 lg:p-8">
              {children}
            </main>

            <AppFooter />
          </div>
        </div>
      </div>
    </NotificationBellProvider>
  );
}
