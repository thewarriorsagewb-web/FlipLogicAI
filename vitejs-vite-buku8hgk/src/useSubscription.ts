import { useState, useEffect, useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Subscription, SubscriptionPlan, SubscriptionStatus } from "./subscriptionTypes";

const EMPTY_DEFAULT: Subscription = {
  user_id: "",
  stripe_customer_id: null,
  stripe_subscription_id: null,
  plan: "free",
  status: "trial",
  trial_deals_used: 0,
  trial_deals_limit: 5,
  cancel_at_period_end: false,
  cancel_at: null,
  canceled_at: null,
  current_period_end: null,
  current_period_start: null,
  monthly_ai_deals_count: 0,
  monthly_ai_deals_reset_at: null,
};

function mapRow(row: Record<string, unknown>): Subscription {
  return {
    id: row.id as string | undefined,
    user_id: String(row.user_id),
    stripe_customer_id: (row.stripe_customer_id as string | null) ?? null,
    stripe_subscription_id: (row.stripe_subscription_id as string | null) ?? null,
    plan: (row.plan as SubscriptionPlan) || "free",
    status: (row.status as SubscriptionStatus) || "trial",
    trial_deals_used: Number(row.trial_deals_used) || 0,
    trial_deals_limit: Number(row.trial_deals_limit) || 5,
    cancel_at_period_end: row.cancel_at_period_end === true,
    cancel_at: (row.cancel_at as string | null) ?? null,
    canceled_at: (row.canceled_at as string | null) ?? null,
    current_period_end: (row.current_period_end as string | null) ?? null,
    current_period_start: (row.current_period_start as string | null) ?? null,
    monthly_ai_deals_count: Number(row.monthly_ai_deals_count) || 0,
    monthly_ai_deals_reset_at: (row.monthly_ai_deals_reset_at as string | null) ?? null,
    created_at: row.created_at as string | undefined,
    updated_at: row.updated_at as string | undefined,
  };
}

export function useSubscription(supabase: SupabaseClient, userId: string | null) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) {
      setSubscription(null);
      setLoading(false);
      setError(null);
      return;
    }
    setError(null);
    const { data, error: qerr } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (qerr) {
      console.error("useSubscription: query failed, using default trial", qerr);
      setError(new Error(qerr.message));
      setSubscription({ ...EMPTY_DEFAULT, user_id: userId });
      setLoading(false);
      return;
    }
    if (!data) {
      setSubscription({ ...EMPTY_DEFAULT, user_id: userId });
      setLoading(false);
      return;
    }
    setSubscription(mapRow(data as Record<string, unknown>));
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`subscriptions-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${userId}` },
        () => {
          void refetch();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId, refetch]);

  return { subscription, loading, error, refetch };
}
