import Link from 'next/link';
import { ArrowRight, Zap, Shield, Mail, BarChart3, Globe, Repeat } from 'lucide-react';
import { Logo } from '@/components/logo';
import { HealthStatus } from '@/components/health-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const features = [
  {
    icon: Mail,
    title: 'Multiple SMTP',
    description: 'Connect unlimited mailboxes with encrypted credentials',
  },
  {
    icon: Repeat,
    title: 'Smart Rotation',
    description: 'Health-aware SMTP rotation across your accounts',
  },
  {
    icon: Zap,
    title: 'Dynamic Variables',
    description: 'Spintax and merge fields for hyper-personalization',
  },
  {
    icon: BarChart3,
    title: 'Unlimited Campaigns',
    description: 'Launch, pause, and resume with full analytics',
  },
  {
    icon: Globe,
    title: 'Country Filters',
    description: 'Target leads by geography for compliance and relevance',
  },
  {
    icon: Shield,
    title: 'Suppression Lists',
    description: 'Centralized blacklists to protect your domain reputation',
  },
];

export default function HomePage() {
  return (
    <main className="sf-dark min-h-screen bg-background">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-0 h-[700px] w-[1000px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(ellipse,_rgba(45,127,249,0.08),_transparent_60%)] blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[500px] w-[700px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(ellipse,_rgba(6,182,212,0.06),_transparent_60%)] blur-3xl" />
      </div>

      {/* Nav bar */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo size="md" />
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild className="border-border/50 text-sm">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button size="sm" asChild className="text-sm shadow-lg shadow-primary/20">
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-16 md:pt-24">
        <div className="max-w-3xl space-y-6 animate-fade-in">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary">
            <Zap className="h-3.5 w-3.5" />
            AI-Powered Outbound Intelligence
          </div>
          <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-foreground md:text-6xl">
            Turn the right signals into{' '}
            <span className="text-primary">
              sales conversations
            </span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
            The AI outbound sales platform with smart SMTP rotation, dynamic personalization,
            verification, suppression, and unlimited campaigns — all in one place.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button size="lg" asChild className="group gap-2 shadow-lg shadow-primary/20">
              <Link href="/signup">
                Start for free
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild className="border-border/50">
              <Link href="/dashboard">View dashboard</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-20">
        <div className="mb-10 max-w-lg">
          <h2 className="text-2xl font-semibold tracking-tight">Everything you need</h2>
          <p className="mt-2 text-muted-foreground">
            Nine integrated features to power your outbound engine.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Card
              key={f.title}
              className="group border-border/50 bg-card/60 backdrop-blur transition-all hover:border-border hover:bg-card/80"
            >
              <CardContent className="flex gap-4 p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                  <f.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{f.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {f.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Status section */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-2">
          <HealthStatus />
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/30 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6">
          <Logo href="/" size="sm" />
          <p className="text-xs text-muted-foreground/50">
            &copy; {new Date().getFullYear()} SignalForge
          </p>
        </div>
      </footer>
    </main>
  );
}
