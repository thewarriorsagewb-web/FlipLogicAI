export interface AIFinding {
  category: string;
  description: string;
  priority: "critical" | "important" | "optional";
  estimatedCost: number;
  notes: string;
  hazmat: boolean;
}

export type PropertyChanges = {
  bedroomDelta: number;
  bathroomDelta: number;
  sqftDelta: number;
  reasoning: string;
};

export const EMPTY_PROPERTY_CHANGES: PropertyChanges = {
  bedroomDelta: 0,
  bathroomDelta: 0,
  sqftDelta: 0,
  reasoning: "",
};

export function normalizePropertyChanges(input: unknown): PropertyChanges {
  if (input == null || typeof input !== "object") return { ...EMPTY_PROPERTY_CHANGES };
  const o = input as Record<string, unknown>;
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

/** Response from analyze-walkthrough Edge Function */
export type AnalyzeWalkthroughResponse = {
  findings: AIFinding[];
  propertyChanges?: PropertyChanges;
  error?: string;
  raw?: string;
};

export type WalkthroughCaptureMode = "photos" | "audio" | "video" | "audiovideo";

export interface WalkthroughFlag {
  atSec: number;
  source: "manual" | "voice";
}

/** Queued walkthrough payloads for offline → online sync */
export interface PendingWalkthroughJob {
  id: string;
  mode: "audio" | "video" | "audiovideo";
  createdAt: string;
  label: string;
  payload: Record<string, unknown>;
}

export interface VideoBurstMeta {
  atSec: number;
  base64: string;
  mimeType: string;
}
