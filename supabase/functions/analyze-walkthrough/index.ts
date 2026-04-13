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

If no transcript is provided and no images are attached, return an empty array.

Return ONLY a valid JSON array. No markdown, no explanation, no code blocks. Just the raw JSON array:
[
  {
    "category": "Foundation & Structure | Roof | Exterior | Windows & Doors | Plumbing | Electrical | HVAC | Insulation | Drywall & Paint | Flooring | Kitchen | Bathrooms | Landscaping | Permits & Fees | Cleanup & Hauling | Other",
    "description": "clear description of the issue or work needed",
    "priority": "critical | important | optional",
    "estimatedCost": 0,
    "notes": "specific observations or recommendations",
    "hazmat": false
  }
]`;

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
    try {
      findings = JSON.parse(cleaned) as Finding[];
      if (!Array.isArray(findings)) throw new Error("Response is not an array");
    } catch (parseErr) {
      console.error("JSON parse failed. Raw:", rawText);
      return new Response(
        JSON.stringify({ findings: [], error: "JSON parse failed", raw: rawText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Returning ${findings.length} findings`);

    return new Response(
      JSON.stringify({ findings }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Edge function error:", msg);
    return new Response(
      JSON.stringify({ findings: [], error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
