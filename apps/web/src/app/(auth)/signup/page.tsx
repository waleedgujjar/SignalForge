'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import { signupSchema } from '@signalforge/validation';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { signup } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

type SignupFormValues = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [serverError, setServerError] = useState('');

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  async function onSubmit(values: SignupFormValues) {
    setServerError('');
    try {
      const session = await signup(values);
      queryClient.setQueryData(['session'], session);
      router.push('/onboarding');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unable to create account');
    }
  }

  return (
    <Card className="border-border/50 bg-card/80 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <CardHeader className="space-y-2 pb-4 text-center">
        <CardTitle className="text-2xl font-semibold tracking-tight">Create your account</CardTitle>
        <CardDescription className="text-muted-foreground/80">
          Start building your outbound engine
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Full name
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Jane Doe"
                      autoComplete="name"
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
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Email
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="you@company.com"
                      autoComplete="email"
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
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Password
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Min 8 chars, upper, lower, number"
                        autoComplete="new-password"
                        className="h-11 border-border/60 bg-background/60 pr-11 transition-colors focus:border-primary/60 focus:bg-background"
                        {...field}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 transition-colors hover:text-foreground"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Confirm password
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showConfirm ? 'text' : 'password'}
                        placeholder="Repeat password"
                        autoComplete="new-password"
                        className="h-11 border-border/60 bg-background/60 pr-11 transition-colors focus:border-primary/60 focus:bg-background"
                        {...field}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm(!showConfirm)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 transition-colors hover:text-foreground"
                        tabIndex={-1}
                      >
                        {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
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
              className="group h-11 w-full gap-2 text-sm font-medium shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? (
                'Creating account...'
              ) : (
                <>
                  Create account
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </Button>
          </form>
        </Form>
        <div className="mt-8 border-t border-border/40 pt-6 text-center">
          <p className="text-sm text-muted-foreground/70">
            Already have an account?{' '}
            <Link
              href="/login"
              className="font-medium text-primary transition-colors hover:text-primary/80"
            >
              Sign in
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
