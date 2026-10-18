'use client';

import { AlertCircle, CheckCircle2 } from 'lucide-react';

export function SpintaxHelper({ template }: { template: string }) {
  const hasSpintax = /\{[^{}]+\|[^{}]+\}/.test(template);
  const unbalanced = (template.match(/\{/g)?.length ?? 0) !== (template.match(/\}/g)?.length ?? 0);

  if (!hasSpintax && !unbalanced) {
    return (
      <p className="text-xs text-muted-foreground">
        Use spintax like {'{Hi|Hello|Hey}'} for variations. Variables use {'{{first_name}}'}.
      </p>
    );
  }

  return (
    <div className="flex items-start gap-2 text-xs">
      {unbalanced ? (
        <>
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 text-destructive" />
          <span className="text-destructive">Unbalanced spintax braces detected.</span>
        </>
      ) : (
        <>
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
          <span className="text-muted-foreground">Spintax detected — preview to see variations.</span>
        </>
      )}
    </div>
  );
}
