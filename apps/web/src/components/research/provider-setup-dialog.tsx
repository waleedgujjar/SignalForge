'use client';

import { ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export const AGENT_REACH_REPO_URL = 'https://github.com/Panniantong/agent-reach';

interface SetupGuide {
  title: string;
  summary: string;
  steps: string[];
  /** Environment variable NAMES only — values are never shown in the UI. */
  envVars: { name: string; purpose: string }[];
  notes?: string[];
  link?: { href: string; label: string };
}

const GUIDES: Record<string, SetupGuide> = {
  manual: {
    title: 'Manual verification',
    summary: 'Always available and always the last step in the provider chain. Nothing to install.',
    steps: [
      'Open the LinkedIn URL attached to the research record in your own browser.',
      'Read the public profile or company page yourself.',
      'Use "Enter Data" on the record and type only the values you personally confirmed.',
      'Saved values are labelled Verified, with you recorded as the source.',
    ],
    envVars: [{ name: 'LINKEDIN_RESEARCH_ENABLED', purpose: 'Turns the whole Lead Research module on or off.' }],
    notes: ['The manual provider cannot be disabled — it guarantees every research job ends with a decision.'],
  },
  public: {
    title: 'Public page fetch (single request)',
    summary:
      'Fetches the URL you paste exactly once through a reader service, then parses only the fields visibly present on the public page.',
    steps: [
      'Enable the Lead Research module on the API and worker hosts.',
      'Select the public provider as the research provider.',
      'Keep the public fetch switch enabled (it is the default once the module is on).',
      'Optionally set a reader API key on the server if your reader plan requires one.',
      'Run a health check here to confirm the configuration is recognised.',
    ],
    envVars: [
      { name: 'LINKEDIN_RESEARCH_ENABLED', purpose: 'Module flag (strict: only "true" or "1" enable it).' },
      { name: 'LINKEDIN_RESEARCH_PROVIDER', purpose: 'Which provider heads the chain (manual, public or agent-reach).' },
      { name: 'LINKEDIN_RESEARCH_PUBLIC_FETCH_ENABLED', purpose: 'Allows the single public fetch.' },
      { name: 'JINA_READER_BASE_URL', purpose: 'Reader service base URL (https only).' },
      { name: 'JINA_API_KEY', purpose: 'Optional reader API key — kept server-side, never shown here.' },
      { name: 'LINKEDIN_RESEARCH_TIMEOUT_MS', purpose: 'Per-request timeout.' },
    ],
    notes: [
      'One request per researcher action. No crawling, no follow-ups, no retries around a refusal.',
      'An authwall, sign-in page, rate limit or CAPTCHA response stops the job and routes the record to Manual Review.',
      'Public-page values are labelled Inferred until a researcher marks them Verified.',
    ],
  },
  'agent-reach': {
    title: 'Agent-Reach (health check + public path)',
    summary:
      'SignalForge only runs the Agent-Reach health check and routes research through the public single-fetch path. No LinkedIn login is performed or stored.',
    steps: [
      'Install Agent-Reach on the API and worker hosts in an isolated Python virtual environment (no system-wide install).',
      'Point the binary path variable at the installed executable.',
      'Select agent-reach as the research provider and restart the API and the lead-research worker.',
      'Run a health check here — it executes the Agent-Reach doctor command and shows its sanitised status.',
    ],
    envVars: [
      { name: 'LINKEDIN_RESEARCH_PROVIDER', purpose: 'Set to the agent-reach provider to head the chain.' },
      { name: 'AGENT_REACH_BIN', purpose: 'Path to the Agent-Reach executable.' },
      { name: 'AGENT_REACH_HEALTH_TIMEOUT_MS', purpose: 'Timeout for the health check process.' },
      { name: 'LINKEDIN_RESEARCH_PUBLIC_FETCH_ENABLED', purpose: 'Allows the public fallback this provider delegates to.' },
      {
        name: 'LINKEDIN_RESEARCH_AGENT_REACH_MCP_ENABLED',
        purpose: 'Gated extension point for an authenticated read-only session. Off by default and not implemented in this release.',
      },
    ],
    notes: [
      'Health output is sanitised before storage or display: anything resembling a token, cookie or key is removed.',
      'SignalForge never reads Agent-Reach’s own session store and never stores LinkedIn cookies, tokens or passwords.',
    ],
    link: { href: AGENT_REACH_REPO_URL, label: 'Agent-Reach on GitHub' },
  },
  'authorized-api': {
    title: 'Authorized LinkedIn API',
    summary: 'Placeholder for an official partner integration. Not implemented in this release.',
    steps: [
      'Requires a LinkedIn partner API agreement.',
      'Once an agreement exists, this provider can be implemented against the official API with read-only scopes.',
    ],
    envVars: [],
    notes: ['There is nothing to configure today; the descriptor exists so the chain can grow without schema changes.'],
  },
};

const FALLBACK_GUIDE: SetupGuide = {
  title: 'Provider setup',
  summary: 'No setup guide is available for this provider yet.',
  steps: ['Refer to docs/linkedin-research.md in the repository.'],
  envVars: [],
};

interface Props {
  provider: string | null;
  displayName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProviderSetupDialog({ provider, displayName, open, onOpenChange }: Props) {
  const guide = (provider ? GUIDES[provider] : undefined) ?? FALLBACK_GUIDE;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{displayName ? `${displayName} — setup` : guide.title}</DialogTitle>
          <DialogDescription>{guide.summary}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <section>
            <h4 className="mb-1 font-medium">Steps</h4>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          {guide.envVars.length > 0 && (
            <section>
              <h4 className="mb-1 font-medium">Server environment variables</h4>
              <p className="mb-2 text-xs text-muted-foreground">
                Set these on the API and worker hosts. Names only — values never leave the server.
              </p>
              <ul className="space-y-1.5">
                {guide.envVars.map((env) => (
                  <li key={env.name} className="rounded-md border border-border px-3 py-2">
                    <code className="text-xs font-semibold">{env.name}</code>
                    <p className="text-xs text-muted-foreground">{env.purpose}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {guide.notes && guide.notes.length > 0 && (
            <section>
              <h4 className="mb-1 font-medium">Notes</h4>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {guide.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          )}

          {guide.link && (
            <a
              href={guide.link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {guide.link.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
