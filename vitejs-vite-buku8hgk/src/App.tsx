import { useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AIFinding, WalkthroughCaptureMode, PendingWalkthroughJob, PropertyChanges, AnalyzeWalkthroughResponse } from "./walkthroughTypes";
import { normalizePropertyChanges } from "./walkthroughTypes";
import { WalkthroughMediaRecorder, WALKTHROUGH_TRIGGER_KEY, isMobileDevice, loadPendingJobs, savePendingJobs, type AIGateDeal } from "./walkthroughMedia";
import { useSubscription } from "./useSubscription";
import { PaywallModal } from "./PaywallModal";
// ─── Supabase Client ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://gnygraconlpwzvllayoq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdueWdyYWNvbmxwd3p2bGxheW9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NjA4NzQsImV4cCI6MjA5MTUzNjg3NH0.fKZ0G0Q6jGxGrX-onuKmklB1HeSuxyWI3c3lkftOvkg";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────
type RehabCostSource = "initial" | "ai_walkthrough" | "manual";
type ArvSource = "initial" | "comp_derived";

interface DealInputs {
  propertyAddress: string;
  purchasePrice: number;
  /** Computed from active rehab source — kept in sync for metrics + save */
  rehabCost: number;
  /** Initial / baseline rehab figure (editable) */
  rehabInitialEstimate: number;
  rehabManualOverride: number;
  rehabCostSource: RehabCostSource;
  /** Computed from active ARV source — kept in sync for metrics + save */
  arv: number;
  arvInitialEstimate: number;
  arvSource: ArvSource;
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
  /** Max allowable offer: percent of ARV used in MAO = (ARV × MAO%) − Rehab */
  maoPercent: number;
}

interface Comp {
  id: string; address: string; salePrice: number; sqft: number;
  bedBath: string; daysOnMarket: number; soldDate: string;
  strength: "strong" | "average" | "weak"; notes: string;
}

interface RentalComp {
  id: string;
  address: string;
  monthlyRent: number;
  bedBath: string;
  distance: string;
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

interface PersistedDealPhoto {
  id: string;
  dealId: string;
  userId: string;
  storagePath: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  flaggedForAi: boolean;
  displayOrder: number;
  createdAt: string;
  signedUrl?: string;
}

interface Deal {
  id: string; createdAt: string; updatedAt: string;
  inputs: DealInputs; comps: Comp[]; subjectSqft: number;
  subjectBedrooms: number;
  subjectBathrooms: number;
  /** Construction year (AI walkthrough); null = not set — do not default (avoids false lead-paint heuristics) */
  yearBuilt: number | null;
  lenderInfo: LenderInfo; scopeItems: ScopeItem[];
  rentalComps: RentalComp[];
  /** First successful AI walkthrough or RentCast on this deal counts toward trial */
  aiAnalysisUsed?: boolean;
  /** If true, user created this deal without AI (trial exhausted) — no AI until Investor */
  aiLocked?: boolean;
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
  propertyAddress: "",
  purchasePrice: 0,
  rehabInitialEstimate: 0,
  rehabManualOverride: 0,
  rehabCostSource: "initial",
  rehabCost: 0,
  arvInitialEstimate: 0,
  arvSource: "initial",
  arv: 0,
  loanAmount: 0,
  interestRate: 11.5, loanTermMonths: 12, holdingMonths: 6,
  closingCostsBuy: 0, closingCostsSell: 0, monthlyRent: 0, monthlyExpenses: 0,
  notes: "", dealStatus: "prospect",
  maoPercent: 70,
};

const BLANK_LENDER_INFO: LenderInfo = {
  investorName: "", investorCompany: "", investorPhone: "", investorEmail: "", lenderName: "",
};

const DEMO_INPUTS: DealInputs = {
  propertyAddress: "123 Main St, Atlanta, GA 30301",
  purchasePrice: 120000,
  rehabInitialEstimate: 45000,
  rehabManualOverride: 0,
  rehabCostSource: "initial",
  rehabCost: 45000,
  arvInitialEstimate: 225000,
  arvSource: "initial",
  arv: 225000,
  loanAmount: 148500,
  interestRate: 11.5, loanTermMonths: 12, holdingMonths: 6,
  closingCostsBuy: 3500, closingCostsSell: 13500, monthlyRent: 1800, monthlyExpenses: 400,
  notes: "Solid bones. Needs full kitchen/bath remodel. Roof is 4 years old — good shape.",
  dealStatus: "prospect",
  maoPercent: 70,
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

/** Pre-seeded demo deal — excluded from trial usage counting */
const DEMO_DEAL_ID = "27695e3f-a022-4c13-8f8e-6d290ba5b9d4";

/** Persisted when user selects a deal — restored on full page load (e.g. Android background resume / reload) */
const SELECTED_DEAL_STORAGE_KEY = "fliplogic_selected_deal_id";

function readSelectedDealIdFromStorage(): string | null {
  try {
    return localStorage.getItem(SELECTED_DEAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Prefer saved id if that deal is still in the list; else first (most recent) deal */
function pickActiveDealIdOnLoad(assembled: Deal[]): string | null {
  if (assembled.length === 0) return null;
  const saved = readSelectedDealIdFromStorage();
  if (saved && assembled.some((d) => d.id === saved)) return saved;
  return assembled[0].id;
}

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

function calculateAIWalkthroughRehab(scopeItems: ScopeItem[]): number {
  return scopeItems.reduce((s, i) => s + (i.myEstimate || 0), 0);
}

function calculateActiveRehab(inputs: DealInputs, scopeItems: ScopeItem[]): number {
  if (inputs.rehabCostSource === "ai_walkthrough") {
    return calculateAIWalkthroughRehab(scopeItems);
  }
  if (inputs.rehabCostSource === "manual") {
    return inputs.rehabManualOverride;
  }
  return inputs.rehabInitialEstimate;
}

function calculateActiveARV(inputs: DealInputs, comps: Comp[], subjectSqft: number): number {
  if (inputs.arvSource === "comp_derived") {
    return calculateCompARV(comps, subjectSqft).weightedArv;
  }
  return inputs.arvInitialEstimate;
}

/**
 * Standard formula: MAO = (ARV × MAO%) − Rehab Cost
 * Example: ARV $275,000, Rehab $45,000, MAO% 70 → MAO = ($275,000 × 0.70) − $45,000 = $147,500
 */
function calculateMAO(activeARV: number, activeRehab: number, maoPercent: number): number {
  if (!activeARV || activeARV <= 0 || !maoPercent || maoPercent <= 0) return 0;
  return Math.max(0, (activeARV * (maoPercent / 100)) - (activeRehab || 0));
}

function applySyncedRehabArv(d: Deal): Deal {
  const r = calculateActiveRehab(d.inputs, d.scopeItems);
  const a = calculateActiveARV(d.inputs, d.comps, d.subjectSqft);
  return { ...d, inputs: { ...d.inputs, rehabCost: r, arv: a } };
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const uid = () => crypto.randomUUID();

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

const DEFAULT_PASSWORD_FIELD_INPUT_STYLE: CSSProperties = {
  width: "100%",
  background: "#060b14",
  border: "1px solid #1e293b",
  borderRadius: 6,
  color: "#f1f5f9",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

function PasswordFieldWithVisibilityToggle({
  value,
  onChange,
  onKeyDown,
  placeholder,
  inputStyle,
}: {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  inputStyle?: CSSProperties;
}) {
  const [visible, setVisible] = useState(false);
  const [toggleFocused, setToggleFocused] = useState(false);
  const inputMerged: CSSProperties = {
    ...DEFAULT_PASSWORD_FIELD_INPUT_STYLE,
    ...inputStyle,
    marginBottom: 0,
    padding: "10px 48px 10px 12px",
  };
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={inputMerged}
      />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((v) => !v)}
        onFocus={() => setToggleFocused(true)}
        onBlur={() => setToggleFocused(false)}
        style={{
          position: "absolute",
          right: 2,
          top: "50%",
          transform: "translateY(-50%)",
          minWidth: 44,
          minHeight: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          borderRadius: 6,
          zIndex: 1,
          color: visible ? "#475569" : "#94a3b8",
          boxShadow: toggleFocused ? "0 0 0 2px rgba(59, 130, 246, 0.45)" : "none",
        }}
      >
        {visible ? <EyeOff size={22} strokeWidth={2} color="currentColor" /> : <Eye size={22} strokeWidth={2} color="currentColor" />}
      </button>
    </div>
  );
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth, onForgotPassword }: { onAuth: () => void; onForgotPassword: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [termsRequiredError, setTermsRequiredError] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) { setError("Please enter email and password."); return; }
    if (mode === "signup") {
      if (!termsAgreed) {
        setTermsRequiredError(true);
        return;
      }
    }
    setLoading(true); setError(""); setMessage(""); setTermsRequiredError(false);
    try {
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              marketing_opt_in: marketingOptIn,
            },
          },
        });
        if (signUpError) throw signUpError;
        setMessage("Account created! Please check your email to verify your account, then sign in below.");
        setMode("signin");
        setTermsAgreed(false);
        setMarketingOptIn(false);
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
    <div style={{ minHeight: "100vh", background: "#060b14", display: "flex", flexDirection: "column", fontFamily: "'Syne', sans-serif", boxSizing: "border-box" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: narrow ? "16px 12px" : 0, boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 400, padding: narrow ? "28px 20px" : 40, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 12, boxSizing: "border-box" }}>
        <div style={{ textAlign: "center", marginBottom: narrow ? 24 : 32 }}>
          <div style={{ fontSize: narrow ? 24 : 28, fontWeight: 800, color: "#f1f5f9", marginBottom: 6 }}>
            FLIP<span style={{ color: "#3b82f6" }}>LOGIC</span> AI
          </div>
          <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.15em" }}>COMMAND CENTER · DEAL ANALYZER</div>
        </div>

        <div style={{ display: "flex", marginBottom: 24, background: "#060b14", borderRadius: 8, padding: 4 }}>
          {(["signin", "signup"] as const).map((m) => (
            <button key={m} onClick={() => { setMode(m); setError(""); setMessage(""); setTermsAgreed(false); setMarketingOptIn(false); setTermsRequiredError(false); }}
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

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Password</label>
          <PasswordFieldWithVisibilityToggle
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="••••••••"
          />
        </div>
        {mode === "signin" && (
          <button
            type="button"
            onClick={onForgotPassword}
            style={{ background: "transparent", border: "none", color: "#60a5fa", fontSize: 12, cursor: "pointer", padding: 0, marginBottom: 14, fontFamily: "'Syne', sans-serif" }}
          >
            Forgot password?
          </button>
        )}

        {mode === "signup" && (
          <div style={{ marginBottom: 12 }}>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                minHeight: 44,
                padding: "6px 0",
                marginBottom: termsRequiredError ? 6 : 0,
                cursor: "pointer",
                boxSizing: "border-box",
              }}
            >
              <input
                type="checkbox"
                checked={termsAgreed}
                onChange={(e) => {
                  setTermsAgreed(e.target.checked);
                  if (e.target.checked) setTermsRequiredError(false);
                }}
                style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0, cursor: "pointer", accentColor: "#3b82f6" }}
              />
              <span style={{ fontSize: 13, color: "#e2e8f0", lineHeight: 1.5, fontWeight: 500 }}>
                I agree to the{" "}
                <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "underline" }}>Terms of Service</a>
                {" "}and{" "}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "underline" }}>Privacy Policy</a>
                .
              </span>
            </label>
            {termsRequiredError ? (
              <div style={{ fontSize: 12, color: "#f87171", marginLeft: 28, lineHeight: 1.4 }}>
                You must agree to the Terms of Service and Privacy Policy to create an account.
              </div>
            ) : null}
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                minHeight: 44,
                padding: "6px 0",
                marginTop: 4,
                cursor: "pointer",
                boxSizing: "border-box",
              }}
            >
              <input
                type="checkbox"
                checked={marketingOptIn}
                onChange={(e) => setMarketingOptIn(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0, cursor: "pointer", accentColor: "#3b82f6" }}
              />
              <span style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5, fontWeight: 400 }}>
                Send me product updates, tips, and announcements from FlipLogic AI. (Optional — you can unsubscribe anytime.)
              </span>
            </label>
          </div>
        )}

        {error && <div style={{ background: "#2a0a0a", border: "1px solid #dc2626", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#f87171", marginBottom: 14 }}>{error}</div>}
        {message && <div style={{ background: "#0d3d1f", border: "1px solid #16a34a", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#22c55e", marginBottom: 14 }}>{message}</div>}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || (mode === "signup" && !termsAgreed)}
          style={{
            width: "100%",
            background: (loading || (mode === "signup" && !termsAgreed)) ? "#1e293b" : "linear-gradient(135deg, #1d4ed8, #1e40af)",
            border: "none",
            borderRadius: 8,
            color: (loading || (mode === "signup" && !termsAgreed)) ? "#94a3b8" : "#fff",
            padding: narrow ? "14px 0" : "12px 0",
            minHeight: narrow ? 48 : undefined,
            fontSize: narrow ? 14 : 13,
            fontWeight: 700,
            cursor: (loading || (mode === "signup" && !termsAgreed)) ? "not-allowed" : "pointer",
            fontFamily: "'Syne', sans-serif",
            letterSpacing: "0.05em",
          }}
        >
          {loading ? "Please wait..." : mode === "signin" ? "SIGN IN" : "CREATE ACCOUNT"}
        </button>

        <div style={{ marginTop: 20, fontSize: 11, color: "#334155", textAlign: "center", lineHeight: 1.6 }}>
          Your deals are encrypted and synced across all your devices.
        </div>
      </div>
      </div>
      <div style={{ fontSize: 11, color: "#64748b", textAlign: "center", padding: "0 16px 20px", lineHeight: 1.6 }}>
        Legal:{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "#64748b", textDecoration: "underline" }}>
          Privacy Policy
        </a>
        {" "}
        ·{" "}
        <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#64748b", textDecoration: "underline" }}>
          Terms of Service
        </a>
      </div>
    </div>
  );
}

function ForgotPasswordScreen({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  const sendReset = async () => {
    const trimmed = email.trim();
    if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: window.location.origin,
      });
      if (resetError) throw resetError;
      setSentTo(trimmed);
    } catch (e: any) {
      setError(e?.message || "Could not send reset link.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#060b14", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", padding: "16px 12px", boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 420, padding: 28, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 12, boxSizing: "border-box" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", marginBottom: 8 }}>Reset your password</div>
        <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5, marginBottom: 18 }}>Enter your email and we&apos;ll send you a link to reset your password.</div>
        {!sentTo ? (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendReset()}
                placeholder="you@example.com"
                style={{ width: "100%", background: "#060b14", border: "1px solid #1e293b", borderRadius: 6, color: "#f1f5f9", padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            {error ? <div style={{ background: "#2a0a0a", border: "1px solid #dc2626", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#f87171", marginBottom: 12 }}>{error}</div> : null}
            <button
              type="button"
              onClick={sendReset}
              disabled={loading}
              style={{ width: "100%", background: loading ? "#1e293b" : "linear-gradient(135deg, #1d4ed8, #1e40af)", border: "none", borderRadius: 8, color: "#fff", padding: "12px 0", minHeight: 44, fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: "'Syne', sans-serif", marginBottom: 10 }}
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </>
        ) : (
          <div style={{ background: "#0d3d1f", border: "1px solid #16a34a", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#22c55e", marginBottom: 12 }}>
            Check your email. We&apos;ve sent a password reset link to {sentTo}.
          </div>
        )}
        <button type="button" onClick={onBack} style={{ background: "transparent", border: "none", color: "#60a5fa", fontSize: 12, cursor: "pointer", padding: 0, fontFamily: "'Syne', sans-serif" }}>
          ← Back to sign in
        </button>
      </div>
    </div>
  );
}

function ResetPasswordScreen({ onDone }: { onDone: () => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const updatePassword = async () => {
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", window.location.pathname);
      }
      setNewPassword("");
      setConfirmPassword("");
      onDone();
      return true;
    } catch (e: any) {
      setError(e?.message || "Could not update password.");
      return false;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#060b14", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", padding: "16px 12px", boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 420, padding: 28, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 12, boxSizing: "border-box" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", marginBottom: 8 }}>Set a new password</div>
        <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5, marginBottom: 18 }}>Choose a new password for your account.</div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>New password</label>
          <PasswordFieldWithVisibilityToggle value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Confirm new password</label>
          <PasswordFieldWithVisibilityToggle
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void updatePassword()}
            placeholder="••••••••"
          />
        </div>
        {error ? <div style={{ background: "#2a0a0a", border: "1px solid #dc2626", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#f87171", marginBottom: 12 }}>{error}</div> : null}
        <button type="button" onClick={() => { void updatePassword(); }} disabled={loading} style={{ width: "100%", background: loading ? "#1e293b" : "linear-gradient(135deg, #1d4ed8, #1e40af)", border: "none", borderRadius: 8, color: "#fff", padding: "12px 0", minHeight: 44, fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: "'Syne', sans-serif" }}>
          {loading ? "Updating..." : "Update password"}
        </button>
      </div>
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function InputField({ label, value, onChange, prefix = "$", suffix = "", isMobile = false, hideLabel = false }: {
  label: string; value: number; onChange: (v: number) => void; prefix?: string; suffix?: string; isMobile?: boolean; hideLabel?: boolean;
}) {
  const pad = isMobile ? "12px 14px" : "8px 10px";
  const minH = isMobile ? 44 : undefined;
  return (
    <div style={{ marginBottom: hideLabel ? 0 : isMobile ? 14 : 12 }}>
      {!hideLabel && <label style={{ display: "block", fontSize: isMobile ? 12 : 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</label>}
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

function AILockOverlay({
  message,
  subtext,
  onUpgrade,
}: {
  message: string;
  subtext?: string;
  onUpgrade: () => void;
}) {
  return (
    <div
      style={{
        width: "100%",
        borderRadius: 8,
        padding: 18,
        background: "rgba(255, 165, 0, 0.08)",
        border: "1px solid rgba(255, 165, 0, 0.4)",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 26, marginBottom: 8 }}>🔒</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#FFA500", marginBottom: 8 }}>{message}</div>
      <div style={{ fontSize: 13, color: "#ccc", lineHeight: 1.5, marginBottom: 12 }}>
        {subtext || "Upgrade to Investor for unlimited AI analyses on all your deals."}
      </div>
      <button
        type="button"
        onClick={onUpgrade}
        style={{
          background: "#FFA500",
          border: "none",
          borderRadius: 8,
          color: "#111827",
          padding: "10px 16px",
          minHeight: 44,
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "'Syne', sans-serif",
        }}
      >
        Upgrade to Investor
      </button>
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

const DEAL_PHOTOS_MAX_BYTES = 400 * 1024;
const DEAL_PHOTOS_MAX_WIDTH = 1920;
const DEAL_PHOTOS_JPEG_QUALITY = 0.82;

async function loadImageForCompression(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image decode failed"));
        img.src = url;
      });
      return img;
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function getImageWidthHeight(img: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  if (img instanceof ImageBitmap) return { w: img.width, h: img.height };
  return { w: img.naturalWidth, h: img.naturalHeight };
}

/**
 * Client-side compression for deal-photos uploads.
 * Target ~400 KB JPEG at quality 0.82, max width 1920 (preserve aspect ratio).
 * All non-JPEG sources are decoded and re-encoded as JPEG before upload so Storage + Edge see image/jpeg consistently.
 */
function isProbablyJpegFile(file: File): boolean {
  const t = file.type?.toLowerCase() ?? "";
  return t === "image/jpeg" || t === "image/jpg" || /\.jpe?g$/i.test(file.name);
}

async function decodeImageBlobToPixels(blob: Blob): Promise<ImageBitmap | HTMLImageElement | null> {
  try {
    return await createImageBitmap(blob);
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image decode failed"));
        img.src = url;
      });
      return img;
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Draw decoded bitmap to canvas → JPEG (~400 KB cap), max width 1920. Closes img if ImageBitmap. */
async function jpegEncodeDecodedImage(
  img: ImageBitmap | HTMLImageElement,
  maxSourceW: number,
  maxSourceH: number,
): Promise<{ blob: Blob; contentType: string } | null> {
  let targetW = maxSourceW;
  let targetH = maxSourceH;
  if (targetW > DEAL_PHOTOS_MAX_WIDTH && targetW > 0) {
    targetW = DEAL_PHOTOS_MAX_WIDTH;
    targetH = Math.max(1, Math.round(maxSourceH * (DEAL_PHOTOS_MAX_WIDTH / maxSourceW)));
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    if (img instanceof ImageBitmap) img.close();
    console.error("Canvas 2D context unavailable");
    return null;
  }
  ctx.drawImage(img, 0, 0, targetW, targetH);
  if (img instanceof ImageBitmap) img.close();

  let quality = DEAL_PHOTOS_JPEG_QUALITY;
  let blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  while (blob && blob.size > DEAL_PHOTOS_MAX_BYTES && quality > 0.45) {
    quality -= 0.05;
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  }
  if (!blob) {
    console.error("JPEG encode failed");
    return null;
  }
  return { blob, contentType: "image/jpeg" };
}

async function compressImageForDealPhoto(file: File): Promise<{ blob: Blob; contentType: string } | null> {
  const looksHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.hei[cf]$/i.test(file.name);

  const img = await loadImageForCompression(file);
  if (!img) {
    if (looksHeic) console.warn("HEIC/HEIF could not be decoded in this browser:", file.name);
    else console.warn("Could not decode image for upload (unsupported format or corrupt file):", file.name);
    return null;
  }

  try {
    const { w, h } = getImageWidthHeight(img);
    const underDim = w <= DEAL_PHOTOS_MAX_WIDTH && h > 0;
    const underSize = file.size <= DEAL_PHOTOS_MAX_BYTES;

    if (underDim && underSize && isProbablyJpegFile(file)) {
      if (img instanceof ImageBitmap) img.close();
      return { blob: file, contentType: "image/jpeg" };
    }

    return await jpegEncodeDecodedImage(img, w, h);
  } catch (e) {
    console.warn(looksHeic ? "HEIC/HEIF decode failed — skipping file:" : "Image compression failed:", file.name, e);
    if (img instanceof ImageBitmap) img.close();
    return null;
  }
}

function usePhotos(dealId: string | null) {
  const [photos, setPhotos] = useState<PersistedDealPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Keeps toggleFlag stable ([] deps) without stale dealId when switching deals */
  const dealIdRef = useRef(dealId);
  dealIdRef.current = dealId;
  /** Ignore realtime UPDATE refreshes briefly after local optimistic toggle (avoids overwriting UI + avoids refresh storms). */
  const realtimeSkipPhotoIdsRef = useRef(new Set<string>());
  const realtimeSkipTimersRef = useRef(new Map<string, number>());

  const markRealtimeSkipForToggle = useCallback((photoId: string) => {
    const timers = realtimeSkipTimersRef.current;
    const prev = timers.get(photoId);
    if (prev !== undefined) window.clearTimeout(prev);
    realtimeSkipPhotoIdsRef.current.add(photoId);
    timers.set(
      photoId,
      window.setTimeout(() => {
        realtimeSkipPhotoIdsRef.current.delete(photoId);
        timers.delete(photoId);
      }, 2000),
    );
  }, []);

  const refresh = useCallback(async (options?: { background?: boolean }) => {
    if (!dealId) {
      setPhotos([]);
      return;
    }
    const background = Boolean(options?.background);
    if (!background) setLoading(true);
    if (!background) setError(null);
    try {
      const { data: rows, error: qErr } = await supabase
        .from("deal_photos")
        .select("id, deal_id, user_id, storage_path, file_name, file_size_bytes, mime_type, flagged_for_ai, display_order, created_at")
        .eq("deal_id", dealId)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (qErr) throw qErr;
      const list: PersistedDealPhoto[] = [];
      for (const row of rows ?? []) {
        const r = row as Record<string, unknown>;
        const storagePath = String(r.storage_path ?? "");
        let signedUrl: string | undefined;
        try {
          const { data: signed, error: signErr } = await supabase.storage.from("deal-photos").createSignedUrl(storagePath, 3600);
          if (signErr) throw signErr;
          signedUrl = signed?.signedUrl;
        } catch (signE) {
          console.error("Signed URL failed for", storagePath, signE);
        }
        list.push({
          id: String(r.id ?? ""),
          dealId: String(r.deal_id ?? ""),
          userId: String(r.user_id ?? ""),
          storagePath,
          fileName: String(r.file_name ?? ""),
          fileSizeBytes: Number(r.file_size_bytes ?? 0),
          mimeType: String(r.mime_type ?? ""),
          flaggedForAi: Boolean(r.flagged_for_ai),
          displayOrder: Number(r.display_order ?? 0),
          createdAt: String(r.created_at ?? ""),
          signedUrl,
        });
      }
      setPhotos(list);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not load deal photos.";
      console.error(e);
      if (!background) setError(msg);
    } finally {
      if (!background) setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    if (!dealId) {
      setPhotos([]);
      return;
    }
    void refresh();
  }, [dealId, refresh]);

  useEffect(() => {
    realtimeSkipPhotoIdsRef.current.clear();
    realtimeSkipTimersRef.current.forEach((t) => window.clearTimeout(t));
    realtimeSkipTimersRef.current.clear();
  }, [dealId]);

  useEffect(() => {
    if (!dealId) return;
    const channel = supabase
      .channel(`deal_photos:${dealId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deal_photos", filter: `deal_id=eq.${dealId}` },
        (payload: { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
          if (payload.eventType === "UPDATE") {
            const rawId = payload.new?.id ?? payload.old?.id;
            if (rawId != null && realtimeSkipPhotoIdsRef.current.has(String(rawId))) {
              console.log("[usePhotos realtime] skip refresh (pending local flag toggle)", String(rawId));
              return;
            }
          }
          void refresh({ background: true });
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") console.error("Realtime subscription error for deal_photos", dealId);
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [dealId, refresh]);

  const uploadPhotos = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      console.log("[usePhotos uploadPhotos] start", { fileCount: arr.length, dealId });
      if (!dealId) {
        const msg = "No deal selected.";
        setError(msg);
        console.error(msg);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { data: userData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const user = userData.user;
        if (!user) throw new Error("You must be signed in to upload photos.");
        console.log("[usePhotos uploadPhotos] after auth", { userId: user.id });

        const { data: maxRow, error: maxErr } = await supabase
          .from("deal_photos")
          .select("display_order")
          .eq("deal_id", dealId)
          .order("display_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (maxErr) throw maxErr;
        let nextDisplayOrder = (typeof maxRow?.display_order === "number" ? maxRow.display_order : -1) + 1;

        for (const file of arr) {
          try {
            const looksHeic =
              file.type === "image/heic" ||
              file.type === "image/heif" ||
              /\.hei[cf]$/i.test(file.name);
            const compressed = await compressImageForDealPhoto(file);
            if (!compressed) {
              setError(
                looksHeic
                  ? "Could not process this photo. If it's a HEIC photo from iPhone, try saving it as JPEG first."
                  : "Could not process this photo. Unsupported format or the file may be corrupted.",
              );
              continue;
            }

            const photoUuid = crypto.randomUUID();
            const storagePath = `${user.id}/${dealId}/${photoUuid}.jpg`;
            const contentType = compressed.contentType;

            console.log("[usePhotos uploadPhotos] before storage.upload", { storagePath, contentType, bytes: compressed.blob.size });
            const { error: upErr } = await supabase.storage.from("deal-photos").upload(storagePath, compressed.blob, {
              contentType,
              cacheControl: "3600",
              upsert: false,
            });
            console.log("[usePhotos uploadPhotos] after storage.upload", { storagePath, error: upErr?.message ?? null });
            if (upErr) throw upErr;

            const { error: insErr } = await supabase.from("deal_photos").insert({
              id: photoUuid,
              deal_id: dealId,
              user_id: user.id,
              storage_path: storagePath,
              file_name: file.name,
              file_size_bytes: compressed.blob.size,
              mime_type: contentType,
              flagged_for_ai: false,
              display_order: nextDisplayOrder,
            });

            if (insErr) {
              console.error(insErr);
              try {
                await supabase.storage.from("deal-photos").remove([storagePath]);
              } catch (rmErr) {
                console.error("Rollback storage delete failed:", rmErr);
              }
              throw insErr;
            }
            nextDisplayOrder += 1;
          } catch (fileErr: unknown) {
            const msg = fileErr instanceof Error ? fileErr.message : "Upload failed.";
            console.error(fileErr);
            setError(msg);
          }
        }

        await refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Upload failed.";
        console.error(e);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [dealId, refresh],
  );

  const deletePhoto = useCallback(
    async (photoId: string) => {
      if (!dealId) {
        const msg = "No deal selected.";
        setError(msg);
        console.error(msg);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { data: row, error: fetchErr } = await supabase
          .from("deal_photos")
          .select("storage_path")
          .eq("id", photoId)
          .eq("deal_id", dealId)
          .maybeSingle();
        if (fetchErr) throw fetchErr;
        const storagePath = row?.storage_path as string | undefined;
        if (!storagePath) throw new Error("Photo not found.");

        const { error: stErr } = await supabase.storage.from("deal-photos").remove([storagePath]);
        if (stErr) throw stErr;

        const { error: delErr } = await supabase.from("deal_photos").delete().eq("id", photoId).eq("deal_id", dealId);
        if (delErr) throw delErr;

        await refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not delete photo.";
        console.error(e);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [dealId, refresh],
  );

  const bulkDeletePhotos = useCallback(
    async (photoIds: string[]) => {
      if (!dealId || photoIds.length === 0) return;
      setLoading(true);
      setError(null);
      try {
        const uniq = [...new Set(photoIds)].filter(Boolean);
        await Promise.all(
          uniq.map(async (photoId) => {
            const { data: row, error: fetchErr } = await supabase
              .from("deal_photos")
              .select("storage_path")
              .eq("id", photoId)
              .eq("deal_id", dealId)
              .maybeSingle();
            if (fetchErr) throw fetchErr;
            const storagePath = row?.storage_path as string | undefined;
            if (!storagePath) throw new Error("Photo not found.");
            const { error: stErr } = await supabase.storage.from("deal-photos").remove([storagePath]);
            if (stErr) throw stErr;
            const { error: delErr } = await supabase.from("deal_photos").delete().eq("id", photoId).eq("deal_id", dealId);
            if (delErr) throw delErr;
          }),
        );
        await refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not delete photos.";
        console.error(e);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [dealId, refresh],
  );

  const bulkSetFlags = useCallback(
    async (targetFlagValue: boolean) => {
      const effectiveDealId = dealIdRef.current;
      if (!effectiveDealId) {
        const msg = "No deal selected.";
        setError(msg);
        console.error(msg);
        return;
      }

      let priorSnapshot: PersistedDealPhoto[] | undefined;

      setPhotos((prev) => {
        if (prev.length === 0) return prev;
        priorSnapshot = prev.map((p) => ({ ...p }));
        for (const p of prev) {
          markRealtimeSkipForToggle(p.id);
        }
        return prev.map((p) => ({ ...p, flaggedForAi: targetFlagValue }));
      });

      await Promise.resolve();

      if (!priorSnapshot || priorSnapshot.length === 0) return;

      const ids = priorSnapshot.map((p) => p.id);
      try {
        setError(null);
        const { data, error: upErr } = await supabase
          .from("deal_photos")
          .update({ flagged_for_ai: targetFlagValue })
          .eq("deal_id", effectiveDealId)
          .in("id", ids)
          .select("id");

        if (upErr || !data || data.length === 0) {
          setPhotos(priorSnapshot);
          setError("Could not update selection — please try again.");
          console.error("[usePhotos bulkSetFlags] update failed", { error: upErr, data });
        }
      } catch (err) {
        setPhotos(priorSnapshot);
        setError("Could not update selection — please try again.");
        console.error("[usePhotos bulkSetFlags] exception", err);
      }
    },
    [markRealtimeSkipForToggle],
  );

  const toggleFlag = useCallback(async (photoId: string) => {
    const effectiveDealId = dealIdRef.current;
    if (!effectiveDealId) {
      const msg = "No deal selected.";
      setError(msg);
      console.error(msg);
      return;
    }

    let priorRow: PersistedDealPhoto | undefined;
    let newFlaggedValue: boolean | undefined;

    console.time("toggleFlag-visual");
    markRealtimeSkipForToggle(photoId);
    setPhotos((prev) => {
      const found = prev.find((p) => p.id === photoId);
      if (!found) return prev;
      priorRow = found;
      newFlaggedValue = !found.flaggedForAi;
      return prev.map((p) => (p.id === photoId ? { ...p, flaggedForAi: newFlaggedValue! } : p));
    });
    console.timeEnd("toggleFlag-visual");

    await Promise.resolve();

    if (!priorRow || newFlaggedValue === undefined) {
      const tSkip = realtimeSkipTimersRef.current.get(photoId);
      if (tSkip !== undefined) window.clearTimeout(tSkip);
      realtimeSkipTimersRef.current.delete(photoId);
      realtimeSkipPhotoIdsRef.current.delete(photoId);
      setError("Photo not found.");
      console.error("[usePhotos toggleFlag] photo not found in current list", photoId);
      return;
    }

    const originalFlagged = priorRow.flaggedForAi;

    try {
      setError(null);
      let data: { id: unknown; flagged_for_ai: unknown }[] | null;
      let supaErr;
      console.time("toggleFlag-db");
      try {
        const res = await supabase
          .from("deal_photos")
          .update({ flagged_for_ai: newFlaggedValue })
          .eq("id", photoId)
          .eq("deal_id", effectiveDealId)
          .select("id, flagged_for_ai");
        data = res.data as typeof data;
        supaErr = res.error;
      } finally {
        console.timeEnd("toggleFlag-db");
      }

      if (supaErr || !data || data.length === 0) {
        setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, flaggedForAi: originalFlagged } : p)));
        setError("Could not update flag — please try again.");
        console.error("[usePhotos toggleFlag] update failed", { error: supaErr, data });
      }
    } catch (err) {
      setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, flaggedForAi: originalFlagged } : p)));
      setError("Could not update flag — please try again.");
      console.error("[usePhotos toggleFlag] exception", err);
    }
  }, [markRealtimeSkipForToggle]);

  return { photos, loading, error, uploadPhotos, deletePhoto, bulkDeletePhotos, bulkSetFlags, toggleFlag, refresh };
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Decode any browser-supported image blob and re-save as JPEG (handles legacy PNG/WEBP in Storage). */
async function jpegBlobFromAnyDownloadedBlob(blob: Blob): Promise<Blob | null> {
  const img = await decodeImageBlobToPixels(blob);
  if (!img) return null;
  const { w, h } = getImageWidthHeight(img);
  const enc = await jpegEncodeDecodedImage(img, w, h);
  return enc?.blob ?? null;
}

// ─── AI WALKTHROUGH TAB ───────────────────────────────────────────────────────
function AIWalkthroughTab({ address, onUpdateYearBuilt, onAddToScope, isMobile = false, dealId, userId, currentDeal, canUseAI, triggerAIUse, onNeedPaywall,
  propertyChangeBanner, onPropertyChangeFromAnalysis, onAcceptPropertyChangeBanner, onDismissPropertyChangeBanner, onModifyPropertySpecsManually }: {
  address: string; onUpdateYearBuilt: (y: number | null) => void; onAddToScope: (items: ScopeItem[]) => void; isMobile?: boolean;
  dealId: string; userId: string;
  currentDeal: Deal;
  canUseAI: (deal: AIGateDeal) => boolean;
  triggerAIUse: (dealId: string) => Promise<void>;
  onNeedPaywall: (reason: string) => void;
  propertyChangeBanner: PropertyChanges | null;
  onPropertyChangeFromAnalysis: (p: PropertyChanges) => void;
  onAcceptPropertyChangeBanner: () => void;
  onDismissPropertyChangeBanner: () => void;
  onModifyPropertySpecsManually: () => void;
}) {
  const [walkMode, setWalkMode] = useState<WalkthroughCaptureMode>("photos");
  const [triggerPhrase, setTriggerPhrase] = useState(() => localStorage.getItem(WALKTHROUGH_TRIGGER_KEY) || "flag this");
  const [pendingJobs, setPendingJobs] = useState<PendingWalkthroughJob[]>(() => loadPendingJobs());
  const [syncingJobId, setSyncingJobId] = useState<string | null>(null);
  const [mediaAnalyzing, setMediaAnalyzing] = useState(false);

  const [findings, setFindings] = useState<AIFinding[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [selectedFindings, setSelectedFindings] = useState<Set<number>>(new Set());
  const [localBuildYear, setLocalBuildYear] = useState("");
  const [showYearGate, setShowYearGate] = useState(false);
  const [yearGateInput, setYearGateInput] = useState("");
  const [yearGateError, setYearGateError] = useState("");
  const yearGateResolveRef = useRef<((r: { buildYear: number }) => void) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const {
    photos: persistedPhotos,
    loading: photosLoading,
    error: photosError,
    uploadPhotos,
    bulkDeletePhotos,
    bulkSetFlags,
    toggleFlag,
    refresh: refreshPhotos,
  } = usePhotos(dealId ?? null);

  const MAX_PERSISTED_PHOTOS = 200;
  const FLAGGED_FOR_AI_LIMIT = 20;
  const flaggedCount = persistedPhotos.filter((p) => p.flaggedForAi).length;
  const photoTabAccent = "#3b82f6";
  const analyzeOverAiCap = flaggedCount > FLAGGED_FOR_AI_LIMIT;
  const [photoUploadLimitNote, setPhotoUploadLimitNote] = useState<string | null>(null);
  const [photosErrorDismissed, setPhotosErrorDismissed] = useState(false);

  useEffect(() => {
    setPhotosErrorDismissed(false);
  }, [photosError]);

  useEffect(() => {
    const yb = currentDeal.yearBuilt;
    setLocalBuildYear(yb != null && yb > 0 ? String(yb) : "");
  }, [dealId, currentDeal.yearBuilt]);

  useEffect(() => {
    setShowYearGate(false);
    yearGateResolveRef.current = null;
  }, [dealId]);

  const waitForYearGate = useCallback((): Promise<{ buildYear: number }> => {
    const yb = currentDeal.yearBuilt;
    if (yb != null && yb > 0) return Promise.resolve({ buildYear: yb });
    return new Promise((resolve) => {
      setYearGateInput("");
      setYearGateError("");
      yearGateResolveRef.current = resolve;
      setShowYearGate(true);
    });
  }, [currentDeal.yearBuilt]);

  const resolveYearGate = (r: { buildYear: number }) => {
    setShowYearGate(false);
    const fn = yearGateResolveRef.current;
    yearGateResolveRef.current = null;
    fn?.(r);
  };

  const onYearGateContinue = () => {
    const t = yearGateInput.trim();
    const n = parseInt(t, 10);
    if (!Number.isFinite(n) || n < 1800 || n > 2200) {
      setYearGateError("Enter a valid year (1800–2200).");
      return;
    }
    onUpdateYearBuilt(n);
    resolveYearGate({ buildYear: n });
  };

  const onYearGateSkip = () => {
    resolveYearGate({ buildYear: 0 });
  };

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
    if (!canUseAI(currentDeal)) {
      onNeedPaywall("AI Walkthrough requires Investor plan or a free trial analysis");
      return;
    }
    const { buildYear: apiBy } = await waitForYearGate();
    setSyncingJobId(job.id);
    setError("");
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("analyze-walkthrough", {
        body: { ...job.payload, buildYear: apiBy },
      });
      if (fnErr) throw new Error(fnErr.message || String(fnErr));
      const res = data as AnalyzeWalkthroughResponse;
      const parsed = res.findings;
      if (!parsed || !Array.isArray(parsed)) throw new Error("Invalid response from analyze-walkthrough");
      setFindings(parsed);
      setSelectedFindings(new Set(parsed.map((_, i) => i)));
      onPropertyChangeFromAnalysis(normalizePropertyChanges(res.propertyChanges));
      setStatus(`Synced — ${parsed.length} findings identified.`);
      const next = loadPendingJobs().filter((j) => j.id !== job.id);
      savePendingJobs(next);
      setPendingJobs(next);
      await triggerAIUse(dealId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncingJobId(null);
    }
  };

  const analyze = async () => {
    if (walkMode !== "photos") return;

    const flaggedPhotos = persistedPhotos.filter((p) => p.flaggedForAi);
    if (flaggedPhotos.length === 0) {
      setError("Select at least one photo for AI analysis (use the circle in the top-left of each photo)");
      return;
    }
    if (flaggedPhotos.length > FLAGGED_FOR_AI_LIMIT) {
      setError(`Select at most ${FLAGGED_FOR_AI_LIMIT} photos for AI analysis — deselect extras or use bulk delete to remove them.`);
      return;
    }
    if (!dealId) {
      setError("No deal selected.");
      return;
    }
    if (!canUseAI(currentDeal)) {
      onNeedPaywall("AI Walkthrough requires Investor plan or a free trial analysis");
      return;
    }
    const { buildYear: apiBy } = await waitForYearGate();
    setAnalyzing(true);
    setError("");
    setFindings([]);
    setSelectedFindings(new Set());
    try {
      setStatus("Downloading photos for analysis...");
      const base64Array: string[] = [];
      for (let i = 0; i < flaggedPhotos.length; i++) {
        const photo = flaggedPhotos[i];
        setStatus(`Downloading photo ${i + 1} of ${flaggedPhotos.length}...`);
        const { data: blobData, error: dlErr } = await supabase.storage.from("deal-photos").download(photo.storagePath);
        if (dlErr || !blobData) {
          setStatus("");
          setError(`Failed to download photo: ${photo.fileName}`);
          return;
        }
        if (photo.mimeType && !/^image\/jpe?g$/i.test(photo.mimeType)) {
          console.warn("[analyze photos] DB mime_type is not image/jpeg — re-encoding for Edge Function:", photo.mimeType, photo.fileName);
        }
        const jpegBlob = await jpegBlobFromAnyDownloadedBlob(blobData);
        if (!jpegBlob) {
          setStatus("");
          setError(`Could not decode photo for analysis: ${photo.fileName}`);
          return;
        }
        base64Array.push(await blobToBase64(jpegBlob));
      }

      const payload = {
        mode: "photos",
        propertyAddress: address,
        buildYear: apiBy,
        framesBase64: base64Array,
        videoFrames: base64Array,
        flagTimestamps: [] as number[],
        transcript: "",
      };
      setStatus("Analyzing photos with AI...");
      const { data, error: fnErr } = await supabase.functions.invoke("analyze-walkthrough", { body: payload });
      if (fnErr) {
        const detail = (fnErr as unknown as { context?: { json?: () => Promise<unknown> } }).context?.json
          ? JSON.stringify(await (fnErr as unknown as { context: { json: () => Promise<unknown> } }).context.json())
          : fnErr.message || String(fnErr);
        throw new Error(detail);
      }
      const res = data as AnalyzeWalkthroughResponse;
      const findingsRows = res.findings;
      const serverError = res.error;
      if (serverError) throw new Error(serverError);
      if (!findingsRows || !Array.isArray(findingsRows)) throw new Error("Invalid response: " + JSON.stringify(data));
      setFindings(findingsRows);
      setSelectedFindings(new Set(findingsRows.map((_, idx) => idx)));
      onPropertyChangeFromAnalysis(normalizePropertyChanges(res.propertyChanges));
      setStatus(`Analysis complete — ${findingsRows.length} findings identified.`);

      await triggerAIUse(dealId);

      try {
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const user = authData.user;
        if (!user) throw new Error("Not signed in");
        const { error: insErr } = await supabase.from("walkthrough_findings").insert({
          mode: "photos",
          deal_id: dealId,
          user_id: user.id,
          findings: findingsRows,
          transcript: "",
          frame_storage_paths: flaggedPhotos.map((p) => p.storagePath),
        });
        if (insErr) console.error("[analyze photos] Could not persist walkthrough_findings:", insErr);
      } catch (persistErr: unknown) {
        console.error("[analyze photos] Could not persist walkthrough_findings:", persistErr);
      }
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

  const showPropertyChangeBanner = Boolean(
    propertyChangeBanner
    && dealId !== DEMO_DEAL_ID
    && (propertyChangeBanner.bedroomDelta !== 0 || propertyChangeBanner.bathroomDelta !== 0 || propertyChangeBanner.sqftDelta !== 0)
  );
  const fmtBath = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  const modeTabs: { id: WalkthroughCaptureMode; label: string }[] = [
    { id: "photos", label: "📸 Photos" },
    { id: "audio", label: "🎙️ Audio" },
    { id: "video", label: "🎥 Video" },
    { id: "audiovideo", label: "🎙️+🎥 Audio + Video" },
  ];

  const howItWorksPhotos: { icon: string; text: string }[] = [
    { icon: "1️⃣", text: "Photos are analyzed securely via FlipLogic AI — no API key required" },
    { icon: "2️⃣", text: "Select photos for analysis (up to 20) using the circle in the top-left. Click Analyze with AI or Delete below." },
    { icon: "3️⃣", text: "Set the property build year above — pre-1978 homes automatically trigger lead paint warnings" },
    { icon: "4️⃣", text: "Tap Analyze Photos — AI identifies every repair item visible in your photos and estimates costs" },
  ];
  const howItWorksByMode: Record<WalkthroughCaptureMode, { icon: string; text: string }[]> = isMobileDevice()
    ? {
        photos: howItWorksPhotos,
        audio: [
          { icon: "1️⃣", text: "Tap the 🚩 Flag button during recording to mark moments for review." },
          { icon: "2️⃣", text: "Tap Record and walk the property. Speak naturally — describe everything you see out loud" },
          { icon: "3️⃣", text: "Tap 🚩 Flag This to mark moments that need attention as you walk." },
          { icon: "4️⃣", text: "Tap Stop then Analyze Walkthrough — AI transcribes your audio and generates a scope of work" },
        ],
        video: [
          { icon: "1️⃣", text: "Tap the 🚩 Flag button during recording to mark moments for review." },
          { icon: "2️⃣", text: "Tap Record — uses your rear camera with frames captured every 3 seconds alongside your audio" },
          { icon: "3️⃣", text: "Describe what you see. Tap 🚩 Flag This to mark key moments for review during your walk." },
          { icon: "4️⃣", text: "Tap Stop then Analyze Walkthrough — AI analyzes both your audio transcript and video frames" },
        ],
        audiovideo: [
          { icon: "1️⃣", text: "Tap the 🚩 Flag button during recording to mark moments for review." },
          { icon: "2️⃣", text: "Tap Record for continuous audio. Tap 🎥 Capture Video for 5-second video bursts at key moments" },
          { icon: "3️⃣", text: "Describe what you see. Tap 🚩 Flag This to mark key moments for review during your walk." },
          { icon: "4️⃣", text: "Tap Stop then Analyze Walkthrough — AI uses your full audio timeline plus video bursts" },
        ],
      }
    : {
        photos: howItWorksPhotos,
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

  if (currentDeal.aiLocked) {
    return (
      <AILockOverlay
        message="AI Walkthrough is locked on this deal"
        onUpgrade={() => onNeedPaywall("Upgrade to Investor to unlock AI Walkthrough on locked deals")}
      />
    );
  }

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
              <div style={{ display: "flex", alignItems: "center", background: "#060b14", border: `1px solid ${(currentDeal.yearBuilt != null && currentDeal.yearBuilt > 0 && currentDeal.yearBuilt < 1978) ? "#d97706" : "#1e293b"}`, borderRadius: 6, overflow: "hidden", width: isMobile ? "100%" : 120, minHeight: isMobile ? 44 : undefined }}>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="—"
                  value={localBuildYear}
                  onChange={(e) => {
                    const t = e.target.value;
                    if (t === "") { setLocalBuildYear(""); onUpdateYearBuilt(null); return; }
                    if (!/^\d{1,4}$/.test(t)) return;
                    setLocalBuildYear(t);
                    if (t.length === 4) {
                      const n = parseInt(t, 10);
                      if (n >= 1500 && n <= 2500) onUpdateYearBuilt(n);
                    }
                  }}
                  onBlur={() => {
                    const t = localBuildYear.trim();
                    if (t === "") { onUpdateYearBuilt(null); return; }
                    const n = parseInt(t, 10);
                    if (Number.isFinite(n) && n >= 1500 && n <= 2500) {
                      onUpdateYearBuilt(n);
                      setLocalBuildYear(String(n));
                    } else {
                      setLocalBuildYear(currentDeal.yearBuilt != null && currentDeal.yearBuilt > 0 ? String(currentDeal.yearBuilt) : "");
                    }
                  }}
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#f1f5f9", padding: isMobile ? "12px 14px" : "8px 10px", fontSize: isMobile ? 16 : 14, fontFamily: "monospace" }}
                />
              </div>
            </div>
            {currentDeal.yearBuilt != null && currentDeal.yearBuilt > 0 && currentDeal.yearBuilt < 1978 && <div style={{ background: "#2d2000", border: "1px solid #d97706", borderRadius: 6, padding: "10px 14px", fontSize: isMobile ? 12 : 11, color: "#f59e0b", lineHeight: 1.45 }}>⚠ Pre-1978 build — AI will flag lead paint risk automatically</div>}
          </div>

          {walkMode === "photos" && photosLoading && persistedPhotos.length === 0 ? (
            <div style={{ textAlign: "center", padding: isMobile ? "40px 16px" : "48px 16px", color: "#94a3b8", marginBottom: 16, fontSize: isMobile ? 15 : 14 }}>Loading photos...</div>
          ) : walkMode === "photos" ? (
            <>
              {photosError && !photosErrorDismissed && (
                <div style={{ background: "#2a0a0a", border: "1px solid #dc2626", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#f87171", marginBottom: 12, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span>Photo error: {photosError}</span>
                  <button
                    type="button"
                    onClick={() => setPhotosErrorDismissed(true)}
                    style={{ background: "transparent", border: "1px solid #64748b", borderRadius: 6, color: "#94a3b8", padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: photoUploadLimitNote ? 6 : 10,
                  fontSize: isMobile ? 13 : 12,
                  color: "#94a3b8",
                }}
              >
                <div>
                  <div>{persistedPhotos.length} of {MAX_PERSISTED_PHOTOS} photos</div>
                  <div style={{ marginTop: 4 }}>{flaggedCount} selected</div>
                  {persistedPhotos.length >= MAX_PERSISTED_PHOTOS && (
                    <span style={{ display: "block", marginTop: 4, color: "#f59e0b", fontSize: isMobile ? 12 : 11 }}>Photo limit reached. Delete photos to add more.</span>
                  )}
                </div>
                {persistedPhotos.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0, marginLeft: "auto" }}>
                    <button
                      type="button"
                      disabled={photosLoading || flaggedCount >= persistedPhotos.length}
                      onClick={() => void bulkSetFlags(true)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        fontSize: "inherit",
                        fontFamily: "'Syne', sans-serif",
                        cursor: photosLoading || flaggedCount >= persistedPhotos.length ? "not-allowed" : "pointer",
                        color: photosLoading || flaggedCount >= persistedPhotos.length ? "#475569" : "#94a3b8",
                        opacity: photosLoading || flaggedCount >= persistedPhotos.length ? 0.55 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (photosLoading || flaggedCount >= persistedPhotos.length) return;
                        e.currentTarget.style.color = "#3b82f6";
                      }}
                      onMouseLeave={(e) => {
                        if (photosLoading || flaggedCount >= persistedPhotos.length) {
                          e.currentTarget.style.color = "#475569";
                          return;
                        }
                        e.currentTarget.style.color = "#94a3b8";
                      }}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      disabled={photosLoading || flaggedCount === 0}
                      onClick={() => void bulkSetFlags(false)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        fontSize: "inherit",
                        fontFamily: "'Syne', sans-serif",
                        cursor: photosLoading || flaggedCount === 0 ? "not-allowed" : "pointer",
                        color: photosLoading || flaggedCount === 0 ? "#475569" : "#94a3b8",
                        opacity: photosLoading || flaggedCount === 0 ? 0.55 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (photosLoading || flaggedCount === 0) return;
                        e.currentTarget.style.color = "#3b82f6";
                      }}
                      onMouseLeave={(e) => {
                        if (photosLoading || flaggedCount === 0) {
                          e.currentTarget.style.color = "#475569";
                          return;
                        }
                        e.currentTarget.style.color = "#94a3b8";
                      }}
                    >
                      Deselect All
                    </button>
                  </div>
                )}
              </div>
              {photoUploadLimitNote && (
                <div style={{ fontSize: isMobile ? 12 : 11, color: "#f59e0b", marginBottom: 10, lineHeight: 1.45 }}>{photoUploadLimitNote}</div>
              )}

              <div
                onClick={() => {
                  if (photosLoading || persistedPhotos.length >= MAX_PERSISTED_PHOTOS) return;
                  fileRef.current?.click();
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (photosLoading) return;
                  const files = e.dataTransfer.files;
                  if (!files?.length) return;
                  if (persistedPhotos.length >= MAX_PERSISTED_PHOTOS) {
                    setPhotoUploadLimitNote("Photo limit reached. Delete photos to add more.");
                    return;
                  }
                  const arr = Array.from(files);
                  const room = MAX_PERSISTED_PHOTOS - persistedPhotos.length;
                  if (arr.length > room) {
                    const toUpload = arr.slice(0, room);
                    setPhotoUploadLimitNote(`Only ${toUpload.length} of ${arr.length} photos uploaded — 200 photo limit reached.`);
                    void uploadPhotos(toUpload);
                  } else {
                    setPhotoUploadLimitNote(null);
                    void uploadPhotos(arr);
                  }
                }}
                style={{
                  border: "2px dashed #1e293b",
                  borderRadius: 8,
                  padding: isMobile ? "28px 16px" : "32px 20px",
                  textAlign: "center",
                  cursor: photosLoading || persistedPhotos.length >= MAX_PERSISTED_PHOTOS ? "not-allowed" : "pointer",
                  marginBottom: 16,
                  background: "#0a0f1a",
                  minHeight: isMobile ? 120 : undefined,
                  opacity: photosLoading ? 0.6 : 1,
                  pointerEvents: photosLoading ? "none" : "auto",
                }}
                onMouseEnter={(e) => {
                  if (!photosLoading && persistedPhotos.length < MAX_PERSISTED_PHOTOS) e.currentTarget.style.borderColor = "#3b82f6";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#1e293b";
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 10 }}>📸</div>
                <div style={{ fontSize: isMobile ? 15 : 14, color: "#94a3b8", marginBottom: 4 }}>
                  {photosLoading ? "Uploading..." : "Upload photos · JPG, PNG, WEBP, HEIC · Up to 200 photos"}
                </div>
                <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569" }}>
                  {photosLoading ? "Please wait" : "Drop photos here or click to upload"}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    // Snapshot files before clearing the input — input.files is a live FileList and
                    // clearing value empties it, which previously caused silent no-op uploads.
                    const arr = e.target.files?.length ? Array.from(e.target.files) : [];
                    if (fileRef.current) fileRef.current.value = "";
                    if (arr.length === 0) return;
                    if (persistedPhotos.length >= MAX_PERSISTED_PHOTOS) {
                      setPhotoUploadLimitNote("Photo limit reached. Delete photos to add more.");
                      return;
                    }
                    const room = MAX_PERSISTED_PHOTOS - persistedPhotos.length;
                    if (arr.length > room) {
                      const toUpload = arr.slice(0, room);
                      setPhotoUploadLimitNote(`Only ${toUpload.length} of ${arr.length} photos uploaded — 200 photo limit reached.`);
                      void uploadPhotos(toUpload);
                    } else {
                      setPhotoUploadLimitNote(null);
                      void uploadPhotos(arr);
                    }
                  }}
                />
              </div>

              {persistedPhotos.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
                  {persistedPhotos.map((photo) => (
                    <div key={photo.id} title={photo.fileName} style={{ position: "relative", borderRadius: 6, overflow: "hidden", background: "#0a0f1a", border: "1px solid #1e293b", display: "flex", flexDirection: "column" }}>
                      <div style={{ position: "relative", width: "100%", aspectRatio: "1", background: "#1e293b" }}>
                        {photo.signedUrl ? (
                          <img src={photo.signedUrl} alt={photo.fileName} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 12 }}>Loading...</div>
                        )}
                        <button
                          type="button"
                          aria-label={photo.flaggedForAi ? "Deselect photo" : "Select photo"}
                          aria-pressed={photo.flaggedForAi}
                          disabled={photosLoading}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void toggleFlag(photo.id);
                          }}
                          style={{
                            position: "absolute",
                            top: 4,
                            left: 4,
                            width: 28,
                            height: 28,
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "50%",
                            border: photo.flaggedForAi ? `2px solid ${photoTabAccent}` : "2px solid rgba(226, 232, 240, 0.65)",
                            background: photo.flaggedForAi ? photoTabAccent : "rgba(15, 23, 42, 0.75)",
                            color: "#e2e8f0",
                            cursor: photosLoading ? "not-allowed" : "pointer",
                            opacity: photosLoading ? 0.45 : 1,
                            transition: "transform 0.15s ease, filter 0.15s ease",
                            boxShadow: "0 1px 4px rgba(0,0,0,0.45)",
                          }}
                          onMouseEnter={(ev) => {
                            if (photosLoading) return;
                            ev.currentTarget.style.transform = "scale(1.08)";
                            ev.currentTarget.style.filter = "brightness(1.12)";
                          }}
                          onMouseLeave={(ev) => {
                            ev.currentTarget.style.transform = "scale(1)";
                            ev.currentTarget.style.filter = "none";
                          }}
                        >
                          {photo.flaggedForAi ? (
                            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden style={{ display: "block" }}>
                              <path
                                fill="none"
                                stroke="#fff"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M3.5 8.2 6.4 11l6.1-6.1"
                              />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden style={{ display: "block" }}>
                              <circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
                            </svg>
                          )}
                        </button>
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#64748b",
                          padding: "4px 6px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {photo.fileName}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {flaggedCount > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 16,
                    padding: "12px 14px",
                    background: "#0a0f1a",
                    border: "1px solid #1e293b",
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontSize: isMobile ? 13 : 12, color: "#94a3b8", fontWeight: 600 }}>
                    {flaggedCount} selected
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginLeft: isMobile ? 0 : "auto", width: isMobile ? "100%" : "auto", justifyContent: isMobile ? "stretch" : "flex-end", flexDirection: isMobile ? "column" : "row" }}>
                    <button
                      type="button"
                      disabled={photosLoading || analyzing}
                      onClick={() => {
                        const n = flaggedCount;
                        if (!window.confirm(`Delete ${n} photos? This cannot be undone.`)) return;
                        const ids = persistedPhotos.filter((p) => p.flaggedForAi).map((p) => p.id);
                        void bulkDeletePhotos(ids);
                      }}
                      style={{
                        border: "1px solid #dc2626",
                        borderRadius: 8,
                        background: analyzing || photosLoading ? "#451a1a" : "#7f1d1d",
                        color: "#fecaca",
                        padding: "10px 14px",
                        fontSize: isMobile ? 14 : 13,
                        fontWeight: 700,
                        fontFamily: "'Syne', sans-serif",
                        cursor: analyzing || photosLoading ? "not-allowed" : "pointer",
                        opacity: analyzing || photosLoading ? 0.55 : 1,
                        flex: isMobile ? "1 1 auto" : "0 0 auto",
                      }}
                    >
                      Delete {flaggedCount}
                    </button>
                    <button
                      type="button"
                      title={
                        analyzeOverAiCap && !analyzing
                          ? "Reduce selection to 20 or fewer photos to analyze with AI. Delete works on any number."
                          : undefined
                      }
                      onClick={analyze}
                      disabled={analyzing || photosLoading || analyzeOverAiCap}
                      style={{
                        border: "none",
                        borderRadius: 8,
                        color: "#fff",
                        padding: isMobile ? "12px 16px" : "10px 16px",
                        minHeight: isMobile ? 46 : undefined,
                        fontSize: isMobile ? 14 : 13,
                        fontWeight: 700,
                        cursor: analyzing || photosLoading || analyzeOverAiCap ? "not-allowed" : "pointer",
                        fontFamily: "'Syne', sans-serif",
                        flex: isMobile ? "1 1 auto" : "0 0 auto",
                        background:
                          analyzing || photosLoading || analyzeOverAiCap ? "#1e293b" : "linear-gradient(135deg, #7c3aed, #6d28d9)",
                        opacity: analyzing || photosLoading || analyzeOverAiCap ? 0.65 : 1,
                      }}
                    >
                      {analyzing ? (status || "Working…") : analyzeOverAiCap ? "Maximum 20 for AI" : `Analyze ${flaggedCount} ${flaggedCount === 1 ? "Photo" : "Photos"} with AI`}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : null}

          {walkMode !== "photos" && (
            <div style={{ marginBottom: 16 }}>
              {isMobileDevice() ? (
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.45, marginBottom: 14 }}>🚩 Tap the Flag button to mark moments during recording. (Voice trigger is desktop-only.)</div>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Voice trigger phrase</div>
                  <input
                    type="text"
                    value={triggerPhrase}
                    onChange={(e) => saveTriggerPhrase(e.target.value)}
                    placeholder="flag this"
                    style={{ width: "100%", boxSizing: "border-box", minHeight: 48, background: "#060b14", border: "1px solid #1e293b", borderRadius: 8, color: "#f1f5f9", padding: "12px 14px", fontSize: 15, marginBottom: 14 }}
                  />
                </>
              )}
              <WalkthroughMediaRecorder
                key={walkMode}
                mode={walkMode as "audio" | "video" | "audiovideo"}
                address={address}
                buildYear={currentDeal.yearBuilt != null && currentDeal.yearBuilt > 0 ? currentDeal.yearBuilt : 0}
                isMobile={isMobile}
                supabase={supabase}
                triggerPhrase={triggerPhrase}
                dealId={dealId}
                userId={userId}
                currentDeal={currentDeal}
                canUseAI={canUseAI}
                triggerAIUse={triggerAIUse}
                onNeedPaywall={onNeedPaywall}
                onBeforeAnalyze={waitForYearGate}
                onFindings={(f) => {
                  setFindings(f);
                  setSelectedFindings(new Set(f.map((_, i) => i)));
                  setStatus(`Analysis complete — ${f.length} findings identified.`);
                }}
                onPropertyChanges={onPropertyChangeFromAnalysis}
                onAnalyzing={setMediaAnalyzing}
              />
            </div>
          )}

          {status && !analyzing && !mediaAnalyzing && <div style={{ background: "#0d3d1f", border: "1px solid #16a34a", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#22c55e", marginBottom: 12 }}>✓ {status}</div>}
          {error && <div style={{ background: "#2a0a0a", border: "1px solid #dc2626", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#f87171", marginBottom: 12 }}>✗ {error}</div>}

          {showPropertyChangeBanner && propertyChangeBanner && (
            <div
              style={{
                background: "linear-gradient(135deg, #172554 0%, #0f172a 100%)",
                border: "1px solid #3b82f6",
                borderRadius: 10,
                padding: isMobile ? 16 : 18,
                marginBottom: 16,
                boxShadow: "0 4px 24px rgba(59, 130, 246, 0.12)",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 800, color: "#e0e7ff", marginBottom: 12, fontFamily: "'Syne', sans-serif" }}>🏠 AI detected planned property changes</div>
              <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.65, marginBottom: 10 }}>
                <div>
                  <span style={{ color: "#64748b" }}>Current specs: </span>
                  {currentDeal.subjectBedrooms || 0} bed / {fmtBath(currentDeal.subjectBathrooms || 0)} bath / {Math.round(currentDeal.subjectSqft || 0)} sqft
                </div>
                <div>
                  <span style={{ color: "#64748b" }}>Proposed specs: </span>
                  {Math.max(0, Math.round((currentDeal.subjectBedrooms || 0) + propertyChangeBanner.bedroomDelta))} bed /{" "}
                  {fmtBath(Math.max(0, (currentDeal.subjectBathrooms || 0) + propertyChangeBanner.bathroomDelta))} bath /{" "}
                  {Math.max(0, Math.round((currentDeal.subjectSqft || 0) + propertyChangeBanner.sqftDelta))} sqft
                </div>
              </div>
              {propertyChangeBanner.reasoning ? (
                <div style={{ fontSize: 12, color: "#cbd5e1", marginBottom: 12, fontStyle: "italic", lineHeight: 1.5 }}>AI reasoning: &ldquo;{propertyChangeBanner.reasoning}&rdquo;</div>
              ) : null}
              <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 16, lineHeight: 1.5 }}>
                These changes can affect ARV — review comps after updating.
              </div>
              <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", flexWrap: "wrap", gap: 10, alignItems: isMobile ? "stretch" : "center" }}>
                <button
                  type="button"
                  onClick={onAcceptPropertyChangeBanner}
                  style={{ minHeight: 48, background: "linear-gradient(135deg, #1d4ed8, #1e40af)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, fontFamily: "'Syne', sans-serif", padding: "0 18px", cursor: "pointer" }}
                >
                  Accept all changes
                </button>
                <button
                  type="button"
                  onClick={onModifyPropertySpecsManually}
                  style={{ minHeight: 48, background: "transparent", color: "#94a3b8", border: "1px solid #334155", borderRadius: 8, fontWeight: 600, fontSize: 13, fontFamily: "'Syne', sans-serif", padding: "0 18px", cursor: "pointer" }}
                >
                  Modify manually
                </button>
                <button
                  type="button"
                  onClick={onDismissPropertyChangeBanner}
                  style={{ minHeight: 48, background: "transparent", color: "#64748b", border: "1px solid #1e293b", borderRadius: 8, fontWeight: 600, fontSize: 12, fontFamily: "'Syne', sans-serif", padding: "0 14px", cursor: "pointer" }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

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
              <button type="button" onClick={() => { setFindings([]); setStatus(""); setSelectedFindings(new Set()); }}
                style={{ width: "100%", background: "transparent", border: "1px solid #1e293b", borderRadius: 8, color: "#475569", padding: isMobile ? "14px 16px" : "10px 0", minHeight: isMobile ? 44 : undefined, fontSize: isMobile ? 14 : 12, cursor: "pointer" }}>
                Clear & Start New Analysis
              </button>
            </>
          )}
        </div>
      </div>

      {showYearGate && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1999,
            background: "rgba(0,0,0,0.88)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            boxSizing: "border-box",
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="year-gate-title"
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: 12,
              padding: 24,
              boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div id="year-gate-title" style={{ fontSize: 15, fontWeight: 800, color: "#e2e8f0", marginBottom: 10, fontFamily: "'Syne', sans-serif" }}>Enter Year Built before analyzing</div>
            <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.55, margin: "0 0 14px 0" }}>
              This helps detect lead paint (pre-1978), asbestos (pre-1980), and informs age-appropriate cost estimates.
            </p>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Year Built</div>
            <input
              type="text"
              inputMode="numeric"
              value={yearGateInput}
              onChange={(e) => {
                setYearGateInput(e.target.value);
                setYearGateError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") onYearGateContinue();
              }}
              placeholder="e.g. 1995"
              style={{
                width: "100%",
                boxSizing: "border-box",
                minHeight: 44,
                background: "#060b14",
                border: "1px solid #1e293b",
                borderRadius: 8,
                color: "#f1f5f9",
                padding: "10px 12px",
                fontSize: 15,
                fontFamily: "monospace",
                marginBottom: 8,
                outline: "none",
              }}
            />
            {yearGateError ? <div style={{ color: "#f87171", fontSize: 12, marginBottom: 6 }}>{yearGateError}</div> : null}
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, marginTop: 6 }}>
              <button
                type="button"
                onClick={onYearGateContinue}
                style={{
                  flex: 1,
                  minHeight: 48,
                  border: "none",
                  borderRadius: 8,
                  background: "linear-gradient(135deg, #1d4ed8, #1e40af)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  fontFamily: "'Syne', sans-serif",
                  cursor: "pointer",
                }}
              >
                Continue
              </button>
              <button
                type="button"
                onClick={onYearGateSkip}
                style={{
                  flex: 1,
                  minHeight: 48,
                  border: "1px solid #334155",
                  borderRadius: 8,
                  background: "transparent",
                  color: "#94a3b8",
                  fontWeight: 600,
                  fontSize: 13,
                  fontFamily: "'Syne', sans-serif",
                  cursor: "pointer",
                }}
              >
                Skip — I don&apos;t know the year
              </button>
            </div>
          </div>
        </div>
      )}
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
function CompsTab({ comps, subjectSqft, enteredArv, onAddComp, onUpdateComp, onDeleteComp, onUpdateSubjectSqft: _onUpdateSubjectSqft, onApplyArv, onRentCastSuccess, supabase, dealId: _dealId, propertyAddress, isMobile = false, activeDeal, canUseAI, onNeedPaywall, triggerAIUse }: {
  comps: Comp[]; subjectSqft: number; enteredArv: number;
  onAddComp: () => void; onUpdateComp: (id: string, u: Partial<Comp>) => void;
  onDeleteComp: (id: string) => void; onUpdateSubjectSqft: (v: number) => void; onApplyArv: (v: number) => void;
  onRentCastSuccess: (newComps: Omit<Comp, "id">[], rentEstimate: number, rentalComps: Omit<RentalComp, "id">[]) => void | Promise<void>;
  supabase: SupabaseClient;
  dealId: string;
  propertyAddress: string;
  isMobile?: boolean;
  activeDeal: Deal;
  canUseAI: (deal: AIGateDeal) => boolean;
  onNeedPaywall: (reason: string) => void;
  triggerAIUse: (dealId: string) => Promise<void>;
}) {
  const [pullingComps, setPullingComps] = useState(false);
  const [pullError, setPullError] = useState("");
  const [pullSuccess, setPullSuccess] = useState("");

  const pullCompsFromRentCast = async () => {
    if (!canUseAI(activeDeal)) {
      onNeedPaywall("Auto-pulling comps requires Investor plan or a free trial analysis");
      return;
    }
    if (!propertyAddress.trim()) {
      setPullError("Enter a property address in the Deal Analysis tab first");
      return;
    }
    if (comps.length >= 3) {
      setPullSuccess("Comps already pulled for this deal. Remove existing comps first to pull fresh data.");
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
        rentalComps?: Omit<RentalComp, "id">[];
      };
      if (payload.success === false && payload.error) throw new Error(payload.error);
      const saleList = payload.saleComps || [];
      const rentEst = typeof payload.rentEstimate === "number" ? payload.rentEstimate : 0;
      const rentalCompsList = payload.rentalComps || [];
      const room = Math.max(0, 6 - comps.length);
      const toAdd = saleList.slice(0, room);
      await onRentCastSuccess(toAdd, rentEst, rentalCompsList);
      setPullSuccess(`Pulled ${toAdd.length} sale comps and rent estimate of ${fmt(rentEst)} from RentCast`);
      await triggerAIUse(activeDeal.id);
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
        {activeDeal.aiLocked ? (
          <AILockOverlay
            message="RentCast auto-pull is locked on this deal"
            subtext="You can still add comps manually."
            onUpgrade={() => onNeedPaywall("Upgrade to Investor to unlock RentCast auto-pull")}
          />
        ) : (
          <button
            type="button"
            onClick={() => void pullCompsFromRentCast()}
            disabled={pullingComps || !propertyAddress.trim() || comps.length >= 3}
            style={{
              width: isMobile ? "100%" : "auto",
              background: pullingComps || !propertyAddress.trim() || comps.length >= 3 ? "#1e293b" : "#1d4ed8",
              border: "none",
              borderRadius: 8,
              color: "#fff",
              padding: isMobile ? "14px 16px" : "10px 18px",
              minHeight: isMobile ? 48 : 44,
              fontSize: isMobile ? 14 : 13,
              fontWeight: 700,
              cursor: pullingComps || !propertyAddress.trim() || comps.length >= 3 ? "not-allowed" : "pointer",
              fontFamily: "'Syne', sans-serif",
              opacity: pullingComps || !propertyAddress.trim() || comps.length >= 3 ? 0.6 : 1,
            }}
          >
            {pullingComps ? "Pulling comps..." : comps.length >= 3 ? "✓ Comps Already Pulled" : "🔄 Auto-Pull Comps from RentCast"}
          </button>
        )}
        {pullError && <div style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>{pullError}</div>}
        {pullSuccess && <div style={{ color: "#22c55e", fontSize: 13, marginTop: 10 }}>{pullSuccess}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 14 : 16, marginBottom: 20, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: isMobile ? 16 : 14 }}>
        <div style={{ flex: 1, width: isMobile ? "100%" : undefined }}>
          <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Subject Sq Ft</div>
          <div style={{ display: "flex", alignItems: "center", background: "#060b14", border: "1px solid #1e293b", borderRadius: 6, overflow: "hidden", maxWidth: isMobile ? "100%" : 160, minHeight: isMobile ? 44 : undefined, opacity: 0.85 }}>
            <input type="number" value={subjectSqft || ""} readOnly disabled
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#94a3b8", padding: isMobile ? "12px 14px" : "8px 10px", fontSize: isMobile ? 16 : 14, fontFamily: "monospace", cursor: "not-allowed" }} />
            <span style={{ padding: isMobile ? "12px 10px" : "8px 8px", color: "#475569", fontSize: isMobile ? 12 : 11, background: "#0a0f1a", borderLeft: "1px solid #1e293b" }}>sqft</span>
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 6, lineHeight: 1.35 }}>Edit on Deal Analysis tab → Property Specs</div>
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

// ─── Rental Pivot Tab ─────────────────────────────────────────────────────────
function RentalPivotTab({ inputs, metrics, isMobile = false, rentalComps, setField, activeDeal, onNeedPaywall }: {
  inputs: DealInputs;
  metrics: DealMetrics;
  isMobile?: boolean;
  rentalComps: RentalComp[];
  setField: (key: keyof DealInputs) => (value: number | string) => void;
  activeDeal: Deal;
  onNeedPaywall: (reason: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 20 : 24 }}>
      <div>
        <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Rental Inputs</div>
        <InputField label="Monthly Rent" value={inputs.monthlyRent} onChange={setField("monthlyRent")} isMobile={isMobile} />
        <InputField label="Monthly Expenses" value={inputs.monthlyExpenses} onChange={setField("monthlyExpenses")} isMobile={isMobile} />
        <InputField label="Loan Amount (Refi)" value={inputs.loanAmount} onChange={setField("loanAmount")} isMobile={isMobile} />
        <InputField label="Interest Rate" value={inputs.interestRate} onChange={setField("interestRate")} prefix="%" suffix="APR" isMobile={isMobile} />
        <InputField label="Loan Term" value={inputs.loanTermMonths} onChange={setField("loanTermMonths")} prefix="" suffix="mo" isMobile={isMobile} />
      </div>
      <div>
        <div style={{ fontSize: isMobile ? 12 : 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Rental Metrics</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
          <MetricCard label="DSCR" value={metrics.dscr.toFixed(2)} sub={metrics.dscr >= 1.25 ? "✓ Lender Ready" : metrics.dscr >= 1.0 ? "⚠ Borderline" : "✗ Below Threshold"} highlight={metrics.dscr >= 1.25} isMobile={isMobile} />
          <MetricCard label="Monthly Payment" value={fmt(metrics.monthlyPayment)} isMobile={isMobile} />
          <MetricCard label="Net Monthly Cash Flow" value={fmt(inputs.monthlyRent - inputs.monthlyExpenses - metrics.monthlyPayment)} highlight isMobile={isMobile} />
          <MetricCard label="Annual Cash Flow" value={fmt((inputs.monthlyRent - inputs.monthlyExpenses - metrics.monthlyPayment) * 12)} isMobile={isMobile} />
        </div>
        {activeDeal.aiLocked ? (
          <div style={{ marginTop: 16 }}>
            <AILockOverlay
              message="RentCast rental data is locked on this deal"
              subtext="You can still enter rental estimates manually."
              onUpgrade={() => onNeedPaywall("Upgrade to Investor to unlock RentCast rental data")}
            />
          </div>
        ) : null}
        {rentalComps.length === 0 && (
          <div style={{ marginTop: 16, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Rental Comps
            </div>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
              No rental comps yet. Go to the Comps tab and tap Auto-Pull Comps from RentCast to automatically pull nearby rental listings for this property.
            </div>
          </div>
        )}

        {rentalComps.length > 0 && (
          <div style={{ marginTop: 16, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
              Rental Comps from RentCast ({rentalComps.length})
            </div>
            {rentalComps.map((r, i) => (
              <div key={r.id || i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #0f172a", flexWrap: "wrap", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#f1f5f9", marginBottom: 2 }}>{r.address}</div>
                  <div style={{ fontSize: 11, color: "#475569" }}>{r.bedBath}{r.distance ? ` · ${r.distance}` : ""}</div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#22c55e", fontFamily: "monospace" }}>{fmt(r.monthlyRent)}/mo</div>
              </div>
            ))}
          </div>
        )}
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
function DealsSidebar({ deals, activeDealId, onSelect, onNew, onOpenSettings, onOpenHelp, syncing, upgradePanel, variant = "sidebar", drawerOpen = false, onCloseDrawer }: {
  deals: Deal[]; activeDealId: string; onSelect: (id: string) => void; onNew: () => boolean | Promise<boolean>;
  onOpenSettings: () => void; onOpenHelp: () => void; syncing: boolean;
  upgradePanel?: ReactNode;
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.06em" }}>MY DEALS</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            aria-label="Help and support"
            onClick={() => { onOpenHelp(); if (isDrawer) onCloseDrawer?.(); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            onMouseDown={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; }}
            onMouseUp={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            style={{ minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid #1e293b", borderRadius: 8, color: "#94a3b8", fontSize: 21, lineHeight: 1, cursor: "pointer" }}
          >
            ?
          </button>
          <button
            type="button"
            aria-label="Open settings"
            onClick={() => { onOpenSettings(); if (isDrawer) onCloseDrawer?.(); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            onMouseDown={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; }}
            onMouseUp={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            style={{ minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid #1e293b", borderRadius: 8, color: "#94a3b8", fontSize: 21, lineHeight: 1, cursor: "pointer" }}
          >
            ⚙
          </button>
          {isDrawer ? (
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => onCloseDrawer?.()}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              onMouseDown={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; }}
              onMouseUp={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
              style={{ minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid #1e293b", borderRadius: 8, color: "#94a3b8", fontSize: 22, lineHeight: 1, cursor: "pointer" }}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
      <div style={{ padding: isDrawer ? "12px 14px 10px" : "16px 14px 10px", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
        {!isDrawer && <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>({deals.length})</div>}
        {isDrawer && <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>({deals.length})</div>}
        <button
          type="button"
          onClick={async () => {
            const created = await Promise.resolve(onNew());
            if (isDrawer && created) onCloseDrawer?.();
          }}
          style={{ width: "100%", background: "#1d4ed8", border: "none", borderRadius: 6, color: "#fff", padding: isDrawer ? "12px 0" : "9px 0", minHeight: isDrawer ? 44 : undefined, fontSize: isDrawer ? 13 : 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}
        >
          + NEW DEAL
        </button>
        {upgradePanel ? <div style={{ marginTop: 10 }}>{upgradePanel}</div> : null}
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
              {deal.inputs.propertyAddress === "123 Main St, Atlanta, GA 30301" && (
                <div style={{ fontSize: 9, color: "#f59e0b", background: "#2d2000", border: "1px solid #d97706", borderRadius: 3, padding: "2px 6px", display: "inline-block", marginTop: 2, letterSpacing: "0.08em", fontWeight: 700 }}>DEMO DEAL</div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ fontSize: 12, color: "#22c55e", fontFamily: "monospace" }}>{m.netProfit !== 0 ? fmt(m.netProfit) : "—"}</div>
                <div style={{ fontSize: 10, color: STATUS_STYLES[deal.inputs.dealStatus].color }}>{deal.inputs.dealStatus.charAt(0).toUpperCase() + deal.inputs.dealStatus.slice(1)}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: "12px 14px", borderTop: "1px solid #1e293b", flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: syncing ? "#a3a3a3" : "#94a3b8", marginBottom: 8, textAlign: "center" }}>{syncing ? "⟳ Saving..." : "✓ Synced to cloud"}</div>
      </div>
    </div>
  );
}

function SettingsPage({
  userEmail,
  subscription,
  deals,
  onBack,
  onOpenPaywall,
  onRequestDeleteDeal,
  onSignOut,
}: {
  userEmail: string;
  subscription: ReturnType<typeof useSubscription>["subscription"];
  deals: Deal[];
  onBack: () => void;
  onOpenPaywall: () => void;
  onRequestDeleteDeal: (deal: Deal) => void;
  onSignOut: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  const [openingPortal, setOpeningPortal] = useState(false);
  const [portalError, setPortalError] = useState("");

  const updatePassword = async () => {
    setPasswordError("");
    setPasswordSuccess("");
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }
    setUpdatingPassword(true);
    try {
      const { error: reauthErr } = await supabase.auth.signInWithPassword({ email: userEmail, password: currentPassword });
      if (reauthErr) {
        setPasswordError("Current password is incorrect");
        return;
      }
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
      if (updateErr) throw updateErr;
      setPasswordSuccess("Password updated successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e: any) {
      setPasswordError(e?.message || "Could not update password.");
    } finally {
      setUpdatingPassword(false);
    }
  };

  const s = subscription;
  const isInvestor = s?.status === "active" && (s.plan === "investor_monthly" || s.plan === "investor_annual");
  const planLabel = !s || s.status === "trial"
    ? "Free Trial"
    : s.plan === "investor_monthly"
      ? "Investor — Monthly"
      : s.plan === "investor_annual"
        ? "Investor — Annual"
        : "Investor";
  const showPendingCancel = Boolean(isInvestor && s?.cancel_at_period_end && s?.cancel_at);
  const cancelDateLabel = showPendingCancel
    ? new Date(String(s?.cancel_at)).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : "";

  const section: CSSProperties = { background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 10, padding: 16, marginBottom: 14 };
  const heading: CSSProperties = { fontSize: 13, fontWeight: 800, color: "#e2e8f0", marginBottom: 10, letterSpacing: "0.06em", textTransform: "uppercase" };
  const label: CSSProperties = { display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" };
  const input: CSSProperties = { width: "100%", background: "#060b14", border: "1px solid #1e293b", borderRadius: 6, color: "#f1f5f9", padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10 };
  const settingsPasswordFieldStyle: CSSProperties = {
    width: "100%",
    background: "#060b14",
    border: "1px solid #1e293b",
    borderRadius: 6,
    color: "#f1f5f9",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };
  const formatSpecSummary = (deal: Deal) => {
    const bits: string[] = [];
    if (deal.subjectBedrooms > 0) bits.push(`${Math.round(deal.subjectBedrooms)} bed`);
    if (deal.subjectBathrooms > 0) bits.push(`${deal.subjectBathrooms} bath`);
    if (deal.subjectSqft > 0) bits.push(`${Math.round(deal.subjectSqft).toLocaleString()} sqft`);
    return bits.join(" / ");
  };

  return (
    <div style={{ maxWidth: 840 }}>
      <button type="button" onClick={onBack} style={{ background: "transparent", border: "1px solid #1e293b", borderRadius: 8, color: "#94a3b8", padding: "10px 14px", minHeight: 44, fontSize: 13, cursor: "pointer", fontFamily: "'Syne', sans-serif", marginBottom: 16 }}>← Back</button>
      <div style={section}>
        <div style={heading}>Account</div>
        <div style={label}>Email</div>
        <div style={{ ...input, color: "#94a3b8", marginBottom: 0 }}>{userEmail}</div>
      </div>
      <div style={section}>
        <div style={heading}>Change Password</div>
        <label style={label}>Current password</label>
        <div style={{ marginBottom: 10 }}>
          <PasswordFieldWithVisibilityToggle value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} inputStyle={settingsPasswordFieldStyle} />
        </div>
        <label style={label}>New password</label>
        <div style={{ marginBottom: 10 }}>
          <PasswordFieldWithVisibilityToggle value={newPassword} onChange={(e) => setNewPassword(e.target.value)} inputStyle={settingsPasswordFieldStyle} />
        </div>
        <label style={label}>Confirm new password</label>
        <div style={{ marginBottom: 10 }}>
          <PasswordFieldWithVisibilityToggle value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} inputStyle={settingsPasswordFieldStyle} />
        </div>
        {passwordError ? <div style={{ background: "#2a0a0a", border: "1px solid #dc2626", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#f87171", marginBottom: 10 }}>{passwordError}</div> : null}
        {passwordSuccess ? <div style={{ background: "#0d3d1f", border: "1px solid #16a34a", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#22c55e", marginBottom: 10 }}>{passwordSuccess}</div> : null}
        <button type="button" onClick={() => { void updatePassword(); }} disabled={updatingPassword} style={{ background: updatingPassword ? "#1e293b" : "linear-gradient(135deg, #1d4ed8, #1e40af)", border: "none", borderRadius: 8, color: "#fff", padding: "10px 16px", minHeight: 44, fontSize: 13, fontWeight: 700, cursor: updatingPassword ? "not-allowed" : "pointer", fontFamily: "'Syne', sans-serif" }}>{updatingPassword ? "Updating..." : "Update Password"}</button>
      </div>
      <div style={section}>
        <div style={heading}>Subscription</div>
        <div style={{ fontSize: 13, color: "#f1f5f9", marginBottom: 8 }}>Current plan: <span style={{ color: "#60a5fa", fontWeight: 700 }}>{planLabel}</span></div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          {isInvestor ? "Unlimited AI analyses" : `${s?.trial_deals_used ?? 0} of ${s?.trial_deals_limit ?? 5} AI analyses used`}
        </div>
        {showPendingCancel ? (
          <div style={{ background: "rgba(255, 165, 0, 0.1)", border: "1px solid #FFA500", borderRadius: 8, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: "#FFA500", fontWeight: 700, marginBottom: 4 }}>⚠ Subscription cancels on {cancelDateLabel}</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>You&apos;ll continue to have full Investor access until this date.</div>
          </div>
        ) : null}
        <button
          type="button"
          disabled={openingPortal}
          onClick={() => {
            if (!isInvestor) {
              onOpenPaywall();
              return;
            }
            void (async () => {
              setPortalError("");
              setOpeningPortal(true);
              try {
                const { data: sessionData } = await supabase.auth.getSession();
                const token = sessionData?.session?.access_token;
                if (!token) throw new Error("No active session");

                const response = await fetch(`${SUPABASE_URL}/functions/v1/create-portal-session`, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({}),
                });

                const payload = await response.json().catch(() => null) as { url?: string; error?: string; details?: string } | null;
                if (!response.ok || !payload?.url) {
                  throw new Error(payload?.error || payload?.details || "Failed to create portal session");
                }

                window.location.href = payload.url;
              } catch (error) {
                console.error("open portal error:", error);
                setPortalError("Unable to open subscription management. Please try again or contact support.");
                setOpeningPortal(false);
              }
            })();
          }}
          style={isInvestor
            ? { background: openingPortal ? "#1e293b" : "linear-gradient(135deg, #1d4ed8, #1e40af)", border: "none", borderRadius: 8, color: "#fff", padding: "10px 16px", minHeight: 44, fontSize: 13, fontWeight: 700, cursor: openingPortal ? "wait" : "pointer", fontFamily: "'Syne', sans-serif", opacity: openingPortal ? 0.95 : 1 }
            : { background: "#16a34a", border: "1px solid #16a34a", borderRadius: 8, color: "#fff", padding: "10px 16px", minHeight: 44, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}
        >
          {isInvestor ? (openingPortal ? "Opening..." : "Manage Subscription") : "Upgrade to Investor"}
        </button>
        {portalError ? <div style={{ fontSize: 12, color: "#f87171", marginTop: 10 }}>{portalError}</div> : null}
      </div>
      <div id="settings-manage-deals-section" style={section}>
        <div style={heading}>Manage Deals</div>
        {deals.length === 0 ? (
          <div style={{ fontSize: 13, color: "#64748b" }}>No deals yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {deals.map((deal) => {
              const address = (deal.inputs.propertyAddress || "").trim() || "Untitled deal";
              const isDemoDeal = deal.inputs.propertyAddress === "123 Main St, Atlanta, GA 30301";
              const specs = formatSpecSummary(deal);
              return (
                <div key={deal.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, border: "1px solid #1e293b", borderRadius: 8, padding: "10px 12px", background: "#060b14" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{address}</div>
                    {specs ? (
                      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{specs}</div>
                    ) : null}
                    <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {isDemoDeal ? (
                        <div style={{ fontSize: 9, color: "#f59e0b", background: "#2d2000", border: "1px solid #d97706", borderRadius: 3, padding: "2px 6px", letterSpacing: "0.08em", fontWeight: 700 }}>DEMO DEAL</div>
                      ) : null}
                      {deal.aiLocked ? (
                        <div style={{ fontSize: 9, color: "#94a3b8", background: "#111827", border: "1px solid #334155", borderRadius: 3, padding: "2px 6px", letterSpacing: "0.08em", fontWeight: 700 }}>AI LOCKED</div>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRequestDeleteDeal(deal)}
                    style={{ background: "transparent", border: "1px solid #dc2626", borderRadius: 8, color: "#f87171", padding: "8px 12px", minHeight: 40, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={section}>
        <button type="button" onClick={onSignOut} style={{ background: "transparent", border: "1px solid #dc2626", borderRadius: 8, color: "#f87171", padding: "10px 16px", minHeight: 44, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>Sign Out</button>
      </div>
    </div>
  );
}

function HelpSupportPage({ onBack }: { onBack: () => void }) {
  const [openFaq, setOpenFaq] = useState<Set<number>>(new Set());
  const faqs = [
    {
      q: "How do I cancel my subscription?",
      a: "Open Settings → Subscription → Manage Subscription. This opens the Stripe customer portal where you can cancel anytime. Cancellations take effect at the end of your current billing period — you'll continue to have full access until then.",
    },
    {
      q: "I forgot my password. How do I reset it?",
      a: "On the login screen, tap the 'Forgot password?' link below the password field. Enter your email address — we'll send you a reset link. The email may take a few minutes to arrive. If you don't see it, check your spam folder.",
    },
    {
      q: "Why are AI features locked on some of my deals?",
      a: "Your free trial includes 5 AI deal analyses. After that, deals you create can still be analyzed manually, but AI features (Walkthrough, RentCast auto-pull) are locked on those new deals. Upgrade to Investor for unlimited AI analyses on all deals.",
    },
    {
      q: "I'm a beta tester from a REIA — how do I redeem my coupon?",
      a: "Beta tester coupons are entered during checkout. When the paywall appears, click 'Start Monthly Plan' and look for the 'Add promotion code' link on the Stripe checkout page. Enter your coupon code there. If you don't have a coupon yet, contact your REIA host.",
    },
  ];

  const toggleFaq = (idx: number) => {
    setOpenFaq((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const section: CSSProperties = { background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 10, padding: 16, marginBottom: 14 };
  const heading: CSSProperties = { fontSize: 13, fontWeight: 800, color: "#e2e8f0", marginBottom: 10, letterSpacing: "0.06em", textTransform: "uppercase" };

  return (
    <div style={{ maxWidth: 860 }}>
      <button type="button" onClick={onBack} style={{ background: "transparent", border: "1px solid #1e293b", borderRadius: 8, color: "#94a3b8", padding: "10px 14px", minHeight: 44, fontSize: 13, cursor: "pointer", fontFamily: "'Syne', sans-serif", marginBottom: 16 }}>← Back</button>
      <div style={{ fontSize: 26, fontWeight: 800, color: "#f1f5f9", marginBottom: 14 }}>Help & Support</div>

      <div style={section}>
        <div style={heading}>Get in touch</div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12, lineHeight: 1.55 }}>Have a question, found a bug, or need help with a deal? Email us anytime.</div>
        <a href="mailto:support@fliplogic.ai" style={{ display: "block", textAlign: "center", width: "100%", boxSizing: "border-box", background: "linear-gradient(135deg, #1d4ed8, #1e40af)", border: "none", borderRadius: 8, color: "#fff", padding: "12px 16px", minHeight: 48, fontSize: 14, fontWeight: 700, textDecoration: "none", fontFamily: "'Syne', sans-serif", marginBottom: 8 }}>
          Email support@fliplogic.ai
        </a>
        <div style={{ fontSize: 12, color: "#64748b" }}>We typically respond within 24 hours.</div>
      </div>

      <div style={section}>
        <div style={heading}>Quick Answers</div>
        {faqs.map((f, i) => {
          const open = openFaq.has(i);
          return (
            <div key={f.q} style={{ border: "1px solid #1e293b", borderRadius: 8, marginBottom: 10, background: "#060b14" }}>
              <button
                type="button"
                onClick={() => toggleFaq(i)}
                style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", color: "#e2e8f0", padding: "12px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
              >
                <span>{f.q}</span>
                <span style={{ color: "#64748b" }}>{open ? "−" : "+"}</span>
              </button>
              {open ? <div style={{ padding: "0 14px 12px", fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>{f.a}</div> : null}
            </div>
          );
        })}
      </div>

      <div style={{ ...section, background: "rgba(59,130,246,0.08)" }}>
        <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.55, marginBottom: 12 }}>
          📖 For step-by-step workflows and feature walkthroughs, use the full guide below. You can also email us at support@fliplogic.ai for questions about your deals.
        </div>
        <a
          href="/userguide"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "block",
            textAlign: "center",
            width: "100%",
            boxSizing: "border-box",
            background: "linear-gradient(135deg, #1d4ed8, #1e40af)",
            border: "none",
            borderRadius: 8,
            color: "#fff",
            padding: "12px 16px",
            minHeight: 48,
            fontSize: 14,
            fontWeight: 700,
            textDecoration: "none",
            fontFamily: "'Syne', sans-serif",
            lineHeight: 1.25,
          }}
        >
          Open the Comprehensive User Guide
        </a>
      </div>

      <div style={section}>
        <div style={heading}>Beta Feedback</div>
        <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, fontStyle: "italic" }}>
          FlipLogic AI is in active beta. Your feedback shapes the product — bug reports, feature requests, and &quot;this confused me&quot; moments are all welcome. Email support@fliplogic.ai with anything you&apos;d like to share.
        </div>
      </div>

      <div style={{ fontSize: 12, color: "#64748b", textAlign: "center", marginTop: 8, paddingBottom: 4, lineHeight: 1.6 }}>
        Legal:{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "#64748b", textDecoration: "underline" }}>
          Privacy Policy
        </a>
        {" "}
        ·{" "}
        <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#64748b", textDecoration: "underline" }}>
          Terms of Service
        </a>
      </div>
    </div>
  );
}

// ─── Gating modals (add deal) ─────────────────────────────────────────────────
function TrialExhaustedModal({ onClose, onUpgrade, onContinueWithoutAI, isMobile = false }: { onClose: () => void; onUpgrade: () => void; onContinueWithoutAI: () => void; isMobile?: boolean }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2002, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }} role="dialog" aria-modal="true" aria-labelledby="trial-exh-title" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: isMobile ? 20 : 28, maxWidth: 500, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.45)" }}>
        <h2 id="trial-exh-title" style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0", margin: "0 0 12px 0", fontFamily: "'Syne', sans-serif" }}>You&apos;ve used all 5 free AI analyses</h2>
        <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.55, margin: "0 0 20px 0" }}>
          To create new deals with AI features (walkthrough, photo analysis, auto comps), upgrade to Investor. You can also continue creating this deal without AI — manual entry, calculations, comps, scope, and reports all still work.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, alignItems: isMobile ? "stretch" : "stretch" }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onUpgrade();
              }}
              style={{ flex: isMobile ? "none" : 1, minWidth: 0, minHeight: 48, width: isMobile ? "100%" : "auto", background: "#16a34a", border: "1px solid #16a34a", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 13, fontFamily: "'Syne', sans-serif", cursor: "pointer", padding: "10px 16px" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#15803d"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#16a34a"; }}
            >
              Upgrade to Investor
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onContinueWithoutAI();
              }}
              style={{ flex: isMobile ? "none" : 1, minHeight: 48, width: isMobile ? "100%" : "auto", background: "transparent", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", fontWeight: 600, fontSize: 13, fontFamily: "'Syne', sans-serif", cursor: "pointer", padding: "10px 16px" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(51, 65, 85, 0.4)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              Continue without AI
            </button>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onClose();
            }}
            style={{ minHeight: 40, background: "transparent", border: "none", color: "#64748b", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "center", padding: "4px" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function DealLimitModal({ onClose, onUpgrade, onManageDeals, isMobile = false }: { onClose: () => void; onUpgrade: () => void; onManageDeals: () => void; isMobile?: boolean }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 2002, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="deal-limit-title"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: isMobile ? 20 : 28, maxWidth: 480, width: "100%" }}>
        <h2 id="deal-limit-title" style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0", margin: "0 0 12px 0", fontFamily: "'Syne', sans-serif" }}>Free tier deal limit reached</h2>
        <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.55, margin: "0 0 20px 0" }}>
          You&apos;ve reached the 8-deal limit for Free tier. Upgrade to Investor for unlimited deals, or delete a deal first to make room.
        </p>
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onUpgrade();
            }}
            style={{ flex: 1, minHeight: 48, background: "#16a34a", border: "1px solid #16a34a", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 13, fontFamily: "'Syne', sans-serif", cursor: "pointer", padding: "10px 16px" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#15803d"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#16a34a"; }}
          >
            Upgrade to Investor
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onManageDeals();
            }}
            style={{ flex: 1, minHeight: 48, background: "transparent", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", fontWeight: 600, fontSize: 13, fontFamily: "'Syne', sans-serif", cursor: "pointer", padding: "10px 16px" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(51, 65, 85, 0.4)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            Manage deals
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteDealConfirmationModal({ deal, onCancel, onConfirmDelete, isMobile = false }: { deal: Deal; onCancel: () => void; onConfirmDelete: () => void; isMobile?: boolean }) {
  const address = (deal.inputs.propertyAddress || "").trim();
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 2003, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-deal-title"
      onClick={onCancel}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: isMobile ? 20 : 24, maxWidth: 520, width: "100%" }}>
        <h2 id="delete-deal-title" style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0", margin: "0 0 12px 0", fontFamily: "'Syne', sans-serif" }}>Delete this deal?</h2>
        <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, margin: "0 0 20px 0" }}>
          {address || "This deal"} and all associated data (comps, scope items, walkthrough findings) will be permanently deleted. This cannot be undone.
        </p>
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10 }}>
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            style={{ flex: 1, minHeight: 44, background: "transparent", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", fontWeight: 600, fontSize: 13, fontFamily: "'Syne', sans-serif", cursor: "pointer", padding: "10px 16px" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirmDelete}
            style={{ flex: 1, minHeight: 44, background: "transparent", border: "1px solid #dc2626", borderRadius: 8, color: "#f87171", fontWeight: 700, fontSize: 13, fontFamily: "'Syne', sans-serif", cursor: "pointer", padding: "10px 16px" }}
          >
            Delete Deal
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Onboarding Modal ─────────────────────────────────────────────────────────
function OnboardingModal({ onClose, onNewDeal, onSeen, isMobile = false }: { onClose: () => void; onNewDeal: () => boolean | Promise<boolean>; onSeen: () => void; isMobile?: boolean }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? "16px" : "24px", overflowY: "auto" }}>
      <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 12, padding: isMobile ? "24px 20px" : 40, maxWidth: 480, width: "100%", boxSizing: "border-box", maxHeight: isMobile ? "90vh" : "85vh", overflowY: "auto" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: isMobile ? 26 : 30, fontWeight: 800, color: "#f1f5f9", marginBottom: 6 }}>
            FLIP<span style={{ color: "#3b82f6" }}>LOGIC</span> AI
          </div>
          <div style={{ fontSize: 13, color: "#475569" }}>Welcome to your deal analysis command center</div>
        </div>

        <div style={{ marginBottom: 28 }}>
          {[
            { icon: "🏠", title: "Analyze any deal in minutes", text: "Enter a property address and financials — get instant ROI, LTV, profit projections, and a HOT / WARM / COLD / DEAD deal score." },
            { icon: "🤖", title: "AI-powered property walkthrough", text: "Record audio or video at the property. AI transcribes your words and generates a full scope of work with cost estimates." },
            { icon: "📊", title: "Auto-pull comps", text: "Enter an address and tap Auto-Pull Comps to instantly populate sale and rental comparables for your market." },
            { icon: "📄", title: "Print-ready documents", text: "Generate a blind contractor bid sheet and a professional lender packet with one tap." },
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 14, marginBottom: 18 }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{item.icon}</span>
              <div>
                <div style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 700, marginBottom: 3 }}>{item.title}</div>
                <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{item.text}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: "#0d1829", border: "1px solid #1e293b", borderRadius: 8, padding: 14, marginBottom: 20, fontSize: 12, color: "#60a5fa", lineHeight: 1.6 }}>
          💡 A demo deal has been loaded so you can explore the app. When you are ready, create your first real deal using the button below.
        </div>

        <button
          type="button"
          onClick={async () => {
            onSeen();
            const created = await Promise.resolve(onNewDeal());
            if (created) onClose();
          }}
          style={{ width: "100%", background: "linear-gradient(135deg, #1d4ed8, #1e40af)", border: "none", borderRadius: 8, color: "#fff", padding: isMobile ? "16px 0" : "14px 0", fontSize: isMobile ? 15 : 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif", marginBottom: 10 }}
        >
          + Create My First Deal
        </button>

        <button
          type="button"
          onClick={() => { onSeen(); onClose(); }}
          style={{ width: "100%", background: "transparent", border: "1px solid #1e293b", borderRadius: 8, color: "#475569", padding: isMobile ? "14px 0" : "12px 0", fontSize: isMobile ? 14 : 12, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
          Explore the demo first
        </button>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [activeDealId, setActiveDealId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"deal" | "ai" | "comps" | "rental" | "stress" | "scope" | "packet">("deal");
  const [syncing, setSyncing] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const isMobile = useIsMobile();
  const saveTimer = useRef<any>(null);
  const propertySpecsRef = useRef<HTMLDivElement | null>(null);
  const [aiPropertyChangeBanner, setAiPropertyChangeBanner] = useState<PropertyChanges | null>(null);

  const { subscription, loading: subLoading, refetch: refetchSubscription } = useSubscription(supabase, user?.id ?? null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallReason, setPaywallReason] = useState("");
  const [activityToast, setActivityToast] = useState<{ text: string; ms: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [scrollToManageDeals, setScrollToManageDeals] = useState(false);
  const [dealPendingDelete, setDealPendingDelete] = useState<Deal | null>(null);
  const [trialExhaustedOpen, setTrialExhaustedOpen] = useState(false);
  const [dealLimitOpen, setDealLimitOpen] = useState(false);

  const isPayingInvestor = useMemo(
    () =>
      Boolean(
        subscription?.status === "active" &&
          (subscription.plan === "investor_monthly" || subscription.plan === "investor_annual"),
      ),
    [subscription],
  );

  const openPaywall = useCallback((reason: string) => {
    setPaywallReason(reason);
    setPaywallOpen(true);
  }, []);

  useEffect(() => {
    if (!showSettings || !scrollToManageDeals) return;
    const t = window.setTimeout(() => {
      document.getElementById("settings-manage-deals-section")?.scrollIntoView({ block: "start", behavior: "smooth" });
      setScrollToManageDeals(false);
    }, 50);
    return () => window.clearTimeout(t);
  }, [showSettings, scrollToManageDeals]);

  const canUseAI = useCallback(
    (deal: AIGateDeal) => {
      if ((deal as Partial<Deal>).aiLocked) return false;
      if (deal.aiAnalysisUsed) return true;
      const sub = subscription;
      if (!sub) {
        return 0 < 5;
      }
      if (sub.status === "active") return true;
      if (sub.status === "trial" && sub.trial_deals_used < sub.trial_deals_limit) return true;
      return false;
    },
    [subscription],
  );

  const triggerAIUse = useCallback(
    async (dealId: string) => {
      if (!user) return;
      const deal = deals.find((d) => d.id === dealId);
      if (!deal || deal.aiAnalysisUsed) return;

      try {
        if (dealId !== DEMO_DEAL_ID) {
          const { error: de } = await supabase.from("deals").update({ ai_analysis_used: true }).eq("id", dealId);
          if (de) {
            console.error("triggerAIUse deal update failed:", de);
            return;
          }
          setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, aiAnalysisUsed: true } : d)));
        } else {
          if (!deal.aiAnalysisUsed) {
            const { error: de } = await supabase.from("deals").update({ ai_analysis_used: true }).eq("id", dealId);
            if (de) console.error("triggerAIUse demo deal update failed:", de);
            setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, aiAnalysisUsed: true } : d)));
          }
          return;
        }

        const { data: sub, error: se } = await supabase
          .from("subscriptions")
          .select("status, trial_deals_used")
          .eq("user_id", user.id)
          .maybeSingle();
        if (se) {
          console.error("triggerAIUse sub read failed:", se);
          return;
        }
        if (sub?.status === "trial") {
          const used = Number((sub as { trial_deals_used?: number }).trial_deals_used) || 0;
          const { error: up } = await supabase.from("subscriptions").update({ trial_deals_used: used + 1 }).eq("user_id", user.id);
          if (up) console.error("triggerAIUse trial increment failed:", up);
        }
      } catch (e) {
        console.error("triggerAIUse:", e);
      }
    },
    [deals, user],
  );

  const sidebarUpgradePanel = useMemo(() => {
    if (subLoading && !subscription) return null;
    if (isPayingInvestor) return null;
    const used = subscription?.trial_deals_used ?? 0;
    const label = used >= 5 ? "Upgrade & Unlock AI" : "Upgrade to Investor";
    const solid = used >= 4;
    return (
      <button
        type="button"
        onClick={() => openPaywall("Upgrade to FlipLogic AI Investor to unlock AI features.")}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = solid ? "#15803d" : "rgba(22, 163, 34, 0.15)";
          e.currentTarget.style.borderColor = solid ? "#15803d" : "#16a34a";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = solid ? "#16a34a" : "transparent";
          e.currentTarget.style.borderColor = "#16a34a";
        }}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "10px 16px",
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 12,
          fontFamily: "'Syne', sans-serif",
          cursor: "pointer",
          border: "1px solid #16a34a",
          color: solid ? "#fff" : "#16a34a",
          background: solid ? "#16a34a" : "transparent",
        }}
      >
        {label}
      </button>
    );
  }, [subscription, subLoading, openPaywall, isPayingInvestor]);

  useEffect(() => {
    if (!activityToast) return;
    const t = window.setTimeout(() => setActivityToast(null), activityToast.ms);
    return () => window.clearTimeout(t);
  }, [activityToast]);

  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const c = sp.get("checkout");
    const portal = sp.get("portal");
    if (c === "success") {
      setActivityToast({ text: "Welcome to FlipLogic AI Investor!", ms: 5000 });
      void refetchSubscription();
      const u = new URL(window.location.href);
      u.searchParams.delete("checkout");
      u.searchParams.delete("session_id");
      const path = u.pathname + (u.search || "") + u.hash;
      window.history.replaceState({}, "", path);
    } else if (c === "cancelled") {
      setActivityToast({ text: "Payment was cancelled", ms: 3000 });
      const u = new URL(window.location.href);
      u.searchParams.delete("checkout");
      const path = u.pathname + (u.search || "") + u.hash;
      window.history.replaceState({}, "", path);
    } else if (portal === "return") {
      setActivityToast({ text: "Welcome back!", ms: 3000 });
      void refetchSubscription();
      const u = new URL(window.location.href);
      u.searchParams.delete("portal");
      const path = u.pathname + (u.search || "") + u.hash;
      window.history.replaceState({}, "", path);
    }
  }, [user, refetchSubscription]);

  useEffect(() => {
    if (isMobile && sidebarOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [isMobile, sidebarOpen]);

  useEffect(() => {
    setAiPropertyChangeBanner(null);
  }, [activeDealId]);

  /** Keep selected deal id in localStorage (same window.origin pattern as other fliplogic_* keys) */
  useEffect(() => {
    if (!user) return;
    if (dbLoading) return;
    try {
      if (activeDealId) {
        localStorage.setItem(SELECTED_DEAL_STORAGE_KEY, activeDealId);
      } else if (deals.length === 0) {
        localStorage.removeItem(SELECTED_DEAL_STORAGE_KEY);
      }
    } catch {
      /* private mode, quota, etc. */
    }
  }, [user, activeDealId, dbLoading, deals.length]);

  // ─── Auth listener ────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setShowResetPassword(true);
      }
      setUser(session?.user ?? null);
      if (session?.user) setShowForgotPassword(false);
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
      const { data: rentalCompsData } = await supabase.from("rental_comps").select("*").in("deal_id", dealIds);

      const assembled: Deal[] = dealsData.map((d: any) => {
        const rawRehab = d.rehab_initial_estimate != null ? Number(d.rehab_initial_estimate) : (d.rehab_cost != null ? Number(d.rehab_cost) : 0);
        const rawArv = d.arv_initial_estimate != null ? Number(d.arv_initial_estimate) : (d.arv != null ? Number(d.arv) : 0);
        const rcs = (d.rehab_cost_source as RehabCostSource) || "initial";
        const arvS = (d.arv_source as ArvSource) || "initial";
        const base: Deal = {
          id: d.id,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
          subjectSqft: d.subject_sqft || 0,
          subjectBedrooms: d.subject_bedrooms != null ? Number(d.subject_bedrooms) : 0,
          subjectBathrooms: d.subject_bathrooms != null ? Number(d.subject_bathrooms) : 0,
          yearBuilt: d.year_built != null && d.year_built !== "" && !Number.isNaN(Number(d.year_built)) ? Math.floor(Number(d.year_built)) : null,
          lenderInfo: d.lender_info || BLANK_LENDER_INFO,
          inputs: {
            propertyAddress: d.property_address || "",
            purchasePrice: d.purchase_price || 0,
            rehabInitialEstimate: rawRehab,
            rehabManualOverride: d.rehab_manual_override != null ? Number(d.rehab_manual_override) : 0,
            rehabCostSource: ["initial", "ai_walkthrough", "manual"].includes(rcs) ? rcs : "initial",
            rehabCost: d.rehab_cost != null ? Number(d.rehab_cost) : 0,
            arvInitialEstimate: rawArv,
            arvSource: ["initial", "comp_derived"].includes(arvS) ? arvS : "initial",
            arv: d.arv != null ? Number(d.arv) : 0,
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
            maoPercent: d.mao_percent != null
              ? Math.min(100, Math.max(1, Number(d.mao_percent)))
              : 70,
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
          rentalComps: (rentalCompsData || []).filter((r: any) => r.deal_id === d.id).map((r: any) => ({
            id: r.id,
            address: r.address || "",
            monthlyRent: Number(r.monthly_rent) || 0,
            bedBath: r.bed_bath || "",
            distance: r.distance || "",
          })),
          aiAnalysisUsed: d.ai_analysis_used === true,
          aiLocked: d.ai_locked === true,
        };
        return applySyncedRehabArv(base);
      });

      setDeals(assembled);
      const nextActive = pickActiveDealIdOnLoad(assembled);
      if (nextActive) setActiveDealId(nextActive);
      const onboardingKey = `fliplogic_onboarding_seen_${user.id}`;
      const hasSeenOnboarding = localStorage.getItem(onboardingKey);
      const realDealCount = assembled.filter((d) => d.id !== DEMO_DEAL_ID).length;
      if (!hasSeenOnboarding && realDealCount === 0) {
        setShowOnboarding(true);
      } else {
        setShowOnboarding(false);
      }
    } catch (err) {
      console.error("Error loading deals:", err);
    }
    setDbLoading(false);
  };

  const createDemoDeal = async () => {
    const { data: dealData, error } = await supabase.from("deals").insert({
      user_id: user.id,
      ai_analysis_used: true,
      property_address: DEMO_INPUTS.propertyAddress,
      purchase_price: DEMO_INPUTS.purchasePrice,
      rehab_initial_estimate: DEMO_INPUTS.rehabInitialEstimate,
      rehab_manual_override: 0,
      rehab_cost: DEMO_INPUTS.rehabCost,
      rehab_cost_source: "initial",
      arv_initial_estimate: DEMO_INPUTS.arvInitialEstimate,
      arv: DEMO_INPUTS.arv,
      arv_source: "initial",
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
      mao_percent: 70,
      subject_sqft: 1480,
      subject_bedrooms: 3,
      subject_bathrooms: 2,
      year_built: null,
      ai_locked: false,
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
    console.log("saveDeal called for deal:", deal.id, "comps:", deal.comps.length, "scope:", deal.scopeItems.length);
    setSyncing(true);
    try {
      await supabase.from("deals").upsert({
        id: deal.id, user_id: user.id, updated_at: new Date().toISOString(),
        ai_analysis_used: deal.aiAnalysisUsed === true,
        ai_locked: deal.aiLocked === true,
        property_address: deal.inputs.propertyAddress,
        purchase_price: deal.inputs.purchasePrice,
        rehab_initial_estimate: deal.inputs.rehabInitialEstimate,
        rehab_manual_override: deal.inputs.rehabManualOverride,
        rehab_cost_source: deal.inputs.rehabCostSource,
        rehab_cost: deal.inputs.rehabCost,
        arv_initial_estimate: deal.inputs.arvInitialEstimate,
        arv_source: deal.inputs.arvSource,
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
        mao_percent: deal.inputs.maoPercent,
        subject_sqft: deal.subjectSqft,
        subject_bedrooms: deal.subjectBedrooms,
        subject_bathrooms: deal.subjectBathrooms,
        year_built: deal.yearBuilt,
        lender_info: deal.lenderInfo,
      });

      // Upsert comps — never delete, only add/update
      if (deal.comps.length > 0) {
        const { error: compsError } = await supabase.from("comps").upsert(
          deal.comps.map(c => ({
            id: c.id,
            deal_id: deal.id,
            user_id: user.id,
            address: c.address,
            sale_price: c.salePrice,
            sqft: c.sqft,
            bed_bath: c.bedBath,
            days_on_market: c.daysOnMarket,
            sold_date: c.soldDate,
            strength: c.strength,
            notes: c.notes,
          })),
          { onConflict: "id" }
        );
        if (compsError) console.error("Comps upsert error:", compsError);
      }

      // Upsert scope items — never delete, only add/update
      if (deal.scopeItems.length > 0) {
        await supabase.from("scope_items").upsert(
          deal.scopeItems.map(s => ({
            id: s.id,
            deal_id: deal.id,
            user_id: user.id,
            category: s.category,
            description: s.description,
            quantity: s.quantity,
            unit: s.unit,
            my_estimate: s.myEstimate,
            notes: s.notes,
            priority: s.priority,
          })),
          { onConflict: "id" }
        );
      }

      if (deal.rentalComps.length > 0) {
        const { error: rentalUpsertError } = await supabase.from("rental_comps").upsert(
          deal.rentalComps.map(r => ({
            id: r.id,
            deal_id: deal.id,
            user_id: user.id,
            address: r.address,
            monthly_rent: r.monthlyRent,
            bed_bath: r.bedBath,
            distance: r.distance,
          })),
          { onConflict: "id" }
        );
        if (rentalUpsertError) console.error("Rental comps upsert error:", rentalUpsertError);
      }
    } catch (err) {
      console.error("Save error:", err);
    }
    setSyncing(false);
  };

  const updateDeal = (changes: Partial<Deal>) => {
    setDeals((prev) => prev.map((d) => {
      if (d.id !== activeDealId) return d;
      const updated: Deal = { ...d, updatedAt: new Date().toISOString(), ...changes };
      if (changes.inputs !== undefined) {
        updated.inputs = { ...d.inputs, ...changes.inputs };
      }
      const out = applySyncedRehabArv(updated);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveDeal(out), 1500);
      return out;
    }));
  };

  const activeDeal = deals.find((d) => d.id === activeDealId);
  const inputs = activeDeal?.inputs ?? BLANK_INPUTS;
  const metrics = calculateMetrics(inputs);
  const scoreStyle = SCORE_STYLES[metrics.dealScore];

  const updateInputs = (updates: Partial<DealInputs>) => updateDeal({ inputs: { ...inputs, ...updates } });
  const set = (key: keyof DealInputs) => (value: number | string) => updateInputs({ [key]: value });

  const handleAiWalkthroughPropertyChanges = useCallback((p: PropertyChanges) => {
    const n = normalizePropertyChanges(p);
    if (n.bedroomDelta !== 0 || n.bathroomDelta !== 0 || n.sqftDelta !== 0) {
      setAiPropertyChangeBanner(n);
    }
  }, []);

  const acceptAiPropertyChangeBanner = useCallback(() => {
    if (!aiPropertyChangeBanner || !activeDeal) return;
    const b = aiPropertyChangeBanner;
    setAiPropertyChangeBanner(null);
    const rawBed = (activeDeal.subjectBedrooms || 0) + b.bedroomDelta;
    const rawBath = (activeDeal.subjectBathrooms || 0) + b.bathroomDelta;
    const rawSq = (activeDeal.subjectSqft || 0) + Math.round(b.sqftDelta);
    if (rawBed < 0) console.warn("FlipLogic: clamping bedroom count to 0 after AI spec update");
    if (rawBath < 0) console.warn("FlipLogic: clamping bathroom count to 0 after AI spec update");
    if (rawSq < 0) console.warn("FlipLogic: clamping sqft to 0 after AI spec update");
    const nb = Math.max(0, Math.round(rawBed));
    const nba = Math.max(0, rawBath);
    const nsq = Math.max(0, rawSq);
    updateDeal({ subjectBedrooms: nb, subjectBathrooms: nba, subjectSqft: nsq });
    setActivityToast({ text: "Property specs updated based on AI walkthrough.", ms: 5000 });
  }, [aiPropertyChangeBanner, activeDeal, updateDeal]);

  const modifyAiPropertySpecsManually = useCallback(() => {
    setAiPropertyChangeBanner(null);
    setActiveTab("deal");
    window.setTimeout(() => {
      propertySpecsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
  }, []);

  const getUserDealCount = () => deals.length;

  const insertNewDeal = async (aiLocked: boolean): Promise<boolean> => {
    if (!user) return false;
    const { data, error } = await supabase.from("deals").insert({
      user_id: user.id,
      ai_analysis_used: false,
      ai_locked: aiLocked,
      property_address: "", purchase_price: 0,
      rehab_initial_estimate: 0, rehab_manual_override: 0, rehab_cost: 0, rehab_cost_source: "initial",
      arv_initial_estimate: 0, arv: 0, arv_source: "initial",
      loan_amount: 0,
      interest_rate: 11.5, loan_term_months: 12, holding_months: 6,
      closing_costs_buy: 0, closing_costs_sell: 0, monthly_rent: 0, monthly_expenses: 0,
      notes: "", deal_status: "prospect", mao_percent: 70, subject_sqft: 0, subject_bedrooms: 0, subject_bathrooms: 0, year_built: null, lender_info: BLANK_LENDER_INFO,
    }).select().single();
    if (error || !data) return false;
    const nd: Deal = applySyncedRehabArv({
      id: data.id, createdAt: data.created_at, updatedAt: data.updated_at,
      inputs: { ...BLANK_INPUTS },
      comps: [], subjectSqft: 0, subjectBedrooms: 0, subjectBathrooms: 0, yearBuilt: null,
      lenderInfo: { ...BLANK_LENDER_INFO }, scopeItems: [], rentalComps: [], aiAnalysisUsed: false,
      aiLocked: aiLocked || undefined,
    });
    setDeals((prev) => [nd, ...prev]);
    setActiveDealId(nd.id);
    setShowSettings(false);
    setActiveTab("deal");
    if (isMobile && sidebarOpen) {
      setSidebarOpen(false);
    }
    return true;
  };

  const handleAddDeal = async (): Promise<boolean> => {
    if (!user) return false;
    setShowSettings(false);
    if (isPayingInvestor) {
      return await insertNewDeal(false);
    }
    if (getUserDealCount() >= 8) {
      setDealLimitOpen(true);
      return false;
    }
    const tlim = subscription?.trial_deals_limit ?? 5;
    const tused = subscription?.trial_deals_used ?? 0;
    if (tused >= tlim) {
      setTrialExhaustedOpen(true);
      return false;
    }
    return await insertNewDeal(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("deals").delete().eq("id", id);
    const remaining = deals.filter((d) => d.id !== id);
    setDeals(remaining);
    if (activeDealId === id) setActiveDealId(remaining.length > 0 ? remaining[0].id : "");
  };

  const handleConfirmDeleteDeal = async () => {
    if (!dealPendingDelete) return;
    await handleDelete(dealPendingDelete.id);
    setDealPendingDelete(null);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    try {
      localStorage.removeItem(SELECTED_DEAL_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setDeals([]);
    setActiveDealId("");
    setShowSettings(false);
  };

  const handleAddAIToScope = (items: ScopeItem[]) => {
    if (!activeDeal) return;
    const wasEmpty = activeDeal.scopeItems.length === 0;
    const nextScope = [...activeDeal.scopeItems, ...items];
    if (wasEmpty && items.length > 0 && activeDeal.inputs.rehabCostSource === "initial") {
      updateDeal({
        scopeItems: nextScope,
        inputs: { ...activeDeal.inputs, rehabCostSource: "ai_walkthrough" },
      });
      const sum = calculateAIWalkthroughRehab(nextScope);
      setActivityToast({ text: `AI scope detected. Using ${fmt(sum)} for rehab calculations. Change anytime on Deal Analysis.`, ms: 6000 });
    } else {
      updateDeal({ scopeItems: nextScope });
    }
    setActiveTab("scope");
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#060b14", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontFamily: "'Syne', sans-serif", fontSize: 14 }}>
      Loading...
    </div>
  );

  if (showResetPassword) {
    return (
      <ResetPasswordScreen onDone={() => {
        setShowResetPassword(false);
        setActivityToast({ text: "Password updated. You're signed in.", ms: 5000 });
      }} />
    );
  }

  if (!user && showForgotPassword) {
    return <ForgotPasswordScreen onBack={() => setShowForgotPassword(false)} />;
  }

  if (!user) return <AuthScreen onAuth={() => {}} onForgotPassword={() => setShowForgotPassword(true)} />;

  if (dbLoading) return (
    <div style={{ minHeight: "100vh", background: "#060b14", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontFamily: "'Syne', sans-serif", fontSize: 14 }}>
      Loading your deals...
    </div>
  );

  if (!activeDeal) return (
    <div style={{ minHeight: "100vh", background: "#060b14", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <button type="button" onClick={() => { void handleAddDeal(); }} style={{ background: "#1d4ed8", border: "none", color: "#fff", padding: "16px 24px", borderRadius: 8, fontSize: 16, cursor: "pointer", minHeight: 48, width: "min(100%, 320px)" }}>+ Start Your First Deal</button>
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
      {!isMobile && <DealsSidebar deals={deals} activeDealId={activeDealId} onSelect={(id) => { setShowSettings(false); setShowHelp(false); setActiveDealId(id); }} onNew={handleAddDeal} onOpenSettings={() => { setShowHelp(false); setShowSettings(true); }} onOpenHelp={() => { setShowSettings(false); setShowHelp(true); }} syncing={syncing} upgradePanel={sidebarUpgradePanel} variant="sidebar" />}
      {isMobile && <DealsSidebar deals={deals} activeDealId={activeDealId} onSelect={(id) => { setShowSettings(false); setShowHelp(false); setActiveDealId(id); }} onNew={handleAddDeal} onOpenSettings={() => { setShowHelp(false); setShowSettings(true); }} onOpenHelp={() => { setShowSettings(false); setShowHelp(true); }} syncing={syncing} upgradePanel={sidebarUpgradePanel} variant="drawer" drawerOpen={sidebarOpen} onCloseDrawer={() => setSidebarOpen(false)} />}
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

        {!showSettings && !showHelp && (
        <>
        {/* Address */}
        <div style={{ padding: isMobile ? "12px 14px" : "10px 24px", background: "#0a0f1a", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
          <input type="text" value={inputs.propertyAddress} onChange={(e) => set("propertyAddress")(e.target.value)} placeholder="Enter property address..."
            style={{ width: "100%", background: "transparent", border: "none", outline: "none", color: "#94a3b8", fontSize: isMobile ? 15 : 13, fontFamily: "monospace", boxSizing: "border-box", minHeight: isMobile ? 44 : undefined, padding: isMobile ? "4px 0" : 0 }} />
        </div>
        {activityToast && (
          <div
            style={{
              padding: isMobile ? "10px 14px" : "10px 24px",
              background: activityToast.text.includes("Welcome") ? "#0d3d1f" : "#1e293b",
              borderBottom: "1px solid " + (activityToast.text.includes("Welcome") ? "#16a34a" : "#334155"),
              color: activityToast.text.includes("Welcome") ? "#22c55e" : "#94a3b8",
              fontSize: 13,
              fontWeight: 600,
              flexShrink: 0,
            }}
            role="status"
          >
            {activityToast.text}
          </div>
        )}
        {inputs.propertyAddress === "123 Main St, Atlanta, GA 30301" && (
          <div style={{ padding: isMobile ? "8px 14px" : "8px 24px", background: "#2d2000", borderBottom: "1px solid #d97706", fontSize: isMobile ? 12 : 11, color: "#f59e0b", letterSpacing: "0.08em", flexShrink: 0, fontWeight: 600 }}>
            📋 This is a demo deal with sample data. Create a new deal in the sidebar to analyze a real property.
          </div>
        )}

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

          {activeTab === "deal" && (() => {
            const aiRehab = calculateAIWalkthroughRehab(activeDeal.scopeItems);
            const { weightedArv: compArvW } = calculateCompARV(activeDeal.comps, activeDeal.subjectSqft);
            const nComps = activeDeal.comps.filter((c) => c.salePrice > 0 && c.sqft > 0).length;
            const activeRe = calculateActiveRehab(inputs, activeDeal.scopeItems);
            const activeAr = calculateActiveARV(inputs, activeDeal.comps, activeDeal.subjectSqft);
            const rehabBySource: Record<RehabCostSource, number> = {
              initial: inputs.rehabInitialEstimate,
              ai_walkthrough: aiRehab,
              manual: inputs.rehabManualOverride,
            };
            const selectedRehabVal = rehabBySource[inputs.rehabCostSource];
            const arvBySource: Record<ArvSource, number> = { initial: inputs.arvInitialEstimate, comp_derived: compArvW };
            const selectedArvVal = arvBySource[inputs.arvSource];
            const mao = calculateMAO(activeAr, activeRe, inputs.maoPercent);
            const sectionBox: CSSProperties = { background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 12, padding: isMobile ? 16 : 20, marginBottom: 20 };
            const sectionHeader: CSSProperties = { display: "flex", alignItems: "center", gap: 10, fontSize: isMobile ? 15 : 17, color: "#3b82f6", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16, fontWeight: 700, fontFamily: "'Syne', sans-serif" };
            const purchase = inputs.purchasePrice;
            return (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 20 : 24 }}>
              <div>
                <div ref={propertySpecsRef} style={sectionBox}>
                  <div style={sectionHeader}><span aria-hidden>🏠</span> Property Specs</div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 10, color: "#64748b", marginBottom: 4, textTransform: "uppercase" }}>Bedrooms</label>
                      <input type="number" min={0} value={activeDeal.subjectBedrooms || ""} onChange={(e) => updateDeal({ subjectBedrooms: Math.max(0, parseInt(e.target.value) || 0) })}
                        style={{ width: "100%", minHeight: isMobile ? 44 : 36, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, color: "#f1f5f9", padding: isMobile ? "12px" : "8px", fontFamily: "monospace" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, color: "#64748b", marginBottom: 4, textTransform: "uppercase" }}>Bathrooms</label>
                      <input type="number" min={0} step={0.5} value={activeDeal.subjectBathrooms || ""} onChange={(e) => updateDeal({ subjectBathrooms: Math.max(0, parseFloat(e.target.value) || 0) })}
                        style={{ width: "100%", minHeight: isMobile ? 44 : 36, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, color: "#f1f5f9", padding: isMobile ? "12px" : "8px", fontFamily: "monospace" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, color: "#64748b", marginBottom: 4, textTransform: "uppercase" }}>Square Footage</label>
                      <input type="number" min={0} value={activeDeal.subjectSqft || ""} onChange={(e) => updateDeal({ subjectSqft: Math.max(0, parseFloat(e.target.value) || 0) })}
                        style={{ width: "100%", minHeight: isMobile ? 44 : 36, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, color: "#f1f5f9", padding: isMobile ? "12px" : "8px", fontFamily: "monospace" }} />
                    </div>
                  </div>
                </div>

                <div style={sectionBox}>
                  <div style={sectionHeader}><span aria-hidden>💰</span> Acquisition</div>
                  <InputField label="Purchase Price" value={inputs.purchasePrice} onChange={set("purchasePrice")} isMobile={isMobile} />
                  <InputField label="Closing Costs (Buy)" value={inputs.closingCostsBuy} onChange={set("closingCostsBuy")} isMobile={isMobile} />
                </div>

                <div style={sectionBox}>
                  <div style={sectionHeader}><span aria-hidden>🔨</span> Rehab Cost Breakdown</div>
                  {([["initial", "Initial Estimate"], ["ai_walkthrough", "AI Walkthrough"], ["manual", "Manual Override"]] as const).map(([k, label]) => (
                    <div key={k} style={{ display: "grid", gridTemplateColumns: isMobile ? "32px 1fr" : "32px 1fr 200px", gap: 8, alignItems: "center", marginBottom: 10, padding: "8px 0", borderBottom: "1px solid #0f172a" }}>
                      <input type="radio" name="rehabSource" checked={inputs.rehabCostSource === k} onChange={() => void updateInputs({ rehabCostSource: k })}
                        style={{ width: 18, height: 18, accentColor: "#3b82f6" }} />
                      <div style={{ fontSize: 13, color: "#e2e8f0" }}>{label}</div>
                      {k === "initial" && (
                        <div style={{ gridColumn: isMobile ? "1 / -1" : undefined, marginTop: isMobile ? 4 : 0, marginLeft: isMobile ? 32 : 0 }}>
                          <InputField label="" value={inputs.rehabInitialEstimate} onChange={(v) => updateInputs({ rehabInitialEstimate: v })} prefix="$" isMobile={isMobile} hideLabel />
                        </div>
                      )}
                      {k === "ai_walkthrough" && (
                        <div style={{ fontSize: 13, color: activeDeal.scopeItems.length > 0 ? "#94a3b8" : "#64748b", gridColumn: isMobile ? "1 / -1" : 3, textAlign: isMobile ? "left" : "right" }}>
                          {activeDeal.scopeItems.length > 0
                            ? `${fmt(aiRehab)} (${activeDeal.scopeItems.length} scope items)`
                            : "$0 — add scope items to enable"}
                        </div>
                      )}
                      {k === "manual" && (
                        <div style={{ gridColumn: isMobile ? "1 / -1" : undefined, marginTop: isMobile ? 4 : 0, marginLeft: isMobile ? 32 : 0 }}>
                          <InputField label="" value={inputs.rehabManualOverride} onChange={(v) => updateInputs({ rehabManualOverride: v })} prefix="$" isMobile={isMobile} hideLabel />
                        </div>
                      )}
                    </div>
                  ))}
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9", marginTop: 12, marginBottom: 6 }}>Active Rehab Cost: {fmt(activeRe)}</div>
                  {selectedRehabVal === 0 && <div style={{ fontSize: 12, color: "#f59e0b" }}>⚠ Selected source has $0 value.</div>}
                </div>

                <div style={sectionBox}>
                  <div style={sectionHeader}><span aria-hidden>📈</span> After Repair Value</div>
                  {([["initial", "Initial Estimate"], ["comp_derived", "Comp-Derived"]] as const).map(([k, label]) => (
                    <div key={k} style={{ display: "grid", gridTemplateColumns: isMobile ? "32px 1fr" : "32px 1fr 200px", gap: 8, alignItems: "center", marginBottom: 10, padding: "8px 0", borderBottom: "1px solid #0f172a" }}>
                      <input type="radio" name="arvSource" checked={inputs.arvSource === k} onChange={() => void updateInputs({ arvSource: k })} style={{ width: 18, height: 18, accentColor: "#3b82f6" }} />
                      <div style={{ fontSize: 13, color: "#e2e8f0" }}>{label}</div>
                      {k === "initial" && (
                        <div style={{ gridColumn: isMobile ? "1 / -1" : undefined, marginTop: isMobile ? 4 : 0, marginLeft: isMobile ? 32 : 0 }}>
                          <InputField label="" value={inputs.arvInitialEstimate} onChange={(v) => updateInputs({ arvInitialEstimate: v })} prefix="$" isMobile={isMobile} hideLabel />
                        </div>
                      )}
                      {k === "comp_derived" && (
                        <div style={{ fontSize: 13, color: nComps > 0 ? "#94a3b8" : "#64748b", gridColumn: isMobile ? "1 / -1" : 3, textAlign: isMobile ? "left" : "right" }}>
                          {nComps > 0 ? `${fmt(compArvW)} (${nComps} comps)` : "$0 — add comps to enable"}
                        </div>
                      )}
                    </div>
                  ))}
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9", marginTop: 12, marginBottom: 6 }}>Active ARV: {fmt(activeAr)}</div>
                  {selectedArvVal === 0 && <div style={{ fontSize: 12, color: "#f59e0b" }}>⚠ Selected source has $0 value.</div>}
                </div>

                <div style={sectionBox}>
                  <div style={sectionHeader}><span aria-hidden>🎯</span> Maximum Allowable Offer</div>
                  <InputField
                    label="MAO Percentage"
                    value={inputs.maoPercent}
                    onChange={(v) => { const n = Math.round(v || 0); void updateInputs({ maoPercent: Math.min(100, Math.max(1, n)) }); }}
                    prefix=""
                    suffix="%"
                    isMobile={isMobile}
                  />
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, marginBottom: 12 }}>MAO = (ARV × MAO%) − Rehab Cost</div>
                  <div style={{ fontSize: isMobile ? 20 : 22, fontWeight: 800, color: "#f1f5f9", fontFamily: "'JetBrains Mono', monospace", marginBottom: 10 }}>Maximum Offer: {fmt(mao)}</div>
                  {purchase === 0 ? (
                    <div style={{ fontSize: 12, color: "#64748b" }}>Enter purchase price in Acquisition to compare</div>
                  ) : purchase <= mao ? (
                    <div style={{ fontSize: 13, color: "#22c55e", fontWeight: 600 }}>You&apos;re {fmt(mao - purchase)} under MAO ✓</div>
                  ) : (
                    <div style={{ fontSize: 13, color: "#f87171", fontWeight: 600 }}>⚠ You&apos;re {fmt(purchase - mao)} over MAO</div>
                  )}
                </div>

                <div style={sectionBox}>
                  <div style={sectionHeader}><span aria-hidden>🏦</span> Financing</div>
                  <InputField label="Loan Amount" value={inputs.loanAmount} onChange={set("loanAmount")} isMobile={isMobile} />
                  <InputField label="Interest Rate" value={inputs.interestRate} onChange={set("interestRate")} prefix="%" suffix="APR" isMobile={isMobile} />
                  <InputField label="Loan Term" value={inputs.loanTermMonths} onChange={set("loanTermMonths")} prefix="" suffix="mo" isMobile={isMobile} />
                  <InputField label="Projected Hold Time" value={inputs.holdingMonths} onChange={set("holdingMonths")} prefix="" suffix="mo" isMobile={isMobile} />
                  <InputField label="Closing Costs (Sell)" value={inputs.closingCostsSell} onChange={set("closingCostsSell")} isMobile={isMobile} />
                </div>

                <div style={sectionBox}>
                  <div style={sectionHeader}><span aria-hidden>📝</span> Field Notes</div>
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
            );
          })()}

          {activeTab === "ai" && (
            <AIWalkthroughTab
              address={inputs.propertyAddress}
              onUpdateYearBuilt={(y) => updateDeal({ yearBuilt: y })}
              onAddToScope={handleAddAIToScope}
              isMobile={isMobile}
              dealId={activeDeal.id}
              userId={user.id}
              currentDeal={activeDeal}
              canUseAI={canUseAI}
              triggerAIUse={triggerAIUse}
              onNeedPaywall={openPaywall}
              propertyChangeBanner={aiPropertyChangeBanner}
              onPropertyChangeFromAnalysis={handleAiWalkthroughPropertyChanges}
              onAcceptPropertyChangeBanner={acceptAiPropertyChangeBanner}
              onDismissPropertyChangeBanner={() => setAiPropertyChangeBanner(null)}
              onModifyPropertySpecsManually={modifyAiPropertySpecsManually}
            />
          )}

          {activeTab === "comps" && (
            <CompsTab comps={activeDeal.comps} subjectSqft={activeDeal.subjectSqft} enteredArv={inputs.arv} isMobile={isMobile}
              supabase={supabase}
              dealId={activeDeal.id}
              activeDeal={activeDeal}
              canUseAI={canUseAI}
              onNeedPaywall={openPaywall}
              triggerAIUse={triggerAIUse}
              propertyAddress={inputs.propertyAddress}
              onAddComp={() => updateDeal({ comps: [...activeDeal.comps, { id: uid(), address: "", salePrice: 0, sqft: 0, bedBath: "", daysOnMarket: 0, soldDate: "", strength: "average", notes: "" }] })}
              onUpdateComp={(id, u) => updateDeal({ comps: activeDeal.comps.map((c) => c.id === id ? { ...c, ...u } : c) })}
              onDeleteComp={async (id) => {
                await supabase.from("comps").delete().eq("id", id);
                updateDeal({ comps: activeDeal.comps.filter((c) => c.id !== id) });
              }}
              onUpdateSubjectSqft={() => {}}
              onApplyArv={(_weightedArv) => { void _weightedArv; updateInputs({ arvSource: "comp_derived" }); setActiveTab("deal"); }}
              onRentCastSuccess={async (newComps, rentEstimate, rentalComps) => {
                if (!activeDeal || !user) return;
                const compsWereEmpty = activeDeal.comps.length === 0;
                const arvWasInitial = activeDeal.inputs.arvSource === "initial";
                const compsWithIds: Comp[] = newComps.map((c) => ({ ...c, id: uid() }));
                const updatedComps = [...activeDeal.comps, ...compsWithIds];
                let nextInputs: DealInputs = { ...activeDeal.inputs };
                if (rentEstimate > 0) nextInputs = { ...nextInputs, monthlyRent: rentEstimate };
                if (compsWereEmpty && updatedComps.length > 0 && arvWasInitial) {
                  nextInputs = { ...nextInputs, arvSource: "comp_derived" };
                }
                let merged: Deal = {
                  ...activeDeal,
                  inputs: nextInputs,
                  comps: updatedComps,
                  updatedAt: new Date().toISOString(),
                };
                merged = applySyncedRehabArv(merged);
                setDeals((prev) => prev.map((d) => d.id === activeDeal.id ? merged : d));
                if (compsWereEmpty && updatedComps.length > 0 && arvWasInitial) {
                  const w = calculateCompARV(updatedComps, activeDeal.subjectSqft).weightedArv;
                  setActivityToast({ text: `Comps imported. Using ${fmt(w)} comp-derived ARV. Change anytime on Deal Analysis.`, ms: 6000 });
                }
                if (saveTimer.current) clearTimeout(saveTimer.current);
                saveTimer.current = setTimeout(() => saveDeal(merged), 1500);
                try {
                  if (compsWithIds.length > 0) {
                    const { error: compsError } = await supabase.from("comps").insert(
                      compsWithIds.map((c) => ({
                        id: c.id,
                        deal_id: activeDeal.id,
                        user_id: user.id,
                        address: c.address,
                        sale_price: c.salePrice,
                        sqft: c.sqft,
                        bed_bath: c.bedBath,
                        days_on_market: c.daysOnMarket,
                        sold_date: c.soldDate,
                        strength: c.strength,
                        notes: c.notes,
                      }))
                    );
                    if (compsError) console.error("Direct comps insert error:", compsError);
                  }
                  if (rentEstimate > 0) {
                    const { error: rentError } = await supabase
                      .from("deals")
                      .update({ monthly_rent: rentEstimate })
                      .eq("id", activeDeal.id)
                      .eq("user_id", user.id);
                    if (rentError) console.error("Rent update error:", rentError);
                  }
                  if (rentalComps && rentalComps.length > 0) {
                    const rentalCompsWithIds = rentalComps.map(r => ({ ...r, id: uid() }));
                    const { error: rentalError } = await supabase.from("rental_comps").insert(
                      rentalCompsWithIds.map(r => ({
                        id: r.id,
                        deal_id: activeDeal.id,
                        user_id: user.id,
                        address: r.address,
                        monthly_rent: r.monthlyRent,
                        bed_bath: r.bedBath,
                        distance: r.distance,
                      }))
                    );
                    if (rentalError) console.error("Rental comps insert error:", rentalError);
                    const withRental = applySyncedRehabArv({ ...merged, rentalComps: rentalCompsWithIds });
                    setDeals(prev => prev.map(d => d.id === activeDeal.id ? withRental : d));
                    if (saveTimer.current) clearTimeout(saveTimer.current);
                    saveTimer.current = setTimeout(() => saveDeal(withRental), 1500);
                  }
                } catch (err) {
                  console.error("RentCast save error:", err);
                }
              }} />
          )}

          {activeTab === "rental" && activeDeal && (
            <RentalPivotTab
              inputs={inputs}
              metrics={metrics}
              isMobile={isMobile}
              rentalComps={activeDeal.rentalComps || []}
              setField={set}
              activeDeal={activeDeal}
              onNeedPaywall={openPaywall}
            />
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
              onDelete={async (id) => {
                await supabase.from("scope_items").delete().eq("id", id);
                updateDeal({ scopeItems: activeDeal.scopeItems.filter((s) => s.id !== id) });
              }}
            />
          )}

          {activeTab === "packet" && (
            <LenderPacketTab deal={activeDeal} metrics={metrics} lenderInfo={activeDeal.lenderInfo ?? BLANK_LENDER_INFO} isMobile={isMobile}
              onUpdateLenderInfo={(u) => updateDeal({ lenderInfo: { ...(activeDeal.lenderInfo ?? BLANK_LENDER_INFO), ...u } })} />
          )}
        </div>
        </>
        )}
        {showSettings && (
          <div style={{ padding: isMobile ? "16px 14px 24px" : "20px 24px", flex: 1, overflow: "auto" }}>
            <SettingsPage
              userEmail={user.email}
              subscription={subscription}
              deals={deals}
              onBack={() => setShowSettings(false)}
              onOpenPaywall={() => openPaywall("Upgrade to unlock Investor plan features.")}
              onRequestDeleteDeal={(deal) => setDealPendingDelete(deal)}
              onSignOut={handleSignOut}
            />
          </div>
        )}
        {showHelp && (
          <div style={{ padding: isMobile ? "16px 14px 24px" : "20px 24px", flex: 1, overflow: "auto" }}>
            <HelpSupportPage onBack={() => setShowHelp(false)} />
          </div>
        )}
      </div>
      {showOnboarding && (
        <OnboardingModal
          isMobile={isMobile}
          onClose={() => setShowOnboarding(false)}
          onNewDeal={handleAddDeal}
          onSeen={() => {
            if (!user) return;
            localStorage.setItem(`fliplogic_onboarding_seen_${user.id}`, "true");
          }}
        />
      )}
      {trialExhaustedOpen && (
        <TrialExhaustedModal
          isMobile={isMobile}
          onClose={() => setTrialExhaustedOpen(false)}
          onUpgrade={() => {
            setTrialExhaustedOpen(false);
            openPaywall("Upgrade to Investor to use AI on new deals.");
          }}
          onContinueWithoutAI={() => {
            setTrialExhaustedOpen(false);
            void insertNewDeal(true);
          }}
        />
      )}
      {dealLimitOpen && (
        <DealLimitModal
          isMobile={isMobile}
          onClose={() => setDealLimitOpen(false)}
          onUpgrade={() => {
            setDealLimitOpen(false);
            openPaywall("Unlimited deals with FlipLogic AI Investor.");
          }}
          onManageDeals={() => {
            setDealLimitOpen(false);
            setSidebarOpen(false);
            setShowSettings(true);
            setScrollToManageDeals(true);
          }}
        />
      )}
      {dealPendingDelete && (
        <DeleteDealConfirmationModal
          deal={dealPendingDelete}
          isMobile={isMobile}
          onCancel={() => setDealPendingDelete(null)}
          onConfirmDelete={() => { void handleConfirmDeleteDeal(); }}
        />
      )}
      <PaywallModal
        isOpen={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason={paywallReason || "Upgrade to use AI features."}
        supabaseClient={supabase}
        returnUrl={typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "https://charming-pudding-d20567.netlify.app"}
      />
    </div>
  );
}