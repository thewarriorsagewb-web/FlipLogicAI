import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@17.0.0?target=deno";

const jsonHeaders = { "Content-Type": "application/json" };

function getStripeSubscriptionId(
  value: string | Stripe.Subscription | null | undefined,
): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return value.id;
}

type DbStatus = "trial" | "active" | "past_due" | "canceled" | "expired";

function stripeTimestampToISOString(unixSeconds: number | null | undefined): string | null {
  if (unixSeconds === null || unixSeconds === undefined) return null;
  // Stripe sends Unix timestamps in seconds; JavaScript Date expects milliseconds
  return new Date(unixSeconds * 1000).toISOString();
}

function mapStripeSubscriptionStatusToDb(stripeStatus: string): DbStatus {
  if (stripeStatus === "active" || stripeStatus === "trialing") return "active";
  if (stripeStatus === "past_due") return "past_due";
  if (stripeStatus === "canceled" || stripeStatus === "unpaid") return "canceled";
  if (stripeStatus === "incomplete" || stripeStatus === "incomplete_expired") {
    return "expired";
  }
  const allowed: DbStatus[] = ["trial", "active", "past_due", "canceled", "expired"];
  if (allowed.includes(stripeStatus as DbStatus)) {
    return stripeStatus as DbStatus;
  }
  console.warn("Unmapped subscription.status; using Stripe value as-is (may require DB support):", stripeStatus);
  return stripeStatus as DbStatus;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY is not set" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
  if (!STRIPE_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "STRIPE_WEBHOOK_SECRET is not set" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
  if (!SUPABASE_URL) {
    return new Response(JSON.stringify({ error: "SUPABASE_URL is not set" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing stripe-signature header" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2024-11-20.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    const cryptoProvider = Stripe.createSubtleCryptoProvider();
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET,
      undefined,
      cryptoProvider,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Webhook signature verification failed:", msg);
    return new Response(JSON.stringify({ error: `Signature verification failed: ${msg}` }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        try {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.mode !== "subscription") {
            return new Response(JSON.stringify({ received: true }), {
              status: 200,
              headers: jsonHeaders,
            });
          }
          const subId = getStripeSubscriptionId(
            session.subscription as string | Stripe.Subscription | null | undefined,
          );
          console.log(`Processing ${event.type} for subscription ${subId ?? "none"}`);
          const supabaseUserId = session.metadata?.supabase_user_id;
          const priceLookupKey = session.metadata?.price_lookup_key;
          if (!supabaseUserId) {
            console.error("checkout.session.completed: missing session.metadata.supabase_user_id");
            throw new Error("Missing supabase_user_id in checkout session metadata");
          }
          if (priceLookupKey !== "investor_monthly" && priceLookupKey !== "investor_annual") {
            console.error("checkout.session.completed: invalid price_lookup_key in metadata", priceLookupKey);
            throw new Error("Invalid or missing price_lookup_key in session metadata");
          }
          if (!subId) {
            console.error("checkout.session.completed: session.subscription is null for mode=subscription", session.id);
            return new Response(JSON.stringify({ received: true }), {
              status: 200,
              headers: jsonHeaders,
            });
          }
          const fullSub = await stripe.subscriptions.retrieve(subId);
          const customerId = typeof session.customer === "string"
            ? session.customer
            : (session.customer as Stripe.Customer | null)?.id;
          if (!customerId) {
            throw new Error("Missing customer on checkout session");
          }
          const { error } = await supabase
            .from("subscriptions")
            .update({
              stripe_subscription_id: subId,
              stripe_customer_id: customerId,
              plan: priceLookupKey,
              status: "active",
              cancel_at_period_end: fullSub.cancel_at_period_end ?? false,
              cancel_at: stripeTimestampToISOString(fullSub.cancel_at),
              canceled_at: stripeTimestampToISOString(fullSub.canceled_at),
              current_period_end: stripeTimestampToISOString(fullSub.current_period_end),
              current_period_start: stripeTimestampToISOString(fullSub.current_period_start),
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", supabaseUserId);
          if (error) {
            throw new Error(`subscriptions update (checkout): ${error.message}`);
          }
          console.log("checkout.session.completed: updated subscription for user", supabaseUserId);
        } catch (e: unknown) {
          console.error("checkout.session.completed handler error:", e);
          if (e instanceof Error && e.stack) console.error(e.stack);
          throw e;
        }
        break;
      }

      case "customer.subscription.updated": {
        try {
          const subscription = event.data.object as Stripe.Subscription;
          console.log(`Processing ${event.type} for subscription ${subscription?.id ?? "none"}`);
          let userId: string | undefined = subscription.metadata?.supabase_user_id;
          if (!userId) {
            const { data: row, error: lookupErr } = await supabase
              .from("subscriptions")
              .select("user_id")
              .eq("stripe_subscription_id", subscription.id)
              .maybeSingle();
            if (lookupErr) {
              throw new Error(`lookup by stripe_subscription_id: ${lookupErr.message}`);
            }
            userId = row?.user_id;
          }
          if (!userId) {
            throw new Error("Cannot resolve supabase user for customer.subscription.updated");
          }
          const newStatus = mapStripeSubscriptionStatusToDb(subscription.status);
          const price = subscription.items?.data?.[0]?.price;
          const lookupKey = price?.lookup_key;
          if (lookupKey && lookupKey !== "investor_monthly" && lookupKey !== "investor_annual") {
            console.warn("Unexpected price lookup_key on subscription.updated:", lookupKey);
          }
          if (lookupKey === "investor_monthly" || lookupKey === "investor_annual") {
            const { error } = await supabase
              .from("subscriptions")
              .update({
                status: newStatus,
                plan: lookupKey,
                cancel_at_period_end: subscription.cancel_at_period_end ?? false,
                cancel_at: stripeTimestampToISOString(subscription.cancel_at),
                canceled_at: stripeTimestampToISOString(subscription.canceled_at),
                current_period_end: stripeTimestampToISOString(subscription.current_period_end),
                current_period_start: stripeTimestampToISOString(subscription.current_period_start),
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", userId);
            if (error) {
              throw new Error(`subscriptions update (sub.updated with plan): ${error.message}`);
            }
          } else {
            const { data: current, error: currentErr } = await supabase
              .from("subscriptions")
              .select("plan")
              .eq("user_id", userId)
              .maybeSingle();
            if (currentErr) {
              throw new Error(`subscriptions read plan (sub.updated): ${currentErr.message}`);
            }
            const { error } = await supabase
              .from("subscriptions")
              .update({
                status: newStatus,
                plan: current?.plan ?? "free",
                cancel_at_period_end: subscription.cancel_at_period_end ?? false,
                cancel_at: stripeTimestampToISOString(subscription.cancel_at),
                canceled_at: stripeTimestampToISOString(subscription.canceled_at),
                current_period_end: stripeTimestampToISOString(subscription.current_period_end),
                current_period_start: stripeTimestampToISOString(subscription.current_period_start),
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", userId);
            if (error) {
              throw new Error(`subscriptions update (sub.updated keep plan): ${error.message}`);
            }
          }
        } catch (e: unknown) {
          console.error("customer.subscription.updated handler error:", e);
          if (e instanceof Error && e.stack) console.error(e.stack);
          throw e;
        }
        break;
      }

      case "customer.subscription.deleted": {
        try {
          const subscription = event.data.object as Stripe.Subscription;
          console.log(`Processing ${event.type} for subscription ${subscription?.id ?? "none"}`);
          const { error } = await supabase
            .from("subscriptions")
            .update({
              status: "canceled",
              plan: "free",
              canceled_at: stripeTimestampToISOString(subscription.canceled_at) ?? new Date().toISOString(),
              cancel_at_period_end: false,
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_subscription_id", subscription.id);
          if (error) {
            throw new Error(`subscriptions update (sub.deleted): ${error.message}`);
          }
          console.log("customer.subscription.deleted: set canceled for stripe_subscription_id", subscription.id);
        } catch (e: unknown) {
          console.error("customer.subscription.deleted handler error:", e);
          if (e instanceof Error && e.stack) console.error(e.stack);
          throw e;
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = getStripeSubscriptionId(invoice.subscription);
        if (subId) {
          const { error } = await supabase
            .from("subscriptions")
            .update({ status: "past_due" })
            .eq("stripe_subscription_id", subId);
          if (error) {
            throw new Error(`subscriptions update (payment_failed): ${error.message}`);
          }
        }
        const email = (invoice as { customer_email?: string | null }).customer_email;
        console.error(
          "invoice.payment_failed:",
          "subscription=",
          subId ?? "none",
          "customer_email=",
          email ?? "n/a",
        );
        break;
      }

      default: {
        console.log("Unhandled event type:", event.type);
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: jsonHeaders,
        });
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe-webhook processing error:", msg);
    if (e instanceof Error && e.stack) console.error(e.stack);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
