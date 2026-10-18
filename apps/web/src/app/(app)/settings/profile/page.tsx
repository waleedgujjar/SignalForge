'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProfile, updateProfile, type UserProfile } from '@/lib/api';
import { useAuth } from '@/components/auth-provider';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

function initials(profile: UserProfile | null): string {
  if (profile?.firstName && profile?.lastName) {
    return `${profile.firstName[0]}${profile.lastName[0]}`.toUpperCase();
  }
  if (profile?.name) {
    const parts = profile.name.trim().split(/\s+/);
    return parts.length >= 2
      ? `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
      : profile.name.slice(0, 2).toUpperCase();
  }
  return (profile?.email ?? '??').slice(0, 2).toUpperCase();
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const { refreshSession } = useAuth();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: fetchProfile,
  });

  const [firstName, setFirstName] = useState<string | undefined>();
  const [lastName, setLastName] = useState<string | undefined>();

  const displayFirstName = firstName ?? profile?.firstName ?? '';
  const displayLastName = lastName ?? profile?.lastName ?? '';

  const mutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      refreshSession();
    },
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const newFirstName = displayFirstName || null;
    const newLastName = displayLastName || null;
    const nameParts = [newFirstName, newLastName].filter(Boolean);
    const name = nameParts.length > 0 ? nameParts.join(' ') : profile?.name ?? null;

    mutation.mutate({ firstName: newFirstName, lastName: newLastName, name });
  }

  const hasChanges =
    (firstName !== undefined && firstName !== (profile?.firstName ?? '')) ||
    (lastName !== undefined && lastName !== (profile?.lastName ?? ''));

  if (isLoading) return <ProfileSkeleton />;

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Personal Information</CardTitle>
          <CardDescription>Update your name and profile details.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
                  {initials(profile ?? null)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {profile?.name ?? profile?.email}
                </p>
                <p className="text-xs text-muted-foreground">{profile?.email}</p>
              </div>
            </div>

            <Separator />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={displayFirstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={displayLastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={profile?.email ?? ''} disabled />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed here.
              </p>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={!hasChanges || mutation.isPending}>
                {mutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Account Details</CardTitle>
          <CardDescription>Your account information.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Role</dt>
              <dd className="mt-1">
                <Badge variant="secondary">{profile?.role ?? 'N/A'}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Workspace</dt>
              <dd className="mt-1 text-sm text-foreground">
                {profile?.workspace?.name ?? 'None'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Email Verified</dt>
              <dd className="mt-1 text-sm text-foreground">
                {profile?.emailVerifiedAt
                  ? new Date(profile.emailVerifiedAt).toLocaleDateString()
                  : 'Not verified'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Account Created</dt>
              <dd className="mt-1 text-sm text-foreground">
                {profile?.createdAt
                  ? new Date(profile.createdAt).toLocaleDateString()
                  : '—'}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
