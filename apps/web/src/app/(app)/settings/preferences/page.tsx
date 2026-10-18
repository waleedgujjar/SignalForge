'use client';

import Link from 'next/link';
import { ShieldBan } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function PreferencesPage() {
  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Preferences</CardTitle>
          <CardDescription>
            Configure workspace-level preferences and data management.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Link
            href="/settings/suppression"
            className="flex items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <ShieldBan className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Suppression Lists</p>
              <p className="text-xs text-muted-foreground">
                Manage email and domain suppression lists to protect your sender reputation.
              </p>
            </div>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
