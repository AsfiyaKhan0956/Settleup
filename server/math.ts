/**
 * SettleUp Financial & Graph Calculation Engine
 * ---------------------------------------------
 * All monetary amounts are represented strictly in integer PAISE (100 paise = ₹1).
 * This avoids IEEE-754 floating-point precision drift across splits, taxes, and balances.
 */

export type SplitMethod = 'equal' | 'exact' | 'percentage' | 'shares' | 'itemized';

export interface SplitParticipantInput {
  userId: number;
  exactPaise?: number;
  percentage?: number; // e.g., 25.5 means 25.5%
  shares?: number;     // e.g., 2 means 2 shares
}

export interface ExpenseItemInput {
  name: string;
  unitPricePaise: number;
  quantity: number;
  consumerUserIds: number[];
}

export interface SplitCalculationInput {
  splitMethod: SplitMethod;
  totalPaise?: number;
  participants: SplitParticipantInput[];
  items?: ExpenseItemInput[];
  taxPaise?: number;
  tipPaise?: number;
  discountPaise?: number;
}

export interface CalculatedUserSplit {
  userId: number;
  owedPaise: number;
  itemSubtotalPaise: number;
  sharedChargesPaise: number;
  shareMeta: string;
}

export interface SplitCalculationResult {
  subtotalPaise: number;
  taxPaise: number;
  tipPaise: number;
  discountPaise: number;
  totalPaise: number;
  remainderPaise: number;
  splits: CalculatedUserSplit[];
}

/**
 * Safely converts a rupee number or numeric string into integer paise.
 */
export function rupeesToPaise(rupees: number | string): number {
  const num = typeof rupees === 'string' ? Number(rupees.trim()) : rupees;
  if (!Number.isFinite(num) || num < 0) {
    throw new Error('Monetary amount must be a valid non-negative number.');
  }
  return Math.round(num * 100);
}

/**
 * Formats integer paise into Indian Rupee (₹) string.
 */
export function formatINR(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const absRupees = Math.abs(paise) / 100;
  return (
    sign +
    '₹' +
    absRupees.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/**
 * Allocates an integer total across weighted shares using the Largest-Remainder (Hamilton)
 * method so that the sum of allocated integer parts ALWAYS equals targetTotal exactly.
 */
export function allocateByWeights(
  targetTotal: number,
  entries: Array<{ userId: number; weight: number }>
): Map<number, number> {
  const result = new Map<number, number>();
  if (entries.length === 0) {
    return result;
  }

  const totalWeight = entries.reduce((acc, e) => acc + e.weight, 0);
  if (totalWeight <= 0) {
    throw new Error('Total weight for allocation must be greater than zero.');
  }

  const sign = targetTotal < 0 ? -1 : 1;
  const absTotal = Math.abs(Math.round(targetTotal));

  const computed = entries.map((entry, index) => {
    const exact = (absTotal * entry.weight) / totalWeight;
    const floored = Math.floor(exact);
    const remainder = exact - floored;
    return {
      userId: entry.userId,
      index,
      floored,
      remainder,
    };
  });

  const allocatedSum = computed.reduce((acc, c) => acc + c.floored, 0);
  let leftover = absTotal - allocatedSum;

  // Deterministic tie-breaking: largest fractional remainder first, then original order
  const sortedForRemainder = [...computed].sort((a, b) => {
    if (Math.abs(b.remainder - a.remainder) > 1e-9) {
      return b.remainder - a.remainder;
    }
    return a.index - b.index;
  });

  for (let i = 0; i < sortedForRemainder.length && leftover > 0; i++) {
    sortedForRemainder[i].floored += 1;
    leftover -= 1;
  }

  for (const item of computed) {
    const prev = result.get(item.userId) ?? 0;
    result.set(item.userId, prev + sign * item.floored);
  }

  return result;
}

/**
 * Core multi-method expense split calculation engine.
 * Enforces strict invariants so sum(splits.owedPaise) === totalPaise.
 */
export function calculateSplits(input: SplitCalculationInput): SplitCalculationResult {
  const taxPaise = Math.max(0, Math.round(input.taxPaise ?? 0));
  const tipPaise = Math.max(0, Math.round(input.tipPaise ?? 0));
  const discountPaise = Math.max(0, Math.round(input.discountPaise ?? 0));

  if (!input.participants || input.participants.length === 0) {
    throw new Error('At least one participant is required to split an expense.');
  }

  // Deduplicate participants by userId
  const uniqueMap = new Map<number, SplitParticipantInput>();
  for (const p of input.participants) {
    uniqueMap.set(p.userId, p);
  }
  const participants = Array.from(uniqueMap.values());

  if (input.splitMethod === 'itemized') {
    const items = input.items ?? [];
    if (items.length === 0) {
      throw new Error('Itemized split requires at least one bill item.');
    }

    const userItemSubtotals = new Map<number, number>();
    for (const p of participants) {
      userItemSubtotals.set(p.userId, 0);
    }

    let subtotalPaise = 0;

    for (const item of items) {
      const name = item.name.trim();
      if (!name) {
        throw new Error('Every bill item must have a name.');
      }
      const qty = Math.round(item.quantity);
      const unitPrice = Math.round(item.unitPricePaise);
      if (qty < 1 || unitPrice <= 0) {
        throw new Error(`Item "${name}" must have quantity >= 1 and price > ₹0.`);
      }
      const uniqueConsumers = Array.from(new Set(item.consumerUserIds));
      if (uniqueConsumers.length === 0) {
        throw new Error(`Select at least one consumer for item "${name}".`);
      }

      const itemTotal = unitPrice * qty;
      subtotalPaise += itemTotal;

      // Ensure every consumer is included in map
      for (const uid of uniqueConsumers) {
        if (!userItemSubtotals.has(uid)) {
          userItemSubtotals.set(uid, 0);
        }
      }

      const itemAllocation = allocateByWeights(
        itemTotal,
        uniqueConsumers.map((uid) => ({ userId: uid, weight: 1 }))
      );

      for (const [uid, share] of itemAllocation.entries()) {
        userItemSubtotals.set(uid, (userItemSubtotals.get(uid) ?? 0) + share);
      }
    }

    const totalPaise = subtotalPaise + taxPaise + tipPaise - discountPaise;
    if (totalPaise <= 0) {
      throw new Error('Final bill total after discount must be greater than ₹0.');
    }

    const netAdjustment = taxPaise + tipPaise - discountPaise;
    const activeEntries = Array.from(userItemSubtotals.entries())
      .filter(([, sub]) => sub > 0)
      .map(([userId, sub]) => ({ userId, weight: sub }));

    const adjustmentMap =
      netAdjustment !== 0 && activeEntries.length > 0
        ? allocateByWeights(netAdjustment, activeEntries)
        : new Map<number, number>();

    const splits: CalculatedUserSplit[] = [];
    for (const [userId, itemSub] of userItemSubtotals.entries()) {
      const adj = adjustmentMap.get(userId) ?? 0;
      const owed = itemSub + adj;
      if (owed < 0) {
        throw new Error('Discount exceeds a participant item subtotal.');
      }
      if (owed > 0 || participants.some((p) => p.userId === userId)) {
        splits.push({
          userId,
          owedPaise: owed,
          itemSubtotalPaise: itemSub,
          sharedChargesPaise: adj,
          shareMeta: `items:${itemSub},adj:${adj}`,
        });
      }
    }

    const sumSplits = splits.reduce((acc, s) => acc + s.owedPaise, 0);
    if (sumSplits !== totalPaise) {
      throw new Error(`Split checksum mismatch: ${sumSplits} vs ${totalPaise}`);
    }

    return {
      subtotalPaise,
      taxPaise,
      tipPaise,
      discountPaise,
      totalPaise,
      remainderPaise: totalPaise % Math.max(1, splits.length),
      splits,
    };
  }

  // Non-itemized modes require positive totalPaise
  const totalPaise = Math.round(input.totalPaise ?? 0);
  if (totalPaise <= 0) {
    throw new Error('Expense total amount must be greater than ₹0.');
  }

  if (input.splitMethod === 'equal') {
    const alloc = allocateByWeights(
      totalPaise,
      participants.map((p) => ({ userId: p.userId, weight: 1 }))
    );
    const splits = participants.map((p) => {
      const owedPaise = alloc.get(p.userId) ?? 0;
      return {
        userId: p.userId,
        owedPaise,
        itemSubtotalPaise: owedPaise,
        sharedChargesPaise: 0,
        shareMeta: `equal:1/${participants.length}`,
      };
    });
    return {
      subtotalPaise: totalPaise,
      taxPaise: 0,
      tipPaise: 0,
      discountPaise: 0,
      totalPaise,
      remainderPaise: totalPaise % participants.length,
      splits,
    };
  }

  if (input.splitMethod === 'exact') {
    let sumExact = 0;
    const splits = participants.map((p) => {
      const exact = Math.round(p.exactPaise ?? 0);
      if (exact < 0) {
        throw new Error('Exact split amounts cannot be negative.');
      }
      sumExact += exact;
      return {
        userId: p.userId,
        owedPaise: exact,
        itemSubtotalPaise: exact,
        sharedChargesPaise: 0,
        shareMeta: `exact:${exact}`,
      };
    });
    if (sumExact !== totalPaise) {
      throw new Error(
        `Exact split sum (${formatINR(sumExact)}) does not match expense total (${formatINR(totalPaise)}).`
      );
    }
    return {
      subtotalPaise: totalPaise,
      taxPaise: 0,
      tipPaise: 0,
      discountPaise: 0,
      totalPaise,
      remainderPaise: 0,
      splits,
    };
  }

  if (input.splitMethod === 'percentage') {
    const pctSum = participants.reduce((acc, p) => acc + (p.percentage ?? 0), 0);
    if (Math.abs(pctSum - 100) > 0.05) {
      throw new Error(`Percentages must total 100% (currently ${pctSum.toFixed(2)}%).`);
    }
    const alloc = allocateByWeights(
      totalPaise,
      participants.map((p) => ({ userId: p.userId, weight: Math.max(0, p.percentage ?? 0) }))
    );
    const splits = participants.map((p) => {
      const owedPaise = alloc.get(p.userId) ?? 0;
      return {
        userId: p.userId,
        owedPaise,
        itemSubtotalPaise: owedPaise,
        sharedChargesPaise: 0,
        shareMeta: `pct:${(p.percentage ?? 0).toFixed(2)}%`,
      };
    });
    return {
      subtotalPaise: totalPaise,
      taxPaise: 0,
      tipPaise: 0,
      discountPaise: 0,
      totalPaise,
      remainderPaise: 0,
      splits,
    };
  }

  if (input.splitMethod === 'shares') {
    const totalShares = participants.reduce((acc, p) => acc + (p.shares ?? 0), 0);
    if (totalShares <= 0) {
      throw new Error('Total participant shares must be greater than zero.');
    }
    const alloc = allocateByWeights(
      totalPaise,
      participants.map((p) => ({ userId: p.userId, weight: Math.max(0, p.shares ?? 0) }))
    );
    const splits = participants.map((p) => {
      const owedPaise = alloc.get(p.userId) ?? 0;
      return {
        userId: p.userId,
        owedPaise,
        itemSubtotalPaise: owedPaise,
        sharedChargesPaise: 0,
        shareMeta: `shares:${p.shares ?? 0}/${totalShares}`,
      };
    });
    return {
      subtotalPaise: totalPaise,
      taxPaise: 0,
      tipPaise: 0,
      discountPaise: 0,
      totalPaise,
      remainderPaise: 0,
      splits,
    };
  }

  throw new Error(`Unsupported split method: ${String(input.splitMethod)}`);
}

export interface MemberNetBalance {
  userId: number;
  fullName: string;
  email: string;
  upiId: string | null;
  avatarUrl: string | null;
  paidPaise: number;
  owedPaise: number;
  settlementsPaidPaise: number;
  settlementsReceivedPaise: number;
  pendingIncomingPaise: number;
  pendingOutgoingPaise: number;
  netPaise: number; // Positive = others owe this user; Negative = this user owes others
}

export interface SimplifiedTransfer {
  fromUserId: number;
  fromName: string;
  toUserId: number;
  toName: string;
  toUpiId: string | null;
  amountPaise: number;
}

/**
 * Greedy Minimum-Cash-Flow Debt Simplification Algorithm.
 * Matches the largest net creditor with the largest net debtor iteratively
 * to produce at most (N - 1) settlement transfers that zero out all group balances.
 */
export function simplifyDebts(balances: MemberNetBalance[]): SimplifiedTransfer[] {
  const creditors = balances
    .filter((b) => b.netPaise > 0)
    .map((b) => ({ ...b, remaining: b.netPaise }))
    .sort((a, b) => b.remaining - a.remaining);

  const debtors = balances
    .filter((b) => b.netPaise < 0)
    .map((b) => ({ ...b, remaining: Math.abs(b.netPaise) }))
    .sort((a, b) => b.remaining - a.remaining);

  const transfers: SimplifiedTransfer[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const settleAmount = Math.min(debtor.remaining, creditor.remaining);

    if (settleAmount > 0) {
      transfers.push({
        fromUserId: debtor.userId,
        fromName: debtor.fullName,
        toUserId: creditor.userId,
        toName: creditor.fullName,
        toUpiId: creditor.upiId,
        amountPaise: settleAmount,
      });
    }

    debtor.remaining -= settleAmount;
    creditor.remaining -= settleAmount;

    if (debtor.remaining === 0) i++;
    if (creditor.remaining === 0) j++;
  }

  return transfers;
}
