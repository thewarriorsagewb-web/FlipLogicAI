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
    const setupToken = req.headers.get("x-setup-token");
    const expectedSetupToken = Deno.env.get("SETUP_TOKEN");
    if (!setupToken || !expectedSetupToken || setupToken !== expectedSetupToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const config = await stripe.billingPortal.configurations.create({
      business_profile: {
        headline: "FlipLogic AI partners with Stripe for simplified billing.",
      },
      features: {
        customer_update: {
          enabled: true,
          allowed_updates: ["name", "address"],
        },
        invoice_history: {
          enabled: true,
        },
        payment_method_update: {
          enabled: true,
        },
        subscription_cancel: {
          enabled: true,
          mode: "at_period_end",
          cancellation_reason: {
            enabled: true,
            options: [
              "too_expensive",
              "missing_features",
              "switched_service",
              "unused",
              "other",
            ],
          },
        },
        subscription_update: {
          enabled: true,
          default_allowed_updates: ["price"],
          proration_behavior: "create_prorations",
          products: [
            {
              product: "prod_UOhn2qJJfejrUO",
              prices: [
                "price_1TPuNYKFRFMKFQpOkUK4WVNc",
                "price_1TPuNYKFRFMKFQpOQh4QRuNV",
              ],
            },
          ],
        },
      },
      login_page: {
        enabled: false,
      },
      metadata: {
        app: "fliplogic-ai",
      },
      name: "FlipLogic AI",
    });

    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.log("setup-portal-config error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: "Failed to create portal config", details: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

