import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@17.0.0?target=deno";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    const token = authHeader?.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey);
    const { data: userData, error: userError } = await supabaseUser.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user = userData.user;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: subscription, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (subError) {
      throw new Error(subError.message);
    }

    const stripeCustomerId = (subscription?.stripe_customer_id ?? "").trim();
    if (!subscription || !stripeCustomerId) {
      return new Response(
        JSON.stringify({ error: "No Stripe customer found for this user. Please subscribe first." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });

    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: "https://fliplogic.ai/?portal=return",
      });

      return new Response(JSON.stringify({ url: portalSession.url }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("create-portal-session stripe error:", msg);
      return new Response(
        JSON.stringify({ error: "Failed to create portal session", details: msg }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("create-portal-session error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
