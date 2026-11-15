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
  | '/dashboard'
  | '/groups'
  | '/add-expense'
  | '/expenses'
  | '/balances'
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
