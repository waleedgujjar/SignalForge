'use client';

import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { createCampaign } from '@/lib/api';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function NewCampaignPage() {
  const router = useRouter();

  const createMutation = useMutation({
    mutationFn: createCampaign,
    onSuccess: (campaign) => {
      toast.success('Campaign created');
      router.push(`/campaigns/${campaign.id}/leads`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    createMutation.mutate({
      name: form.get('name'),
      description: form.get('description') || undefined,
      steps: [],
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Create campaign"
        description="Start with a name and description, then follow the setup wizard to add leads, compose emails, and launch."
      />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Campaign name</Label>
              <Input id="name" name="name" placeholder="Q3 Enterprise Outreach" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Optional internal notes about this campaign"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.push('/campaigns')}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Campaign'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
