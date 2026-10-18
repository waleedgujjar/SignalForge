'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { fetchCampaignActivity } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function CampaignActivityPage() {
  const params = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['campaign', params.id, 'activity'],
    queryFn: () => fetchCampaignActivity(params.id),
  });

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  const activities = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activity timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <div className="space-y-4">
            {activities.map((item) => (
              <div key={item.id} className="flex gap-4 border-b border-border pb-4 last:border-0 last:pb-0">
                <div className="min-w-28 text-xs text-muted-foreground">
                  {new Date(item.createdAt).toLocaleString()}
                </div>
                <div>
                  <p className="text-sm font-medium">{item.type.replace(/_/g, ' ')}</p>
                  <p className="text-sm text-muted-foreground">{item.summary}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
