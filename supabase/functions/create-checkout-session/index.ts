import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@17.0.0?target=deno";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_RETURN_URL = "https://charming-pudding-d20567.netlify.app";

const VALID_LOOKUP_KEYS = new Set(["investor_monthly", "investor_annual"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      throw new Error("Supabase environment is not fully configured");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.trim()) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const priceLookupKey = body.price_lookup_key;
    if (priceLookupKey === undefined || priceLookupKey === null || priceLookupKey === "") {
      return new Response(JSON.stringify({ error: "price_lookup_key is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const keyStr = String(priceLookupKey);
    if (!VALID_LOOKUP_KEYS.has(keyStr)) {
      return new Response(
        JSON.stringify({ error: 'price_lookup_key must be "investor_monthly" or "investor_annual"' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let returnUrl = DEFAULT_RETURN_URL;
    if (body.return_url !== undefined && body.return_url !== null && String(body.return_url).trim() !== "") {
      returnUrl = String(body.return_url).trim();
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: subscription, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id, stripe_customer_id, status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (subError) {
      console.error("subscriptions lookup error:", subError.message);
      throw new Error(subError.message);
    }
    if (!subscription) {
      return new Response(JSON.stringify({ error: "Subscription record not found for user" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (subscription.status === "active") {
      return new Response(JSON.stringify({ error: "You already have an active subscription" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const priceList = await stripe.prices.list({
      lookup_keys: [keyStr],
      limit: 1,
    });
    const price = priceList.data[0];
    if (!price) {
      return new Response(
        JSON.stringify({ error: `No Stripe price found for lookup key: ${keyStr}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let customerId = subscription.stripe_customer_id as string | null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      const { error: updateErr } = await supabaseAdmin
        .from("subscriptions")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", user.id);

      if (updateErr) {
        console.error("Failed to save stripe_customer_id:", updateErr.message);
        throw new Error(updateErr.message);
      }
    }

    const allowPromotionCodes = keyStr === "investor_monthly";

    const successUrlFinal = returnUrl.includes("?")
      ? `${returnUrl}&checkout=success&session_id={CHECKOUT_SESSION_ID}`
      : `${returnUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrlFinal = returnUrl.includes("?")
      ? `${returnUrl}&checkout=cancelled`
      : `${returnUrl}?checkout=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: price.id, quantity: 1 }],
      allow_promotion_codes: allowPromotionCodes,
      success_url: successUrlFinal,
      cancel_url: cancelUrlFinal,
      metadata: {
        supabase_user_id: user.id,
        price_lookup_key: keyStr,
      },
      subscription_data: {
        metadata: { supabase_user_id: user.id },
      },
    });

    if (!session.url) {
      throw new Error("Checkout session has no URL");
    }

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("create-checkout-session error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
