-- Fix realtime propagation for subscriptions table by ensuring clean authenticated SELECT policy
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can view their own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;

CREATE POLICY "authenticated_select_own_subscription"
ON public.subscriptions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Also apply the same pattern to deals for consistency (realtime is enabled on deals too)
DROP POLICY IF EXISTS "Users can view own deals" ON public.deals;
DROP POLICY IF EXISTS "Users can view their own deals" ON public.deals;
DROP POLICY IF EXISTS "deals_select_own" ON public.deals;

CREATE POLICY "authenticated_select_own_deals"
ON public.deals
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
