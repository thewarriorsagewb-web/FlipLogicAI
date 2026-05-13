import type { SupabaseClient } from "@supabase/supabase-js";
import type { VideoBurstMeta } from "./walkthroughTypes";

export function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

/**
 * Uploads walkthrough frame JPEGs (raw base64, no data: prefix) to deal-photos Storage.
 * Paths: `${userId}/${dealId}/walkthrough-frames/${uuid}.jpg`
 */
export async function uploadWalkthroughFrames(
  supabase: SupabaseClient,
  framesBase64: string[],
  dealId: string,
  userId: string,
): Promise<string[]> {
  const uploadOne = async (frameBase64: string): Promise<string> => {
    const bytes = decodeBase64ToUint8Array(frameBase64);
    const blob = new Blob([Uint8Array.from(bytes)], { type: "image/jpeg" });
    const path = `${userId}/${dealId}/walkthrough-frames/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from("deal-photos").upload(path, blob, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (error) {
      throw new Error(`Walkthrough frame upload failed (${path}): ${error.message}`);
    }
    return path;
  };
  return Promise.all(framesBase64.map((frame) => uploadOne(frame)));
}

function pickVideoMime(): string {
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")) return "video/webm;codecs=vp8,opus";
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")) return "video/webm;codecs=vp9,opus";
  return "video/webm";
}

/** One JPEG thumbnail per burst WebM, in burst capture order (audiovideo). */
export async function jpegBase64FromVideoBurstMeta(meta: VideoBurstMeta): Promise<string | null> {
  try {
    const raw = decodeBase64ToUint8Array(meta.base64);
    const vblob = new Blob([Uint8Array.from(raw)], { type: meta.mimeType || pickVideoMime() });
    const url = URL.createObjectURL(vblob);
    try {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        const to = window.setTimeout(() => reject(new Error("burst video load timeout")), 20000);
        video.onloadeddata = () => {
          window.clearTimeout(to);
          resolve();
        };
        video.onerror = () => {
          window.clearTimeout(to);
          reject(new Error("burst video load error"));
        };
      });
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
      video.currentTime = Math.min(0.25, dur * 0.05);
      await new Promise<void>((resolve, reject) => {
        const to = window.setTimeout(() => reject(new Error("burst seek timeout")), 10000);
        video.onseeked = () => {
          window.clearTimeout(to);
          resolve();
        };
      });
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      const w = Math.min(640, vw);
      const h = Math.min(480, vh);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
      const comma = dataUrl.indexOf(",");
      return comma >= 0 ? dataUrl.slice(comma + 1) : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e: unknown) {
    console.error("[walkthroughStorage] burst thumbnail extract failed:", e);
    return null;
  }
}
