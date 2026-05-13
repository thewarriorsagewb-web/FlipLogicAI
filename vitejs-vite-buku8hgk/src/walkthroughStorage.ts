import type { SupabaseClient } from "@supabase/supabase-js";

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
