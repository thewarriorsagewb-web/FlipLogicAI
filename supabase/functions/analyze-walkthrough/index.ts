// Placeholder Edge Function — replace with Whisper + Claude pipeline later.
// Deploy: supabase functions deploy analyze-walkthrough

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Priority = "critical" | "important" | "optional";

interface MockFinding {
  category: string;
  description: string;
  priority: Priority;
  estimatedCost: number;
  notes: string;
  hazmat: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const mode = String(body.mode ?? "unknown");
    const address = String(body.propertyAddress ?? "");
    const flags = Array.isArray(body.flagTimestamps) ? body.flagTimestamps : [];

    const mockFindings: MockFinding[] = [
      {
        category: "Other",
        description: `[Mock] Walkthrough analysis (${mode}) for ${address || "property"}`,
        priority: "important",
        estimatedCost: 2500,
        notes: `Edge function placeholder. Received ${flags.length} flag marker(s). Implement Whisper + vision model here.`,
        hazmat: false,
      },
      {
        category: "Electrical",
        description: "[Mock] Verify panel age and capacity from walkthrough media",
        priority: "critical",
        estimatedCost: 1800,
        notes: "Replace with real model output.",
        hazmat: false,
      },
      {
        category: "Roof",
        description: "[Mock] Confirm roof condition from frames / narration",
        priority: "optional",
        estimatedCost: 1200,
        notes: "Placeholder finding for UI testing.",
        hazmat: false,
      },
    ];

    return new Response(JSON.stringify({ findings: mockFindings }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
