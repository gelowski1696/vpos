'use client';

import { useReducedMotion } from 'framer-motion';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--admin-surface)',
  border: '1px solid var(--admin-border)',
  borderRadius: '0.625rem',
  boxShadow: '0 12px 28px rgb(15 23 42 / 0.12)',
  color: 'var(--admin-text)',
  fontSize: '0.75rem'
};

function shortDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[2]}/${match[3]}` : value;
}

function EmptyChart({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="grid h-56 place-items-center rounded-lg border border-dashed border-adminBorder bg-adminMuted/50 px-4 text-center text-xs text-adminTextMuted" role="status">
      {message}
    </div>
  );
}

export function TrendAreaChart({
  data,
  label = 'Amount',
  valueFormatter = (value) => value.toLocaleString()
}: {
  data: Array<{ date: string; value: number }>;
  label?: string;
  valueFormatter?: (value: number) => string;
}): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  if (data.length === 0) {
    return <EmptyChart message="No trend data for the selected scope." />;
  }

  return (
    <div aria-label={`${label} trend chart`} className="h-64 w-full" role="img">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart accessibilityLayer data={data} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}>
          <defs>
            <linearGradient id="admin-trend-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--admin-accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--admin-accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--admin-border)" strokeDasharray="3 5" vertical={false} />
          <XAxis axisLine={false} dataKey="date" tick={{ fill: 'var(--admin-text-muted)', fontSize: 11 }} tickFormatter={shortDate} tickLine={false} />
          <YAxis axisLine={false} tick={{ fill: 'var(--admin-text-muted)', fontSize: 11 }} tickFormatter={(value) => Number(value).toLocaleString(undefined, { notation: 'compact' })} tickLine={false} width={44} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [valueFormatter(Number(value)), label]} labelFormatter={(value) => String(value)} />
          <Area
            dataKey="value"
            fill="url(#admin-trend-fill)"
            isAnimationActive={!reduceMotion}
            name={label}
            stroke="var(--admin-accent)"
            strokeWidth={2.5}
            type="monotone"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PerformanceBarChart({
  data,
  valueFormatter = (value) => value.toLocaleString()
}: {
  data: Array<{ name: string; primary: number; secondary: number }>;
  valueFormatter?: (value: number) => string;
}): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  if (data.length === 0) {
    return <EmptyChart message="No comparison data for the selected scope." />;
  }

  return (
    <div aria-label="Performance comparison chart" className="h-64 w-full" role="img">
      <ResponsiveContainer height="100%" width="100%">
        <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}>
          <CartesianGrid stroke="var(--admin-border)" strokeDasharray="3 5" vertical={false} />
          <XAxis axisLine={false} dataKey="name" tick={{ fill: 'var(--admin-text-muted)', fontSize: 11 }} tickLine={false} />
          <YAxis axisLine={false} tick={{ fill: 'var(--admin-text-muted)', fontSize: 11 }} tickFormatter={(value) => Number(value).toLocaleString(undefined, { notation: 'compact' })} tickLine={false} width={44} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [valueFormatter(Number(value)), String(name)]} />
          <Legend iconSize={8} wrapperStyle={{ fontSize: '0.7rem' }} />
          <Bar dataKey="primary" fill="var(--admin-accent)" isAnimationActive={!reduceMotion} maxBarSize={30} name="Sales" radius={[5, 5, 0, 0]} />
          <Bar dataKey="secondary" fill="#10b981" isAnimationActive={!reduceMotion} maxBarSize={30} name="Gross profit" radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MultiSeriesAreaChart({
  data,
  primaryLabel,
  secondaryLabel,
  valueFormatter = (value) => value.toLocaleString()
}: {
  data: Array<{ date: string; primary: number; secondary: number }>;
  primaryLabel: string;
  secondaryLabel: string;
  valueFormatter?: (value: number) => string;
}): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  if (data.length === 0) {
    return <EmptyChart message="No trend data for the selected scope." />;
  }

  return (
    <div aria-label={`${primaryLabel} and ${secondaryLabel} trend chart`} className="h-64 w-full" role="img">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart accessibilityLayer data={data} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}>
          <CartesianGrid stroke="var(--admin-border)" strokeDasharray="3 5" vertical={false} />
          <XAxis axisLine={false} dataKey="date" tick={{ fill: 'var(--admin-text-muted)', fontSize: 11 }} tickFormatter={shortDate} tickLine={false} />
          <YAxis axisLine={false} tick={{ fill: 'var(--admin-text-muted)', fontSize: 11 }} tickFormatter={(value) => Number(value).toLocaleString(undefined, { notation: 'compact' })} tickLine={false} width={44} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [valueFormatter(Number(value)), String(name)]} />
          <Legend iconSize={8} wrapperStyle={{ fontSize: '0.7rem' }} />
          <Area dataKey="primary" fill="var(--admin-accent-soft)" fillOpacity={0.65} isAnimationActive={!reduceMotion} name={primaryLabel} stroke="var(--admin-accent)" strokeWidth={2.3} type="monotone" />
          <Area dataKey="secondary" fill="#10b981" fillOpacity={0.08} isAnimationActive={!reduceMotion} name={secondaryLabel} stroke="#10b981" strokeWidth={2} type="monotone" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export type DonutDatum = {
  name: string;
  value: number;
  color: string;
};

export function DistributionDonutChart({ data }: { data: DonutDatum[] }): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const visibleData = data.filter((entry) => entry.value > 0);
  if (visibleData.length === 0) {
    return <EmptyChart message="No distribution data for the selected scope." />;
  }

  return (
    <div aria-label="Distribution donut chart" className="h-64 w-full" role="img">
      <ResponsiveContainer height="100%" width="100%">
        <PieChart accessibilityLayer>
          <Pie
            data={visibleData}
            dataKey="value"
            innerRadius="52%"
            isAnimationActive={!reduceMotion}
            nameKey="name"
            outerRadius="78%"
            paddingAngle={3}
            stroke="var(--admin-surface)"
            strokeWidth={3}
          >
            {visibleData.map((entry) => <Cell fill={entry.color} key={entry.name} />)}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [Number(value).toLocaleString(), String(name)]} />
          <Legend iconSize={8} wrapperStyle={{ fontSize: '0.7rem' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
