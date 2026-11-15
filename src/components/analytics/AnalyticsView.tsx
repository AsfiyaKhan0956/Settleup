import React, { useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { apiRequest, downloadAuthenticatedCsv } from '../../services/api.ts';
import { formatINR } from '../../utils/currency.ts';
import {
  CategoryDonutChart,
  HorizontalBarChart,
  MonthlyTrendChart,
  type CategoryPoint,
  type MonthlyPoint,
} from '../charts/FinancialCharts.tsx';
import type { GroupSummary } from '../../types/index.ts';

interface AnalyticsResponse {
  monthlyTrend: MonthlyPoint[];
  weeklyTrend: Array<{ week: string; total_paise: number; my_share_paise: number }>;
  byCategory: CategoryPoint[];
  byGroup: Array<{ group_id: number; group_name: string; cover_color: string; total_paise: number; expense_count: number }>;
  memberContributions: Array<{ user_id: number; full_name: string; paid_paise: number }>;
  settlementStats: { settled_paise: number; pending_paise: number };
}

export const AnalyticsView: React.FC = () => {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [days, setDays] = useState('180');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    apiRequest<{ groups: GroupSummary[] }>('/api/groups').then((res) => setGroups(res.groups)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ days });
    if (selectedGroupId) params.set('groupId', selectedGroupId);
    apiRequest<AnalyticsResponse>(`/api/analytics/summary?${params.toString()}`)
      .then((res) => setData(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedGroupId, days]);

  const exportCsvUrl = `/api/analytics/export.csv${selectedGroupId ? `?groupId=${selectedGroupId}` : ''}`;

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      await downloadAuthenticatedCsv(exportCsvUrl, 'settleup-expenses-report.csv');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Analytics &amp; Reports</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Real-time SQL spending insights, category breakdowns, and exportable statements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer disabled:opacity-60"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print / PDF Summary</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-4 no-print">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Group Scope</label>
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
          >
            <option value="">All My Groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Time Window</label>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { val: '30', label: '30 Days' },
              { val: '90', label: '90 Days' },
              { val: '180', label: '6 Months' },
              { val: '365', label: '1 Year' },
            ].map((opt) => (
              <button
                key={opt.val}
                type="button"
                onClick={() => setDays(opt.val)}
                className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer ${
                  days === opt.val ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading || !data ? (
        <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="font-display text-base font-bold text-slate-900 mb-4">Monthly Expenditure Trend</h2>
              <MonthlyTrendChart data={data.monthlyTrend} />
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="font-display text-base font-bold text-slate-900 mb-4">Category Spending</h2>
              <CategoryDonutChart data={data.byCategory} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h2 className="font-display text-base font-bold text-slate-900">Group-Wise Expenditure</h2>
              <HorizontalBarChart
                items={data.byGroup.map((g) => ({
                  label: `${g.group_name} (${g.expense_count})`,
                  valuePaise: g.total_paise,
                  color: g.cover_color,
                }))}
              />
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h2 className="font-display text-base font-bold text-slate-900">Member Contributions (Paid)</h2>
              <HorizontalBarChart
                items={data.memberContributions.map((m) => ({
                  label: m.full_name,
                  valuePaise: m.paid_paise,
                }))}
              />
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h2 className="font-display text-base font-bold text-slate-900">Settled vs Pending Volume</h2>
              <HorizontalBarChart
                items={[
                  { label: 'Confirmed Settled', valuePaise: data.settlementStats.settled_paise, color: '#065F46' },
                  { label: 'Awaiting Confirmation', valuePaise: data.settlementStats.pending_paise, color: '#D97706' },
                ]}
              />
              <div className="pt-3 border-t border-slate-100 text-xs text-slate-600 flex justify-between">
                <span>Weekly records active</span>
                <span className="font-mono-num font-semibold">{data.weeklyTrend.length} weeks</span>
              </div>
            </div>
          </div>

          {/* Printable Breakdown Table */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="font-display text-base font-bold text-slate-900 mb-4">Category Financial Summary</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="pb-2">Category</th>
                  <th className="pb-2 text-right">Transactions</th>
                  <th className="pb-2 text-right">Group Total</th>
                  <th className="pb-2 text-right">My Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.byCategory.map((c) => (
                  <tr key={c.category} className="h-10">
                    <td className="font-medium text-slate-900">{c.category}</td>
                    <td className="text-right font-mono-num text-slate-600">{c.count}</td>
                    <td className="text-right font-mono-num font-semibold text-slate-900">
                      {formatINR(c.total_paise)}
                    </td>
                    <td className="text-right font-mono-num text-slate-700">{formatINR(c.my_share_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
