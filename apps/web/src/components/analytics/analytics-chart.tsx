'use client';

import {
  Bar,
  BarChart,
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

export type ChartSeries<T> = {
  key: keyof T & string;
  label: string;
  color: string;
};

type AnalyticsChartProps<T extends { date: string }> = {
  title: string;
  description?: string;
  points: T[];
  series: Array<ChartSeries<T>>;
  unit?: '%' | '';
  variant?: 'line' | 'bar';
  emptyTitle?: string;
  emptyDescription?: string;
};

/// Shared time-series chart for the analytics views. Generic over the point
/// shape so the same component renders volume, rate, and warmup series.
export function AnalyticsChart<T extends { date: string }>({
  title,
  description,
  points,
  series,
  unit = '',
  variant = 'line',
  emptyTitle = 'No data for this period',
  emptyDescription = 'Charts fill in as sending and reply activity is recorded.',
}: AnalyticsChartProps<T>) {
  const Chart = variant === 'bar' ? BarChart : LineChart;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <Chart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
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
                {series.map((entry) =>
                  variant === 'bar' ? (
                    <Bar
                      key={entry.key}
                      dataKey={entry.key as never}
                      name={entry.label}
                      fill={entry.color}
                    />
                  ) : (
                    <Line
                      key={entry.key}
                      type="monotone"
                      dataKey={entry.key}
                      name={entry.label}
                      stroke={entry.color}
                      strokeWidth={2}
                      dot={false}
                    />
                  ),
                )}
              </Chart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
