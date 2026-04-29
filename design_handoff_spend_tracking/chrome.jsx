// Page-level chrome that mirrors the existing Anderson Ledger dashboard.
// Renders the header row, tab bar, KPI strip, and a card wrapper.

const T = {
  bg: "#FAF8F4",
  card: "#FFFFFF",
  border: "#E8E4DC",
  borderSoft: "#EFEBE3",
  ink: "#1F1D1A",
  inkMute: "#6B6760",
  inkFaint: "#9A958C",
  navy: "#1F2A37",
  greenPill: "#D9EAD8",
  greenPillText: "#3A6A3F",
  amberPill: "#F5E6C8",
  amberPillText: "#7A5A1E",
  warnSoft: "#F2E2C9",
  warnInk: "#8A6A2B",
};

function HeaderBar({ activeTab = "Spend" }) {
  const tabs = ["Profit First", "Taxes", "Payroll", "Spend"];
  return (
    <div style={{ padding: "20px 28px 0 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: "#EAE5DA", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600, color: T.ink, letterSpacing: 0.5 }}>TA</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.ink, letterSpacing: -0.1 }}>Anderson Ledger</div>
          <div style={{ fontSize: 10.5, color: T.inkFaint, letterSpacing: 0.4, textTransform: "uppercase" }}>Dr Todd Anderson · Momentum Health · FY 2026</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: 4, background: "#F1EDE3", borderRadius: 999, border: `1px solid ${T.border}` }}>
        {tabs.map(t => (
          <div key={t} style={{
            padding: "6px 14px", fontSize: 12.5, fontWeight: t === activeTab ? 600 : 500,
            color: t === activeTab ? T.ink : T.inkMute,
            background: t === activeTab ? "#fff" : "transparent",
            borderRadius: 999,
            border: t === activeTab ? `1px solid ${T.border}` : "1px solid transparent",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: t === activeTab ? "#1F2A37" : "transparent", display: "inline-block" }}></span>
            {t}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", background: T.greenPill, color: T.greenPillText, borderRadius: 999, fontSize: 11.5, fontWeight: 500 }}>
          <span style={{ width: 6, height: 6, borderRadius: 6, background: T.greenPillText, display: "inline-block" }}></span>
          Synced
        </div>
        <button style={btnGhost}>Print</button>
        <button style={btnPrimary}>+ Add Entry</button>
      </div>
    </div>
  );
}

const btnGhost = {
  padding: "6px 12px", border: `1px solid ${T.border}`, background: "#fff",
  borderRadius: 6, fontSize: 12.5, color: T.ink, cursor: "pointer",
};
const btnPrimary = {
  padding: "6px 12px", border: "1px solid #0F1620", background: "#1F2A37",
  borderRadius: 6, fontSize: 12.5, color: "#fff", cursor: "pointer", fontWeight: 500,
};

// KPI strip — same proportions as the original screenshot.
function KpiStrip({ kpis }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, padding: "16px 28px 0 28px" }}>
      {kpis.map((k, i) => (
        <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "14px 16px" }}>
          <div style={{ fontSize: 10, color: T.inkFaint, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>{k.label}</div>
          <div style={{ fontSize: 26, fontWeight: 600, color: T.ink, fontVariantNumeric: "tabular-nums", letterSpacing: -0.5 }}>{k.value}</div>
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
            {k.dotColor && <span style={{ width: 5, height: 5, borderRadius: 5, background: k.dotColor, display: "inline-block" }}></span>}
            {k.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

function Card({ title, sub, right, children, padded = true }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, margin: "16px 28px 0 28px" }}>
      {(title || right) && (
        <div style={{ padding: "14px 18px 12px 18px", borderBottom: `1px solid ${T.borderSoft}`, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: T.ink, letterSpacing: -0.1 }}>{title}</div>
            {sub && <div style={{ fontSize: 11.5, color: T.inkMute, marginTop: 3 }}>{sub}</div>}
          </div>
          {right}
        </div>
      )}
      <div style={padded ? { padding: 18 } : {}}>{children}</div>
    </div>
  );
}

// Bucket pill — matches the small colored chips at the bottom of the live-bank section.
function BucketChip({ b, value }) {
  return (
    <span style={{ padding: "3px 10px", background: b.chip, color: b.chipText, borderRadius: 999, fontSize: 11, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
      {b.label}{value != null ? `: ${typeof value === "string" ? value : fmtUSDc(value)}` : ""}
    </span>
  );
}

Object.assign(window, { T, HeaderBar, KpiStrip, Card, BucketChip, btnGhost, btnPrimary });
