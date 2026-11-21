/** Integer-paise allocation for item-wise Trip Ledger costs. */
export function allocateItemCost(totalPaise: number, participantIds: number[]): Array<{ participantId: number; sharePaise: number }> {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) throw new Error('Item total must be a non-negative integer number of paise.');
  const ids = [...new Set(participantIds)].sort((a, b) => a - b);
  if (ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error('At least one valid participant is required.');
  const base = Math.floor(totalPaise / ids.length);
  let remainder = totalPaise - base * ids.length;
  return ids.map((participantId) => ({ participantId, sharePaise: base + (remainder-- > 0 ? 1 : 0) }));
}

export function calculateParticipantNetBalance(input: {
  paidPaise: number;
  consumedPaise: number;
  settlementPaidPaise: number;
  settlementReceivedPaise: number;
}): number {
  return input.paidPaise - input.consumedPaise + input.settlementPaidPaise - input.settlementReceivedPaise;
}

export interface NetParticipant { id: number; name: string; netPaise: number }
export interface LedgerTransfer { fromParticipantId: number; fromName: string; toParticipantId: number; toName: string; amountPaise: number }

/** Creates a deterministic, minimal set of transfers from net balances. */
export function simplifyLedgerBalances(participants: NetParticipant[]): LedgerTransfer[] {
  const netTotal = participants.reduce((sum, participant) => sum + participant.netPaise, 0);
  if (netTotal !== 0) throw new Error('Trip Ledger participant balances do not reconcile to zero.');
  const debtors = participants.filter((p) => p.netPaise < 0).map((p) => ({ ...p, remaining: -p.netPaise })).sort((a, b) => a.id - b.id);
  const creditors = participants.filter((p) => p.netPaise > 0).map((p) => ({ ...p, remaining: p.netPaise })).sort((a, b) => a.id - b.id);
  const transfers: LedgerTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountPaise = Math.min(debtor.remaining, creditor.remaining);
    if (amountPaise > 0) transfers.push({ fromParticipantId: debtor.id, fromName: debtor.name, toParticipantId: creditor.id, toName: creditor.name, amountPaise });
    debtor.remaining -= amountPaise;
    creditor.remaining -= amountPaise;
    if (debtor.remaining === 0) debtorIndex++;
    if (creditor.remaining === 0) creditorIndex++;
  }
  return transfers;
}
