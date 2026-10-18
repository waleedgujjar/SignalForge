import { Badge } from '@/components/ui/badge';

const STATUS_LABEL: Record<string, string> = {
  VERIFIED: 'Valid',
  ROLE_BASED: 'Role',
  RISKY: 'Risky',
  INVALID: 'Invalid',
  UNKNOWN: 'Unknown',
  DISPOSABLE: 'Disposable',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  VERIFIED: 'default',
  ROLE_BASED: 'secondary',
  RISKY: 'outline',
  INVALID: 'destructive',
  UNKNOWN: 'secondary',
  DISPOSABLE: 'destructive',
};

export function VerificationStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'outline'}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export function verificationStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}
