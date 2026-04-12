export interface AIFinding {
  category: string;
  description: string;
  priority: "critical" | "important" | "optional";
  estimatedCost: number;
  notes: string;
  hazmat: boolean;
}

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
