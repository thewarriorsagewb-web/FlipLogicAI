-- Add subscription lifecycle tracking columns
-- These mirror Stripe's subscription object fields for cancellation/renewal state

ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS cancel_at timestamptz,
ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
ADD COLUMN IF NOT EXISTS current_period_start timestamptz;

COMMENT ON COLUMN subscriptions.cancel_at_period_end IS 'True when user clicked Cancel in portal but subscription remains active until period end. Mirrors Stripe subscription.cancel_at_period_end.';
COMMENT ON COLUMN subscriptions.cancel_at IS 'Future timestamp when subscription will be cancelled. Mirrors Stripe subscription.cancel_at.';
COMMENT ON COLUMN subscriptions.canceled_at IS 'Timestamp when user clicked Cancel. Mirrors Stripe subscription.canceled_at.';
COMMENT ON COLUMN subscriptions.current_period_end IS 'End of current billing period. Mirrors Stripe subscription.current_period_end.';
COMMENT ON COLUMN subscriptions.current_period_start IS 'Start of current billing period. Mirrors Stripe subscription.current_period_start.';
