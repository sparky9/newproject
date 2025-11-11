'use client';

import Link from 'next/link';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bell, ShieldHalf } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage notifications, security, and workspace preferences.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notification preferences
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Decide how C-Suite alerts you when actions need approval or finish executing.
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild variant="outline">
              <Link href="/settings/notifications">Manage channels</Link>
            </Button>
          </CardFooter>
        </Card>

        <Card className="border-dashed">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <ShieldHalf className="h-5 w-5" />
              Security controls
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Role management, SSO, and audit exports arrive later in Phase 4.
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" disabled>
              Coming soon
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
