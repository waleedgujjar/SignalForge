import { Badge } from '@/components/ui/badge';
import type { ReplyClassification } from '@/lib/api';

const LABELS: Record<ReplyClassification, string> = {
  INTERESTED: 'Interested',
  NOT_INTERESTED: 'Not interested',
  QUESTION: 'Question',
  NEEDS_FOLLOW_UP: 'Needs follow-up',
  OUT_OF_OFFICE: 'Out of office',
  UNSUBSCRIBE: 'Unsubscribe',
  WRONG_PERSON: 'Wrong person',
  REFERRAL: 'Referral',
  POSITIVE: 'Positive',
  NEGATIVE: 'Negative',
  NEUTRAL: 'Neutral',
  UNKNOWN: 'Unknown',
};

const VARIANTS: Record<
  ReplyClassification,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'
> = {
  INTERESTED: 'success',
  NOT_INTERESTED: 'secondary',
  QUESTION: 'default',
  NEEDS_FOLLOW_UP: 'warning',
  OUT_OF_OFFICE: 'outline',
  UNSUBSCRIBE: 'destructive',
  WRONG_PERSON: 'secondary',
  REFERRAL: 'default',
  POSITIVE: 'success',
  NEGATIVE: 'destructive',
  NEUTRAL: 'outline',
  UNKNOWN: 'outline',
};

type ClassificationBadgeProps = {
  classification: ReplyClassification | null | undefined;
  className?: string;
};

export function ClassificationBadge({ classification, className }: ClassificationBadgeProps) {
  if (!classification) {
    return (
      <Badge variant="outline" className={className}>
        Unclassified
      </Badge>
    );
  }

  return (
    <Badge variant={VARIANTS[classification]} className={className}>
      {LABELS[classification]}
    </Badge>
  );
}
