import { useState, useEffect, useRef } from "react";

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

interface AIFinding {
  category: string;
  description: string;
  priority: "critical" | "important" | "optional";
  estimatedCost: number;
  notes: string;
  hazmat: boolean;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// ─── Shared UI ────────────────────────────────────────────────────────────────
function InputField({ label, value, onChange, prefix = "$", suffix = "" }: {
  label: string; value: number; onChange: (v: number) => void; prefix?: string; suffix?: string;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, overflow: "hidden" }}>
        {prefix && <span style={{ padding: "8px 10px", color: "#475569", fontSize: 13, background: "#0a0f1a", borderRight: "1px solid #1e293b" }}>{prefix}</span>}
        <input type="number" value={value || ""} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#f1f5f9", padding: "8px 10px", fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }} />
        {suffix && <span style={{ padding: "8px 10px", color: "#475569", fontSize: 13, background: "#0a0f1a", borderLeft: "1px solid #1e293b" }}>{suffix}</span>}
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, highlight = false }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div style={{ background: highlight ? "#0d1f35" : "#0a0f1a", border: `1px solid ${highlight ? "#1d4ed8" : "#1e293b"}`, borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: highlight ? "#60a5fa" : "#f1f5f9", fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ScenarioRow({ scenario, inputs }: { scenario: Scenario; inputs: DealInputs }) {
  const m = calculateMetrics({ ...inputs, rehabCost: inputs.rehabCost * scenario.rehabMultiplier, arv: inputs.arv * scenario.arvMultiplier });
  const score = SCORE_STYLES[m.dealScore];
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
function AIWalkthroughTab({ address, buildYear, onAddToScope }: {
  address: string;
  buildYear: number;
  onAddToScope: (items: ScopeItem[]) => void;
}) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("fliplogic_api_key") || "");
  const [showKey, setShowKey] = useState(false);
  const [photos, setPhotos] = useState<WalkthroughPhoto[]>([]);
  const [findings, setFindings] = useState<AIFinding[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [selectedFindings, setSelectedFindings] = useState<Set<number>>(new Set());
  const [buildYearInput, setBuildYearInput] = useState(buildYear || 1970);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem("fliplogic_api_key", key);
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
      newPhotos.push({
        id: uid(),
        base64,
        mediaType: file.type,
        label: file.name,
        analyzed: false,
      });
    }
    setPhotos((prev) => [...prev, ...newPhotos].slice(0, 8));
  };

  const analyze = async () => {
    if (!apiKey.trim()) { setError("Please enter your Anthropic API key first."); return; }
    if (photos.length === 0) { setError("Please upload at least one property photo."); return; }

    setAnalyzing(true);
    setError("");
    setFindings([]);
    setSelectedFindings(new Set());
    setStatus("Sending photos to Claude AI for analysis...");

    try {
      const imageContent = photos.map((p) => ({
        type: "image",
        source: { type: "base64", media_type: p.mediaType, data: p.base64 },
      }));

      const hazmatContext = buildYearInput < 1978
        ? `IMPORTANT: This property was built in ${buildYearInput}, before 1978. Assume lead paint is LIKELY present in all painted surfaces until tested. Flag this as a critical hazmat item.`
        : `This property was built in ${buildYearInput}.`;

      const prompt = `You are an expert real estate inspector and rehab estimator analyzing property photos for a fix-and-flip investor.

${hazmatContext}

Analyze all ${photos.length} photo(s) carefully. Identify every repair, renovation, or remediation item you can see or reasonably infer.

For each finding, respond ONLY with a JSON array. No preamble, no explanation, just the raw JSON array.

Format:
[
  {
    "category": "one of: Foundation & Structure, Roof, Exterior, Windows & Doors, Plumbing, Electrical, HVAC, Insulation, Drywall & Paint, Flooring, Kitchen, Bathrooms, Landscaping, Permits & Fees, Cleanup & Hauling, Other",
    "description": "clear concise description of the work needed",
    "priority": "critical | important | optional",
    "estimatedCost": number (realistic US market cost in dollars, no symbols),
    "notes": "specific observations, materials spotted, hazmat flags, severity notes",
    "hazmat": true or false
  }
]

Priority rules:
- critical = safety hazard, structural, deal-killer, or hazmat (lead, asbestos, mold)
- important = necessary for resale value or financing
- optional = cosmetic upgrades that improve value but aren't required

Be thorough. A good inspector catches things others miss. Flag Federal Pacific or Zinsco electrical panels as critical. Flag popcorn ceilings in pre-1980 homes as potential asbestos. Flag any visible water damage, foundation cracks, or signs of pest damage.

Return ONLY the JSON array.`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              ...imageContent,
              { type: "text", text: prompt },
            ],
          }],
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.content[0]?.text || "";

      // Parse JSON — strip any markdown fences if present
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed: AIFinding[] = JSON.parse(clean);

      setFindings(parsed);
      setSelectedFindings(new Set(parsed.map((_, i) => i)));
      setStatus(`Analysis complete — ${parsed.length} findings identified across ${photos.length} photo(s).`);
    } catch (err: any) {
      setError(err.message || "Analysis failed. Check your API key and try again.");
      setStatus("");
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleFinding = (i: number) => {
    setSelectedFindings((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const handleAddToScope = () => {
    const items: ScopeItem[] = Array.from(selectedFindings).map((i) => {
      const f = findings[i];
      return {
        id: uid(),
        category: f.category,
        description: f.description,
        quantity: 1,
        unit: "lot",
        myEstimate: f.estimatedCost,
        notes: f.notes + (f.hazmat ? " ⚠ HAZMAT FLAG" : ""),
        priority: f.priority,
      };
    });
    onAddToScope(items);
  };

  const hazmatFindings = findings.filter((f) => f.hazmat);
  const totalEstimate = findings.filter((_, i) => selectedFindings.has(i)).reduce((s, f) => s + f.estimatedCost, 0);

  return (
    <div>
      {/* API Key Section */}
      <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>Anthropic API Key</div>
          {apiKey && <div style={{ fontSize: 11, color: "#22c55e" }}>✓ Key saved</div>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", background: "#060b14", border: "1px solid #1e293b", borderRadius: 6, overflow: "hidden" }}>
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => saveKey(e.target.value)}
              placeholder="sk-ant-api03-..."
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#f1f5f9", padding: "8px 12px", fontSize: 13, fontFamily: "monospace" }}
            />
            <button onClick={() => setShowKey(!showKey)}
              style={{ padding: "8px 12px", background: "transparent", border: "none", color: "#475569", cursor: "pointer", fontSize: 11 }}>
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#334155", marginTop: 6 }}>
          Your key is stored only in your browser. Never shared. Get yours at console.anthropic.com
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }}>
        {/* Left: Upload + Photos */}
        <div>
          {/* Build Year */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Property Build Year</div>
              <div style={{ display: "flex", alignItems: "center", background: "#060b14", border: `1px solid ${buildYearInput < 1978 ? "#d97706" : "#1e293b"}`, borderRadius: 6, overflow: "hidden", width: 120 }}>
                <input type="number" value={buildYearInput} onChange={(e) => setBuildYearInput(parseInt(e.target.value) || 1970)}
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#f1f5f9", padding: "8px 10px", fontSize: 14, fontFamily: "monospace" }} />
              </div>
            </div>
            {buildYearInput < 1978 && (
              <div style={{ background: "#2d2000", border: "1px solid #d97706", borderRadius: 6, padding: "8px 14px", fontSize: 11, color: "#f59e0b" }}>
                ⚠ Pre-1978 build — AI will flag lead paint risk automatically
              </div>
            )}
            {buildYearInput < 1985 && buildYearInput >= 1978 && (
              <div style={{ background: "#0c1a2e", border: "1px solid #3b82f6", borderRadius: 6, padding: "8px 14px", fontSize: 11, color: "#60a5fa" }}>
                ℹ Pre-1985 — AI will watch for asbestos indicators
              </div>
            )}
          </div>

          {/* Upload Zone */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handlePhotos(e.dataTransfer.files); }}
            style={{
              border: "2px dashed #1e293b", borderRadius: 8, padding: "32px 20px",
              textAlign: "center", cursor: "pointer", marginBottom: 16,
              background: "#0a0f1a", transition: "border-color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#3b82f6")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#1e293b")}
          >
            <div style={{ fontSize: 32, marginBottom: 10 }}>📸</div>
            <div style={{ fontSize: 14, color: "#94a3b8", marginBottom: 4 }}>Drop property photos here or click to upload</div>
            <div style={{ fontSize: 11, color: "#475569" }}>Up to 8 photos · JPG, PNG, WEBP · Interior & exterior</div>
            <input ref={fileRef} type="file" multiple accept="image/*" style={{ display: "none" }}
              onChange={(e) => e.target.files && handlePhotos(e.target.files)} />
          </div>

          {/* Photo Grid */}
          {photos.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
              {photos.map((p) => (
                <div key={p.id} style={{ position: "relative", borderRadius: 6, overflow: "hidden", aspectRatio: "1", background: "#0a0f1a", border: "1px solid #1e293b" }}>
                  <img src={`data:${p.mediaType};base64,${p.base64}`} alt={p.label}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                    style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.7)", border: "none", color: "#f87171", borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    ×
                  </button>
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.7)", padding: "3px 6px", fontSize: 9, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.label}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Analyze Button */}
          <button onClick={analyze} disabled={analyzing || photos.length === 0 || !apiKey}
            style={{
              width: "100%", border: "none", borderRadius: 8, color: "#fff",
              padding: "14px 0", fontSize: 14, fontWeight: 700, cursor: analyzing || photos.length === 0 || !apiKey ? "not-allowed" : "pointer",
              fontFamily: "'Syne', sans-serif", letterSpacing: "0.05em", marginBottom: 8,
              background: analyzing ? "#1e293b" : photos.length === 0 || !apiKey ? "#1e293b" : "linear-gradient(135deg, #7c3aed, #6d28d9)",
              opacity: analyzing || photos.length === 0 || !apiKey ? 0.5 : 1,
            }}>
            {analyzing ? "🔍 Analyzing..." : `🤖 Analyze ${photos.length > 0 ? photos.length + " Photo" + (photos.length > 1 ? "s" : "") : "Photos"} with AI`}
          </button>

          {status && !analyzing && (
            <div style={{ background: "#0d3d1f", border: "1px solid #16a34a", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#22c55e", marginBottom: 12 }}>
              ✓ {status}
            </div>
          )}

          {analyzing && (
            <div style={{ background: "#0c1a2e", border: "1px solid #3b82f6", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#60a5fa", marginBottom: 12 }}>
              <span style={{ display: "inline-block", animation: "pulse 1.5s infinite" }}>🔍</span> Claude is analyzing your photos for repair items, hazmat risks, and cost estimates...
            </div>
          )}

          {error && (
            <div style={{ background: "#2a0a0a", border: "1px solid #dc2626", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#f87171", marginBottom: 12 }}>
              ✗ {error}
            </div>
          )}

          {/* Findings List */}
          {findings.length > 0 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  AI Findings — Select items to add to Scope
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setSelectedFindings(new Set(findings.map((_, i) => i)))}
                    style={{ background: "transparent", border: "1px solid #1e293b", borderRadius: 4, color: "#94a3b8", padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
                    All
                  </button>
                  <button onClick={() => setSelectedFindings(new Set())}
                    style={{ background: "transparent", border: "1px solid #1e293b", borderRadius: 4, color: "#94a3b8", padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
                    None
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {findings.map((f, i) => {
                  const p = PRIORITY_STYLES[f.priority];
                  const selected = selectedFindings.has(i);
                  return (
                    <div key={i} onClick={() => toggleFinding(i)}
                      style={{
                        background: selected ? "#0d1829" : "#0a0f1a",
                        border: `1px solid ${selected ? p.border : "#1e293b"}`,
                        borderRadius: 8, padding: 14, cursor: "pointer",
                        transition: "all 0.15s",
                      }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${selected ? "#3b82f6" : "#334155"}`, background: selected ? "#3b82f6" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff" }}>
                            {selected ? "✓" : ""}
                          </div>
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

        {/* Right: Summary + Actions */}
        <div>
          <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>AI Analysis Summary</div>

          {/* How it works */}
          {findings.length === 0 && (
            <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>How It Works</div>
              {[
                { icon: "📸", text: "Upload photos of each room, exterior, roof, electrical panel, HVAC, and any problem areas" },
                { icon: "🤖", text: "Claude AI analyzes every image for repair needs, hazmat risks, and construction quality" },
                { icon: "⚠", text: "Pre-1978 homes automatically trigger lead paint warnings. Popcorn ceilings flagged for asbestos" },
                { icon: "📋", text: "Review findings, select what applies, and push directly to your Scope of Work with one click" },
              ].map((item) => (
                <div key={item.icon} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                  <span style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{item.text}</span>
                </div>
              ))}
              <div style={{ marginTop: 12, padding: "10px 12px", background: "#060b14", border: "1px solid #1e293b", borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: "#475569", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>Pro Tip</div>
                <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>
                  Always photograph the electrical panel, under sinks, attic access, basement/crawlspace, and any visible cracks. These are where deal-killers hide.
                </div>
              </div>
            </div>
          )}

          {/* Results Summary */}
          {findings.length > 0 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <MetricCard label="Total Findings" value={`${findings.length}`} sub="items identified" />
                <MetricCard label="Selected Est." value={fmt(totalEstimate)} highlight />
                <MetricCard label="Critical Items" value={`${findings.filter(f => f.priority === "critical").length}`} sub="need immediate attention" />
                <MetricCard label="Hazmat Flags" value={`${hazmatFindings.length}`} sub={hazmatFindings.length > 0 ? "⚠ Review required" : "None detected"} />
              </div>

              {/* Hazmat Alert */}
              {hazmatFindings.length > 0 && (
                <div style={{ background: "#2d2000", border: "1px solid #d97706", borderRadius: 8, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700, marginBottom: 8 }}>⚠ Hazmat Findings Detected</div>
                  {hazmatFindings.map((f, i) => (
                    <div key={i} style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>• {f.description}</div>
                  ))}
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 8, lineHeight: 1.5 }}>
                    Always get a professional environmental assessment before closing. These items may affect financing.
                  </div>
                </div>
              )}

              {/* Breakdown by priority */}
              <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Cost by Priority</div>
                {(["critical", "important", "optional"] as const).map((p) => {
                  const pFindings = findings.filter((f) => f.priority === p);
                  const pTotal = pFindings.reduce((s, f) => s + f.estimatedCost, 0);
                  if (pFindings.length === 0) return null;
                  return (
                    <div key={p} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #0f172a" }}>
                      <span style={{ fontSize: 12, color: PRIORITY_STYLES[p].color }}>● {PRIORITY_STYLES[p].label} ({pFindings.length})</span>
                      <span style={{ fontSize: 12, fontFamily: "monospace", color: "#f1f5f9" }}>{fmt(pTotal)}</span>
                    </div>
                  );
                })}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0" }}>
                  <span style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 700 }}>AI Total Estimate</span>
                  <span style={{ fontSize: 16, fontFamily: "monospace", color: "#22c55e", fontWeight: 700 }}>{fmt(findings.reduce((s, f) => s + f.estimatedCost, 0))}</span>
                </div>
              </div>

              {/* Add to Scope Button */}
              <button onClick={handleAddToScope} disabled={selectedFindings.size === 0}
                style={{
                  width: "100%", border: "none", borderRadius: 8, color: "#fff",
                  padding: "14px 0", fontSize: 13, fontWeight: 700,
                  cursor: selectedFindings.size === 0 ? "not-allowed" : "pointer",
                  fontFamily: "'Syne', sans-serif", letterSpacing: "0.05em", marginBottom: 8,
                  background: selectedFindings.size === 0 ? "#1e293b" : "linear-gradient(135deg, #16a34a, #15803d)",
                  opacity: selectedFindings.size === 0 ? 0.5 : 1,
                }}>
                + Add {selectedFindings.size} Item{selectedFindings.size !== 1 ? "s" : ""} to Scope of Work
              </button>

              <button onClick={() => { setFindings([]); setPhotos([]); setStatus(""); setSelectedFindings(new Set()); }}
                style={{ width: "100%", background: "transparent", border: "1px solid #1e293b", borderRadius: 8, color: "#475569", padding: "10px 0", fontSize: 12, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
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
function CompCard({ comp, onUpdate, onDelete }: { comp: Comp; onUpdate: (u: Partial<Comp>) => void; onDelete: () => void }) {
  const ppsf = comp.salePrice > 0 && comp.sqft > 0 ? comp.salePrice / comp.sqft : 0;
  const strength = STRENGTH_STYLES[comp.strength];
  const fs = { background: "#060b14", border: "1px solid #1e293b", borderRadius: 4, color: "#f1f5f9", padding: "6px 8px", fontSize: 12, fontFamily: "monospace", outline: "none", width: "100%", boxSizing: "border-box" as const };
  return (
    <div style={{ background: "#0a0f1a", border: `1px solid ${strength.border}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {(["strong", "average", "weak"] as const).map((s) => (
            <button key={s} onClick={() => onUpdate({ strength: s })} style={{ padding: "3px 10px", borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: "pointer", border: `1px solid ${comp.strength === s ? STRENGTH_STYLES[s].border : "#1e293b"}`, background: comp.strength === s ? STRENGTH_STYLES[s].bg : "transparent", color: comp.strength === s ? STRENGTH_STYLES[s].color : "#475569", fontFamily: "'Syne', sans-serif" }}>
              {STRENGTH_STYLES[s].label}
            </button>
          ))}
        </div>
        <button onClick={onDelete} style={{ background: "transparent", border: "none", color: "#334155", cursor: "pointer", fontSize: 16 }}>×</button>
      </div>
      <input type="text" value={comp.address} placeholder="Address..." onChange={(e) => onUpdate({ address: e.target.value })} style={{ ...fs, marginBottom: 8, color: "#94a3b8" }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
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
function CompsTab({ comps, subjectSqft, enteredArv, onAddComp, onUpdateComp, onDeleteComp, onUpdateSubjectSqft, onApplyArv }: {
  comps: Comp[]; subjectSqft: number; enteredArv: number;
  onAddComp: () => void; onUpdateComp: (id: string, u: Partial<Comp>) => void;
  onDeleteComp: (id: string) => void; onUpdateSubjectSqft: (v: number) => void; onApplyArv: (v: number) => void;
}) {
  const { weightedArv, avgPpsf, strongAvg, allAvg } = calculateCompARV(comps, subjectSqft);
  const validComps = comps.filter((c) => c.salePrice > 0);
  const arvDiff = enteredArv > 0 && weightedArv > 0 ? ((enteredArv - weightedArv) / weightedArv) * 100 : null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Subject Sq Ft</div>
          <div style={{ display: "flex", alignItems: "center", background: "#060b14", border: "1px solid #1e293b", borderRadius: 6, overflow: "hidden", maxWidth: 160 }}>
            <input type="number" value={subjectSqft || ""} onChange={(e) => onUpdateSubjectSqft(parseFloat(e.target.value) || 0)}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#f1f5f9", padding: "8px 10px", fontSize: 14, fontFamily: "monospace" }} />
            <span style={{ padding: "8px 8px", color: "#475569", fontSize: 11, background: "#0a0f1a", borderLeft: "1px solid #1e293b" }}>sqft</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Your ARV</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9", fontFamily: "monospace" }}>{enteredArv > 0 ? fmt(enteredArv) : "—"}</div>
        </div>
        <div style={{ color: "#334155" }}>vs</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Comp-Derived ARV</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: weightedArv > 0 ? "#22c55e" : "#334155", fontFamily: "monospace" }}>{weightedArv > 0 ? fmt(weightedArv) : "—"}</div>
        </div>
        {arvDiff !== null && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 4 }}>Variance</div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: Math.abs(arvDiff) <= 5 ? "#22c55e" : Math.abs(arvDiff) <= 10 ? "#f59e0b" : "#f87171" }}>{arvDiff > 0 ? "+" : ""}{arvDiff.toFixed(1)}%</div>
            <div style={{ fontSize: 10, color: "#475569" }}>{Math.abs(arvDiff) <= 5 ? "✓ On target" : arvDiff > 0 ? "⚠ You're high" : "⚠ You're low"}</div>
          </div>
        )}
        {weightedArv > 0 && (
          <button onClick={() => onApplyArv(Math.round(weightedArv))} style={{ background: "#1d4ed8", border: "none", borderRadius: 6, color: "#fff", padding: "8px 14px", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap" }}>Apply to Deal</button>
        )}
      </div>
      {validComps.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
          <MetricCard label="Comp Count" value={`${validComps.length}`} />
          <MetricCard label="Avg $/SqFt" value={avgPpsf > 0 ? `$${avgPpsf.toFixed(0)}` : "—"} highlight />
          <MetricCard label="Strong Comp Avg" value={strongAvg > 0 ? fmt(strongAvg) : "—"} />
          <MetricCard label="All Comp Avg" value={allAvg > 0 ? fmt(allAvg) : "—"} />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {comps.map((comp) => <CompCard key={comp.id} comp={comp} onUpdate={(u) => onUpdateComp(comp.id, u)} onDelete={() => onDeleteComp(comp.id)} />)}
      </div>
      {comps.length < 6 && (
        <button onClick={onAddComp} style={{ width: "100%", background: "transparent", border: "1px dashed #1e293b", borderRadius: 8, color: "#334155", padding: "14px 0", fontSize: 13, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
          + Add Comparable Sale {comps.length > 0 ? `(${comps.length}/6)` : ""}
        </button>
      )}
    </div>
  );
}

// ─── Scope of Work Tab ────────────────────────────────────────────────────────
function ScopeOfWorkTab({ scopeItems, address, onAdd, onUpdate, onDelete }: {
  scopeItems: ScopeItem[]; address: string;
  onAdd: () => void; onUpdate: (id: string, u: Partial<ScopeItem>) => void; onDelete: (id: string) => void;
}) {
  const totalEstimate = scopeItems.reduce((s, i) => s + i.myEstimate, 0);
  const byCategory = SCOPE_CATEGORIES.map((cat) => ({ cat, items: scopeItems.filter((i) => i.category === cat) })).filter((g) => g.items.length > 0);
  const criticalTotal = scopeItems.filter((i) => i.priority === "critical").reduce((s, i) => s + i.myEstimate, 0);
  const importantTotal = scopeItems.filter((i) => i.priority === "important").reduce((s, i) => s + i.myEstimate, 0);
  const optionalTotal = scopeItems.filter((i) => i.priority === "optional").reduce((s, i) => s + i.myEstimate, 0);
  const fs = { background: "#060b14", border: "1px solid #1e293b", borderRadius: 4, color: "#f1f5f9", padding: "6px 8px", fontSize: 12, fontFamily: "monospace", outline: "none", boxSizing: "border-box" as const };

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
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;margin-bottom:16px"><strong>${address||"Property Address"}</strong><br><span style="font-size:10px;color:#64748b">Please review the scope below and provide your itemized bid for each line item.</span></div>
    <div class="notice">⚠ BLIND BID NOTICE: Budget estimates have been intentionally removed. Please provide your honest market-rate pricing based solely on the scope of work described.</div>
    ${grouped.map(g=>`<div class="section-title">${g.cat}</div><table><thead><tr><th style="width:40%">Description</th><th>Qty</th><th>Unit</th><th>Priority</th><th>Notes</th><th style="width:120px">Your Bid ($)</th></tr></thead><tbody>${g.items.map(item=>`<tr><td>${item.description||"—"}</td><td style="text-align:center">${item.quantity}</td><td>${item.unit}</td><td class="p-${item.priority}">${item.priority.charAt(0).toUpperCase()+item.priority.slice(1)}</td><td style="color:#64748b;font-style:italic">${item.notes||""}</td><td><div class="bid-box">$____________</div></td></tr>`).join("")}</tbody></table>`).join("")}
    <div style="margin-top:20px;border-top:2px solid #1e3a5f;padding-top:12px"><table><tr style="background:#f8fafc"><td colspan="5" style="font-size:13px;padding:10px 8px;font-weight:700">TOTAL BID</td><td style="padding:10px 8px"><div class="bid-box" style="border:2px solid #1e3a5f;font-weight:700;font-size:13px;color:#1e3a5f">$____________</div></td></tr></table></div>
    <div class="contractor-box"><div style="font-size:10px;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Contractor Information</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:11px"><div>Company: ____________________________</div><div>License #: ____________________________</div><div>Contact: ____________________________</div><div>Phone: ____________________________</div><div>Email: ____________________________</div><div>Date: ____________________________</div></div></div>
    <div class="footer"><span>FlipLogic AI · Blind SOW · ${new Date().toLocaleDateString()}</span><span>${address||""}</span></div>
    </body></html>`);
    pw.document.close();
    setTimeout(() => pw.print(), 500);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase" }}>Scope Items ({scopeItems.length})</div>
          <button onClick={onAdd} style={{ background: "#1d4ed8", border: "none", borderRadius: 6, color: "#fff", padding: "8px 16px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>+ Add Item</button>
        </div>
        {scopeItems.length === 0 && (
          <div style={{ background: "#0a0f1a", border: "1px dashed #1e293b", borderRadius: 8, padding: 40, textAlign: "center", color: "#334155", fontSize: 13 }}>
            No scope items yet. Use the AI Walkthrough tab to auto-populate, or click "+ Add Item" to add manually.
          </div>
        )}
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
                        <button key={p} onClick={() => onUpdate(item.id, { priority: p })} style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif", border: `1px solid ${item.priority === p ? PRIORITY_STYLES[p].border : "#1e293b"}`, background: item.priority === p ? PRIORITY_STYLES[p].bg : "transparent", color: item.priority === p ? PRIORITY_STYLES[p].color : "#475569" }}>
                          {PRIORITY_STYLES[p].label}
                        </button>
                      ))}
                    </div>
                    <button onClick={() => onDelete(item.id)} style={{ background: "transparent", border: "none", color: "#334155", cursor: "pointer", fontSize: 16 }}>×</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 8, marginBottom: 8 }}>
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
                  <div style={{ display: "grid", gridTemplateColumns: "80px 100px 1fr 160px", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#475569", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>Qty</div>
                      <input type="number" value={item.quantity || ""} onChange={(e) => onUpdate(item.id, { quantity: parseFloat(e.target.value) || 1 })} style={{ ...fs, width: "100%" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#475569", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>Unit</div>
                      <input type="text" value={item.unit} onChange={(e) => onUpdate(item.id, { unit: e.target.value })} style={{ ...fs, width: "100%", color: "#94a3b8" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#475569", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>Notes</div>
                      <input type="text" value={item.notes} onChange={(e) => onUpdate(item.id, { notes: e.target.value })} style={{ ...fs, width: "100%", color: "#64748b" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#475569", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>My Estimate</div>
                      <div style={{ display: "flex", alignItems: "center", background: "#060b14", border: "1px solid #334155", borderRadius: 4, overflow: "hidden" }}>
                        <span style={{ padding: "6px 8px", color: "#334155", fontSize: 12, background: "#0a0f1a", borderRight: "1px solid #1e293b" }}>$</span>
                        <input type="number" value={item.myEstimate || ""} onChange={(e) => onUpdate(item.id, { myEstimate: parseFloat(e.target.value) || 0 })} style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#475569", padding: "6px 8px", fontSize: 12, fontFamily: "monospace" }} />
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
        {byCategory.length > 0 && (
          <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>By Category</div>
            {byCategory.map(g => {
              const t = g.items.reduce((s, i) => s + i.myEstimate, 0);
              const pct = totalEstimate > 0 ? (t / totalEstimate) * 100 : 0;
              return (
                <div key={g.cat} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>{g.cat}</span>
                    <span style={{ fontSize: 11, fontFamily: "monospace", color: "#f1f5f9" }}>{fmt(t)}</span>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 2, height: 4, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: "#3b82f6", borderRadius: 2 }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ background: "#2d2000", border: "1px solid #d97706", borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, marginBottom: 6 }}>🔒 Blind Export</div>
          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>Your estimates are hidden from contractors. They bid blind — no anchoring to your numbers.</div>
        </div>
        <button onClick={handlePrintBlind} style={{ width: "100%", background: "linear-gradient(135deg, #d97706, #b45309)", border: "none", borderRadius: 8, color: "#fff", padding: "14px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif", marginBottom: 8 }}>
          🖨 PRINT BLIND SOW
        </button>
        <div style={{ fontSize: 11, color: "#334155", textAlign: "center" }}>Contractors bid blind — no anchoring</div>
      </div>
    </div>
  );
}

// ─── Lender Packet Tab ────────────────────────────────────────────────────────
function LenderPacketTab({ deal, metrics, lenderInfo, onUpdateLenderInfo }: {
  deal: Deal; metrics: DealMetrics; lenderInfo: LenderInfo; onUpdateLenderInfo: (u: Partial<LenderInfo>) => void;
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
    .property{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;margin-bottom:20px}
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
    .disc{font-size:9px;color:#94a3b8;font-style:italic;margin-top:10px;line-height:1.5}
    @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body>
    <div class="header">
      <div><div class="brand">FLIP<span>LOGIC</span> AI</div>${lenderInfo.investorName?`<div style="margin-top:8px;font-size:11px;font-weight:600">${lenderInfo.investorName}${lenderInfo.investorCompany?` · ${lenderInfo.investorCompany}`:""}</div>`:""}</div>
      <div style="text-align:right"><div style="font-size:16px;font-weight:700;color:#1e3a5f">LENDER PACKET</div>${lenderInfo.lenderName?`<div style="font-size:10px;color:#1d4ed8;font-weight:600;margin-top:4px">For: ${lenderInfo.lenderName}</div>`:""}<div style="font-size:10px;color:#94a3b8;margin-top:3px">${new Date().toLocaleDateString()}</div></div>
    </div>
    <div class="property"><strong style="font-size:13px">${inputs.propertyAddress||"Property Address"}</strong><br><span style="font-size:10px;color:#64748b">Fix &amp; Flip · Hold: ${inputs.holdingMonths} months</span></div>
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
      <div><div class="st">Acquisition &amp; Financing</div><table class="dt"><tr><td>Purchase Price</td><td>${fmt(inputs.purchasePrice)}</td></tr><tr><td>Rehab Cost</td><td>${fmt(inputs.rehabCost)}</td></tr><tr><td>Closing Costs (Buy)</td><td>${fmt(inputs.closingCostsBuy)}</td></tr><tr><td>Total Project Cost</td><td>${fmt(metrics.totalProjectCost)}</td></tr><tr><td>Loan Amount</td><td>${fmt(inputs.loanAmount)}</td></tr><tr><td>Interest Rate</td><td>${fmtPct(inputs.interestRate)} APR</td></tr></table></div>
      <div><div class="st">Profit &amp; Exit</div><table class="dt"><tr><td>ARV</td><td>${fmt(inputs.arv)}</td></tr><tr><td>Gross Profit</td><td>${fmt(metrics.grossProfit)}</td></tr><tr><td>Selling Costs</td><td>${fmt(inputs.closingCostsSell)}</td></tr><tr><td>Holding Costs</td><td>${fmt(metrics.totalHoldingCosts)}</td></tr><tr><td>Net Profit</td><td>${fmt(metrics.netProfit)}</td></tr><tr><td>ROI</td><td>${fmtPct(metrics.roi)}</td></tr></table></div>
    </div>
    ${deal.comps.filter(c=>c.salePrice>0).length>0?`<div class="st">Comparable Sales</div><table class="ct"><thead><tr><th>Address</th><th>Price</th><th>SqFt</th><th>$/SqFt</th><th>DOM</th><th>Weight</th></tr></thead><tbody>${deal.comps.filter(c=>c.salePrice>0).map(c=>`<tr><td>${c.address||"—"}</td><td style="font-weight:600">${fmt(c.salePrice)}</td><td>${c.sqft>0?c.sqft.toLocaleString():"—"}</td><td>${c.salePrice>0&&c.sqft>0?"$"+(c.salePrice/c.sqft).toFixed(0):"—"}</td><td>${c.daysOnMarket>0?c.daysOnMarket+"d":"—"}</td><td>${c.strength.charAt(0).toUpperCase()+c.strength.slice(1)}</td></tr>`).join("")}</tbody></table>${weightedArv>0?`<p style="margin-top:8px;font-size:11px">Weighted ARV: <strong style="color:#1d4ed8">${fmt(weightedArv)}</strong></p>`:""}`:""}
    <div style="margin-top:20px"><div class="st">Sensitivity Analysis</div>
    <div class="sg">${["Scenario","Net Profit","ROI","LTV","Score"].map(h=>`<div class="sh">${h}</div>`).join("")}
    ${SCENARIOS.map(s=>{const m2=calculateMetrics({...inputs,rehabCost:inputs.rehabCost*s.rehabMultiplier,arv:inputs.arv*s.arvMultiplier});const sc={HOT:"H",WARM:"W",COLD:"C",DEAD:"D"}[m2.dealScore];return`<div class="sr">${s.label}</div><div class="sr">${fmt(m2.netProfit)}</div><div class="sr">${fmtPct(m2.roi)}</div><div class="sr">${fmtPct(m2.ltv)}</div><div class="sr"><span class="sb s${sc}">${m2.dealScore}</span></div>`;}).join("")}</div></div>
    ${inputs.notes?`<div class="st">Field Notes</div><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;font-size:11px;line-height:1.6">${inputs.notes}</div>`:""}
    <div class="footer"><span>FlipLogic AI · ${new Date().toLocaleDateString()}</span><span>${lenderInfo.investorName||""}</span></div>
    <div class="disc">Informational purposes only. All projections are estimates. Not investment or legal advice.</div>
    </body></html>`);
    pw.document.close();
    setTimeout(() => pw.print(), 500);
  };

  const tf = (label: string, key: keyof LenderInfo) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</label>
      <input type="text" value={lenderInfo[key]} onChange={(e) => onUpdateLenderInfo({ [key]: e.target.value })} placeholder={`Enter ${label.toLowerCase()}...`}
        style={{ width: "100%", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, color: "#f1f5f9", padding: "8px 10px", fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 24 }}>
      <div>
        <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Packet Info</div>
        <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 14 }}>
          {tf("Investor Name", "investorName")}{tf("Company", "investorCompany")}{tf("Phone", "investorPhone")}{tf("Email", "investorEmail")}
        </div>
        <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 14 }}>
          {tf("Lender / Recipient Name", "lenderName")}
        </div>
        <button onClick={handlePrint} style={{ width: "100%", background: "linear-gradient(135deg, #1d4ed8, #1e40af)", border: "none", borderRadius: 8, color: "#fff", padding: "14px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
          🖨 PRINT / SAVE AS PDF
        </button>
      </div>
      <div>
        <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Preview</div>
        <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #1e293b", padding: 24, color: "#1a202c", fontSize: 11 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, paddingBottom: 12, borderBottom: "3px solid #1e3a5f" }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {[{ l: "Net Profit", v: fmt(metrics.netProfit), hi: true }, { l: "ROI", v: fmtPct(metrics.roi), hi: true }, { l: "LTV", v: fmtPct(metrics.ltv) }, { l: "LTC", v: fmtPct(metrics.ltc) }].map((m) => (
              <div key={m.l} style={{ background: m.hi ? "#eff6ff" : "#f8fafc", border: `1px solid ${m.hi ? "#bfdbfe" : "#e2e8f0"}`, borderRadius: 4, padding: "8px 10px" }}>
                <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", marginBottom: 3 }}>{m.l}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: m.hi ? "#1d4ed8" : "#1e293b", fontFamily: "monospace" }}>{m.v}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", padding: "16px 0 0", borderTop: "1px solid #e2e8f0", marginTop: 14 }}>
            Full report includes comps, stress test, field notes, and scope summary
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Deals Sidebar ────────────────────────────────────────────────────────────
function DealsSidebar({ deals, activeDealId, onSelect, onNew, onDelete }: {
  deals: Deal[]; activeDealId: string; onSelect: (id: string) => void; onNew: () => void; onDelete: (id: string) => void;
}) {
  return (
    <div style={{ width: 240, flexShrink: 0, background: "#060b14", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", height: "100vh", position: "sticky", top: 0, overflowY: "auto" }}>
      <div style={{ padding: "16px 14px 10px", borderBottom: "1px solid #1e293b" }}>
        <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>My Deals ({deals.length})</div>
        <button onClick={onNew} style={{ width: "100%", background: "#1d4ed8", border: "none", borderRadius: 6, color: "#fff", padding: "9px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>+ NEW DEAL</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {deals.map((deal) => {
          const m = calculateMetrics(deal.inputs);
          const score = SCORE_STYLES[m.dealScore];
          const isActive = deal.id === activeDealId;
          return (
            <div key={deal.id} onClick={() => onSelect(deal.id)} style={{ padding: "10px 14px", cursor: "pointer", background: isActive ? "#0d1829" : "transparent", borderLeft: isActive ? "2px solid #3b82f6" : "2px solid transparent", borderBottom: "1px solid #0f172a" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ fontSize: 12, color: isActive ? "#f1f5f9" : "#94a3b8", fontWeight: isActive ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{deal.inputs.propertyAddress || "Unnamed Property"}</div>
                <div style={{ fontSize: 10, fontWeight: 700, padding: "2px 5px", borderRadius: 3, background: score.bg, color: score.text, border: `1px solid ${score.border}`, flexShrink: 0, marginLeft: 4 }}>{m.dealScore}</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ fontSize: 11, color: "#22c55e", fontFamily: "monospace" }}>{m.netProfit !== 0 ? fmt(m.netProfit) : "—"}</div>
                <div style={{ fontSize: 10, color: STATUS_STYLES[deal.inputs.dealStatus].color }}>{deal.inputs.dealStatus.charAt(0).toUpperCase() + deal.inputs.dealStatus.slice(1)}</div>
              </div>
              {isActive && <button onClick={(e) => { e.stopPropagation(); onDelete(deal.id); }} style={{ marginTop: 6, background: "transparent", border: "1px solid #2a0a0a", color: "#f87171", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer", width: "100%", fontFamily: "'Syne', sans-serif" }}>Delete Deal</button>}
            </div>
          );
        })}
      </div>
      <div style={{ padding: "12px 14px", borderTop: "1px solid #1e293b" }}>
        <div style={{ fontSize: 10, color: "#1e293b", textAlign: "center" }}>Saved locally in browser</div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [activeDealId, setActiveDealId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"deal" | "ai" | "comps" | "rental" | "stress" | "scope" | "packet">("deal");

  useEffect(() => {
    const saved = localStorage.getItem("fliplogic_deals_v5");
    if (saved) {
      try {
        const parsed: Deal[] = JSON.parse(saved);
        if (parsed.length > 0) { setDeals(parsed); setActiveDealId(parsed[0].id); return; }
      } catch (_) {}
    }
    const demo: Deal = {
      id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      inputs: DEMO_INPUTS, comps: DEMO_COMPS, subjectSqft: 1480,
      lenderInfo: { investorName: "Jane Investor", investorCompany: "JI Capital LLC", investorPhone: "(404) 555-0192", investorEmail: "jane@jicapital.com", lenderName: "First National Hard Money" },
      scopeItems: DEMO_SCOPE,
    };
    setDeals([demo]);
    setActiveDealId(demo.id);
  }, []);

  useEffect(() => {
    if (deals.length > 0) localStorage.setItem("fliplogic_deals_v5", JSON.stringify(deals));
  }, [deals]);

  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syne:wght@700;800&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }, []);

  const activeDeal = deals.find((d) => d.id === activeDealId);
  const inputs = activeDeal?.inputs ?? BLANK_INPUTS;
  const metrics = calculateMetrics(inputs);
  const scoreStyle = SCORE_STYLES[metrics.dealScore];

  const updateDeal = (changes: Partial<Deal>) =>
    setDeals((prev) => prev.map((d) => d.id === activeDealId ? { ...d, updatedAt: new Date().toISOString(), ...changes } : d));

  const updateInputs = (updates: Partial<DealInputs>) => updateDeal({ inputs: { ...inputs, ...updates } });
  const set = (key: keyof DealInputs) => (value: number | string) => updateInputs({ [key]: value });

  const handleNewDeal = () => {
    const nd: Deal = { id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), inputs: { ...BLANK_INPUTS }, comps: [], subjectSqft: 0, lenderInfo: { ...BLANK_LENDER_INFO }, scopeItems: [] };
    setDeals((prev) => [nd, ...prev]);
    setActiveDealId(nd.id);
    setActiveTab("deal");
  };

  const handleDelete = (id: string) => {
    const remaining = deals.filter((d) => d.id !== id);
    setDeals(remaining);
    if (activeDealId === id) setActiveDealId(remaining.length > 0 ? remaining[0].id : "");
    if (remaining.length === 0) localStorage.removeItem("fliplogic_deals_v5");
  };

  const handleAddAIToScope = (items: ScopeItem[]) => {
    if (!activeDeal) return;
    updateDeal({ scopeItems: [...activeDeal.scopeItems, ...items] });
    setActiveTab("scope");
  };

  if (!activeDeal) return (
    <div style={{ minHeight: "100vh", background: "#060b14", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <button onClick={handleNewDeal} style={{ background: "#1d4ed8", border: "none", color: "#fff", padding: "16px 32px", borderRadius: 8, fontSize: 16, cursor: "pointer" }}>+ Start Your First Deal</button>
    </div>
  );

  const TABS = [
    { key: "deal",   label: "Deal Analysis" },
    { key: "ai",     label: "🤖 AI Walkthrough" },
    { key: "comps",  label: `Comps ${activeDeal.comps.length > 0 ? `(${activeDeal.comps.length})` : ""}` },
    { key: "rental", label: "Rental Pivot" },
    { key: "stress", label: "Stress Test" },
    { key: "scope",  label: `🔨 Scope ${activeDeal.scopeItems.length > 0 ? `(${activeDeal.scopeItems.length})` : ""}` },
    { key: "packet", label: "📄 Lender Packet" },
  ] as const;

  return (
    <div style={{ minHeight: "100vh", background: "#060b14", color: "#f1f5f9", fontFamily: "'Syne', sans-serif", display: "flex" }}>
      <DealsSidebar deals={deals} activeDealId={activeDealId} onSelect={setActiveDealId} onNew={handleNewDeal} onDelete={handleDelete} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg, #060b14 0%, #0d1829 100%)", borderBottom: "1px solid #1e293b", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>FLIP<span style={{ color: "#3b82f6" }}>LOGIC</span> AI</div>
            <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.15em", marginTop: 1 }}>COMMAND CENTER · DEAL ANALYZER</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <select value={inputs.dealStatus} onChange={(e) => set("dealStatus")(e.target.value)} style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 6, color: STATUS_STYLES[inputs.dealStatus].color, padding: "6px 10px", fontSize: 12, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
              <option value="prospect">Prospect</option><option value="active">Active</option><option value="closed">Closed</option><option value="passed">Passed</option>
            </select>
            <div style={{ background: scoreStyle.bg, border: `2px solid ${scoreStyle.border}`, borderRadius: 8, padding: "8px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: scoreStyle.text, letterSpacing: "0.15em", marginBottom: 1 }}>DEAL SCORE</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: scoreStyle.text }}>{metrics.dealScore}</div>
            </div>
          </div>
        </div>

        {/* Address */}
        <div style={{ padding: "10px 24px", background: "#0a0f1a", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
          <input type="text" value={inputs.propertyAddress} onChange={(e) => set("propertyAddress")(e.target.value)} placeholder="Enter property address..."
            style={{ width: "100%", background: "transparent", border: "none", outline: "none", color: "#94a3b8", fontSize: 13, fontFamily: "monospace", boxSizing: "border-box" }} />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1e293b", background: "#0a0f1a", flexShrink: 0, overflowX: "auto" }}>
          {TABS.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{ padding: "11px 14px", background: "transparent", border: "none", borderBottom: activeTab === tab.key ? "2px solid #3b82f6" : "2px solid transparent", color: activeTab === tab.key ? "#60a5fa" : "#475569", cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap" }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: "20px 24px", flex: 1, overflow: "auto" }}>

          {activeTab === "deal" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div>
                <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Deal Inputs</div>
                <InputField label="Purchase Price" value={inputs.purchasePrice} onChange={set("purchasePrice")} />
                <InputField label="Rehab Cost" value={inputs.rehabCost} onChange={set("rehabCost")} />
                <InputField label="After Repair Value (ARV)" value={inputs.arv} onChange={set("arv")} />
                <InputField label="Loan Amount" value={inputs.loanAmount} onChange={set("loanAmount")} />
                <InputField label="Interest Rate" value={inputs.interestRate} onChange={set("interestRate")} prefix="%" suffix="APR" />
                <InputField label="Loan Term" value={inputs.loanTermMonths} onChange={set("loanTermMonths")} prefix="" suffix="mo" />
                <InputField label="Projected Hold Time" value={inputs.holdingMonths} onChange={set("holdingMonths")} prefix="" suffix="mo" />
                <InputField label="Closing Costs (Buy)" value={inputs.closingCostsBuy} onChange={set("closingCostsBuy")} />
                <InputField label="Closing Costs (Sell)" value={inputs.closingCostsSell} onChange={set("closingCostsSell")} />
                <div style={{ marginTop: 4 }}>
                  <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4, letterSpacing: "0.08em", textTransform: "uppercase" }}>Field Notes</label>
                  <textarea value={inputs.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="Walkthrough observations, red flags, contractor notes..." rows={4}
                    style={{ width: "100%", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, color: "#94a3b8", padding: "10px", fontSize: 13, fontFamily: "monospace", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Key Metrics</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <MetricCard label="Net Profit" value={fmt(metrics.netProfit)} highlight />
                  <MetricCard label="ROI" value={fmtPct(metrics.roi)} highlight />
                  <MetricCard label="LTC" value={fmtPct(metrics.ltc)} sub="Loan to Cost" />
                  <MetricCard label="LTV" value={fmtPct(metrics.ltv)} sub="Loan to Value" />
                  <MetricCard label="Monthly Payment" value={fmt(metrics.monthlyPayment)} />
                  <MetricCard label="Total Holding Costs" value={fmt(metrics.totalHoldingCosts)} />
                  <MetricCard label="Gross Profit" value={fmt(metrics.grossProfit)} />
                  <MetricCard label="Total Project Cost" value={fmt(metrics.totalProjectCost)} />
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

          {activeTab === "ai" && (
            <AIWalkthroughTab
              address={inputs.propertyAddress}
              buildYear={1970}
              onAddToScope={handleAddAIToScope}
            />
          )}

          {activeTab === "comps" && (
            <CompsTab comps={activeDeal.comps} subjectSqft={activeDeal.subjectSqft} enteredArv={inputs.arv}
              onAddComp={() => updateDeal({ comps: [...activeDeal.comps, { id: uid(), address: "", salePrice: 0, sqft: 0, bedBath: "", daysOnMarket: 0, soldDate: "", strength: "average", notes: "" }] })}
              onUpdateComp={(id, u) => updateDeal({ comps: activeDeal.comps.map((c) => c.id === id ? { ...c, ...u } : c) })}
              onDeleteComp={(id) => updateDeal({ comps: activeDeal.comps.filter((c) => c.id !== id) })}
              onUpdateSubjectSqft={(v) => updateDeal({ subjectSqft: v })}
              onApplyArv={(v) => { updateInputs({ arv: v }); setActiveTab("deal"); }} />
          )}

          {activeTab === "rental" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div>
                <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Rental Inputs</div>
                <InputField label="Monthly Rent" value={inputs.monthlyRent} onChange={set("monthlyRent")} />
                <InputField label="Monthly Expenses" value={inputs.monthlyExpenses} onChange={set("monthlyExpenses")} />
                <InputField label="Loan Amount (Refi)" value={inputs.loanAmount} onChange={set("loanAmount")} />
                <InputField label="Interest Rate" value={inputs.interestRate} onChange={set("interestRate")} prefix="%" suffix="APR" />
                <InputField label="Loan Term" value={inputs.loanTermMonths} onChange={set("loanTermMonths")} prefix="" suffix="mo" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Rental Metrics</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <MetricCard label="DSCR" value={metrics.dscr.toFixed(2)} sub={metrics.dscr >= 1.25 ? "✓ Lender Ready" : metrics.dscr >= 1.0 ? "⚠ Borderline" : "✗ Below Threshold"} highlight={metrics.dscr >= 1.25} />
                  <MetricCard label="Monthly Payment" value={fmt(metrics.monthlyPayment)} />
                  <MetricCard label="Net Monthly Cash Flow" value={fmt(inputs.monthlyRent - inputs.monthlyExpenses - metrics.monthlyPayment)} highlight />
                  <MetricCard label="Annual Cash Flow" value={fmt((inputs.monthlyRent - inputs.monthlyExpenses - metrics.monthlyPayment) * 12)} />
                </div>
                <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 8, padding: 14, marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>DSCR Threshold Guide</div>
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
              <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.1em", marginBottom: 14, textTransform: "uppercase" }}>Sensitivity Stress Test</div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>Best Case: rehab -10%, ARV +5% · Worst Case: rehab +20%, ARV -5%</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 80px", gap: 8, padding: "8px 14px" }}>
                  {["Scenario", "Net Profit", "ROI", "Leverage", "Score"].map((h) => <div key={h} style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em" }}>{h}</div>)}
                </div>
                {SCENARIOS.map((s) => <ScenarioRow key={s.label} scenario={s} inputs={inputs} />)}
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
              scopeItems={activeDeal.scopeItems}
              address={inputs.propertyAddress}
              onAdd={() => updateDeal({ scopeItems: [...activeDeal.scopeItems, { id: uid(), category: "Other", description: "", quantity: 1, unit: "lot", myEstimate: 0, notes: "", priority: "important" }] })}
              onUpdate={(id, u) => updateDeal({ scopeItems: activeDeal.scopeItems.map((s) => s.id === id ? { ...s, ...u } : s) })}
              onDelete={(id) => updateDeal({ scopeItems: activeDeal.scopeItems.filter((s) => s.id !== id) })}
            />
          )}

          {activeTab === "packet" && (
            <LenderPacketTab
              deal={activeDeal} metrics={metrics}
              lenderInfo={activeDeal.lenderInfo ?? BLANK_LENDER_INFO}
              onUpdateLenderInfo={(u) => updateDeal({ lenderInfo: { ...(activeDeal.lenderInfo ?? BLANK_LENDER_INFO), ...u } })}
            />
          )}
        </div>
      </div>
    </div>
  );
}