'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Globe2, Loader2, Sparkles } from 'lucide-react';

import { analyzeWebsiteUrl } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

export default function WebsiteIntelligenceStudioPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [maxPages, setMaxPages] = useState('10');

  const analyzeMutation = useMutation({
    mutationFn: () =>
      analyzeWebsiteUrl({
        url: url.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(company.trim() ? { company: company.trim() } : {}),
        maxPages: Number(maxPages),
      }),
    onSuccess: (result) => {
      toast.success('Website analysis started');
      router.push(`/website-intelligence/${result.analysisId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      toast.error('Enter a website URL');
      return;
    }
    analyzeMutation.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/website-intelligence">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analyze Website</h1>
          <p className="text-sm text-muted-foreground">
            Crawl and score any website for technical, SEO, and opportunity insights.
          </p>
        </div>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            Website Analysis Studio
          </CardTitle>
          <CardDescription>
            Enter a URL to analyze. A lead will be created or matched automatically if you do not
            provide an email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="url">Website URL</Label>
              <Input
                id="url"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Lead email (optional)</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="contact@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Company (optional)</Label>
                <Input
                  id="company"
                  placeholder="Acme Inc."
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxPages">Pages to crawl</Label>
              <Select value={maxPages} onValueChange={setMaxPages}>
                <SelectTrigger id="maxPages" className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 10, 15, 20].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} pages
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" disabled={analyzeMutation.isPending} className="w-full sm:w-auto">
              {analyzeMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Globe2 className="mr-2 h-4 w-4" />
              )}
              Start Analysis
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        You can also analyze a lead&apos;s website from their{' '}
        <Link href="/leads" className="text-primary hover:underline">
          lead detail page
        </Link>
        . Localhost and private network URLs are blocked for security.
      </p>
    </div>
  );
}
