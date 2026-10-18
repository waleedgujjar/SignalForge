'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { EligibilityReport } from '@/lib/api';

export function LeadEligibilityModal({
  open,
  onOpenChange,
  report,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: EligibilityReport | null;
  onConfirm: () => void;
  loading?: boolean;
}) {
  if (!report) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lead eligibility</DialogTitle>
          <DialogDescription>
            Review which leads can be enrolled before confirming.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">Eligible</p>
            <p className="text-2xl font-semibold text-emerald-600">{report.counts.eligible}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">Already enrolled</p>
            <p className="text-2xl font-semibold">{report.counts.alreadyEnrolled}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">Suppressed</p>
            <p className="text-2xl font-semibold text-amber-600">{report.counts.suppressed}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">Ineligible</p>
            <p className="text-2xl font-semibold text-destructive">{report.counts.ineligible}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={loading || report.counts.eligible === 0}>
            Enroll {report.counts.eligible} lead(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
