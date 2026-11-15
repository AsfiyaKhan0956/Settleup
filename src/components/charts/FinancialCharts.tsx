import React, { useState } from 'react';
import { motion } from 'motion/react';
import { formatINR } from '../../utils/currency.ts';

export interface MonthlyPoint {
  month: string;
  group_total_paise: number;
  my_share_paise: number;
  expense_count: number;
}

export interface CategoryPoint {
  category: string;
  total_paise: number;
  my_share_paise: number;
  count: number;
}

const CHART_PALETTE = ['#065F46', '#D97706', '#0D9488', '#4F46E5', '#E11D48', '#0F172A', '#059669', '#64748B'];

export const MonthlyTrendChart: React.FC<{ data: MonthlyPoint[] }> = ({ data }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
        No monthly expense data yet for this period.
      </div>
    );
  }

  const width = 560;
  const height = 220;
  const padX = 48;
  const padY = 24;
  const maxVal = Math.max(100, ...data.map((d) => d.group_total_paise));

  const points = data.map((d, i) => {
    const x =
      data.length === 1
        ? width / 2
        : padX + (i / (data.length - 1)) * (width - padX * 2);
    const yGroup = height - padY - (d.group_total_paise / maxVal) * (height - padY * 2);
    const yMine = height - padY - (d.my_share_paise / maxVal) * (height - padY * 2);
    return { x, yGroup, yMine, ...d };
  });

  const groupPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yGroup}`).join(' ');
  const myPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yMine}`).join(' ');
  const areaPath =
    points.length > 1
      ? `${groupPath} L ${points[points.length - 1].x} ${height - padY} L ${points[0].x} ${height - padY} Z`
      : '';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#065F46] inline-block" /> Group Total
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#D97706] inline-block border-b border-dashed" /> My Share
          </span>
        </div>
        {hoveredIdx !== null && points[hoveredIdx] && (
          <span className="font-mono-num text-slate-900 font-semibold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
            {points[hoveredIdx].month}: Group {formatINR(points[hoveredIdx].group_total_paise)} · Mine{' '}
            {formatINR(points[hoveredIdx].my_share_paise)}
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-52 overflow-visible" role="img" aria-label="Monthly expenditure trend">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = height - padY - ratio * (height - padY * 2);
          return (
            <g key={ratio}>
              <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="#E2E8F0" strokeDasharray="3 3" />
              <text x={padX - 8} y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-mono-num">
                ₹{Math.round((maxVal * ratio) / 100)}
              </text>
            </g>
          );
        })}

        {areaPath && <path d={areaPath} fill="#065F46" fillOpacity="0.1" />}
        {points.length > 1 && <path d={groupPath} fill="none" stroke="#065F46" strokeWidth="2.75" strokeLinecap="round" />}
        {points.length > 1 && (
          <path d={myPath} fill="none" stroke="#D97706" strokeWidth="2.25" strokeDasharray="5 4" strokeLinecap="round" />
        )}

        {points.map((p, i) => (
          <g
            key={p.month}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            className="cursor-pointer"
          >
            <circle cx={p.x} cy={p.yGroup} r={hoveredIdx === i ? 6.5 : 4.2} fill="#065F46" stroke="#FFFFFF" strokeWidth="2" />
            <circle cx={p.x} cy={p.yMine} r={hoveredIdx === i ? 5.5 : 3.8} fill="#D97706" stroke="#FFFFFF" strokeWidth="1.5" />
            <text x={p.x} y={height - 4} textAnchor="middle" className="fill-slate-500 text-[11px] font-mono-num">
              {p.month}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

export const CategoryDonutChart: React.FC<{ data: CategoryPoint[] }> = ({ data }) => {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const total = data.reduce((acc, d) => acc + d.total_paise, 0);

  if (total === 0 || data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
        Log expenses to see category distribution.
      </div>
    );
  }

  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  const activeItem = activeIdx !== null ? data[activeIdx] : null;
  const activePct = activeItem ? Math.round((activeItem.total_paise / total) * 100) : 100;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-center">
      <div className="sm:col-span-5 flex flex-col items-center relative">
        <div className="relative">
          <svg width="176" height="176" viewBox="0 0 176 176" role="img" aria-label="Category spending distribution">
            <g transform="translate(88,88) rotate(-90)">
              {data.map((d, i) => {
                const frac = d.total_paise / total;
                const dash = frac * circumference;
                const offset = -accumulated * circumference;
                accumulated += frac;
                return (
                  <circle
                    key={d.category}
                    r={radius}
                    cx="0"
                    cy="0"
                    fill="transparent"
                    stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
                    strokeWidth={activeIdx === i ? 25 : 20}
                    strokeDasharray={`${Math.max(0, dash - 2)} ${circumference}`}
                    strokeDashoffset={offset}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseLeave={() => setActiveIdx(null)}
                    className="transition-all duration-300 cursor-pointer"
                  />
                );
              })}
            </g>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-4">
            <span className="text-[11px] font-medium text-slate-500">
              {activeItem ? `${activeItem.category} (${activePct}%)` : 'Total Spend'}
            </span>
            <span className="font-mono-num text-sm font-bold text-slate-900">
              {formatINR(activeItem ? activeItem.total_paise : total)}
            </span>
          </div>
        </div>
      </div>

      <div className="sm:col-span-7 space-y-2.5 max-h-56 overflow-y-auto pr-1">
        {data.map((d, i) => {
          const pct = Math.round((d.total_paise / total) * 100);
          const color = CHART_PALETTE[i % CHART_PALETTE.length];
          return (
            <div
              key={d.category}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx(null)}
              className={`p-2 rounded-lg transition-colors cursor-default ${
                activeIdx === i ? 'bg-slate-100' : 'bg-slate-50/70'
              }`}
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                  <span className="font-semibold text-slate-800 truncate">{d.category}</span>
                  <span className="text-[11px] text-slate-500">({d.count})</span>
                </div>
                <div className="flex items-center gap-2.5 shrink-0 font-mono-num">
                  <span className="text-slate-500">{pct}%</span>
                  <span className="font-bold text-slate-900">{formatINR(d.total_paise)}</span>
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(3, pct)}%` }}
                  transition={{ duration: 0.55, delay: i * 0.05, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const HorizontalBarChart: React.FC<{
  items: Array<{ label: string; valuePaise: number; color?: string }>;
  emptyText?: string;
}> = ({ items, emptyText = 'No data recorded yet.' }) => {
  const maxVal = Math.max(1, ...items.map((i) => i.valuePaise));

  if (items.length === 0 || items.every((i) => i.valuePaise === 0)) {
    return (
      <div className="h-44 flex items-center justify-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, idx) => {
        const widthPct = Math.max(3, Math.round((item.valuePaise / maxVal) * 100));
        return (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-800 truncate">{item.label}</span>
              <span className="font-mono-num font-semibold text-slate-900">{formatINR(item.valuePaise)}</span>
            </div>
            <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${widthPct}%` }}
                transition={{ duration: 0.55, delay: idx * 0.04, ease: 'easeOut' }}
                className="h-full rounded-full"
                style={{
                  backgroundColor: item.color || CHART_PALETTE[idx % CHART_PALETTE.length],
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
