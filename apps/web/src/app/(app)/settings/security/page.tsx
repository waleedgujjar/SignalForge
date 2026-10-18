'use client';

import { useAuth } from '@/components/auth-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function SecurityPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Password</CardTitle>
          <CardDescription>
            Manage your account password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Password management is coming soon. Use the forgot password flow from the login page to reset your password.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Sessions</CardTitle>
          <CardDescription>
            Active sessions on your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border border-border p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Current Session</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <Badge variant="success">Active</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
