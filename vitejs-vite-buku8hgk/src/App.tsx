import { useState, useEffect, useRef, type CSSProperties } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AIFinding, WalkthroughCaptureMode, PendingWalkthroughJob } from "./walkthroughTypes";
import { WalkthroughMediaRecorder, WALKTHROUGH_TRIGGER_KEY, loadPendingJobs, savePendingJobs } from "./walkthroughMedia";
// ─── Supabase Client ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://gnygraconlpwzvllayoq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdueWdyYWNvbmxwd3p2bGxheW9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NjA4NzQsImV4cCI6MjA5MTUzNjg3NH0.fKZ0G0Q6jGxGrX-onuKmklB1HeSuxyWI3c3lkftOvkg";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────
interface DealInputs {
  propertyAddress: string;
  purchasePrice: number;
  rehabCost: number;
  arv: number;
  loanAmount: number;
  interestRate: number;
  loanTermMonths: number;
  holdingMonths: number;
  closingCostsBuy: number;
  closingCostsSell: number;
  monthlyRent: number;
  monthlyExpenses: number;
  notes: string;
  dealStatus: "prospect" | "active" | "closed" | "passed";
}

interface Comp {
  id: string; address: string; salePrice: number; sqft: number;
  bedBath: string; daysOnMarket: number; soldDate: string;
  strength: "strong" | "average" | "weak"; notes: string;
}

interface ScopeItem {
  id: string; category: string; description: string;
  quantity: number; unit: string; myEstimate: number;
  notes: string; priority: "critical" | "important" | "optional";
}

interface LenderInfo {
  investorName: string; investorCompany: string;
  investorPhone: string; investorEmail: string; lenderName: string;
}

interface WalkthroughPhoto {
  id: string;
  base64: string;
  mediaType: string;
  label: string;
  analyzed: boolean;
}

interface Deal {
  id: string; createdAt: string; updatedAt: string;
  inputs: DealInputs; comps: Comp[]; subjectSqft: number;
  lenderInfo: LenderInfo; scopeItems: ScopeItem[];
}

interface DealMetrics {
  totalProjectCost: number; ltc: number; ltv: number; dscr: number;
  equityPosition: number; equityPercent: number; grossProfit: number;
  netProfit: number; roi: number; monthlyPayment: number;
  totalHoldingCosts: number; dealScore: "HOT" | "WARM" | "COLD" | "DEAD";
}

interface Scenario { label: string; rehabMultiplier: number; arvMultiplier: number; }

const SCENARIOS: Scenario[] = [
  { label: "Best Case", rehabMultiplier: 0.9, arvMultiplier: 1.05 },
  { label: "Baseline", rehabMultiplier: 1.0, arvMultiplier: 1.0 },
  { label: "Worst Case", rehabMultiplier: 1.2, arvMultiplier: 0.95 },
];

const SCOPE_CATEGORIES = [
  "Foundation & Structure", "Roof", "Exterior", "Windows & Doors",
  "Plumbing", "Electrical", "HVAC", "Insulation",
  "Drywall & Paint", "Flooring", "Kitchen", "Bathrooms",
  "Landscaping", "Permits & Fees", "Cleanup & Hauling", "Other",
];

const BLANK_INPUTS: DealInputs = {
  propertyAddress: "", purchasePrice: 0, rehabCost: 0, arv: 0, loanAmount: 0,
  interestRate: 11.5, loanTermMonths: 12, holdingMonths: 6,
  closingCostsBuy: 0, closingCostsSell: 0, monthlyRent: 0, monthlyExpenses: 0,
  notes: "", dealStatus: "prospect",
};

const BLANK_LENDER_INFO: LenderInfo = {
  investorName: "", investorCompany: "", investorPhone: "", investorEmail: "", lenderName: "",
};

const DEMO_INPUTS: DealInputs = {
  propertyAddress: "123 Main St, Atlanta, GA 30301",
  purchasePrice: 120000, rehabCost: 45000, arv: 225000, loanAmount: 148500,
  interestRate: 11.5, loanTermMonths: 12, holdingMonths: 6,
  closingCostsBuy: 3500, closingCostsSell: 13500, monthlyRent: 1800, monthlyExpenses: 400,
  notes: "Solid bones. Needs full kitchen/bath remodel. Roof is 4 years old — good shape.",
  dealStatus: "prospect",
};

const DEMO_COMPS: Comp[] = [
  { id: "c1", address: "110 Elm St, Atlanta, GA", salePrice: 218000, sqft: 1450, bedBath: "3/2", daysOnMarket: 12, soldDate: "2025-11-15", strength: "strong", notes: "Same street, fully updated" },
  { id: "c2", address: "87 Oak Ave, Atlanta, GA", salePrice: 231000, sqft: 1550, bedBath: "3/2", daysOnMarket: 8, soldDate: "2025-10-22", strength: "strong", notes: "Corner lot premium" },
  { id: "c3", address: "204 Pine Rd, Atlanta, GA", salePrice: 209000, sqft: 1400, bedBath: "3/1", daysOnMarket: 31, soldDate: "2025-09-10", strength: "average", notes: "Only 1 bath, slightly weaker" },
];

const DEMO_SCOPE: ScopeItem[] = [
  { id: "s1", category: "Kitchen", description: "Full kitchen remodel", quantity: 1, unit: "lot", myEstimate: 18000, notes: "White shaker cabinets, quartz counters", priority: "critical" },
  { id: "s2", category: "Bathrooms", description: "Master bath full renovation", quantity: 1, unit: "lot", myEstimate: 8500, notes: "New tile, vanity, fixtures", priority: "critical" },
  { id: "s3", category: "Flooring", description: "LVP flooring throughout", quantity: 950, unit: "sqft", myEstimate: 5700, notes: "Waterproof LVP supply & install", priority: "critical" },
  { id: "s4", category: "HVAC", description: "HVAC system replacement", quantity: 1, unit: "unit", myEstimate: 6500, notes: "3-ton unit, 15 SEER", priority: "critical" },
  { id: "s5", category: "Electrical", description: "Panel upgrade to 200A", quantity: 1, unit: "lot", myEstimate: 3200, notes: "FPE panel replacement — hazard", priority: "critical" },
];

// ─── Financial Engine ─────────────────────────────────────────────────────────
function calculateMetrics(inputs: DealInputs): DealMetrics {
  const { purchasePrice, rehabCost, arv, loanAmount, interestRate, loanTermMonths, holdingMonths, closingCostsBuy, closingCostsSell, monthlyRent, monthlyExpenses } = inputs;
  const totalProjectCost = purchasePrice + rehabCost + closingCostsBuy;
  const monthlyRate = interestRate / 100 / 12;
  const monthlyPayment = loanTermMonths > 0 && monthlyRate > 0
    ? loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, loanTermMonths)) / (Math.pow(1 + monthlyRate, loanTermMonths) - 1) : 0;
  const totalHoldingCosts = monthlyPayment * holdingMonths;
  const ltc = totalProjectCost > 0 ? (loanAmount / totalProjectCost) * 100 : 0;
  const ltv = arv > 0 ? (loanAmount / arv) * 100 : 0;
  const dscr = monthlyPayment > 0 ? (monthlyRent - monthlyExpenses) / monthlyPayment : 0;
  const equityPosition = arv - loanAmount;
  const equityPercent = arv > 0 ? (equityPosition / arv) * 100 : 0;
  const grossProfit = arv - purchasePrice - rehabCost;
  const netProfit = grossProfit - closingCostsBuy - closingCostsSell - totalHoldingCosts;
  const roi = totalProjectCost > 0 ? (netProfit / totalProjectCost) * 100 : 0;
  let dealScore: DealMetrics["dealScore"] = "DEAD";
  if (roi >= 20 && ltv <= 70 && netProfit > 0) dealScore = "HOT";
  else if (roi >= 12 && ltv <= 80 && netProfit > 0) dealScore = "WARM";
  else if (roi >= 5 && netProfit > 0) dealScore = "COLD";
  return { totalProjectCost, ltc, ltv, dscr, equityPosition, equityPercent, grossProfit, netProfit, roi, monthlyPayment, totalHoldingCosts, dealScore };
}

function calculateCompARV(comps: Comp[], subjectSqft: number) {
  const valid = comps.filter((c) => c.salePrice > 0 && c.sqft > 0);
  if (valid.length === 0) return { weightedArv: 0, avgPpsf: 0, strongAvg: 0, allAvg: 0 };
  const weights = { strong: 3, average: 2, weak: 1 };
  let weightedSum = 0, totalWeight = 0;
  valid.forEach((c) => { const ppsf = c.salePrice / c.sqft; const w = weights[c.strength]; weightedSum += ppsf * w; totalWeight += w; });
  const avgPpsf = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const weightedArv = subjectSqft > 0 ? avgPpsf * subjectSqft : valid.reduce((s, c) => s + c.salePrice, 0) / valid.length;
  const strong = valid.filter((c) => c.strength === "strong");
  const strongAvg = strong.length > 0 ? strong.reduce((s, c) => s + c.salePrice, 0) / strong.length : 0;
  const allAvg = valid.reduce((s, c) => s + c.salePrice, 0) / valid.length;
  return { weightedArv, avgPpsf, strongAvg, allAvg };
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const uid = () => Math.random().toString(36).slice(2, 10);

const SCORE_STYLES: Record<DealMetrics["dealScore"], { bg: string; text: string; border: string }> = {
  HOT: { bg: "#0d3d1f", text: "#22c55e", border: "#16a34a" },
  WARM: { bg: "#2d2000", text: "#f59e0b", border: "#d97706" },
  COLD: { bg: "#0c1a2e", text: "#60a5fa", border: "#3b82f6" },
  DEAD: { bg: "#2a0a0a", text: "#f87171", border: "#dc2626" },
};

const STATUS_STYLES: Record<DealInputs["dealStatus"], { color: string }> = {
  prospect: { color: "#94a3b8" }, active: { color: "#f59e0b" },
  closed: { color: "#22c55e" }, passed: { color: "#475569" },
};

const STRENGTH_STYLES = {
  strong: { color: "#22c55e", bg: "#0d3d1f", border: "#16a34a", label: "Strong" },
  average: { color: "#f59e0b", bg: "#2d2000", border: "#d97706", label: "Average" },
  weak: { color: "#94a3b8", bg: "#1e293b", border: "#334155", label: "Weak" },
};

const PRIORITY_STYLES = {
  critical: { color: "#f87171", bg: "#2a0a0a", border: "#dc2626", label: "Critical" },
  important: { color: "#f59e0b", bg: "#2d2000", border: "#d97706", label: "Important" },
  optional: { color: "#60a5fa", bg: "#0c1a2e", border: "#3b82f6", label: "Optional" },
};

const MOBILE_BREAKPOINT = 768;
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = async () => {
    if (!email || !password) { setError("Please enter email and password."); return; }
    setLoading(true); setError(""); setMessage("");
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage("Account created! Please check your email to verify your account, then sign in below.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth();
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT);
  useEffect(() => {
    const q = () => setNarrow(window.innerWidth < MOBILE_BREAKPOINT);
    q();
    window.addEventListener("resize", q);
    return () => window.removeEventListener("resize", q);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#060b14", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", padding: narrow ? "16px 12px" : 0, boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 400, padding: narrow ? "28px 20px" : 40, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 12, boxSizing: "border-box" }}>
        <div style={{ textAlign: "center", marginBottom: narrow ? 24 : 32 }}>
          <div style={{ fontSize: narrow ? 24 : 28, fontWeight: 800, color: "#f1f5f9", marginBottom: 6 }}>
            FLIP<span style={{ color: "#3b82f6" }}>LOGIC</span> AI
          </div>
          <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.15em" }}>COMMAND CENTER · DEAL ANALYZER</div>
        </div>

        <div style={{ display: "flex", marginBottom: 24, background: "#060b14", borderRadius: 8, padding: 4 }}>
          {(["signin", "signup"] as const).map((m) => (
            <button key={m} onClick={() => { setMode(m); setError(""); setMessage(""); }}
              style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Syne', sans-serif", letterSpacing: "0.05em",
                background: mode === m ? "#1d4ed8" : "transparent", color: mode === m ? "#fff" : "#475569" }}>
              {m === "signin" ? "SIGN IN" : "CREATE ACCOUNT"}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="you@example.com"
            style={{ width: "100%", background: "#060b14", border: "1px solid #1e293b", borderRadius: 6, color: "#f1f5f9", padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="••••••••"
            style={{ width: "100%", background: "#060b14", border: "1px solid #1e293b", borderRadius: 6, color: "#f1f5f9", padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
        </div>

        {error && <div style={{ background: "#2a0a0a", border: "1px solid #dc2626", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#f87171", marginBottom: 14 }}>{error}</div>}
        {message && <div style={{ background: "#0d3d1f", border: "1px solid #16a34a", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#22c55e", marginBottom: 14 }}>{message}</div>}

        <button type="button" onClick={handleSubmit} disabled={loading}
          style={{ width: "100%", background: loading ? "#1e293b" : "linear-gradient(135deg, #1d4ed8, #1e40af)", border: "none", borderRadius: 8, color: "#fff", padding: narrow ? "14px 0" : "12px 0", minHeight: narrow ? 48 : undefined, fontSize: narrow ? 14 : 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: "'Syne', sans-serif", letterSpacing: "0.05em" }}>
          {loading ? "Please wait..." : mode === "signin" ? "SIGN IN" : "CREATE ACCOUNT"}
        </button>

        <div style={{ marginTop: 20, fontSize: 11, color: "#334155", textAlign: "center", lineHeight: 1.6 }}>
          Your deals are encrypted and synced across all your devices.
        </div>
      </div>
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function InputField({ label, value, onChange, prefix = "$", suffix = "", isMobile = false }: {
  label: string; value: number; onChange: (v: number) => void; prefix?: string; suffix?: string; isMobile?: boolean;
}) {
  const pad = isMobile ? "12px 14px" : "8px 10px";
  const minH = isMobile ? 44 : undefined;
  return (
    <div style={{ marginBottom: isMobile ? 14 : 12 }}>
      <label style={{ display: "block", fontSize: isMobile ? 12 : 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, overflow: "hidden", width: "100%", minHeight: minH }}>
        {prefix && <span style={{ padding: pad, color: "#475569", fontSize: isMobile ? 14 : 13, background: "#0a0f1a", borderRight: "1px solid #1e293b", display: "flex", alignItems: "center", minHeight: minH }}>{prefix}</span>}
        <input type="number" value={value || ""} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          style={{ flex: 1, width: "100%", minWidth: 0, background: "transparent", border: "none", outline: "none", color: "#f1f5f9", padding: pad, fontSize: isMobile ? 16 : 14, fontFamily: "'JetBrains Mono', monospace", minHeight: minH, boxSizing: "border-box" }} />
        {suffix && <span style={{ padding: pad, color: "#475569", fontSize: isMobile ? 14 : 13, background: "#0a0f1a", borderLeft: "1px solid #1e293b", display: "flex", alignItems: "center", minHeight: minH }}>{suffix}</span>}
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, highlight = false, isMobile = false }: { label: string; value: string; sub?: string; highlight?: boolean; isMobile?: boolean }) {
  return (
    <div style={{ background: highlight ? "#0d1f35" : "#0a0f1a", border: `1px solid ${highlight ? "#1d4ed8" : "#1e293b"}`, borderRadius: 8, padding: isMobile ? "14px 14px" : "14px 16px", minHeight: isMobile ? 72 : undefined }}>
      <div style={{ fontSize: isMobile ? 11 : 10, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: isMobile ? 20 : 22, fontWeight: 700, color: highlight ? "#60a5fa" : "#f1f5f9", fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ScenarioRow({ scenario, inputs, isMobile = false }: { scenario: Scenario; inputs: DealInputs; isMobile?: boolean }) {
  const m = calculateMetrics({ ...inputs, rehabCost: inputs.rehabCost * scenario.rehabMultiplier, arv: inputs.arv * scenario.arvMultiplier });
  const score = SCORE_STYLES[m.dealScore];
  if (isMobile) {
    return (
      <div style={{ padding: "12px 14px", background: "#0a0f1a", borderRadius: 8, border: "1px solid #1e293b", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#cbd5e1", fontSize: 14, fontWeight: 700 }}>{scenario.label}</span>
          <div style={{ background: score.bg, color: score.text, border: `1px solid ${score.border}`, borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 700, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>{m.dealScore}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>Net Profit</div><div style={{ color: "#f1f5f9", fontSize: 14, fontFamily: "monospace" }}>{fmt(m.netProfit)}</div></div>
          <div><div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>ROI</div><div style={{ color: m.roi >= 15 ? "#22c55e" : m.roi >= 8 ? "#f59e0b" : "#f87171", fontSize: 14, fontFamily: "monospace" }}>{fmtPct(m.roi)}</div></div>
          <div style={{ gridColumn: "1 / -1" }}><div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>LTV</div><div style={{ color: "#94a3b8", fontSize: 14, fontFamily: "monospace" }}>{fmtPct(m.ltv)}</div></div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 80px", gap: 8, alignItems: "center", padding: "10px 14px", background: "#0a0f1a", borderRadius: 6, border: "1px solid #1e293b" }}>
      <div style={{ color: "#cbd5e1", fontSize: 13 }}>{scenario.label}</div>
      <div style={{ color: "#f1f5f9", fontSize: 13, fontFamily: "monospace" }}>{fmt(m.netProfit)}</div>
      <div style={{ color: m.roi >= 15 ? "#22c55e" : m.roi >= 8 ? "#f59e0b" : "#f87171", fontSize: 13, fontFamily: "monospace" }}>{fmtPct(m.roi)}</div>
      <div style={{ color: "#94a3b8", fontSize: 13, fontFamily: "monospace" }}>{fmtPct(m.ltv)} LTV</div>
      <div style={{ background: score.bg, color: score.text, border: `1px solid ${score.border}`, borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 700, textAlign: "center" }}>{m.dealScore}</div>
    </div>
  );
}

// ─── AI WALKTHROUGH TAB ───────────────────────────────────────────────────────
function AIWalkthroughTab({ address, buildYear, onAddToScope, isMobile = false, dealId, userId }: {
  address: string; buildYear: number; onAddToScope: (items: ScopeItem[]) => void; isMobile?: boolean;
  dealId: string; userId: string;
}) {
  const [walkMode, setWalkMode] = useState<WalkthroughCaptureMode>("photos");
  const [triggerPhrase, setTriggerPhrase] = useState(() => localStorage.getItem(WALKTHROUGH_TRIGGER_KEY) || "flag this");
  const [pendingJobs, setPendingJobs] = useState<PendingWalkthroughJob[]>(() => loadPendingJobs());
  const [syncingJobId, setSyncingJobId] = useState<string | null>(null);
  const [mediaAnalyzing, setMediaAnalyzing] = useState(false);

  const [photos, setPhotos] = useState<WalkthroughPhoto[]>([]);
  const [findings, setFindings] = useState<AIFinding[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [selectedFindings, setSelectedFindings] = useState<Set<number>>(new Set());
  const [buildYearInput, setBuildYearInput] = useState(buildYear || 1970);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const iv = window.setInterval(() => setPendingJobs(loadPendingJobs()), 2000);
    return () => window.clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!dealId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("walkthrough_findings")
        .select("findings, transcript")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (cancelled) return;
      if (error) {
        const code = (error as { code?: string }).code;
        if (code === "PGRST116") return;
        return;
      }
      const loaded = data?.findings;
      if (Array.isArray(loaded) && loaded.length > 0) {
        setFindings(loaded as AIFinding[]);
        setSelectedFindings(new Set(loaded.map((_: unknown, i: number) => i)));
      }
    })();
    return () => { cancelled = true; };
  }, [dealId]);

  useEffect(() => {
    setFindings([]);
    setSelectedFindings(new Set());
    setError("");
    setStatus("");
  }, [walkMode]);

  const saveTriggerPhrase = (t: string) => {
    setTriggerPhrase(t);
    localStorage.setItem(WALKTHROUGH_TRIGGER_KEY, t);
  };

  const syncPendingJob = async (job: PendingWalkthroughJob) => {
    if (!navigator.onLine) return;
    setSyncingJobId(job.id);
    setError("");
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("analyze-walkthrough", { body: job.payload });
      if (fnErr) throw new Error(fnErr.message || String(fnErr));
      const parsed = (data as { findings?: AIFinding[] })?.findings;
      if (!parsed || !Array.isArray(parsed)) throw new Error("Invalid response from analyze-walkthrough");
      setFindings(parsed);
      setSelectedFindings(new Set(parsed.map((_, i) => i)));
      setStatus(`Synced — ${parsed.length} findings identified.`);
      const next = loadPendingJobs().filter((j) => j.id !== job.id);
      savePendingJobs(next);
      setPendingJobs(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncingJobId(null);
    }
  };

  const handlePhotos = async (files: FileList) => {
    const newPhotos: WalkthroughPhoto[] = [];
    for (let i = 0; i < Math.min(files.length, 8); i++) {
      const file = files[i];
      const base64 = await new Promise<string>((res) => {
        const reader = new FileReader();
        reader.onload = () => res((reader.result as string).split(",")[1]);
        reader.readAsDataURL(file);
      });
      newPhotos.push({ id: uid(), base64, mediaType: file.type, label: file.name, analyzed: false });
    }
    setPhotos((prev) => [...prev, ...newPhotos].slice(0, 8));
  };

  const analyze = async () => {
    if (photos.length === 0) { setError("Please upload at least one property photo."); return; }
    setAnalyzing(true);
    setError("");
    setFindings([]);
    setSelectedFindings(new Set());
    setStatus("Sending photos to Claude AI for analysis...");
    try {
      const b64 = photos.map((p) => p.base64);
      const payload = {
        mode: "photos",
        propertyAddress: address,
        buildYear: buildYearInput,
        videoFrames: b64,
        framesBase64: b64,
        flagTimestamps: [] as number[],
        transcript: "",
      };
      const { data, error: fnErr } = await supabase.functions.invoke("analyze-walkthrough", { body: payload });
      if (fnErr) {
        const detail = (fnErr as unknown as { context?: { json?: () => Promise<unknown> } }).context?.json
          ? JSON.stringify(await (fnErr as unknown as { context: { json: () => Promise<unknown> } }).context.json())
          : fnErr.message || String(fnErr);
        throw new Error(detail);
      }
      const findings = (data as { findings?: AIFinding[]; error?: string })?.findings;
      const serverError = (data as { error?: string })?.error;
      if (serverError) throw new Error(serverError);
      if (!findings || !Array.isArray(findings)) throw new Error("Invalid response: " + JSON.stringify(data));
      setFindings(findings);
      setSelectedFindings(new Set(findings.map((_, i) => i)));
      setStatus(`Analysis complete — ${findings.length} findings identified.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleFinding = (i: number) => {
    setSelectedFindings((prev) => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; });
  };

  const handleAddToScope = () => {
    const items: ScopeItem[] = Array.from(selectedFindings).map((i) => {
      const f = findings[i];
      return { id: uid(), category: f.category, description: f.description, quantity: 1, unit: "lot", myEstimate: f.estimatedCost, notes: f.notes + (f.hazmat ? " ⚠ HAZMAT FLAG" : ""), priority: f.priority };
    });
    onAddToScope(items);
  };

  const hazmatFindings = findings.filter((f) => f.hazmat);
  const totalEstimate = findings.filter((_, i) => selectedFindings.has(i)).reduce((s, f) => s + f.estimatedCost, 0);

  const modeTabs: { id: WalkthroughCaptureMode; label: string }[] = [
    { id: "photos", label: "📸 Photos" },
    { id: "audio", label: "🎙️ Audio" },
    { id: "video", label: "🎥 Video" },
    { id: "audiovideo", label: "🎙️+🎥 Audio + Video" },
  ];

  const howItWorksByMode: Record<WalkthroughCaptureMode, { icon: string; text: string }[]> = {
    photos: [
      { icon: "1️⃣", text: "Photos are analyzed securely via FlipLogic AI — no API key required" },
      { icon: "2️⃣", text: "Upload up to 8 photos of the property — drag and drop or tap to select" },
      { icon: "3️⃣", text: "Set the property build year above — pre-1978 homes automatically trigger lead paint warnings" },
      { icon: "4️⃣", text: "Tap Analyze Photos — AI identifies every repair item visible in your photos and estimates costs" },
    ],
    audio: [
      { icon: "1️⃣", text: "Set your trigger phrase above (default: 'flag this') — say it out loud during the walk to automatically flag important moments" },
      { icon: "2️⃣", text: "Tap Record and walk the property. Speak naturally — describe everything you see out loud" },
      { icon: "3️⃣", text: "Tap 🚩 Flag This or say your trigger phrase to mark moments that need attention" },
      { icon: "4️⃣", text: "Tap Stop then Analyze Walkthrough — AI transcribes your audio and generates a scope of work" },
    ],
    video: [
      { icon: "1️⃣", text: "Set your trigger phrase above (default: 'flag this') — say it out loud during the walk to automatically flag important moments" },
      { icon: "2️⃣", text: "Tap Record — uses your rear camera with frames captured every 3 seconds alongside your audio" },
      { icon: "3️⃣", text: "Speak naturally and describe what you see. Tap 🚩 Flag This or say your trigger phrase to mark key moments" },
      { icon: "4️⃣", text: "Tap Stop then Analyze Walkthrough — AI analyzes both your audio transcript and video frames" },
    ],
    audiovideo: [
      { icon: "1️⃣", text: "Set your trigger phrase above (default: 'flag this') — say it out loud during the walk to automatically flag important moments" },
      { icon: "2️⃣", text: "Tap Record for continuous audio. Tap 🎥 Capture Video for 5-second video bursts at key moments" },
      { icon: "3️⃣", text: "Speak naturally and describe what you see. Tap 🚩 Flag This or say your trigger phrase to mark key moments" },
      { icon: "4️⃣", text: "Tap Stop then Analyze Walkthrough — AI uses your full audio timeline plus video bursts" },
    ],
  };

  const tabBtnBase = {
    flex: isMobile ? "1 1 45%" : "1 1 0",
    minHeight: 60,
    borderRadius: 10,
    border: "1px solid #1e293b",
    fontWeight: 700 as const,
    fontFamily: "'Syne', sans-serif",
    cursor: "pointer" as const,
    fontSize: isMobile ? 14 : 13,
    padding: "0 10px",
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
        {modeTabs.map((m) => {
          const active = walkMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setWalkMode(m.id)}
              style={{
                ...tabBtnBase,
                background: active ? "linear-gradient(135deg, #1e3a5f, #0f172a)" : "#0a0f1a",
                color: active ? "#e2e8f0" : "#64748b",
                borderColor: active ? "#3b82f6" : "#1e293b",
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {pendingJobs.length > 0 && (
        <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 14, marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Pending unsynced recordings</div>
          {pendingJobs.map((job) => (
            <div key={job.id} style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: 10, padding: "10px 0", borderTop: "1px solid #0f172a" }}>
              <div style={{ flex: 1, fontSize: 13, color: "#cbd5e1" }}>{job.label}</div>
              <button
                type="button"
                disabled={!navigator.onLine || syncingJobId === job.id}
                onClick={() => void syncPendingJob(job)}
                style={{
                  minHeight: 60,
                  borderRadius: 10,
                  border: "none",
                  fontWeight: 700,
                  fontFamily: "'Syne', sans-serif",
                  cursor: !navigator.onLine || syncingJobId === job.id ? "not-allowed" : "pointer",
                  fontSize: 14,
                  padding: "0 20px",
                  background: navigator.onLine ? "#1d4ed8" : "#334155",
                  color: "#fff",
                  opacity: navigator.onLine ? 1 : 0.5,
                }}
              >
                {syncingJobId === job.id ? "Syncing…" : "Sync"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 340px", gap: isMobile ? 20 : 24 }}>
        <div>
          <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: 16, marginBottom: 16, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: isMobile ? 14 : 14 }}>
            <div>
              <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Property Build Year</div>
              <div style={{ display: "flex", alignItems: "center", background: "#060b14", border: `1px solid ${buildYearInput < 1978 ? "#d97706" : "#1e293b"}`, borderRadius: 6, overflow: "hidden", width: isMobile ? "100%" : 120, minHeight: isMobile ? 44 : undefined }}>
                <input type="number" value={buildYearInput} onChange={(e) => setBuildYearInput(parseInt(e.target.value) || 1970)}
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#f1f5f9", padding: isMobile ? "12px 14px" : "8px 10px", fontSize: isMobile ? 16 : 14, fontFamily: "monospace" }} />
              </div>
            </div>
            {buildYearInput < 1978 && <div style={{ background: "#2d2000", border: "1px solid #d97706", borderRadius: 6, padding: "10px 14px", fontSize: isMobile ? 12 : 11, color: "#f59e0b", lineHeight: 1.45 }}>⚠ Pre-1978 build — AI will flag lead paint risk automatically</div>}
          </div>

          {walkMode === "photos" && (
            <>
              <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handlePhotos(e.dataTransfer.files); }}
                style={{ border: "2px dashed #1e293b", borderRadius: 8, padding: isMobile ? "28px 16px" : "32px 20px", textAlign: "center", cursor: "pointer", marginBottom: 16, background: "#0a0f1a", minHeight: isMobile ? 120 : undefined }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#3b82f6")} onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#1e293b")}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📸</div>
                <div style={{ fontSize: isMobile ? 15 : 14, color: "#94a3b8", marginBottom: 4 }}>Drop property photos here or click to upload</div>
                <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569" }}>Up to 8 photos · JPG, PNG, WEBP</div>
                <input ref={fileRef} type="file" multiple accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files && handlePhotos(e.target.files)} />
              </div>

              {photos.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
                  {photos.map((p) => (
                    <div key={p.id} style={{ position: "relative", borderRadius: 6, overflow: "hidden", aspectRatio: "1", background: "#0a0f1a", border: "1px solid #1e293b" }}>
                      <img src={`data:${p.mediaType};base64,${p.base64}`} alt={p.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <button onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))} style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.7)", border: "none", color: "#f87171", borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: 12 }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              <button type="button" onClick={analyze} disabled={analyzing || photos.length === 0}
                style={{ width: "100%", border: "none", borderRadius: 8, color: "#fff", padding: isMobile ? "16px 16px" : "14px 0", minHeight: isMobile ? 48 : undefined, fontSize: isMobile ? 15 : 14, fontWeight: 700, cursor: analyzing || photos.length === 0 ? "not-allowed" : "pointer", fontFamily: "'Syne', sans-serif", marginBottom: 8,
                  background: analyzing || photos.length === 0 ? "#1e293b" : "linear-gradient(135deg, #7c3aed, #6d28d9)", opacity: analyzing || photos.length === 0 ? 0.5 : 1 }}>
                {analyzing ? "🔍 Analyzing..." : `🤖 Analyze ${photos.length > 0 ? photos.length + " Photo" + (photos.length > 1 ? "s" : "") : "Photos"} with AI`}
              </button>
            </>
          )}

          {walkMode !== "photos" && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Voice trigger phrase</div>
              <input
                type="text"
                value={triggerPhrase}
                onChange={(e) => saveTriggerPhrase(e.target.value)}
                placeholder="flag this"
                style={{ width: "100%", boxSizing: "border-box", minHeight: 48, background: "#060b14", border: "1px solid #1e293b", borderRadius: 8, color: "#f1f5f9", padding: "12px 14px", fontSize: 15, marginBottom: 14 }}
              />
              <WalkthroughMediaRecorder
                key={walkMode}
                mode={walkMode as "audio" | "video" | "audiovideo"}
                address={address}
                buildYear={buildYearInput}
                isMobile={isMobile}
                supabase={supabase}
                triggerPhrase={triggerPhrase}
                dealId={dealId}
                userId={userId}
                onFindings={(f) => {
                  setFindings(f);
                  setSelectedFindings(new Set(f.map((_, i) => i)));
                  setStatus(`Analysis complete — ${f.length} findings identified.`);
                }}
                onAnalyzing={setMediaAnalyzing}
              />
            </div>
          )}

          {status && !analyzing && !mediaAnalyzing && <div style={{ background: "#0d3d1f", border: "1px solid #16a34a", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#22c55e", marginBottom: 12 }}>✓ {status}</div>}
          {error && <div style={{ background: "#2a0a0a", border: "1px solid #dc2626", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#f87171", marginBottom: 12 }}>✗ {error}</div>}

          {findings.length > 0 && (
            <div>
              <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between", gap: isMobile ? 10 : 0, marginBottom: 12 }}>
                <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" }}>AI Findings — Select items to add to Scope</div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button type="button" onClick={() => setSelectedFindings(new Set(findings.map((_, i) => i)))} style={{ background: "transparent", border: "1px solid #1e293b", borderRadius: 6, color: "#94a3b8", padding: isMobile ? "10px 14px" : "4px 10px", minHeight: isMobile ? 44 : undefined, fontSize: isMobile ? 13 : 11, cursor: "pointer" }}>All</button>
                  <button type="button" onClick={() => setSelectedFindings(new Set())} style={{ background: "transparent", border: "1px solid #1e293b", borderRadius: 6, color: "#94a3b8", padding: isMobile ? "10px 14px" : "4px 10px", minHeight: isMobile ? 44 : undefined, fontSize: isMobile ? 13 : 11, cursor: "pointer" }}>None</button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {findings.map((f, i) => {
                  const p = PRIORITY_STYLES[f.priority]; const selected = selectedFindings.has(i);
                  return (
                    <div key={i} onClick={() => toggleFinding(i)} style={{ background: selected ? "#0d1829" : "#0a0f1a", border: `1px solid ${selected ? p.border : "#1e293b"}`, borderRadius: 8, padding: 14, cursor: "pointer" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${selected ? "#3b82f6" : "#334155"}`, background: selected ? "#3b82f6" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff" }}>{selected ? "✓" : ""}</div>
                          {f.hazmat && <span style={{ background: "#2d2000", border: "1px solid #d97706", borderRadius: 3, padding: "1px 6px", fontSize: 9, color: "#f59e0b", fontWeight: 700 }}>⚠ HAZMAT</span>}
                          <span style={{ background: p.bg, border: `1px solid ${p.border}`, borderRadius: 3, padding: "1px 6px", fontSize: 9, color: p.color, fontWeight: 700 }}>{p.label}</span>
                          <span style={{ fontSize: 11, color: "#60a5fa" }}>{f.category}</span>
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#22c55e", fontFamily: "monospace" }}>{fmt(f.estimatedCost)}</span>
                      </div>
                      <div style={{ fontSize: 13, color: "#f1f5f9", marginBottom: 4 }}>{f.description}</div>
                      {f.notes && <div style={{ fontSize: 11, color: "#64748b" }}>{f.notes}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>AI Analysis Summary</div>
          {findings.length === 0 && (
            <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12, fontWeight: 700, textTransform: "uppercase" }}>How It Works</div>
              {howItWorksByMode[walkMode].map((item, idx) => (
                <div key={idx} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                  <span style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{item.text}</span>
                </div>
              ))}
            </div>
          )}
          {findings.length > 0 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <MetricCard label="Total Findings" value={`${findings.length}`} sub="items identified" isMobile={isMobile} />
                <MetricCard label="Selected Est." value={fmt(totalEstimate)} highlight isMobile={isMobile} />
                <MetricCard label="Critical Items" value={`${findings.filter(f => f.priority === "critical").length}`} sub="need attention" isMobile={isMobile} />
                <MetricCard label="Hazmat Flags" value={`${hazmatFindings.length}`} sub={hazmatFindings.length > 0 ? "⚠ Review required" : "None detected"} isMobile={isMobile} />
              </div>
              {hazmatFindings.length > 0 && (
                <div style={{ background: "#2d2000", border: "1px solid #d97706", borderRadius: 8, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700, marginBottom: 8 }}>⚠ Hazmat Findings Detected</div>
                  {hazmatFindings.map((f, i) => <div key={i} style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>• {f.description}</div>)}
                </div>
              )}
              <button type="button" onClick={handleAddToScope} disabled={selectedFindings.size === 0 || analyzing || mediaAnalyzing}
                style={{ width: "100%", border: "none", borderRadius: 8, color: "#fff", padding: isMobile ? "16px 16px" : "14px 0", minHeight: isMobile ? 48 : undefined, fontSize: isMobile ? 14 : 13, fontWeight: 700, cursor: selectedFindings.size === 0 || analyzing || mediaAnalyzing ? "not-allowed" : "pointer", fontFamily: "'Syne', sans-serif", marginBottom: 8,
                  background: selectedFindings.size === 0 || analyzing || mediaAnalyzing ? "#1e293b" : "linear-gradient(135deg, #16a34a, #15803d)", opacity: selectedFindings.size === 0 || analyzing || mediaAnalyzing ? 0.5 : 1 }}>
                + Add {selectedFindings.size} Item{selectedFindings.size !== 1 ? "s" : ""} to Scope of Work
              </button>
              <button type="button" onClick={() => { setFindings([]); if (walkMode === "photos") setPhotos([]); setStatus(""); setSelectedFindings(new Set()); }}
                style={{ width: "100%", background: "transparent", border: "1px solid #1e293b", borderRadius: 8, color: "#475569", padding: isMobile ? "14px 16px" : "10px 0", minHeight: isMobile ? 44 : undefined, fontSize: isMobile ? 14 : 12, cursor: "pointer" }}>
                Clear & Start New Analysis
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Comp Card ────────────────────────────────────────────────────────────────
function CompCard({ comp, onUpdate, onDelete, isMobile = false }: { comp: Comp; onUpdate: (u: Partial<Comp>) => void; onDelete: () => void; isMobile?: boolean }) {
  const ppsf = comp.salePrice > 0 && comp.sqft > 0 ? comp.salePrice / comp.sqft : 0;
  const strength = STRENGTH_STYLES[comp.strength];
  const fs = { background: "#060b14", border: "1px solid #1e293b", borderRadius: 4, color: "#f1f5f9", padding: isMobile ? "12px 10px" : "6px 8px", fontSize: isMobile ? 15 : 12, fontFamily: "monospace", outline: "none", width: "100%", boxSizing: "border-box" as const, minHeight: isMobile ? 44 : undefined };
  return (
    <div style={{ background: "#0a0f1a", border: `1px solid ${strength.border}`, borderRadius: 8, padding: isMobile ? 16 : 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["strong", "average", "weak"] as const).map((s) => (
            <button type="button" key={s} onClick={() => onUpdate({ strength: s })} style={{ padding: isMobile ? "10px 12px" : "3px 10px", minHeight: isMobile ? 44 : undefined, borderRadius: 4, fontSize: isMobile ? 12 : 10, fontWeight: 700, cursor: "pointer", border: `1px solid ${comp.strength === s ? STRENGTH_STYLES[s].border : "#1e293b"}`, background: comp.strength === s ? STRENGTH_STYLES[s].bg : "transparent", color: comp.strength === s ? STRENGTH_STYLES[s].color : "#475569", fontFamily: "'Syne', sans-serif" }}>
              {STRENGTH_STYLES[s].label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onDelete} style={{ background: "#2a0a0a", border: "1px solid #dc2626", borderRadius: 6, color: "#f87171", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: "8px 14px", minWidth: 44, minHeight: 44, fontFamily: "'Syne', sans-serif" }} aria-label="Remove comp">🗑 Remove</button>
      </div>
      <input type="text" value={comp.address} placeholder="Address..." onChange={(e) => onUpdate({ address: e.target.value })} style={{ ...fs, marginBottom: 8, color: "#94a3b8" }} />
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
        {[{ label: "Sale Price", val: comp.salePrice, key: "salePrice", type: "number" }, { label: "Sq Ft", val: comp.sqft, key: "sqft", type: "number" }, { label: "Bed/Bath", val: comp.bedBath, key: "bedBath", type: "text" }, { label: "DOM", val: comp.daysOnMarket, key: "daysOnMarket", type: "number" }, { label: "Sold Date", val: comp.soldDate, key: "soldDate", type: "text" }].map((f) => (
          <div key={f.key}>
            <div style={{ fontSize: 10, color: "#475569", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>{f.label}</div>
            <input type={f.type} value={f.val || ""} onChange={(e) => onUpdate({ [f.key]: f.type === "number" ? parseFloat(e.target.value) || 0 : e.target.value } as Partial<Comp>)} style={fs} />
          </div>
        ))}
        <div>
          <div style={{ fontSize: 10, color: "#475569", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>$/SqFt</div>
          <div style={{ ...fs, color: ppsf > 0 ? "#60a5fa" : "#334155" }}>{ppsf > 0 ? `$${ppsf.toFixed(0)}` : "—"}</div>
        </div>
      </div>
      <input type="text" value={comp.notes} placeholder="Notes..." onChange={(e) => onUpdate({ notes: e.target.value })} style={{ ...fs, color: "#64748b" }} />
    </div>
  );
}

// ─── Comps Tab ────────────────────────────────────────────────────────────────
function CompsTab({ comps, subjectSqft, enteredArv, onAddComp, onUpdateComp, onDeleteComp, onUpdateSubjectSqft, onApplyArv, onAddMultipleComps, onApplyRent, supabase, dealId: _dealId, propertyAddress, isMobile = false }: {
  comps: Comp[]; subjectSqft: number; enteredArv: number;
  onAddComp: () => void; onUpdateComp: (id: string, u: Partial<Comp>) => void;
  onDeleteComp: (id: string) => void; onUpdateSubjectSqft: (v: number) => void; onApplyArv: (v: number) => void;
  onAddMultipleComps: (newComps: Omit<Comp, "id">[]) => void;
  onApplyRent: (rent: number) => void;
  supabase: SupabaseClient;
  dealId: string;
  propertyAddress: string;
  isMobile?: boolean;
}) {
  const [pullingComps, setPullingComps] = useState(false);
  const [pullError, setPullError] = useState("");
  const [pullSuccess, setPullSuccess] = useState("");

  const pullCompsFromRentCast = async () => {
    if (!propertyAddress.trim()) {
      setPullError("Enter a property address in the Deal Analysis tab first");
      return;
    }
    setPullingComps(true);
    setPullError("");
    setPullSuccess("");
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("rentcast-comps", {
        body: { address: propertyAddress.trim() },
      });
      if (fnErr) {
        const detail = (fnErr as unknown as { context?: { json?: () => Promise<unknown> } }).context?.json
          ? JSON.stringify(await (fnErr as unknown as { context: { json: () => Promise<unknown> } }).context.json())
          : fnErr.message || String(fnErr);
        throw new Error(detail);
      }
      const payload = data as {
        success?: boolean;
        error?: string;
        saleComps?: Omit<Comp, "id">[];
        rentEstimate?: number;
      };
      if (payload.success === false && payload.error) throw new Error(payload.error);
      const saleList = payload.saleComps || [];
      const rentEst = typeof payload.rentEstimate === "number" ? payload.rentEstimate : 0;
      const room = Math.max(0, 6 - comps.length);
      const toAdd = saleList.slice(0, room);
      if (toAdd.length > 0) {
        onAddMultipleComps(toAdd);
      }
      if (rentEst > 0) {
        onApplyRent(Math.round(rentEst));
      }
      setPullSuccess(`Pulled ${toAdd.length} sale comps and rent estimate of ${fmt(rentEst)} from RentCast`);
    } catch (e: unknown) {
      setPullError(e instanceof Error ? e.message : "Failed to pull comps");
    } finally {
      setPullingComps(false);
    }
  };

  const { weightedArv, avgPpsf, strongAvg, allAvg } = calculateCompARV(comps, subjectSqft);
  const validComps = comps.filter((c) => c.salePrice > 0);
  const arvDiff = enteredArv > 0 && weightedArv > 0 ? ((enteredArv - weightedArv) / weightedArv) * 100 : null;
  return (
    <div>
      <div style={{ marginBottom: 16, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: isMobile ? 16 : 14 }}>
        {!propertyAddress.trim() && (
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>Enter a property address in the Deal Analysis tab first</div>
        )}
        <button
          type="button"
          onClick={() => void pullCompsFromRentCast()}
          disabled={pullingComps || !propertyAddress.trim()}
          style={{
            width: isMobile ? "100%" : "auto",
            background: pullingComps || !propertyAddress.trim() ? "#1e293b" : "#1d4ed8",
            border: "none",
            borderRadius: 8,
            color: "#fff",
            padding: isMobile ? "14px 16px" : "10px 18px",
            minHeight: isMobile ? 48 : 44,
            fontSize: isMobile ? 14 : 13,
            fontWeight: 700,
            cursor: pullingComps || !propertyAddress.trim() ? "not-allowed" : "pointer",
            fontFamily: "'Syne', sans-serif",
            opacity: pullingComps || !propertyAddress.trim() ? 0.6 : 1,
          }}
        >
          {pullingComps ? "Pulling comps..." : "🔄 Auto-Pull Comps from RentCast"}
        </button>
        {pullError && <div style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>{pullError}</div>}
        {pullSuccess && <div style={{ color: "#22c55e", fontSize: 13, marginTop: 10 }}>{pullSuccess}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 14 : 16, marginBottom: 20, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: isMobile ? 16 : 14 }}>
        <div style={{ flex: 1, width: isMobile ? "100%" : undefined }}>
          <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Subject Sq Ft</div>
          <div style={{ display: "flex", alignItems: "center", background: "#060b14", border: "1px solid #1e293b", borderRadius: 6, overflow: "hidden", maxWidth: isMobile ? "100%" : 160, minHeight: isMobile ? 44 : undefined }}>
            <input type="number" value={subjectSqft || ""} onChange={(e) => onUpdateSubjectSqft(parseFloat(e.target.value) || 0)}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#f1f5f9", padding: isMobile ? "12px 14px" : "8px 10px", fontSize: isMobile ? 16 : 14, fontFamily: "monospace" }} />
            <span style={{ padding: isMobile ? "12px 10px" : "8px 8px", color: "#475569", fontSize: isMobile ? 12 : 11, background: "#0a0f1a", borderLeft: "1px solid #1e293b" }}>sqft</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Your ARV</div>
          <div style={{ fontSize: isMobile ? 22 : 20, fontWeight: 700, color: "#f1f5f9", fontFamily: "monospace" }}>{enteredArv > 0 ? fmt(enteredArv) : "—"}</div>
        </div>
        {!isMobile && <div style={{ color: "#334155" }}>vs</div>}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Comp-Derived ARV</div>
          <div style={{ fontSize: isMobile ? 22 : 20, fontWeight: 700, color: weightedArv > 0 ? "#22c55e" : "#334155", fontFamily: "monospace" }}>{weightedArv > 0 ? fmt(weightedArv) : "—"}</div>
        </div>
        {arvDiff !== null && (
          <div style={{ textAlign: isMobile ? "left" : "center" }}>
            <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", marginBottom: 4 }}>Variance</div>
            <div style={{ fontSize: isMobile ? 16 : 14, fontWeight: 700, fontFamily: "monospace", color: Math.abs(arvDiff) <= 5 ? "#22c55e" : Math.abs(arvDiff) <= 10 ? "#f59e0b" : "#f87171" }}>{arvDiff > 0 ? "+" : ""}{arvDiff.toFixed(1)}%</div>
            <div style={{ fontSize: isMobile ? 11 : 10, color: "#475569" }}>{Math.abs(arvDiff) <= 5 ? "✓ On target" : arvDiff > 0 ? "⚠ You're high" : "⚠ You're low"}</div>
          </div>
        )}
        {weightedArv > 0 && <button type="button" onClick={() => onApplyArv(Math.round(weightedArv))} style={{ width: isMobile ? "100%" : "auto", background: "#1d4ed8", border: "none", borderRadius: 6, color: "#fff", padding: isMobile ? "14px 16px" : "8px 14px", minHeight: isMobile ? 48 : undefined, fontSize: isMobile ? 14 : 11, cursor: "pointer", fontWeight: 700, fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap" }}>Apply to Deal</button>}
      </div>
      {validComps.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
          <MetricCard label="Comp Count" value={`${validComps.length}`} isMobile={isMobile} />
          <MetricCard label="Avg $/SqFt" value={avgPpsf > 0 ? `$${avgPpsf.toFixed(0)}` : "—"} highlight isMobile={isMobile} />
          <MetricCard label="Strong Comp Avg" value={strongAvg > 0 ? fmt(strongAvg) : "—"} isMobile={isMobile} />
          <MetricCard label="All Comp Avg" value={allAvg > 0 ? fmt(allAvg) : "—"} isMobile={isMobile} />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {comps.map((comp) => <CompCard key={comp.id} comp={comp} onUpdate={(u) => onUpdateComp(comp.id, u)} onDelete={() => onDeleteComp(comp.id)} isMobile={isMobile} />)}
      </div>
      {comps.length < 6 && (
        <button type="button" onClick={onAddComp} style={{ width: "100%", background: "transparent", border: "1px dashed #1e293b", borderRadius: 8, color: "#334155", padding: isMobile ? "16px 16px" : "14px 0", minHeight: isMobile ? 48 : undefined, fontSize: isMobile ? 15 : 13, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
          + Add Comparable Sale {comps.length > 0 ? `(${comps.length}/6)` : ""}
        </button>
      )}
    </div>
  );
}

// ─── Scope of Work Tab ────────────────────────────────────────────────────────
function ScopeOfWorkTab({ scopeItems, address, onAdd, onUpdate, onDelete, isMobile = false }: {
  scopeItems: ScopeItem[]; address: string;
  onAdd: () => void; onUpdate: (id: string, u: Partial<ScopeItem>) => void; onDelete: (id: string) => void; isMobile?: boolean;
}) {
  const totalEstimate = scopeItems.reduce((s, i) => s + i.myEstimate, 0);
  const byCategory = SCOPE_CATEGORIES.map((cat) => ({ cat, items: scopeItems.filter((i) => i.category === cat) })).filter((g) => g.items.length > 0);
  const criticalTotal = scopeItems.filter((i) => i.priority === "critical").reduce((s, i) => s + i.myEstimate, 0);
  const importantTotal = scopeItems.filter((i) => i.priority === "important").reduce((s, i) => s + i.myEstimate, 0);
  const optionalTotal = scopeItems.filter((i) => i.priority === "optional").reduce((s, i) => s + i.myEstimate, 0);
  const fs = { background: "#060b14", border: "1px solid #1e293b", borderRadius: 4, color: "#f1f5f9", padding: isMobile ? "12px 10px" : "6px 8px", fontSize: isMobile ? 15 : 12, fontFamily: "monospace", outline: "none", boxSizing: "border-box" as const, minHeight: isMobile ? 44 : undefined, width: "100%" as const };

  const handlePrintBlind = () => {
    const pw = window.open("", "_blank");
    if (!pw) return;
    const validItems = scopeItems.filter(i => i.description);
    const grouped = SCOPE_CATEGORIES.map(cat => ({ cat, items: validItems.filter(i => i.category === cat) })).filter(g => g.items.length > 0);
    pw.document.write(`<!DOCTYPE html><html><head><title>Scope of Work — ${address}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;color:#1a202c;font-size:11px;padding:40px;max-width:800px;margin:0 auto}
    .brand{font-size:20px;font-weight:700;color:#1e3a5f}.brand span{color:#2563eb}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #1e3a5f}
    .notice{background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:10px 14px;margin-bottom:20px;font-size:11px;color:#92400e}
    .section-title{font-size:10px;font-weight:700;color:#1e3a5f;letter-spacing:1px;text-transform:uppercase;padding:8px 0 6px;border-bottom:1px solid #e2e8f0;margin:16px 0 8px}
    table{width:100%;border-collapse:collapse}th{font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left;background:#f8fafc}
    td{padding:8px 8px;border-bottom:1px solid #f8fafc;font-size:11px;color:#374151}
    .bid-box{border:2px dashed #d1d5db;border-radius:4px;padding:6px 10px;min-width:110px;color:#9ca3af;font-style:italic;font-size:10px}
    .p-critical{color:#dc2626;font-weight:600}.p-important{color:#d97706}.p-optional{color:#3b82f6}
    .contractor-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px;margin-top:20px}
    .footer{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8}
    @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body>
    <div class="header"><div><div class="brand">FLIP<span>LOGIC</span> AI</div><div style="font-size:9px;color:#64748b;letter-spacing:1px;text-transform:uppercase;margin-top:2px">Blind Scope of Work</div></div>
    <div style="text-align:right"><div style="font-size:16px;font-weight:700;color:#1e3a5f">SCOPE OF WORK</div><div style="font-size:10px;color:#64748b">Contractor Bid Request</div><div style="font-size:10px;color:#94a3b8;margin-top:3px">${new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}</div></div></div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;margin-bottom:16px"><strong>${address||"Property Address"}</strong></div>
    <div class="notice">⚠ BLIND BID NOTICE: Budget estimates have been intentionally removed. Please provide your honest market-rate pricing.</div>
    ${grouped.map(g=>`<div class="section-title">${g.cat}</div><table><thead><tr><th style="width:40%">Description</th><th>Qty</th><th>Unit</th><th>Priority</th><th>Notes</th><th style="width:120px">Your Bid ($)</th></tr></thead><tbody>${g.items.map(item=>`<tr><td>${item.description||"—"}</td><td style="text-align:center">${item.quantity}</td><td>${item.unit}</td><td class="p-${item.priority}">${item.priority.charAt(0).toUpperCase()+item.priority.slice(1)}</td><td style="color:#64748b;font-style:italic">${item.notes||""}</td><td><div class="bid-box">$____________</div></td></tr>`).join("")}</tbody></table>`).join("")}
    <div style="margin-top:20px;border-top:2px solid #1e3a5f;padding-top:12px"><table><tr style="background:#f8fafc"><td colspan="5" style="font-size:13px;padding:10px 8px;font-weight:700">TOTAL BID</td><td style="padding:10px 8px"><div class="bid-box" style="border:2px solid #1e3a5f;font-weight:700;font-size:13px;color:#1e3a5f">$____________</div></td></tr></table></div>
    <div class="contractor-box"><div style="font-size:10px;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Contractor Information</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:11px"><div>Company: ____________________________</div><div>License #: ____________________________</div><div>Contact: ____________________________</div><div>Phone: ____________________________</div></div></div>
    <div class="footer"><span>FlipLogic AI · Blind SOW · ${new Date().toLocaleDateString()}</span><span>${address||""}</span></div>
    </body></html>`);
    pw.document.close();
    setTimeout(() => pw.print(), 500);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 320px", gap: isMobile ? 20 : 24 }}>
      <div>
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 12 : 0, marginBottom: 16 }}>
          <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase" }}>Scope Items ({scopeItems.length})</div>
          <button type="button" onClick={onAdd} style={{ width: isMobile ? "100%" : "auto", background: "#1d4ed8", border: "none", borderRadius: 6, color: "#fff", padding: isMobile ? "14px 16px" : "8px 16px", minHeight: isMobile ? 48 : undefined, fontSize: isMobile ? 14 : 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>+ Add Item</button>
        </div>
        {scopeItems.length === 0 && <div style={{ background: "#0a0f1a", border: "1px dashed #1e293b", borderRadius: 8, padding: 40, textAlign: "center", color: "#334155", fontSize: 13 }}>No scope items yet. Use the AI Walkthrough tab to auto-populate, or click "+ Add Item".</div>}
        {byCategory.map((group) => (
          <div key={group.cat} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: "#3b82f6", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
              <span>{group.cat}</span>
              <span style={{ color: "#475569", fontFamily: "monospace" }}>{fmt(group.items.reduce((s, i) => s + i.myEstimate, 0))}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {group.items.map((item) => (
                <div key={item.id} style={{ background: "#0a0f1a", border: `1px solid ${PRIORITY_STYLES[item.priority].border}`, borderRadius: 8, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(["critical", "important", "optional"] as const).map((p) => (
                        <button type="button" key={p} onClick={() => onUpdate(item.id, { priority: p })} style={{ padding: isMobile ? "10px 12px" : "3px 8px", minHeight: isMobile ? 44 : undefined, borderRadius: 4, fontSize: isMobile ? 12 : 10, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif", border: `1px solid ${item.priority === p ? PRIORITY_STYLES[p].border : "#1e293b"}`, background: item.priority === p ? PRIORITY_STYLES[p].bg : "transparent", color: item.priority === p ? PRIORITY_STYLES[p].color : "#475569" }}>
                          {PRIORITY_STYLES[p].label}
                        </button>
                      ))}
                    </div>
                    <button type="button" onClick={() => onDelete(item.id)} style={{ background: "#2a0a0a", border: "1px solid #dc2626", borderRadius: 6, color: "#f87171", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: "8px 14px", minWidth: 44, minHeight: 44, fontFamily: "'Syne', sans-serif" }} aria-label="Remove scope item">🗑 Remove</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "180px 1fr", gap: 8, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#475569", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>Category</div>
                      <select value={item.category} onChange={(e) => onUpdate(item.id, { category: e.target.value })} style={{ ...fs, width: "100%", cursor: "pointer", color: "#94a3b8" }}>
                        {SCOPE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#475569", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>Description</div>
                      <input type="text" value={item.description} onChange={(e) => onUpdate(item.id, { description: e.target.value })} style={{ ...fs, width: "100%", color: "#f1f5f9" }} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "80px 100px 1fr 160px", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: isMobile ? 11 : 10, color: "#475569", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>Qty</div>
                      <input type="number" value={item.quantity || ""} onChange={(e) => onUpdate(item.id, { quantity: parseFloat(e.target.value) || 1 })} style={{ ...fs, width: "100%" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: isMobile ? 11 : 10, color: "#475569", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>Unit</div>
                      <input type="text" value={item.unit} onChange={(e) => onUpdate(item.id, { unit: e.target.value })} style={{ ...fs, width: "100%", color: "#94a3b8" }} />
                    </div>
                    <div style={{ gridColumn: isMobile ? "1 / -1" : undefined }}>
                      <div style={{ fontSize: isMobile ? 11 : 10, color: "#475569", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>Notes</div>
                      <input type="text" value={item.notes} onChange={(e) => onUpdate(item.id, { notes: e.target.value })} style={{ ...fs, width: "100%", color: "#64748b" }} />
                    </div>
                    <div style={{ gridColumn: isMobile ? "1 / -1" : undefined }}>
                      <div style={{ fontSize: isMobile ? 11 : 10, color: "#475569", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>My Estimate</div>
                      <div style={{ display: "flex", alignItems: "center", background: "#060b14", border: "1px solid #334155", borderRadius: 4, overflow: "hidden", minHeight: isMobile ? 44 : undefined }}>
                        <span style={{ padding: isMobile ? "12px 10px" : "6px 8px", color: "#334155", fontSize: isMobile ? 14 : 12, background: "#0a0f1a", borderRight: "1px solid #1e293b" }}>$</span>
                        <input type="number" value={item.myEstimate || ""} onChange={(e) => onUpdate(item.id, { myEstimate: parseFloat(e.target.value) || 0 })} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "#475569", padding: isMobile ? "12px 10px" : "6px 8px", fontSize: isMobile ? 16 : 12, fontFamily: "monospace" }} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div>
        <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Summary</div>
        <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Budget Breakdown</div>
          {[{ label: "Critical", color: "#f87171", total: criticalTotal }, { label: "Important", color: "#f59e0b", total: importantTotal }, { label: "Optional", color: "#60a5fa", total: optionalTotal }].map(r => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #0f172a" }}>
              <span style={{ fontSize: 12, color: r.color }}>● {r.label}</span>
              <span style={{ fontSize: 12, fontFamily: "monospace", color: "#f1f5f9" }}>{fmt(r.total)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0" }}>
            <span style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 700 }}>Total</span>
            <span style={{ fontSize: 18, fontFamily: "monospace", color: "#22c55e", fontWeight: 700 }}>{fmt(totalEstimate)}</span>
          </div>
        </div>
        <div style={{ background: "#2d2000", border: "1px solid #d97706", borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, marginBottom: 6 }}>🔒 Blind Export</div>
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>Your estimates are hidden from contractors. They bid blind — no anchoring to your numbers.</div>
        </div>
        <button type="button" onClick={handlePrintBlind} style={{ width: "100%", background: "linear-gradient(135deg, #d97706, #b45309)", border: "none", borderRadius: 8, color: "#fff", padding: isMobile ? "16px 16px" : "14px 0", minHeight: isMobile ? 48 : undefined, fontSize: isMobile ? 15 : 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif", marginBottom: 8 }}>
          🖨 PRINT BLIND SOW
        </button>
      </div>
    </div>
  );
}

// ─── Lender Packet Tab ────────────────────────────────────────────────────────
function LenderPacketTab({ deal, metrics, lenderInfo, onUpdateLenderInfo, isMobile = false }: {
  deal: Deal; metrics: DealMetrics; lenderInfo: LenderInfo; onUpdateLenderInfo: (u: Partial<LenderInfo>) => void; isMobile?: boolean;
}) {
  const { weightedArv } = calculateCompARV(deal.comps, deal.subjectSqft);
  const inputs = deal.inputs;

  const handlePrint = () => {
    const pw = window.open("", "_blank");
    if (!pw) return;
    pw.document.write(`<!DOCTYPE html><html><head><title>Lender Packet</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;color:#1a202c;font-size:11px;padding:40px;max-width:800px;margin:0 auto}
    .brand{font-size:20px;font-weight:700;color:#1e3a5f}.brand span{color:#2563eb}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #1e3a5f}
    .st{font-size:10px;font-weight:700;color:#1e3a5f;letter-spacing:1px;text-transform:uppercase;margin:18px 0 10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}
    .mg{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
    .mb{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px}
    .mb.hi{background:#eff6ff;border-color:#bfdbfe}
    .ml{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px}
    .mv{font-size:17px;font-weight:700;font-family:monospace}
    .mb.hi .mv{color:#1d4ed8}
    .tc{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
    .dt{width:100%;border-collapse:collapse}.dt tr{border-bottom:1px solid #f1f5f9}.dt td{padding:6px 4px;font-size:11px}.dt td:first-child{color:#64748b}.dt td:last-child{font-weight:600;text-align:right;font-family:monospace}
    .ct{width:100%;border-collapse:collapse;font-size:10px}.ct th{background:#f8fafc;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0}.ct td{padding:6px 8px;border-bottom:1px solid #f8fafc}
    .sg{display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr 80px;gap:6px}.sh{font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;padding:6px 10px;background:#f8fafc}.sr{padding:7px 10px;border-bottom:1px solid #f1f5f9;font-size:11px;font-family:monospace}
    .sb{padding:3px 8px;border-radius:3px;font-size:9px;font-weight:700}.sH{background:#dcfce7;color:#16a34a}.sW{background:#fef3c7;color:#d97706}.sC{background:#dbeafe;color:#1d4ed8}.sD{background:#fee2e2;color:#dc2626}
    .footer{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8}
    @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body>
    <div class="header">
      <div><div class="brand">FLIP<span>LOGIC</span> AI</div>${lenderInfo.investorName?`<div style="margin-top:8px;font-size:11px;font-weight:600">${lenderInfo.investorName}${lenderInfo.investorCompany?` · ${lenderInfo.investorCompany}`:""}</div>`:""}</div>
      <div style="text-align:right"><div style="font-size:16px;font-weight:700;color:#1e3a5f">LENDER PACKET</div>${lenderInfo.lenderName?`<div style="font-size:10px;color:#1d4ed8;font-weight:600;margin-top:4px">For: ${lenderInfo.lenderName}</div>`:""}<div style="font-size:10px;color:#94a3b8;margin-top:3px">${new Date().toLocaleDateString()}</div></div>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;margin-bottom:16px"><strong style="font-size:13px">${inputs.propertyAddress||"Property Address"}</strong></div>
    <div class="st">Executive Summary</div>
    <div class="mg">
      <div class="mb hi"><div class="ml">Net Profit</div><div class="mv">${fmt(metrics.netProfit)}</div></div>
      <div class="mb hi"><div class="ml">ROI</div><div class="mv">${fmtPct(metrics.roi)}</div></div>
      <div class="mb"><div class="ml">LTV</div><div class="mv">${fmtPct(metrics.ltv)}</div></div>
      <div class="mb"><div class="ml">LTC</div><div class="mv">${fmtPct(metrics.ltc)}</div></div>
      <div class="mb"><div class="ml">ARV</div><div class="mv">${fmt(inputs.arv)}</div></div>
      <div class="mb"><div class="ml">Project Cost</div><div class="mv">${fmt(metrics.totalProjectCost)}</div></div>
      <div class="mb"><div class="ml">Equity</div><div class="mv">${fmt(metrics.equityPosition)}</div></div>
      <div class="mb"><div class="ml">Mo. Payment</div><div class="mv">${fmt(metrics.monthlyPayment)}</div></div>
    </div>
    <div class="tc">
      <div><div class="st">Acquisition & Financing</div><table class="dt"><tr><td>Purchase Price</td><td>${fmt(inputs.purchasePrice)}</td></tr><tr><td>Rehab Cost</td><td>${fmt(inputs.rehabCost)}</td></tr><tr><td>Closing Costs (Buy)</td><td>${fmt(inputs.closingCostsBuy)}</td></tr><tr><td>Total Project Cost</td><td>${fmt(metrics.totalProjectCost)}</td></tr><tr><td>Loan Amount</td><td>${fmt(inputs.loanAmount)}</td></tr><tr><td>Interest Rate</td><td>${fmtPct(inputs.interestRate)} APR</td></tr></table></div>
      <div><div class="st">Profit & Exit</div><table class="dt"><tr><td>ARV</td><td>${fmt(inputs.arv)}</td></tr><tr><td>Gross Profit</td><td>${fmt(metrics.grossProfit)}</td></tr><tr><td>Selling Costs</td><td>${fmt(inputs.closingCostsSell)}</td></tr><tr><td>Holding Costs</td><td>${fmt(metrics.totalHoldingCosts)}</td></tr><tr><td>Net Profit</td><td>${fmt(metrics.netProfit)}</td></tr><tr><td>ROI</td><td>${fmtPct(metrics.roi)}</td></tr></table></div>
    </div>
    ${deal.comps.filter(c=>c.salePrice>0).length>0?`<div class="st">Comparable Sales</div><table class="ct"><thead><tr><th>Address</th><th>Price</th><th>SqFt</th><th>$/SqFt</th><th>DOM</th><th>Weight</th></tr></thead><tbody>${deal.comps.filter(c=>c.salePrice>0).map(c=>`<tr><td>${c.address||"—"}</td><td style="font-weight:600">${fmt(c.salePrice)}</td><td>${c.sqft>0?c.sqft.toLocaleString():"—"}</td><td>${c.salePrice>0&&c.sqft>0?"$"+(c.salePrice/c.sqft).toFixed(0):"—"}</td><td>${c.daysOnMarket>0?c.daysOnMarket+"d":"—"}</td><td>${c.strength.charAt(0).toUpperCase()+c.strength.slice(1)}</td></tr>`).join("")}</tbody></table>${weightedArv>0?`<p style="margin-top:8px;font-size:11px">Weighted ARV: <strong style="color:#1d4ed8">${fmt(weightedArv)}</strong></p>`:""}`:""}
    <div style="margin-top:20px"><div class="st">Sensitivity Analysis</div>
    <div class="sg">${["Scenario","Net Profit","ROI","LTV","Score"].map(h=>`<div class="sh">${h}</div>`).join("")}
    ${SCENARIOS.map(s=>{const m2=calculateMetrics({...inputs,rehabCost:inputs.rehabCost*s.rehabMultiplier,arv:inputs.arv*s.arvMultiplier});const sc={HOT:"H",WARM:"W",COLD:"C",DEAD:"D"}[m2.dealScore];return`<div class="sr">${s.label}</div><div class="sr">${fmt(m2.netProfit)}</div><div class="sr">${fmtPct(m2.roi)}</div><div class="sr">${fmtPct(m2.ltv)}</div><div class="sr"><span class="sb s${sc}">${m2.dealScore}</span></div>`;}).join("")}</div></div>
    ${inputs.notes?`<div class="st">Field Notes</div><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;font-size:11px;line-height:1.6">${inputs.notes}</div>`:""}
    <div class="footer"><span>FlipLogic AI · ${new Date().toLocaleDateString()}</span><span>${lenderInfo.investorName||""}</span></div>
    </body></html>`);
    pw.document.close();
    setTimeout(() => pw.print(), 500);
  };

  const tf = (label: string, key: keyof LenderInfo) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: isMobile ? 12 : 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</label>
      <input type="text" value={lenderInfo[key]} onChange={(e) => onUpdateLenderInfo({ [key]: e.target.value })} placeholder={`Enter ${label.toLowerCase()}...`}
        style={{ width: "100%", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, color: "#f1f5f9", padding: isMobile ? "12px 14px" : "8px 10px", fontSize: isMobile ? 16 : 13, outline: "none", boxSizing: "border-box" as const, minHeight: isMobile ? 44 : undefined }} />
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "280px 1fr", gap: isMobile ? 20 : 24 }}>
      <div>
        <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Packet Info</div>
        <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 14 }}>
          {tf("Investor Name", "investorName")}{tf("Company", "investorCompany")}{tf("Phone", "investorPhone")}{tf("Email", "investorEmail")}
        </div>
        <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 14 }}>
          {tf("Lender / Recipient Name", "lenderName")}
        </div>
        <button type="button" onClick={handlePrint} style={{ width: "100%", background: "linear-gradient(135deg, #1d4ed8, #1e40af)", border: "none", borderRadius: 8, color: "#fff", padding: isMobile ? "16px 16px" : "14px 0", minHeight: isMobile ? 48 : undefined, fontSize: isMobile ? 15 : 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
          🖨 PRINT / SAVE AS PDF
        </button>
      </div>
      <div>
        <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Preview</div>
        <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #1e293b", padding: isMobile ? 16 : 24, color: "#1a202c", fontSize: isMobile ? 12 : 11, overflow: "auto" }}>
          <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", gap: isMobile ? 12 : 0, marginBottom: 16, paddingBottom: 12, borderBottom: "3px solid #1e3a5f" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1e3a5f" }}>FLIP<span style={{ color: "#2563eb" }}>LOGIC</span> AI</div>
              {lenderInfo.investorName && <div style={{ fontSize: 11, fontWeight: 600, marginTop: 5 }}>{lenderInfo.investorName}</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1e3a5f" }}>LENDER PACKET</div>
              {lenderInfo.lenderName && <div style={{ fontSize: 10, color: "#1d4ed8", fontWeight: 600, marginTop: 3 }}>For: {lenderInfo.lenderName}</div>}
            </div>
          </div>
          <div style={{ background: "#f8fafc", borderRadius: 5, padding: "10px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{inputs.propertyAddress || "Property Address"}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)", gap: 8 }}>
            {[{ l: "Net Profit", v: fmt(metrics.netProfit), hi: true }, { l: "ROI", v: fmtPct(metrics.roi), hi: true }, { l: "LTV", v: fmtPct(metrics.ltv) }, { l: "LTC", v: fmtPct(metrics.ltc) }].map((m) => (
              <div key={m.l} style={{ background: m.hi ? "#eff6ff" : "#f8fafc", border: `1px solid ${m.hi ? "#bfdbfe" : "#e2e8f0"}`, borderRadius: 4, padding: isMobile ? "10px 10px" : "8px 10px" }}>
                <div style={{ fontSize: isMobile ? 10 : 9, color: "#64748b", textTransform: "uppercase", marginBottom: 3 }}>{m.l}</div>
                <div style={{ fontSize: isMobile ? 15 : 14, fontWeight: 700, color: m.hi ? "#1d4ed8" : "#1e293b", fontFamily: "monospace" }}>{m.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Deals Sidebar ────────────────────────────────────────────────────────────
function DealsSidebar({ deals, activeDealId, onSelect, onNew, onDelete, userEmail, onSignOut, syncing, variant = "sidebar", drawerOpen = false, onCloseDrawer }: {
  deals: Deal[]; activeDealId: string; onSelect: (id: string) => void; onNew: () => void; onDelete: (id: string) => void;
  userEmail: string; onSignOut: () => void; syncing: boolean;
  variant?: "sidebar" | "drawer"; drawerOpen?: boolean; onCloseDrawer?: () => void;
}) {
  const isDrawer = variant === "drawer";
  const shell: CSSProperties = isDrawer
    ? {
        position: "fixed", left: 0, top: 0, height: "100dvh", width: "min(300px, 88vw)", zIndex: 300,
        background: "#060b14", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column",
        transform: drawerOpen ? "translateX(0)" : "translateX(-100%)", transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
        boxShadow: drawerOpen ? "12px 0 40px rgba(0,0,0,0.5)" : "none", overflowY: "auto", WebkitOverflowScrolling: "touch",
      }
    : { width: 240, flexShrink: 0, background: "#060b14", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", height: "100vh", position: "sticky", top: 0, overflowY: "auto" };

  const pickDeal = (id: string) => {
    onSelect(id);
    if (isDrawer) onCloseDrawer?.();
  };

  return (
    <div style={shell}>
      {isDrawer && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.06em" }}>MY DEALS</span>
          <button type="button" aria-label="Close menu" onClick={() => onCloseDrawer?.()} style={{ minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#94a3b8", fontSize: 22, lineHeight: 1, cursor: "pointer" }}>×</button>
        </div>
      )}
      <div style={{ padding: isDrawer ? "12px 14px 10px" : "16px 14px 10px", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
        {!isDrawer && <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>My Deals ({deals.length})</div>}
        {isDrawer && <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>({deals.length})</div>}
        <button type="button" onClick={() => { onNew(); if (isDrawer) onCloseDrawer?.(); }} style={{ width: "100%", background: "#1d4ed8", border: "none", borderRadius: 6, color: "#fff", padding: isDrawer ? "12px 0" : "9px 0", minHeight: isDrawer ? 44 : undefined, fontSize: isDrawer ? 13 : 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>+ NEW DEAL</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {deals.map((deal) => {
          const m = calculateMetrics(deal.inputs);
          const score = SCORE_STYLES[m.dealScore];
          const isActive = deal.id === activeDealId;
          return (
            <div key={deal.id} onClick={() => pickDeal(deal.id)} style={{ padding: "12px 14px", cursor: "pointer", background: isActive ? "#0d1829" : "transparent", borderLeft: isActive ? "2px solid #3b82f6" : "2px solid transparent", borderBottom: "1px solid #0f172a" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 8 }}>
                <div style={{ fontSize: isDrawer ? 13 : 12, color: isActive ? "#f1f5f9" : "#94a3b8", fontWeight: isActive ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{deal.inputs.propertyAddress || "Unnamed Property"}</div>
                <div style={{ fontSize: 10, fontWeight: 700, padding: "2px 5px", borderRadius: 3, background: score.bg, color: score.text, border: `1px solid ${score.border}`, flexShrink: 0 }}>{m.dealScore}</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ fontSize: 12, color: "#22c55e", fontFamily: "monospace" }}>{m.netProfit !== 0 ? fmt(m.netProfit) : "—"}</div>
                <div style={{ fontSize: 10, color: STATUS_STYLES[deal.inputs.dealStatus].color }}>{deal.inputs.dealStatus.charAt(0).toUpperCase() + deal.inputs.dealStatus.slice(1)}</div>
              </div>
              {isActive && <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(deal.id); }} style={{ marginTop: 8, background: "transparent", border: "1px solid #2a0a0a", color: "#f87171", borderRadius: 4, padding: "10px 8px", fontSize: 11, cursor: "pointer", width: "100%", minHeight: 44, fontFamily: "'Syne', sans-serif" }}>Delete Deal</button>}
            </div>
          );
        })}
      </div>
      <div style={{ padding: "12px 14px", borderTop: "1px solid #1e293b", flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: syncing ? "#f59e0b" : "#22c55e", marginBottom: 6, textAlign: "center" }}>{syncing ? "⟳ Saving..." : "✓ Synced to cloud"}</div>
        <div style={{ fontSize: 11, color: "#334155", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>{userEmail}</div>
        <button type="button" onClick={() => { onSignOut(); if (isDrawer) onCloseDrawer?.(); }} style={{ width: "100%", background: "transparent", border: "1px solid #1e293b", borderRadius: 6, color: "#475569", padding: "12px 0", minHeight: 44, fontSize: 12, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>Sign Out</button>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [activeDealId, setActiveDealId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"deal" | "ai" | "comps" | "rental" | "stress" | "scope" | "packet">("deal");
  const [syncing, setSyncing] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const saveTimer = useRef<any>(null);

  useEffect(() => {
    if (isMobile && sidebarOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [isMobile, sidebarOpen]);

  // ─── Auth listener ────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ─── Load deals from Supabase ─────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    loadDeals();
  }, [user]);

  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syne:wght@700;800&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }, []);

  const loadDeals = async () => {
    setDbLoading(true);
    try {
      const { data: dealsData, error } = await supabase
        .from("deals")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (!dealsData || dealsData.length === 0) {
        // New user — create demo deal
        await createDemoDeal();
        setDbLoading(false);
        return;
      }

      // Load comps and scope items for all deals
      const dealIds = dealsData.map((d: any) => d.id);
      const { data: compsData } = await supabase.from("comps").select("*").in("deal_id", dealIds);
      const { data: scopeData } = await supabase.from("scope_items").select("*").in("deal_id", dealIds);

      const assembled: Deal[] = dealsData.map((d: any) => ({
        id: d.id,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        subjectSqft: d.subject_sqft || 0,
        lenderInfo: d.lender_info || BLANK_LENDER_INFO,
        inputs: {
          propertyAddress: d.property_address || "",
          purchasePrice: d.purchase_price || 0,
          rehabCost: d.rehab_cost || 0,
          arv: d.arv || 0,
          loanAmount: d.loan_amount || 0,
          interestRate: d.interest_rate || 11.5,
          loanTermMonths: d.loan_term_months || 12,
          holdingMonths: d.holding_months || 6,
          closingCostsBuy: d.closing_costs_buy || 0,
          closingCostsSell: d.closing_costs_sell || 0,
          monthlyRent: d.monthly_rent || 0,
          monthlyExpenses: d.monthly_expenses || 0,
          notes: d.notes || "",
          dealStatus: d.deal_status || "prospect",
        },
        comps: (compsData || []).filter((c: any) => c.deal_id === d.id).map((c: any) => ({
          id: c.id, address: c.address || "", salePrice: c.sale_price || 0,
          sqft: c.sqft || 0, bedBath: c.bed_bath || "", daysOnMarket: c.days_on_market || 0,
          soldDate: c.sold_date || "", strength: c.strength || "average", notes: c.notes || "",
        })),
        scopeItems: (scopeData || []).filter((s: any) => s.deal_id === d.id).map((s: any) => ({
          id: s.id, category: s.category || "Other", description: s.description || "",
          quantity: s.quantity || 1, unit: s.unit || "lot", myEstimate: s.my_estimate || 0,
          notes: s.notes || "", priority: s.priority || "important",
        })),
      }));

      setDeals(assembled);
      if (assembled.length > 0) setActiveDealId(assembled[0].id);
    } catch (err) {
      console.error("Error loading deals:", err);
    }
    setDbLoading(false);
  };

  const createDemoDeal = async () => {
    const { data: dealData, error } = await supabase.from("deals").insert({
      user_id: user.id,
      property_address: DEMO_INPUTS.propertyAddress,
      purchase_price: DEMO_INPUTS.purchasePrice,
      rehab_cost: DEMO_INPUTS.rehabCost,
      arv: DEMO_INPUTS.arv,
      loan_amount: DEMO_INPUTS.loanAmount,
      interest_rate: DEMO_INPUTS.interestRate,
      loan_term_months: DEMO_INPUTS.loanTermMonths,
      holding_months: DEMO_INPUTS.holdingMonths,
      closing_costs_buy: DEMO_INPUTS.closingCostsBuy,
      closing_costs_sell: DEMO_INPUTS.closingCostsSell,
      monthly_rent: DEMO_INPUTS.monthlyRent,
      monthly_expenses: DEMO_INPUTS.monthlyExpenses,
      notes: DEMO_INPUTS.notes,
      deal_status: DEMO_INPUTS.dealStatus,
      subject_sqft: 1480,
      lender_info: { investorName: "", investorCompany: "", investorPhone: "", investorEmail: "", lenderName: "" },
    }).select().single();

    if (error || !dealData) return;

    await supabase.from("comps").insert(DEMO_COMPS.map(c => ({ deal_id: dealData.id, user_id: user.id, address: c.address, sale_price: c.salePrice, sqft: c.sqft, bed_bath: c.bedBath, days_on_market: c.daysOnMarket, sold_date: c.soldDate, strength: c.strength, notes: c.notes })));
    await supabase.from("scope_items").insert(DEMO_SCOPE.map(s => ({ deal_id: dealData.id, user_id: user.id, category: s.category, description: s.description, quantity: s.quantity, unit: s.unit, my_estimate: s.myEstimate, notes: s.notes, priority: s.priority })));

    await loadDeals();
  };

  // ─── Auto-save with debounce ──────────────────────────────────────────────
  const saveDeal = async (deal: Deal) => {
    if (!user) return;
    setSyncing(true);
    try {
      await supabase.from("deals").upsert({
        id: deal.id, user_id: user.id, updated_at: new Date().toISOString(),
        property_address: deal.inputs.propertyAddress,
        purchase_price: deal.inputs.purchasePrice,
        rehab_cost: deal.inputs.rehabCost,
        arv: deal.inputs.arv,
        loan_amount: deal.inputs.loanAmount,
        interest_rate: deal.inputs.interestRate,
        loan_term_months: deal.inputs.loanTermMonths,
        holding_months: deal.inputs.holdingMonths,
        closing_costs_buy: deal.inputs.closingCostsBuy,
        closing_costs_sell: deal.inputs.closingCostsSell,
        monthly_rent: deal.inputs.monthlyRent,
        monthly_expenses: deal.inputs.monthlyExpenses,
        notes: deal.inputs.notes,
        deal_status: deal.inputs.dealStatus,
        subject_sqft: deal.subjectSqft,
        lender_info: deal.lenderInfo,
      });

      // Delete and re-insert comps
      await supabase.from("comps").delete().eq("deal_id", deal.id);
      if (deal.comps.length > 0) {
        await supabase.from("comps").insert(deal.comps.map(c => ({ id: c.id, deal_id: deal.id, user_id: user.id, address: c.address, sale_price: c.salePrice, sqft: c.sqft, bed_bath: c.bedBath, days_on_market: c.daysOnMarket, sold_date: c.soldDate, strength: c.strength, notes: c.notes })));
      }

      // Delete and re-insert scope items
      await supabase.from("scope_items").delete().eq("deal_id", deal.id);
      if (deal.scopeItems.length > 0) {
        await supabase.from("scope_items").insert(deal.scopeItems.map(s => ({ id: s.id, deal_id: deal.id, user_id: user.id, category: s.category, description: s.description, quantity: s.quantity, unit: s.unit, my_estimate: s.myEstimate, notes: s.notes, priority: s.priority })));
      }
    } catch (err) {
      console.error("Save error:", err);
    }
    setSyncing(false);
  };

  const updateDeal = (changes: Partial<Deal>) => {
    setDeals((prev) => prev.map((d) => {
      if (d.id !== activeDealId) return d;
      const updated = { ...d, updatedAt: new Date().toISOString(), ...changes };
      // Debounced save
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveDeal(updated), 1500);
      return updated;
    }));
  };

  const activeDeal = deals.find((d) => d.id === activeDealId);
  const inputs = activeDeal?.inputs ?? BLANK_INPUTS;
  const metrics = calculateMetrics(inputs);
  const scoreStyle = SCORE_STYLES[metrics.dealScore];

  const updateInputs = (updates: Partial<DealInputs>) => updateDeal({ inputs: { ...inputs, ...updates } });
  const set = (key: keyof DealInputs) => (value: number | string) => updateInputs({ [key]: value });

  const handleNewDeal = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("deals").insert({
      user_id: user.id,
      property_address: "", purchase_price: 0, rehab_cost: 0, arv: 0, loan_amount: 0,
      interest_rate: 11.5, loan_term_months: 12, holding_months: 6,
      closing_costs_buy: 0, closing_costs_sell: 0, monthly_rent: 0, monthly_expenses: 0,
      notes: "", deal_status: "prospect", subject_sqft: 0, lender_info: BLANK_LENDER_INFO,
    }).select().single();
    if (error || !data) return;
    const nd: Deal = { id: data.id, createdAt: data.created_at, updatedAt: data.updated_at, inputs: { ...BLANK_INPUTS }, comps: [], subjectSqft: 0, lenderInfo: { ...BLANK_LENDER_INFO }, scopeItems: [] };
    setDeals((prev) => [nd, ...prev]);
    setActiveDealId(nd.id);
    setActiveTab("deal");
  };

  const handleDelete = async (id: string) => {
    await supabase.from("deals").delete().eq("id", id);
    const remaining = deals.filter((d) => d.id !== id);
    setDeals(remaining);
    if (activeDealId === id) setActiveDealId(remaining.length > 0 ? remaining[0].id : "");
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setDeals([]);
    setActiveDealId("");
  };

  const handleAddAIToScope = (items: ScopeItem[]) => {
    if (!activeDeal) return;
    updateDeal({ scopeItems: [...activeDeal.scopeItems, ...items] });
    setActiveTab("scope");
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#060b14", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontFamily: "'Syne', sans-serif", fontSize: 14 }}>
      Loading...
    </div>
  );

  if (!user) return <AuthScreen onAuth={() => {}} />;

  if (dbLoading) return (
    <div style={{ minHeight: "100vh", background: "#060b14", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontFamily: "'Syne', sans-serif", fontSize: 14 }}>
      Loading your deals...
    </div>
  );

  if (!activeDeal) return (
    <div style={{ minHeight: "100vh", background: "#060b14", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <button type="button" onClick={handleNewDeal} style={{ background: "#1d4ed8", border: "none", color: "#fff", padding: "16px 24px", borderRadius: 8, fontSize: 16, cursor: "pointer", minHeight: 48, width: "min(100%, 320px)" }}>+ Start Your First Deal</button>
    </div>
  );

  const TABS = [
    { key: "deal", label: "Deal Analysis" },
    { key: "ai", label: "🤖 AI Walkthrough" },
    { key: "comps", label: `Comps ${activeDeal.comps.length > 0 ? `(${activeDeal.comps.length})` : ""}` },
    { key: "rental", label: "Rental Pivot" },
    { key: "stress", label: "Stress Test" },
    { key: "scope", label: `🔨 Scope ${activeDeal.scopeItems.length > 0 ? `(${activeDeal.scopeItems.length})` : ""}` },
    { key: "packet", label: "📄 Lender Packet" },
  ] as const;

  return (
    <div style={{ minHeight: "100vh", background: "#060b14", color: "#f1f5f9", fontFamily: "'Syne', sans-serif", display: "flex", position: "relative" }}>
      {isMobile && (
        <button
          type="button"
          aria-hidden={!sidebarOpen}
          tabIndex={sidebarOpen ? 0 : -1}
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 250, border: "none", padding: 0, margin: 0,
            background: sidebarOpen ? "rgba(0,0,0,0.5)" : "transparent",
            opacity: sidebarOpen ? 1 : 0,
            pointerEvents: sidebarOpen ? "auto" : "none",
            transition: "opacity 0.25s ease, background 0.25s ease",
          }}
        />
      )}
      {!isMobile && <DealsSidebar deals={deals} activeDealId={activeDealId} onSelect={setActiveDealId} onNew={handleNewDeal} onDelete={handleDelete} userEmail={user.email} onSignOut={handleSignOut} syncing={syncing} variant="sidebar" />}
      {isMobile && <DealsSidebar deals={deals} activeDealId={activeDealId} onSelect={setActiveDealId} onNew={handleNewDeal} onDelete={handleDelete} userEmail={user.email} onSignOut={handleSignOut} syncing={syncing} variant="drawer" drawerOpen={sidebarOpen} onCloseDrawer={() => setSidebarOpen(false)} />}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minWidth: 0 }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg, #060b14 0%, #0d1829 100%)", borderBottom: "1px solid #1e293b", padding: isMobile ? "12px 14px" : "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
            {isMobile && (
              <button type="button" aria-label="Open deals menu" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)} style={{ flexShrink: 0, minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#f1f5f9", fontSize: 20, cursor: "pointer", padding: 0 }}>
                ☰
              </button>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 800, letterSpacing: "-0.02em" }}>FLIP<span style={{ color: "#3b82f6" }}>LOGIC</span> AI</div>
              <div style={{ fontSize: isMobile ? 9 : 10, color: "#475569", letterSpacing: "0.12em", marginTop: 2 }}>COMMAND CENTER · DEAL ANALYZER</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", width: isMobile ? "100%" : "auto", justifyContent: isMobile ? "stretch" : "flex-end" }}>
            <select value={inputs.dealStatus} onChange={(e) => set("dealStatus")(e.target.value)} style={{ flex: isMobile ? 1 : "none", minWidth: 0, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 6, color: STATUS_STYLES[inputs.dealStatus].color, padding: isMobile ? "12px 12px" : "6px 10px", minHeight: isMobile ? 44 : undefined, fontSize: isMobile ? 14 : 12, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
              <option value="prospect">Prospect</option><option value="active">Active</option><option value="closed">Closed</option><option value="passed">Passed</option>
            </select>
            <div style={{ background: scoreStyle.bg, border: `2px solid ${scoreStyle.border}`, borderRadius: 8, padding: isMobile ? "8px 12px" : "8px 16px", textAlign: "center", minWidth: isMobile ? 88 : undefined }}>
              <div style={{ fontSize: isMobile ? 8 : 9, color: scoreStyle.text, letterSpacing: "0.15em", marginBottom: 1 }}>DEAL SCORE</div>
              <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, color: scoreStyle.text }}>{metrics.dealScore}</div>
            </div>
          </div>
        </div>

        {/* Address */}
        <div style={{ padding: isMobile ? "12px 14px" : "10px 24px", background: "#0a0f1a", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
          <input type="text" value={inputs.propertyAddress} onChange={(e) => set("propertyAddress")(e.target.value)} placeholder="Enter property address..."
            style={{ width: "100%", background: "transparent", border: "none", outline: "none", color: "#94a3b8", fontSize: isMobile ? 15 : 13, fontFamily: "monospace", boxSizing: "border-box", minHeight: isMobile ? 44 : undefined, padding: isMobile ? "4px 0" : 0 }} />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1e293b", background: "#0a0f1a", flexShrink: 0, overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarGutter: "stable", padding: isMobile ? "4px 8px" : "0 4px", gap: isMobile ? 4 : 0 }}>
          {TABS.map((tab) => (
            <button type="button" key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{
                flexShrink: 0, padding: isMobile ? "12px 18px" : "11px 14px", minHeight: isMobile ? 44 : undefined,
                background: "transparent", border: "none", borderBottom: activeTab === tab.key ? "2px solid #3b82f6" : "2px solid transparent",
                color: activeTab === tab.key ? "#60a5fa" : "#475569", cursor: "pointer", fontSize: isMobile ? 12 : 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap",
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: isMobile ? "16px 14px 24px" : "20px 24px", flex: 1, overflow: "auto" }}>

          {activeTab === "deal" && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 20 : 24 }}>
              <div>
                <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Deal Inputs</div>
                <InputField label="Purchase Price" value={inputs.purchasePrice} onChange={set("purchasePrice")} isMobile={isMobile} />
                <InputField label="Rehab Cost" value={inputs.rehabCost} onChange={set("rehabCost")} isMobile={isMobile} />
                <InputField label="After Repair Value (ARV)" value={inputs.arv} onChange={set("arv")} isMobile={isMobile} />
                <InputField label="Loan Amount" value={inputs.loanAmount} onChange={set("loanAmount")} isMobile={isMobile} />
                <InputField label="Interest Rate" value={inputs.interestRate} onChange={set("interestRate")} prefix="%" suffix="APR" isMobile={isMobile} />
                <InputField label="Loan Term" value={inputs.loanTermMonths} onChange={set("loanTermMonths")} prefix="" suffix="mo" isMobile={isMobile} />
                <InputField label="Projected Hold Time" value={inputs.holdingMonths} onChange={set("holdingMonths")} prefix="" suffix="mo" isMobile={isMobile} />
                <InputField label="Closing Costs (Buy)" value={inputs.closingCostsBuy} onChange={set("closingCostsBuy")} isMobile={isMobile} />
                <InputField label="Closing Costs (Sell)" value={inputs.closingCostsSell} onChange={set("closingCostsSell")} isMobile={isMobile} />
                <div style={{ marginTop: 4 }}>
                  <label style={{ display: "block", fontSize: isMobile ? 12 : 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>Field Notes</label>
                  <textarea value={inputs.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="Walkthrough observations, red flags, contractor notes..." rows={isMobile ? 5 : 4}
                    style={{ width: "100%", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, color: "#94a3b8", padding: isMobile ? "14px 12px" : "10px", fontSize: isMobile ? 15 : 13, fontFamily: "monospace", resize: "vertical", outline: "none", boxSizing: "border-box", minHeight: isMobile ? 120 : undefined }} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Key Metrics</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <MetricCard label="Net Profit" value={fmt(metrics.netProfit)} highlight isMobile={isMobile} />
                  <MetricCard label="ROI" value={fmtPct(metrics.roi)} highlight isMobile={isMobile} />
                  <MetricCard label="LTC" value={fmtPct(metrics.ltc)} sub="Loan to Cost" isMobile={isMobile} />
                  <MetricCard label="LTV" value={fmtPct(metrics.ltv)} sub="Loan to Value" isMobile={isMobile} />
                  <MetricCard label="Monthly Payment" value={fmt(metrics.monthlyPayment)} isMobile={isMobile} />
                  <MetricCard label="Total Holding Costs" value={fmt(metrics.totalHoldingCosts)} isMobile={isMobile} />
                  <MetricCard label="Gross Profit" value={fmt(metrics.grossProfit)} isMobile={isMobile} />
                  <MetricCard label="Total Project Cost" value={fmt(metrics.totalProjectCost)} isMobile={isMobile} />
                </div>
                <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>Equity Position</span>
                    <span style={{ fontSize: 13, color: "#22c55e", fontFamily: "monospace", fontWeight: 700 }}>{fmt(metrics.equityPosition)} ({fmtPct(metrics.equityPercent)})</span>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 4, height: 8, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(Math.max(metrics.equityPercent, 0), 100)}%`, height: "100%", borderRadius: 4, background: metrics.equityPercent >= 25 ? "#22c55e" : metrics.equityPercent >= 15 ? "#f59e0b" : "#ef4444", transition: "width 0.4s ease" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                    <span style={{ fontSize: 10, color: "#475569" }}>Loan: {fmt(inputs.loanAmount)}</span>
                    <span style={{ fontSize: 10, color: "#475569" }}>ARV: {fmt(inputs.arv)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "ai" && <AIWalkthroughTab address={inputs.propertyAddress} buildYear={1970} onAddToScope={handleAddAIToScope} isMobile={isMobile} dealId={activeDeal.id} userId={user.id} />}

          {activeTab === "comps" && (
            <CompsTab comps={activeDeal.comps} subjectSqft={activeDeal.subjectSqft} enteredArv={inputs.arv} isMobile={isMobile}
              supabase={supabase}
              dealId={activeDeal.id}
              propertyAddress={inputs.propertyAddress}
              onAddComp={() => updateDeal({ comps: [...activeDeal.comps, { id: uid(), address: "", salePrice: 0, sqft: 0, bedBath: "", daysOnMarket: 0, soldDate: "", strength: "average", notes: "" }] })}
              onUpdateComp={(id, u) => updateDeal({ comps: activeDeal.comps.map((c) => c.id === id ? { ...c, ...u } : c) })}
              onDeleteComp={(id) => updateDeal({ comps: activeDeal.comps.filter((c) => c.id !== id) })}
              onUpdateSubjectSqft={(v) => updateDeal({ subjectSqft: v })}
              onApplyArv={(v) => { updateInputs({ arv: v }); setActiveTab("deal"); }}
              onAddMultipleComps={(newComps) => updateDeal({ comps: [...activeDeal.comps, ...newComps.map((c) => ({ ...c, id: uid() }))] })}
              onApplyRent={(v) => updateInputs({ monthlyRent: v })} />
          )}

          {activeTab === "rental" && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 20 : 24 }}>
              <div>
                <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Rental Inputs</div>
                <InputField label="Monthly Rent" value={inputs.monthlyRent} onChange={set("monthlyRent")} isMobile={isMobile} />
                <InputField label="Monthly Expenses" value={inputs.monthlyExpenses} onChange={set("monthlyExpenses")} isMobile={isMobile} />
                <InputField label="Loan Amount (Refi)" value={inputs.loanAmount} onChange={set("loanAmount")} isMobile={isMobile} />
                <InputField label="Interest Rate" value={inputs.interestRate} onChange={set("interestRate")} prefix="%" suffix="APR" isMobile={isMobile} />
                <InputField label="Loan Term" value={inputs.loanTermMonths} onChange={set("loanTermMonths")} prefix="" suffix="mo" isMobile={isMobile} />
              </div>
              <div>
                <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Rental Metrics</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                  <MetricCard label="DSCR" value={metrics.dscr.toFixed(2)} sub={metrics.dscr >= 1.25 ? "✓ Lender Ready" : metrics.dscr >= 1.0 ? "⚠ Borderline" : "✗ Below Threshold"} highlight={metrics.dscr >= 1.25} isMobile={isMobile} />
                  <MetricCard label="Monthly Payment" value={fmt(metrics.monthlyPayment)} isMobile={isMobile} />
                  <MetricCard label="Net Monthly Cash Flow" value={fmt(inputs.monthlyRent - inputs.monthlyExpenses - metrics.monthlyPayment)} highlight isMobile={isMobile} />
                  <MetricCard label="Annual Cash Flow" value={fmt((inputs.monthlyRent - inputs.monthlyExpenses - metrics.monthlyPayment) * 12)} isMobile={isMobile} />
                </div>
                <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 14, marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                    DSCR — Debt Service Coverage Ratio
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7, marginBottom: 12 }}>
                    DSCR tells lenders whether your rental income covers the loan payment. A score of 1.25 means you earn $1.25 for every $1.00 owed — lenders love this.
                  </div>
                  {[{ label: "1.25+ — Most lenders approve", color: "#22c55e" }, { label: "1.10–1.24 — Some lenders, higher rate", color: "#f59e0b" }, { label: "1.00–1.09 — Very limited options", color: "#f97316" }, { label: "Below 1.0 — Negative cash flow", color: "#ef4444" }].map((row) => (
                    <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: "#94a3b8" }}>{row.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "stress" && (
            <div>
              <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Sensitivity Stress Test</div>
              <div style={{ fontSize: isMobile ? 13 : 12, color: "#64748b", marginBottom: 16, lineHeight: 1.5 }}>Best Case: rehab -10%, ARV +5% · Worst Case: rehab +20%, ARV -5%</div>
              <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 10 : 8 }}>
                {!isMobile && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 80px", gap: 8, padding: "8px 14px" }}>
                    {["Scenario", "Net Profit", "ROI", "Leverage", "Score"].map((h) => <div key={h} style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em" }}>{h}</div>)}
                  </div>
                )}
                {SCENARIOS.map((s) => <ScenarioRow key={s.label} scenario={s} inputs={inputs} isMobile={isMobile} />)}
              </div>
              <div style={{ marginTop: 24, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Deal Health Check</div>
                {[{ label: "LTV under 80%", pass: metrics.ltv < 80 }, { label: "LTC under 90%", pass: metrics.ltc < 90 }, { label: "Net profit above $20,000", pass: metrics.netProfit > 20000 }, { label: "ROI above 15%", pass: metrics.roi > 15 }, { label: "Equity position above 20%", pass: metrics.equityPercent > 20 }].map((check) => (
                  <div key={check.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 20, height: 20, borderRadius: 4, flexShrink: 0, background: check.pass ? "#0d3d1f" : "#2a0a0a", border: `1px solid ${check.pass ? "#16a34a" : "#dc2626"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: check.pass ? "#22c55e" : "#f87171" }}>{check.pass ? "✓" : "✗"}</div>
                    <span style={{ fontSize: 13, color: check.pass ? "#94a3b8" : "#f87171" }}>{check.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "scope" && (
            <ScopeOfWorkTab
              scopeItems={activeDeal.scopeItems} address={inputs.propertyAddress} isMobile={isMobile}
              onAdd={() => updateDeal({ scopeItems: [...activeDeal.scopeItems, { id: uid(), category: "Other", description: "", quantity: 1, unit: "lot", myEstimate: 0, notes: "", priority: "important" }] })}
              onUpdate={(id, u) => updateDeal({ scopeItems: activeDeal.scopeItems.map((s) => s.id === id ? { ...s, ...u } : s) })}
              onDelete={(id) => updateDeal({ scopeItems: activeDeal.scopeItems.filter((s) => s.id !== id) })}
            />
          )}

          {activeTab === "packet" && (
            <LenderPacketTab deal={activeDeal} metrics={metrics} lenderInfo={activeDeal.lenderInfo ?? BLANK_LENDER_INFO} isMobile={isMobile}
              onUpdateLenderInfo={(u) => updateDeal({ lenderInfo: { ...(activeDeal.lenderInfo ?? BLANK_LENDER_INFO), ...u } })} />
          )}
        </div>
      </div>
    </div>
  );
}