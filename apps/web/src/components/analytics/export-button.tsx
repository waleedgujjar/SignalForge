'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { downloadAnalyticsExport, type AnalyticsQuery } from '@/lib/api';

type ExportEntity = Parameters<typeof downloadAnalyticsExport>[0];

export function AnalyticsExportButton({
  entity,
  query,
}: {
  entity: ExportEntity;
  query: AnalyticsQuery;
}) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { filename, csv } = await downloadAnalyticsExport(entity, query);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button variant="outline" size="sm" disabled={exporting} onClick={handleExport}>
      <Download className="mr-2 h-4 w-4" aria-hidden />
      {exporting ? 'Exporting…' : 'Export CSV'}
    </Button>
  );
}
