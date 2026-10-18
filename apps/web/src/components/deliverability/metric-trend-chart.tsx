'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/dashboard/empty-state';
import type { DeliverabilityTimelinePoint } from '@/lib/api';

type SeriesKey = keyof Omit<DeliverabilityTimelinePoint, 'date'>;

type MetricTrendChartProps = {
  title: string;
  description?: string;
  points: DeliverabilityTimelinePoint[];
  series: Array<{ key: SeriesKey; label: string; color: string }>;
  unit?: '%' | '';
};

export function MetricTrendChart({
  title,
  description,
  points,
  series,
  unit = '',
}: MetricTrendChartProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <EmptyState
            title="No data for this period"
            description="Daily metrics appear once sending activity has been aggregated."
          />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => `${value}${unit}`}
                />
                <Tooltip
                  formatter={(value, name) => [`${value}${unit}`, name]}
                  contentStyle={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                {series.map((entry) => (
                  <Line
                    key={entry.key}
                    type="monotone"
                    dataKey={entry.key}
                    name={entry.label}
                    stroke={entry.color}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
