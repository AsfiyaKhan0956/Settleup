import type { SplitMethod } from '../types/index.ts';

export function rupeesToPaise(val: number | string): number {
  const num = typeof val === 'string' ? Number(val.trim()) : val;
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100);
}

export function formatINR(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise) / 100;
  return (
    sign +
    '₹' +
    abs.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatINRCompact(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise) / 100;
  if (abs >= 100000) {
    return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  }
  return (
    sign +
    '₹' +
    abs.toLocaleString('en-IN', {
      minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

export function allocateWeightsPreview(
  targetTotal: number,
  entries: Array<{ userId: number; weight: number }>
): Map<number, number> {
  const result = new Map<number, number>();
  if (entries.length === 0) return result;
  const totalWeight = entries.reduce((acc, e) => acc + e.weight, 0);
  if (totalWeight <= 0) return result;

  const sign = targetTotal < 0 ? -1 : 1;
  const absTotal = Math.abs(Math.round(targetTotal));

  const rows = entries.map((entry, idx) => {
    const exact = (absTotal * entry.weight) / totalWeight;
    const floored = Math.floor(exact);
    return { userId: entry.userId, idx, floored, rem: exact - floored };
  });

  const sum = rows.reduce((a, b) => a + b.floored, 0);
  let leftover = absTotal - sum;

  const sorted = [...rows].sort((a, b) => {
    if (Math.abs(b.rem - a.rem) > 1e-9) return b.rem - a.rem;
    return a.idx - b.idx;
  });

  for (let i = 0; i < sorted.length && leftover > 0; i++) {
    sorted[i].floored += 1;
    leftover -= 1;
  }

  for (const r of rows) {
    result.set(r.userId, (result.get(r.userId) ?? 0) + sign * r.floored);
  }
  return result;
}

export interface ClientSplitPreviewInput {
  splitMethod: SplitMethod;
  totalPaise: number;
  participants: Array<{
    userId: number;
    exactPaise: number;
    percentage: number;
    shares: number;
  }>;
  items: Array<{
    name: string;
    unitPricePaise: number;
    quantity: number;
    consumerUserIds: number[];
  }>;
  taxPaise: number;
  tipPaise: number;
  discountPaise: number;
}

export interface ClientSplitPreviewResult {
  valid: boolean;
  error?: string;
  subtotalPaise: number;
  totalPaise: number;
  perUserPaise: Map<number, number>;
}

export function previewSplitCalculation(input: ClientSplitPreviewInput): ClientSplitPreviewResult {
  const perUserPaise = new Map<number, number>();
  if (input.participants.length === 0) {
    return {
      valid: false,
      error: 'Select at least one participant.',
      subtotalPaise: 0,
      totalPaise: 0,
      perUserPaise,
    };
  }

  if (input.splitMethod === 'itemized') {
    if (input.items.length === 0) {
      return {
        valid: false,
        error: 'Add at least one bill item.',
        subtotalPaise: 0,
        totalPaise: 0,
        perUserPaise,
      };
    }

    let subtotal = 0;
    for (const item of input.items) {
      if (!item.name.trim()) {
        return { valid: false, error: 'Every item needs a name.', subtotalPaise: 0, totalPaise: 0, perUserPaise };
      }
      if (item.unitPricePaise <= 0 || item.quantity < 1) {
        return {
          valid: false,
          error: `Check price and quantity for "${item.name}".`,
          subtotalPaise: 0,
          totalPaise: 0,
          perUserPaise,
        };
      }
      if (item.consumerUserIds.length === 0) {
        return {
          valid: false,
          error: `Select consumers for "${item.name}".`,
          subtotalPaise: 0,
          totalPaise: 0,
          perUserPaise,
        };
      }
      const lineTotal = item.unitPricePaise * item.quantity;
      subtotal += lineTotal;
      const itemAlloc = allocateWeightsPreview(
        lineTotal,
        item.consumerUserIds.map((uid) => ({ userId: uid, weight: 1 }))
      );
      for (const [uid, share] of itemAlloc.entries()) {
        perUserPaise.set(uid, (perUserPaise.get(uid) ?? 0) + share);
      }
    }

    const total = subtotal + input.taxPaise + input.tipPaise - input.discountPaise;
    if (total <= 0) {
      return {
        valid: false,
        error: 'Net total after discount must exceed ₹0.',
        subtotalPaise: subtotal,
        totalPaise: total,
        perUserPaise,
      };
    }

    const netAdj = input.taxPaise + input.tipPaise - input.discountPaise;
    if (netAdj !== 0) {
      const entries = Array.from(perUserPaise.entries())
        .filter(([, v]) => v > 0)
        .map(([userId, v]) => ({ userId, weight: v }));
      const adjAlloc = allocateWeightsPreview(netAdj, entries);
      for (const [uid, adj] of adjAlloc.entries()) {
        perUserPaise.set(uid, (perUserPaise.get(uid) ?? 0) + adj);
      }
    }

    return { valid: true, subtotalPaise: subtotal, totalPaise: total, perUserPaise };
  }

  if (input.totalPaise <= 0) {
    return {
      valid: false,
      error: 'Enter an expense amount greater than ₹0.',
      subtotalPaise: 0,
      totalPaise: 0,
      perUserPaise,
    };
  }

  if (input.splitMethod === 'equal') {
    const alloc = allocateWeightsPreview(
      input.totalPaise,
      input.participants.map((p) => ({ userId: p.userId, weight: 1 }))
    );
    return { valid: true, subtotalPaise: input.totalPaise, totalPaise: input.totalPaise, perUserPaise: alloc };
  }

  if (input.splitMethod === 'exact') {
    const sum = input.participants.reduce((a, p) => a + p.exactPaise, 0);
    input.participants.forEach((p) => perUserPaise.set(p.userId, p.exactPaise));
    if (sum !== input.totalPaise) {
      const diff = input.totalPaise - sum;
      return {
        valid: false,
        error: `Remaining to allocate: ${formatINR(diff)}`,
        subtotalPaise: input.totalPaise,
        totalPaise: input.totalPaise,
        perUserPaise,
      };
    }
    return { valid: true, subtotalPaise: input.totalPaise, totalPaise: input.totalPaise, perUserPaise };
  }

  if (input.splitMethod === 'percentage') {
    const pctSum = input.participants.reduce((a, p) => a + p.percentage, 0);
    if (Math.abs(pctSum - 100) > 0.05) {
      return {
        valid: false,
        error: `Percentages sum to ${pctSum.toFixed(1)}% (must equal 100%).`,
        subtotalPaise: input.totalPaise,
        totalPaise: input.totalPaise,
        perUserPaise,
      };
    }
    const alloc = allocateWeightsPreview(
      input.totalPaise,
      input.participants.map((p) => ({ userId: p.userId, weight: Math.max(0, p.percentage) }))
    );
    return { valid: true, subtotalPaise: input.totalPaise, totalPaise: input.totalPaise, perUserPaise: alloc };
  }

  // shares
  const shareSum = input.participants.reduce((a, p) => a + p.shares, 0);
  if (shareSum <= 0) {
    return {
      valid: false,
      error: 'Total shares must be greater than 0.',
      subtotalPaise: input.totalPaise,
      totalPaise: input.totalPaise,
      perUserPaise,
    };
  }
  const alloc = allocateWeightsPreview(
    input.totalPaise,
    input.participants.map((p) => ({ userId: p.userId, weight: Math.max(0, p.shares) }))
  );
  return { valid: true, subtotalPaise: input.totalPaise, totalPaise: input.totalPaise, perUserPaise: alloc };
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function evaluatePasswordStrength(password: string): {
  score: number;
  label: string;
  checks: { length: boolean; upper: boolean; lower: boolean; number: boolean; symbol: boolean };
} {
  const checks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const label = score <= 2 ? 'Weak' : score === 3 ? 'Fair' : score === 4 ? 'Strong' : 'Very strong';
  return { score, label, checks };
}
