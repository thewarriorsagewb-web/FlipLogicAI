import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Priority = "critical" | "important" | "optional";

interface Finding {
  category: string;
  description: string;
  priority: Priority;
  estimatedCost: number;
  notes: string;
  hazmat: boolean;
}

interface PropertyChanges {
  bedroomDelta: number;
  bathroomDelta: number;
  sqftDelta: number;
  reasoning: string;
}

const DEFAULT_PROPERTY_CHANGES: PropertyChanges = {
  bedroomDelta: 0,
  bathroomDelta: 0,
  sqftDelta: 0,
  reasoning: "",
};

function normalizePropertyChanges(raw: unknown): PropertyChanges {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PROPERTY_CHANGES };
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number => {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v);
      return Number.isNaN(n) ? 0 : n;
    }
    return 0;
  };
  return {
    bedroomDelta: num(o.bedroomDelta),
    bathroomDelta: num(o.bathroomDelta),
    sqftDelta: num(o.sqftDelta),
    reasoning: typeof o.reasoning === "string" ? o.reasoning : "",
  };
}

function parseClaudeJson(cleaned: string): { findings: Finding[]; propertyChanges: PropertyChanges } {
  const parsed: unknown = JSON.parse(cleaned);
  if (Array.isArray(parsed)) {
    return { findings: parsed as Finding[], propertyChanges: { ...DEFAULT_PROPERTY_CHANGES } };
  }
  if (parsed && typeof parsed === "object" && "findings" in parsed) {
    const rec = parsed as { findings?: unknown; propertyChanges?: unknown };
    const arr = rec.findings;
    if (!Array.isArray(arr)) {
      throw new Error("findings is not an array");
    }
    return {
      findings: arr as Finding[],
      propertyChanges: normalizePropertyChanges(rec.propertyChanges),
    };
  }
  throw new Error("Response is not a valid array or object with findings");
}

async function transcribeAudio(audioBase64: string, mimeType: string, deepgramKey: string): Promise<string> {
  console.log("Transcribing audio with Deepgram...");
  const audioBuffer = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
  const response = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true",
    {
      method: "POST",
      headers: {
        "Authorization": `Token ${deepgramKey}`,
        "Content-Type": mimeType || "audio/webm",
      },
      body: audioBuffer,
    }
  );
  if (!response.ok) {
    const err = await response.text();
    console.error("Deepgram error:", err);
    return "";
  }
  const data = await response.json() as {
    results?: {
      channels?: {
        alternatives?: {
          transcript?: string;
        }[];
      }[];
    };
  };
  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  console.log("Deepgram transcript length:", transcript.length);
  console.log("Transcript preview:", transcript.slice(0, 200));
  return transcript;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const mode = String(body.mode ?? "audio");
    const address = String(body.propertyAddress ?? "");
    const buildYear = Number(body.buildYear ?? 0);
    const flags = Array.isArray(body.flagTimestamps) ? body.flagTimestamps as number[] : [];
    let transcript = String(body.transcript ?? "").trim();
    const framesBase64 = Array.isArray(body.framesBase64) ? body.framesBase64 as string[] : [];
    const videoBursts = Array.isArray(body.videoBursts) ? body.videoBursts as { base64: string; atSec: number; mimeType: string }[] : [];
    const audioBase64 = String(body.audioBase64 ?? "");
    const mimeType = String(body.mimeType ?? "audio/webm");

    console.log(`analyze-walkthrough: mode=${mode}, address=${address}, frames=${framesBase64.length}, bursts=${videoBursts.length}, flags=${flags.length}, transcript_len=${transcript.length}, has_audio=${audioBase64.length > 0}`);

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not configured in Edge Function secrets");
    }

    const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");

    // If we have audio and Deepgram key, transcribe it
    if (audioBase64 && DEEPGRAM_API_KEY) {
      const deepgramTranscript = await transcribeAudio(audioBase64, mimeType, DEEPGRAM_API_KEY);
      if (deepgramTranscript) {
        transcript = deepgramTranscript;
        console.log("Using Deepgram transcript");
      }
    } else if (!DEEPGRAM_API_KEY) {
      console.log("No Deepgram key — using browser transcript only");
    }

    // Format flags as readable text
    const flagText = flags.length > 0
      ? flags.map((f) => {
          const m = Math.floor(f / 60);
          const s = Math.floor(f % 60);
          return `- ${m}:${s.toString().padStart(2, "0")} — flagged moment`;
        }).join("\n")
      : "No flags recorded.";

    // Lead paint warning
    const hazmatContext = buildYear > 0 && buildYear < 1978
      ? `IMPORTANT: This property was built in ${buildYear}, before 1978. Lead paint is likely present. Flag any disturbed painted surfaces as hazmat: true.`
      : buildYear > 0
      ? `Property was built in ${buildYear}.`
      : "";

    // Build prompt
    const promptText = `You are an expert real estate inspector and construction estimator helping a fix-and-flip investor analyze a property walkthrough.

Property address: ${address || "Not provided"}
${hazmatContext}

Walkthrough transcript (spoken during the walk):
${transcript || "No transcript provided."}

Flagged moments during recording:
${flagText}

${framesBase64.length > 0 ? `${framesBase64.length} video frame(s) from the walkthrough are attached. Analyze them carefully for any visible defects, damage, or items needing repair.` : ""}
${videoBursts.length > 0 ? `${videoBursts.length} video burst frame(s) are also attached.` : ""}

Your job: Identify every repair, defect, safety issue, or renovation item based on the transcript and any images provided. Use the property location to inform your cost estimates — regional labor and material costs vary significantly across the US.

If no transcript is provided and no images are attached, return an object with "findings" as an empty array and "propertyChanges" with all zeros and empty reasoning.

Return ONLY a valid JSON object. No markdown, no explanation, no code blocks. Just the raw JSON.

Schema (strict):
{
  "findings": [
    {
      "category": "Foundation & Structure | Roof | Exterior | Windows & Doors | Plumbing | Electrical | HVAC | Insulation | Drywall & Paint | Flooring | Kitchen | Bathrooms | Landscaping | Permits & Fees | Cleanup & Hauling | Other",
      "description": "clear description of the issue or work needed",
      "priority": "critical | important | optional",
      "estimatedCost": 0,
      "notes": "specific observations or recommendations",
      "hazmat": false
    }
  ],
  "propertyChanges": {
    "bedroomDelta": 0,
    "bathroomDelta": 0,
    "sqftDelta": 0,
    "reasoning": ""
  }
}

PART A — findings: Same as before. Identify every repair, defect, safety issue, or renovation line item for scope/contractor estimates.

PART B — propertyChanges (separate from findings): The investor's transcript may state PLANNED changes to the home's size or room count (not cosmetic remodels). Only fill non-zero deltas when the speaker clearly plans to:
- add, remove, or convert bedrooms (e.g. convert garage to bedroom, bedroom to closet, add a bedroom, finish basement as bedroom);
- add or remove full or half bathrooms (e.g. "add a half bath" → bathroomDelta 0.5, "add second full bath" → 1.0);
- add or remove square footage (e.g. stated addition "400 sq ft", or a conversion where they give a size).

Rules for propertyChanges:
- bedroomDelta, bathroomDelta, sqftDelta = NET change vs today. Use positive for additions, negative for removals (e.g. convert bedroom to closet → -1 bedroom).
- bathroomDelta may be half-increments (0.5) for a half bath.
- sqftDelta: be CONSERVATIVE. Use a non-zero number ONLY if the investor explicitly states a square footage number (e.g. "400 sqft addition" → 400, "adding 200 square feet" → 200). If the investor mentions a conversion or addition WITHOUT stating a size (e.g. "converting the garage", "finishing the basement", "adding a bedroom"), set sqftDelta to 0 and note in reasoning that sqft impact should be verified manually. Never guess or infer sqft from vague descriptions. When in doubt, use 0.
- If the transcript only describes normal remodels (kitchen, floors, paint, "update master bath" without adding/removing a bath) with NO change to bed/bath count or total sqft, leave ALL deltas 0 and reasoning "".
- reasoning: only if at least one delta is non-zero — 1-2 short sentences: what in the transcript justified the change.
- When in doubt, leave deltas at 0. False positives are worse than false negatives.`;

    // Collect all image frames
    const allFrames: string[] = [];
    for (const f of framesBase64) {
      allFrames.push(f);
    }
    for (const burst of videoBursts) {
      if (burst.base64) allFrames.push(burst.base64);
    }

    // Sample down to max 10 frames evenly
    let framesToSend: string[] = [];
    if (allFrames.length <= 10) {
      framesToSend = allFrames;
    } else {
      for (let i = 0; i < 10; i++) {
        const idx = Math.round((i / 9) * (allFrames.length - 1));
        framesToSend.push(allFrames[idx]);
      }
    }

    // Build Claude content array
    const content: unknown[] = [
      { type: "text", text: promptText }
    ];

    for (const frame of framesToSend) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: frame,
        },
      });
    }

    console.log(`Sending to Claude: ${framesToSend.length} frames, transcript_len=${transcript.length}`);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: content,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("Anthropic API error:", response.status, errBody);
      throw new Error(`Anthropic API error ${response.status}: ${errBody}`);
    }

    const apiData = await response.json() as { content: { type: string; text: string }[] };
    const rawText = apiData.content?.[0]?.text ?? "";
    console.log("Claude response length:", rawText.length);

    const cleaned = rawText
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/gi, "")
      .trim();

    let findings: Finding[] = [];
    let propertyChanges: PropertyChanges = { ...DEFAULT_PROPERTY_CHANGES };
    try {
      const out = parseClaudeJson(cleaned);
      findings = out.findings;
      propertyChanges = out.propertyChanges;
    } catch (parseErr) {
      console.error("JSON parse failed. Raw:", rawText);
      return new Response(
        JSON.stringify({ findings: [], propertyChanges: DEFAULT_PROPERTY_CHANGES, error: "JSON parse failed", raw: rawText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Ensure every field exists for clients
    const pc = normalizePropertyChanges(propertyChanges);
    propertyChanges = {
      bedroomDelta: pc.bedroomDelta,
      bathroomDelta: pc.bathroomDelta,
      sqftDelta: pc.sqftDelta,
      reasoning: pc.reasoning,
    };

    console.log(`Returning ${findings.length} findings, propertyChanges:`, JSON.stringify(propertyChanges));

    return new Response(
      JSON.stringify({ findings, propertyChanges }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Edge function error:", msg);
    return new Response(
      JSON.stringify({ findings: [], propertyChanges: DEFAULT_PROPERTY_CHANGES, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
