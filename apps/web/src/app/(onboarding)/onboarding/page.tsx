'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { onboardingSchema } from '@signalforge/validation';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { completeOnboarding } from '@/lib/api';
import { useAuth } from '@/components/auth-provider';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

type OnboardingFormValues = z.infer<typeof onboardingSchema>;

const useCaseOptions = [
  { value: 'LEAD_GENERATION', label: 'Lead generation' },
  { value: 'COLD_EMAIL', label: 'Cold email outreach' },
  { value: 'SALES_OUTREACH', label: 'Sales outreach' },
  { value: 'AGENCY', label: 'Agency / multi-client' },
  { value: 'OTHER', label: 'Other' },
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isLoading } = useAuth();
  const [serverError, setServerError] = useState('');

  const form = useForm<OnboardingFormValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { workspaceName: '', primaryUseCase: undefined },
  });

  async function onSubmit(values: OnboardingFormValues) {
    setServerError('');
    try {
      const session = await completeOnboarding(values);
      queryClient.setQueryData(['session'], session);
      router.push('/dashboard');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to create workspace');
    }
  }

  if (isLoading) {
    return (
      <div className="sf-dark flex min-h-screen flex-col items-center justify-center bg-background p-6">
        <Skeleton className="mb-8 h-10 w-48" />
        <Card className="w-full max-w-lg border-border/50">
          <CardHeader className="text-center">
            <Skeleton className="mx-auto h-4 w-16" />
            <Skeleton className="mx-auto mt-2 h-7 w-56" />
            <Skeleton className="mx-auto mt-2 h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="sf-dark relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(ellipse,_rgba(37,99,235,0.1),_transparent_60%)] blur-2xl" />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <Logo className="mb-10" href={null} size="lg" />
        <Card className="w-full max-w-lg border-border/50 bg-card/80 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <CardHeader className="space-y-2 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Welcome</p>
            <CardTitle className="text-2xl font-semibold tracking-tight">Set up your workspace</CardTitle>
            <CardDescription className="text-muted-foreground/80">
              Tell us about your team so we can personalize SignalForge.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="workspaceName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Workspace name
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Acme Sales"
                          className="h-11 border-border/60 bg-background/60 transition-colors focus:border-primary/60 focus:bg-background"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="primaryUseCase"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Primary use case (optional)
                      </FormLabel>
                      <FormControl>
                        <Select
                          value={field.value ?? ''}
                          onValueChange={(v) => field.onChange(v || undefined)}
                        >
                          <SelectTrigger className="h-11 border-border/60 bg-background/60">
                            <SelectValue placeholder="Select a use case" />
                          </SelectTrigger>
                          <SelectContent>
                            {useCaseOptions.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {serverError && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {serverError}
                  </p>
                )}
                <Button
                  type="submit"
                  className="group h-11 w-full gap-2 text-sm font-medium shadow-lg shadow-primary/20"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting ? (
                    'Creating workspace...'
                  ) : (
                    <>
                      Continue to dashboard
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
