import { Badge } from '@/components/ui/badge';
import { CONFIDENCE_VARIANTS, isResearchConfidence } from './research-status';

interface Props {
  /**
   * Loose on purpose: the lead page passes AI confidence strings ('HIGH' | 'MEDIUM' | 'LOW' | ...)
   * as well as `ResearchConfidence`. Unknown values render as an outline badge with the raw text.
   */
  confidence: string | null | undefined;
  className?: string;
}

export function ConfidenceBadge({ confidence, className }: Props) {
  if (!confidence) return null;
  const upper = confidence.toUpperCase();
  const variant = isResearchConfidence(upper) ? CONFIDENCE_VARIANTS[upper] : 'outline';
  return (
    <Badge variant={variant} className={className ?? 'text-xs'}>
      {confidence}
    </Badge>
  );
}
