import { CheckCircle2, CircleSlash, AlertTriangle, XCircle } from 'lucide-react';
import type { VerificationCheck } from '@/lib/api';

const CHECK_LABEL: Record<VerificationCheck['check'], string> = {
  syntax: 'Format',
  disposable: 'Disposable',
  role: 'Mailbox type',
  domain: 'Domain',
  mx: 'Mail server',
  smtp: 'Mailbox',
  catch_all: 'Catch-all',
};

function OutcomeIcon({ outcome }: { outcome: VerificationCheck['outcome'] }) {
  if (outcome === 'pass') return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-label="passed" />;
  if (outcome === 'fail') return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="failed" />;
  if (outcome === 'warn') return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" aria-label="warning" />;
  return <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="not checked" />;
}

/** The ordered evidence behind a verification result: why it got its status. */
export function VerificationEvidence({
  checks,
  smtpResponse,
}: {
  checks?: VerificationCheck[] | null;
  smtpResponse?: string | null;
}) {
  if (!checks?.length) {
    return (
      <p className="text-xs text-muted-foreground">
        No detailed evidence was stored for this result. Re-verify to see each check.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {checks.map((c, i) => (
          <li key={`${c.check}-${i}`} className="flex gap-2 text-sm">
            <OutcomeIcon outcome={c.outcome} />
            <span className="min-w-0">
              <span className="font-medium">{CHECK_LABEL[c.check] ?? c.check}:</span>{' '}
              <span className="break-words text-muted-foreground">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {smtpResponse ? (
        <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
          Server reply: {smtpResponse}
        </p>
      ) : null}
    </div>
  );
}
