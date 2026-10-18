import { BadgeCheck, CircleHelp, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { VerificationState } from '@/lib/api';
import { VERIFICATION_LABELS, VERIFICATION_VARIANTS, toVerificationState } from './research-status';

interface Props {
  /** Anything that is not an explicit label renders as Unknown — the UI never upgrades a value. */
  verification: VerificationState | string | null | undefined;
  className?: string;
}

const ICONS: Record<VerificationState, React.ComponentType<{ className?: string }>> = {
  VERIFIED: BadgeCheck,
  INFERRED: TriangleAlert,
  UNKNOWN: CircleHelp,
};

/** Always text + icon (never colour-only) so the label survives colour-blindness and dark mode. */
export function VerificationBadge({ verification, className }: Props) {
  const state = toVerificationState(verification);
  const Icon = ICONS[state];
  return (
    <Badge variant={VERIFICATION_VARIANTS[state]} className={cn('gap-1 text-xs font-medium', className)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {VERIFICATION_LABELS[state]}
    </Badge>
  );
}
