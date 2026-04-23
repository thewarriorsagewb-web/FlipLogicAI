import { useState, type CSSProperties } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2000,
  background: "rgba(0,0,0,0.88)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  overflowY: "auto",
  boxSizing: "border-box",
};

export function PaywallModal({
  isOpen,
  onClose,
  reason,
  supabaseClient,
  returnUrl,
}: {
  isOpen: boolean;
  onClose: () => void;
  reason: string;
  supabaseClient: SupabaseClient;
  returnUrl: string;
}) {
  const [loadingPlan, setLoadingPlan] = useState<"monthly" | "annual" | null>(null);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const startCheckout = async (priceLookupKey: "investor_monthly" | "investor_annual") => {
    setError("");
    setLoadingPlan(priceLookupKey === "investor_monthly" ? "monthly" : "annual");
    try {
      const { data, error: fnError } = await supabaseClient.functions.invoke("create-checkout-session", {
        body: { price_lookup_key: priceLookupKey, return_url: returnUrl },
      });
      if (fnError) {
        const detail = (fnError as unknown as { context?: { json?: () => Promise<unknown> } }).context?.json
          ? String(JSON.stringify(await (fnError as unknown as { context: { json: () => Promise<unknown> } }).context.json()))
          : fnError.message || String(fnError);
        throw new Error(detail);
      }
      const url = (data as { url?: string; error?: string })?.url;
      const serverErr = (data as { error?: string })?.error;
      if (serverErr) throw new Error(serverErr);
      if (!url) throw new Error("No checkout URL returned");
      window.location.href = url;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Checkout could not be started");
    } finally {
      setLoadingPlan(null);
    }
  };

  const card: CSSProperties = {
    background: "#0a0f1a",
    border: "1px solid #1e293b",
    borderRadius: 10,
    padding: 20,
    flex: "1 1 200px",
    maxWidth: 280,
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-labelledby="paywall-title">
      <style>{`@keyframes paySpin { to { transform: rotate(360deg); } }`}</style>
      <div
        style={{
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 12,
          padding: 28,
          maxWidth: 640,
          width: "100%",
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 36,
            height: 36,
            borderRadius: 8,
            border: "1px solid #1e293b",
            background: "#060b14",
            color: "#94a3b8",
            fontSize: 20,
            lineHeight: 1,
            cursor: "pointer",
            fontFamily: "'Syne', sans-serif",
          }}
        >
          ×
        </button>
        <h2 id="paywall-title" style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", margin: "0 0 8px 0", paddingRight: 40 }}>
          Upgrade to FlipLogic AI Investor
        </h2>
        <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.5, marginBottom: 24 }}>{reason}</p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center", marginBottom: 20 }}>
          <div style={card}>
            <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Monthly</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#f1f5f9", marginBottom: 4 }}>$49</div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 16 }}>per month</div>
            <button
              type="button"
              disabled={loadingPlan !== null}
              onClick={() => void startCheckout("investor_monthly")}
              style={{
                width: "100%",
                minHeight: 48,
                border: "none",
                borderRadius: 8,
                background: loadingPlan === "monthly" ? "#1e293b" : "linear-gradient(135deg, #1d4ed8, #1e40af)",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
                fontFamily: "'Syne', sans-serif",
                cursor: loadingPlan !== null ? "wait" : "pointer",
                opacity: loadingPlan !== null && loadingPlan !== "monthly" ? 0.5 : 1,
              }}
            >
              {loadingPlan === "monthly" ? <span style={{ display: "inline-block", width: 18, height: 18, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "paySpin 0.7s linear infinite" }} /> : "Start Monthly Plan"}
            </button>
          </div>
          <div style={card}>
            <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Annual</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#f1f5f9", marginBottom: 4 }}>$468</div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 4 }}>per year</div>
            <div style={{ fontSize: 12, color: "#22c55e", marginBottom: 16 }}>($39/mo equivalent) — Save 20%</div>
            <button
              type="button"
              disabled={loadingPlan !== null}
              onClick={() => void startCheckout("investor_annual")}
              style={{
                width: "100%",
                minHeight: 48,
                border: "none",
                borderRadius: 8,
                background: loadingPlan === "annual" ? "#1e293b" : "linear-gradient(135deg, #16a34a, #15803d)",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
                fontFamily: "'Syne', sans-serif",
                cursor: loadingPlan !== null ? "wait" : "pointer",
                opacity: loadingPlan !== null && loadingPlan !== "annual" ? 0.5 : 1,
              }}
            >
              {loadingPlan === "annual" ? <span style={{ display: "inline-block", width: 18, height: 18, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "paySpin 0.7s linear infinite" }} /> : "Start Annual Plan"}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: "#2a0a0a", border: "1px solid #dc2626", borderRadius: 8, padding: 12, fontSize: 13, color: "#f87171", marginBottom: 12 }}>{error}</div>
        )}

        <p style={{ fontSize: 11, color: "#475569", textAlign: "center", margin: 0 }}>Secure payment powered by Stripe. Cancel anytime.</p>
      </div>
    </div>
  );
}
