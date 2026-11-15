import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSplits,
  rupeesToPaise,
  simplifyDebts,
  type MemberNetBalance,
} from '../server/math.ts';
import { hashPassword, verifyPassword } from '../server/security.ts';

test('Five-person Tea, Coffee & Samosas item-wise split matches exact INR paise expectations', () => {
  // Tea: ₹100 / 4 consumers = ₹25 (2500 paise) each
  // Coffee: ₹120 / 1 consumer = ₹120 (12000 paise)
  // Samosas: ₹150 / 5 consumers = ₹30 (3000 paise) each
  // Expected: 4 tea drinkers pay ₹55 (5500 paise) each; 1 coffee drinker pays ₹150 (15000 paise)
  const result = calculateSplits({
    splitMethod: 'itemized',
    participants: [
      { userId: 1 },
      { userId: 2 },
      { userId: 3 },
      { userId: 4 },
      { userId: 5 },
    ],
    items: [
      { name: 'Tea', unitPricePaise: 2500, quantity: 4, consumerUserIds: [1, 2, 3, 4] },
      { name: 'Coffee', unitPricePaise: 12000, quantity: 1, consumerUserIds: [5] },
      { name: 'Samosas', unitPricePaise: 3000, quantity: 5, consumerUserIds: [1, 2, 3, 4, 5] },
    ],
  });

  assert.equal(result.totalPaise, 37000);
  const byUser = new Map(result.splits.map((s) => [s.userId, s.owedPaise]));
  assert.equal(byUser.get(1), 5500);
  assert.equal(byUser.get(2), 5500);
  assert.equal(byUser.get(3), 5500);
  assert.equal(byUser.get(4), 5500);
  assert.equal(byUser.get(5), 15000);

  const sum = result.splits.reduce((acc, s) => acc + s.owedPaise, 0);
  assert.equal(sum, result.totalPaise);
});

test('Itemized split proportionally distributes tax, tip, and discount with zero paise loss', () => {
  const result = calculateSplits({
    splitMethod: 'itemized',
    participants: [{ userId: 1 }, { userId: 2 }],
    items: [
      { name: 'Thali', unitPricePaise: 20000, quantity: 1, consumerUserIds: [1] },
      { name: 'Juice', unitPricePaise: 10000, quantity: 1, consumerUserIds: [2] },
    ],
    taxPaise: 1500, // 5% GST = ₹15 -> ₹10 to user 1, ₹5 to user 2
    tipPaise: 3000, // ₹30 -> ₹20 to user 1, ₹10 to user 2
    discountPaise: 1500, // -₹15 -> -₹10 to user 1, -₹5 to user 2
  });

  assert.equal(result.subtotalPaise, 30000);
  assert.equal(result.totalPaise, 33000);
  const byUser = new Map(result.splits.map((s) => [s.userId, s.owedPaise]));
  assert.equal(byUser.get(1), 22000);
  assert.equal(byUser.get(2), 11000);
});

test('Equal split handles indivisible amounts (₹100 ÷ 3) deterministically', () => {
  const result = calculateSplits({
    splitMethod: 'equal',
    totalPaise: rupeesToPaise(100), // 10000 paise
    participants: [{ userId: 1 }, { userId: 2 }, { userId: 3 }],
  });

  assert.equal(result.totalPaise, 10000);
  const amounts = result.splits.map((s) => s.owedPaise);
  assert.deepEqual(amounts, [3334, 3333, 3333]);
  assert.equal(
    amounts.reduce((a, b) => a + b, 0),
    10000
  );
});

test('Exact split rejects mismatched totals and accepts exact matches', () => {
  assert.throws(() =>
    calculateSplits({
      splitMethod: 'exact',
      totalPaise: 50000,
      participants: [
        { userId: 1, exactPaise: 20000 },
        { userId: 2, exactPaise: 25000 },
      ],
    })
  );

  const ok = calculateSplits({
    splitMethod: 'exact',
    totalPaise: 50000,
    participants: [
      { userId: 1, exactPaise: 20000 },
      { userId: 2, exactPaise: 30000 },
    ],
  });
  assert.equal(ok.splits[0].owedPaise, 20000);
  assert.equal(ok.splits[1].owedPaise, 30000);
});

test('Percentage and Shares splits compute exact totals', () => {
  const pct = calculateSplits({
    splitMethod: 'percentage',
    totalPaise: 100000,
    participants: [
      { userId: 1, percentage: 60 },
      { userId: 2, percentage: 40 },
    ],
  });
  assert.equal(pct.splits[0].owedPaise, 60000);
  assert.equal(pct.splits[1].owedPaise, 40000);

  const sh = calculateSplits({
    splitMethod: 'shares',
    totalPaise: 90000,
    participants: [
      { userId: 1, shares: 2 },
      { userId: 2, shares: 1 },
    ],
  });
  assert.equal(sh.splits[0].owedPaise, 60000);
  assert.equal(sh.splits[1].owedPaise, 30000);
});

test('Greedy debt simplification produces minimum transfers summing to zero', () => {
  const balances: MemberNetBalance[] = [
    {
      userId: 1,
      fullName: 'Aarav',
      email: 'a@x.com',
      upiId: 'aarav@upi',
      avatarUrl: null,
      paidPaise: 37000,
      owedPaise: 5500,
      settlementsPaidPaise: 0,
      settlementsReceivedPaise: 0,
      pendingIncomingPaise: 0,
      pendingOutgoingPaise: 0,
      netPaise: 31500, // Owed ₹315
    },
    {
      userId: 2,
      fullName: 'Diya',
      email: 'd@x.com',
      upiId: null,
      avatarUrl: null,
      paidPaise: 0,
      owedPaise: 5500,
      settlementsPaidPaise: 0,
      settlementsReceivedPaise: 0,
      pendingIncomingPaise: 0,
      pendingOutgoingPaise: 0,
      netPaise: -5500,
    },
    {
      userId: 3,
      fullName: 'Rohan',
      email: 'r@x.com',
      upiId: null,
      avatarUrl: null,
      paidPaise: 0,
      owedPaise: 5500,
      settlementsPaidPaise: 0,
      settlementsReceivedPaise: 0,
      pendingIncomingPaise: 0,
      pendingOutgoingPaise: 0,
      netPaise: -5500,
    },
    {
      userId: 4,
      fullName: 'Meera',
      email: 'm@x.com',
      upiId: null,
      avatarUrl: null,
      paidPaise: 0,
      owedPaise: 5500,
      settlementsPaidPaise: 0,
      settlementsReceivedPaise: 0,
      pendingIncomingPaise: 0,
      pendingOutgoingPaise: 0,
      netPaise: -5500,
    },
    {
      userId: 5,
      fullName: 'Kabir',
      email: 'k@x.com',
      upiId: null,
      avatarUrl: null,
      paidPaise: 0,
      owedPaise: 15000,
      settlementsPaidPaise: 0,
      settlementsReceivedPaise: 0,
      pendingIncomingPaise: 0,
      pendingOutgoingPaise: 0,
      netPaise: -15000,
    },
  ];

  const transfers = simplifyDebts(balances);
  assert.equal(transfers.length, 4);
  const totalTransferred = transfers.reduce((acc, t) => acc + t.amountPaise, 0);
  assert.equal(totalTransferred, 31500);
  assert.equal(transfers[0].fromUserId, 5);
  assert.equal(transfers[0].toUserId, 1);
  assert.equal(transfers[0].amountPaise, 15000);
});

test('scrypt password hashing verifies valid passwords and rejects wrong passwords', () => {
  const hash = hashPassword('SettleUp#2026');
  assert.equal(verifyPassword('SettleUp#2026', hash), true);
  assert.equal(verifyPassword('WrongPass', hash), false);
});
