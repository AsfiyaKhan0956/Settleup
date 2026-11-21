import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateItemCost, calculateParticipantNetBalance, simplifyLedgerBalances } from '../server/tripLedgerMath.ts';

test('item cost allocation preserves every paise and distributes remainder deterministically', () => {
  const allocation = allocateItemCost(10001, [3, 1, 2]);
  assert.deepEqual(allocation, [
    { participantId: 1, sharePaise: 3334 },
    { participantId: 2, sharePaise: 3334 },
    { participantId: 3, sharePaise: 3333 },
  ]);
  assert.equal(allocation.reduce((sum, item) => sum + item.sharePaise, 0), 10001);
});

test('item allocation rejects an empty consumer list', () => {
  assert.throws(() => allocateItemCost(100, []), /At least one valid participant/);
});

test('ledger balances produce correct simplified transfers', () => {
  const transfers = simplifyLedgerBalances([
    { id: 1, name: 'A', netPaise: 14000 },
    { id: 2, name: 'B', netPaise: -2000 },
    { id: 3, name: 'C', netPaise: -6000 },
    { id: 4, name: 'D', netPaise: -6000 },
  ]);
  assert.deepEqual(transfers, [
    { fromParticipantId: 2, fromName: 'B', toParticipantId: 1, toName: 'A', amountPaise: 2000 },
    { fromParticipantId: 3, fromName: 'C', toParticipantId: 1, toName: 'A', amountPaise: 6000 },
    { fromParticipantId: 4, fromName: 'D', toParticipantId: 1, toName: 'A', amountPaise: 6000 },
  ]);
});


test('participant net balance reflects spending and recorded settlements', () => {
  assert.equal(calculateParticipantNetBalance({ paidPaise: 16000, consumedPaise: 2000, settlementPaidPaise: 0, settlementReceivedPaise: 0 }), 14000);
  assert.equal(calculateParticipantNetBalance({ paidPaise: 0, consumedPaise: 2000, settlementPaidPaise: 2000, settlementReceivedPaise: 0 }), 0);
});

test('ledger debt simplification rejects balances that do not reconcile to zero', () => {
  assert.throws(() => simplifyLedgerBalances([{ id: 1, name: 'A', netPaise: 100 }, { id: 2, name: 'B', netPaise: -90 }]), /do not reconcile to zero/);
});
