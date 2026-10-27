'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { previewCampaignEmail, type Lead } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function EmailPreviewPanel({
  campaignId,
  subjectTemplate,
  bodyTemplate,
  leads,
}: {
  campaignId: string;
  subjectTemplate: string;
  bodyTemplate: string;
  leads: Lead[];
}) {
  const [leadId, setLeadId] = React.useState(leads[0]?.id ?? '');
  const [preview, setPreview] = React.useState<{ subject: string; body: string } | null>(null);
  const [seed, setSeed] = React.useState(0);

  const previewMutation = useMutation({
    mutationFn: (previewSeed: number) =>
      previewCampaignEmail(campaignId, {
        leadId,
        subjectTemplate,
        bodyTemplate,
        seed: previewSeed,
      }),
    onSuccess: (result) => {
      if (result.subject && result.body) {
        setPreview({ subject: result.subject, body: result.body });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  React.useEffect(() => {
    // Note: previewMutation is intentionally excluded — it is recreated every
    // render, so depending on it would re-run this effect in an infinite loop.
    if (leadId && subjectTemplate && bodyTemplate) {
      previewMutation.mutate(seed);
    }
  }, [leadId, subjectTemplate, bodyTemplate, seed]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Email preview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Preview lead</Label>
          <Select value={leadId} onValueChange={setLeadId}>
            <SelectTrigger>
              <SelectValue placeholder="Select lead" />
            </SelectTrigger>
            <SelectContent>
              {leads.map((lead) => (
                <SelectItem key={lead.id} value={lead.id}>
                  {lead.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {preview ? (
          <div className="space-y-3 rounded-md border border-border p-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Subject</p>
              <p className="text-sm">{preview.subject}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Body</p>
              <p className="whitespace-pre-wrap text-sm">{preview.body}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Select a lead to preview rendered output.</p>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!leadId || previewMutation.isPending}
          onClick={() => setSeed((s) => s + 1)}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Generate another variation
        </Button>
      </CardContent>
    </Card>
  );
}
