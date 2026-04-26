export type SubscriptionPlan = "free" | "investor_monthly" | "investor_annual";

export type SubscriptionStatus = "trial" | "active" | "past_due" | "canceled" | "expired";

export interface Subscription {
  id?: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trial_deals_used: number;
  trial_deals_limit: number;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  canceled_at: string | null;
  current_period_end: string | null;
  current_period_start: string | null;
  monthly_ai_deals_count: number;
  monthly_ai_deals_reset_at: string | null;
  created_at?: string;
  updated_at?: string;
}
