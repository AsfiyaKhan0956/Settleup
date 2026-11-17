export type SplitMethod = 'equal' | 'exact' | 'percentage' | 'shares' | 'itemized';

export type AppRoute =
  | '/'
  | '/login'
  | '/register'
  | '/forgot-password'
  | '/help'
  | '/privacy'
  | '/terms'
  | '/403'
  | '/404'
  | '/expired'
  | '/personal'
  | '/dashboard'
  | '/groups'
  | '/add-expense'
  | '/expenses'
  | '/balances'
  | '/manual-balances'
  | '/settlements'
  | '/analytics'
  | '/notifications'
  | '/profile';

export interface UserPreferences {
  currency: string;
  theme: string;
  emailNotifications: boolean;
  settlementAlerts: boolean;
  onboardingCompleted: boolean;
}

export interface AuthUser {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  upiId: string | null;
  isDemo: boolean;
  preferences: UserPreferences;
}

export interface GroupSummary {
  id: number;
  name: string;
  description: string;
  category: string;
  coverColor: string;
  isArchived: boolean;
  myRole: string;
  createdAt: string;
  memberCount: number;
  expenseCount: number;
  totalExpenditurePaise: number;
  myNetBalancePaise: number;
  members: Array<{
    userId: number;
    fullName: string;
    avatarUrl: string | null;
    netPaise: number;
  }>;
}

export interface MemberNetBalance {
  userId: number;
  fullName: string;
  email: string;
  upiId: string | null;
  avatarUrl: string | null;
  role?: string;
  joinedAt?: string;
  paidPaise: number;
  owedPaise: number;
  settlementsPaidPaise: number;
  settlementsReceivedPaise: number;
  pendingIncomingPaise: number;
  pendingOutgoingPaise: number;
  netPaise: number;
}

export interface SimplifiedTransfer {
  groupId?: number;
  groupName?: string;
  fromUserId: number;
  fromName: string;
  toUserId: number;
  toName: string;
  toUpiId: string | null;
  amountPaise: number;
}

export interface ExpenseRecord {
  id: number;
  group_id: number;
  group_name: string;
  paid_by_user_id: number;
  payer_name: string;
  created_by_user_id: number;
  creator_name: string;
  title: string;
  description: string;
  notes?: string;
  category: string;
  split_method: SplitMethod;
  subtotal_paise?: number;
  tax_paise?: number;
  tip_paise?: number;
  discount_paise?: number;
  total_paise: number;
  expense_date: string;
  receipt_data_url?: string | null;
  created_at: string;
  participantCount?: number;
  myOwedPaise?: number;
  splits?: Array<{ user_id: number; full_name: string; owed_paise: number }>;
}

export interface SettlementRecord {
  id: number;
  group_id: number;
  group_name?: string;
  payer_user_id: number;
  payer_name: string;
  receiver_user_id: number;
  receiver_name: string;
  receiver_upi_id?: string | null;
  amount_paise: number;
  payment_method: string;
  reference_code: string;
  status: 'pending' | 'recorded' | 'confirmed';
  notes: string;
  created_at: string;
  confirmed_at: string | null;
}

export interface NotificationRecord {
  id: number;
  group_id: number | null;
  type: string;
  title: string;
  message: string;
  link_path: string;
  is_read: number;
  created_at: string;
}

export interface ActivityRecord {
  id: number;
  group_id: number | null;
  group_name?: string;
  user_id: number;
  actor_name: string;
  action: string;
  entity_type: string;
  summary: string;
  created_at: string;
}

export interface GroupInvitationItem {
  id: number;
  invitee_email: string | null;
  invitee_phone: string | null;
  channel: 'qr' | 'email' | 'whatsapp' | 'phone' | 'link';
  token: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
  delivery_status: string;
  delivery_error: string | null;
  max_uses: number;
  use_count: number;
  expires_at: string;
  created_at: string;
  last_sent_at: string | null;
  inviteUrl: string;
}

export interface PendingUserInvitation {
  id: number;
  group_id: number;
  channel: string;
  token: string;
  expires_at: string;
  created_at: string;
  group_name: string;
  group_description: string;
  group_category: string;
  inviter_name: string;
}

export interface PersonalTransaction {
  id: number;
  title: string;
  amount_paise: number;
  type: 'income' | 'expense';
  category: string;
  transaction_date: string;
  notes: string;
  payment_method: string;
  linked_group_expense_id: number | null;
  created_at: string;
}

export interface PersonalBudgetStatus {
  id: number;
  scope: 'overall' | 'category';
  category: string;
  period: 'weekly' | 'monthly';
  limit_paise: number;
  spentPaise: number;
  remainingPaise: number;
  percentUsed: number;
  alertState: 'ok' | 'approaching' | 'exceeded';
}

export interface PersonalSavingsGoal {
  id: number;
  title: string;
  target_paise: number;
  current_saved_paise: number;
  target_date: string | null;
  notes: string;
  created_at: string;
}

export interface PersonalSummaryPayload {
  range: {
    period: 'daily' | 'weekly' | 'monthly' | 'custom';
    start: string;
    end: string;
    anchorDate: string;
  };
  summary: {
    totalIncomePaise: number;
    totalExpensePaise: number;
    remainingBalancePaise: number;
    savingsPaise: number;
    savingsPercent: number | null;
    hasRecordedIncome: boolean;
    highestSpendingCategory: { category: string; totalPaise: number; count: number } | null;
    transactionCount: number;
  };
  categoryBreakdown: Array<{ category: string; totalPaise: number; count: number }>;
  weeklySpending: Array<{ dayLabel: string; date: string; totalPaise: number }>;
  monthlySpending: Array<{ month: string; income_paise: number; expense_paise: number }>;
  budgetStatuses: PersonalBudgetStatus[];
  savingsGoals: PersonalSavingsGoal[];
  categories: {
    expense: string[];
    income: string[];
    custom: Array<{ id: number; name: string; type: 'income' | 'expense'; color: string }>;
  };
  transactions: PersonalTransaction[];
}

export interface TripLedgerSummary {
  id: number;
  user_id: number;
  group_id: number | null;
  group_name: string | null;
  title: string;
  description: string;
  event_date: string;
  created_at: string;
  entryCount: number;
  totalToPayPaise: number;
  totalToReceivePaise: number;
  remainingToPayPaise: number;
  remainingToReceivePaise: number;
  imbalancePaise: number;
  isBalanced: boolean;
  transfers: SimplifiedTransfer[];
}

export interface ManualBalanceEntry {
  id: number;
  user_id: number;
  trip_ledger_id: number | null;
  external_participant_id: number | null;
  linked_user_id: number | null;
  person_name: string;
  contact_ref: string;
  participant_type: 'external' | 'registered';
  direction: 'to_pay' | 'to_receive';
  amount_paise: number;
  settled_paise: number;
  status: 'pending' | 'partially_settled' | 'settled';
  trip_name: string;
  description: string;
  entry_date: string;
  created_at: string;
  updated_at: string;
}

export interface ExternalParticipantRecord {
  id: number;
  display_name: string;
  phone: string | null;
  email: string | null;
  linked_user_id: number | null;
  linked_user_name: string | null;
  notes: string;
  created_at: string;
}

export interface TripLedgerDetail {
  ledger: {
    id: number;
    user_id: number;
    group_id: number | null;
    group_name: string | null;
    title: string;
    description: string;
    event_date: string;
  };
  entries: ManualBalanceEntry[];
  participants: ExternalParticipantRecord[];
  events: Array<{
    id: number;
    action: string;
    amount_paise: number;
    note: string;
    created_at: string;
  }>;
  summary: {
    totalToPayPaise: number;
    totalToReceivePaise: number;
    remainingToPayPaise: number;
    remainingToReceivePaise: number;
    imbalancePaise: number;
    isBalanced: boolean;
    transfers: SimplifiedTransfer[];
  };
}
