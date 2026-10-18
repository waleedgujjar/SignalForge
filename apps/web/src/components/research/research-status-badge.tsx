import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { researchStatusLabel, researchStatusStyle } from './research-status';

interface Props {
  /** A `ResearchDisplayStatus`; unknown strings are shown verbatim in the neutral style. */
  status: string | null | undefined;
  className?: string;
}

export function ResearchStatusBadge({ status, className }: Props) {
  return (
    <Badge variant="outline" className={cn('border-transparent', researchStatusStyle(status), className)}>
      {researchStatusLabel(status)}
    </Badge>
  );
}
