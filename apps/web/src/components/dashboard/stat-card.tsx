import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

type StatCardProps = {
  title: string;
  value: string | number;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  trend?: {
    value: string;
    positive?: boolean;
  };
  accent?: 'blue' | 'violet' | 'emerald' | 'amber';
  className?: string;
};

const accentStyles = {
  blue: {
    icon: 'bg-blue-500/10 text-blue-600 ring-blue-500/20',
    glow: 'from-blue-500/5 to-transparent',
  },
  violet: {
    icon: 'bg-violet-500/10 text-violet-600 ring-violet-500/20',
    glow: 'from-violet-500/5 to-transparent',
  },
  emerald: {
    icon: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20',
    glow: 'from-emerald-500/5 to-transparent',
  },
  amber: {
    icon: 'bg-amber-500/10 text-amber-600 ring-amber-500/20',
    glow: 'from-amber-500/5 to-transparent',
  },
};

export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  accent = 'blue',
  className,
}: StatCardProps) {
  const styles = accentStyles[accent];

  return (
    <Card
      className={cn(
        'relative overflow-hidden border-border/60 bg-white shadow-sm transition-shadow hover:shadow-md',
        className,
      )}
    >
      <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', styles.glow)} />
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold tracking-tight text-foreground">{value}</p>
            {(description || trend) && (
              <div className="flex flex-wrap items-center gap-2">
                {trend && (
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      trend.positive
                        ? 'bg-emerald-500/10 text-emerald-700'
                        : 'bg-red-500/10 text-red-700',
                    )}
                  >
                    {trend.positive ? '+' : ''}
                    {trend.value}
                  </span>
                )}
                {description && (
                  <span className="text-xs text-muted-foreground">{description}</span>
                )}
              </div>
            )}
          </div>
          {Icon && (
            <div
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1',
                styles.icon,
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
