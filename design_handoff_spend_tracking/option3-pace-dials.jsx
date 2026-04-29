// Option 3: Pace Dials
// A semi-circle gauge for each bucket showing % of allocation consumed,
// with a separate pace marker showing where you "should" be by day.
// The visual answer to "am I on pace?" — gauge needle ahead of pace tick = warn.
// More fintech-feeling. Prior windows shown as a small sparkline under each.

function PaceDials({ allocPct, currentDay }) {
  const [expanded, setExpanded] = React.useState(null);
  const today = { ...WINDOWS[WINDOWS.length - 1], dayIndex: currentDay };
  const derived = deriveWindow(today, allocPct);

  // Sparkline data: % consumed across last 5 closed windows + current.
  const sparkWins = WINDOWS.slice(-6);

  return (
    <div>
      <Card
        title="Allocation pacing"
        sub={`${today.start} – ${today.end}  ·  Day ${currentDay} of ${today.days}  ·  Window inflow $${today.inflow.toLocaleString()}`}
        right={
          <div style={{ fontSize: 11, color: T.inkMute, display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 16, height: 3, background: T.ink, display: "inline-block", borderRadius: 2 }}></span>
              On pace
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 16, height: 3, background: T.warnInk, display: "inline-block", borderRadius: 2 }}></span>
              Off pace
            </span>
          </div>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {derived.buckets.map(b => (
            <DialCard
              key={b.id}
              b={b}
              elapsedPct={derived.win.dayIndex / derived.win.days * 100}
              priorWins={sparkWins}
              allocPct={allocPct}
              expanded={expanded === b.id}
              onToggle={() => setExpanded(expanded === b.id ? null : b.id)}
            />
          ))}
        </div>
      </Card>

      {expanded && (
        <Card
          title={`${BUCKETS.find(x => x.id === expanded).label} · transactions this window`}
          sub={`${(TXNS[expanded] || []).length} transactions  ·  ${today.start} – ${today.end}`}
          right={<button onClick={() => setExpanded(null)} style={btnGhost}>Close</button>}
        >
          <DialTxns bucketId={expanded} />
        </Card>
      )}

      <Card
        title="Window-over-window"
        sub="% of allocation consumed by close of window"
      >
        <div style={{ display: "grid", gridTemplateColumns: `170px repeat(${sparkWins.length}, 1fr)`, columnGap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 10, color: T.inkFaint, letterSpacing: 0.5, textTransform: "uppercase" }}>Bucket</div>
          {sparkWins.map((w, i) => {
            const isCurrent = i === sparkWins.length - 1;
            return (
              <div key={w.id} style={{ fontSize: 10, color: isCurrent ? T.ink : T.inkFaint, letterSpacing: 0.4, textTransform: "uppercase", padding: "0 6px", opacity: isCurrent ? 1 : 0.6 }}>
                {w.monthLabel}
              </div>
            );
          })}
          {BUCKETS.map(b => (
            <React.Fragment key={b.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}>
                <span style={{ width: 8, height: 8, borderRadius: 8, background: b.color, display: "inline-block" }}></span>
                <span style={{ fontSize: 13, color: T.ink, fontWeight: 500 }}>{b.label}</span>
              </div>
              {sparkWins.map((w, i) => {
                const isCurrent = i === sparkWins.length - 1;
                const winData = isCurrent ? today : w;
                const d = deriveWindow(winData, allocPct).buckets.find(x => x.id === b.id);
                return (
                  <div key={w.id} style={{ padding: "0 6px", opacity: isCurrent ? 1 : 0.5 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, fontVariantNumeric: "tabular-nums" }}>
                      {Math.round(d.pctConsumed)}%
                    </div>
                    <div style={{ fontSize: 10.5, color: T.inkFaint, fontVariantNumeric: "tabular-nums" }}>
                      {fmtUSD(d.spent)}
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </Card>
    </div>
  );
}

function DialCard({ b, elapsedPct, priorWins, allocPct, expanded, onToggle }) {
  const isWarn = b.status !== "on-pace";
  // Sparkline (last 5 windows + current)
  const sparkData = priorWins.map(w => {
    const d = deriveWindow(w.id === priorWins[priorWins.length - 1].id ? { ...w, dayIndex: w.dayIndex || 15 } : w, allocPct).buckets.find(x => x.id === b.id);
    return Math.min(d.pctConsumed, 130);
  });
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "16px 16px 14px", background: "#FDFCF8" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 10, background: b.color, display: "inline-block" }}></span>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{b.label}</span>
        </div>
        <span style={{ fontSize: 10.5, color: T.inkFaint }}>{b.pct}%</span>
      </div>

      <Gauge pctConsumed={b.pctConsumed} elapsedPct={elapsedPct} color={b.color} warn={isWarn} />

      <div style={{ textAlign: "center", marginTop: -6 }}>
        <div style={{ fontSize: 11, color: isWarn ? T.warnInk : T.inkMute, fontVariantNumeric: "tabular-nums" }}>
          {b.pace > 0 ? `+${Math.round(b.pace)}% ahead` : `${Math.round(Math.abs(b.pace))}% under`}
        </div>
      </div>

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.borderSoft}`, display: "flex", justifyContent: "space-between", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
        <div>
          <div style={{ color: T.inkFaint, fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase" }}>Spent</div>
          <div style={{ color: T.ink, fontSize: 13, fontWeight: 600, marginTop: 1 }}>{fmtUSD(b.spent)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: T.inkFaint, fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase" }}>Remaining</div>
          <div style={{ color: T.ink, fontSize: 13, fontWeight: 600, marginTop: 1 }}>{fmtUSD(b.remaining)}</div>
        </div>
      </div>

      {/* Sparkline of prior windows */}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <div style={{ fontSize: 10, color: T.inkFaint, letterSpacing: 0.4, textTransform: "uppercase" }}>Last 6 windows vs budget</div>
          <div style={{ fontSize: 9.5, color: T.inkFaint, letterSpacing: 0.3, textTransform: "uppercase" }}>
            <span style={{ display: "inline-block", width: 8, height: 8, background: "#EEF3EC", marginRight: 3, verticalAlign: "middle" }}></span>safe
            <span style={{ display: "inline-block", width: 8, height: 8, background: "#F7EAD9", marginLeft: 6, marginRight: 3, verticalAlign: "middle" }}></span>over
          </div>
        </div>
        <Sparkline data={sparkData} color={b.color} />
      </div>

      <button onClick={onToggle} style={{
        marginTop: 12, width: "100%", padding: "6px 10px", fontSize: 11.5,
        background: expanded ? b.chip : "transparent", color: expanded ? b.chipText : T.inkMute,
        border: `1px solid ${expanded ? b.chip : T.borderSoft}`,
        borderRadius: 5, cursor: "pointer",
      }}>
        {expanded ? "Hide" : "View"} {(TXNS[b.id]||[]).length} transactions
      </button>
    </div>
  );
}

function Gauge({ pctConsumed, elapsedPct, color, warn }) {
  // Semi-circle gauge.  180deg sweep, left -> right.
  const r = 58, cx = 80, cy = 78;
  const arc = (pct) => {
    const angle = Math.min(pct, 130) / 100 * 180;
    const rad = (angle - 180) * Math.PI / 180;
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    const large = angle > 180 ? 1 : 0;
    return `M ${cx - r} ${cy} A ${r} ${r} 0 ${large} 1 ${x} ${y}`;
  };
  const tick = (pct) => {
    const angle = (pct / 100) * 180 - 180;
    const rad = angle * Math.PI / 180;
    const x1 = cx + (r - 10) * Math.cos(rad);
    const y1 = cy + (r - 10) * Math.sin(rad);
    const x2 = cx + (r + 6) * Math.cos(rad);
    const y2 = cy + (r + 6) * Math.sin(rad);
    return { x1, y1, x2, y2 };
  };
  const paceTick = tick(elapsedPct);
  const overflow = Math.max(0, pctConsumed - 100);
  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
      <svg width="160" height="100" viewBox="0 0 160 100">
        {/* Track */}
        <path d={arc(100)} fill="none" stroke="#F1EDE3" strokeWidth="10" strokeLinecap="round" />
        {/* Filled */}
        <path d={arc(Math.min(pctConsumed, 100))} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
        {/* Overflow */}
        {overflow > 0 && (
          <path d={`M ${cx + r} ${cy} A ${r} ${r} 0 0 1 ${cx + r * Math.cos((Math.min(overflow, 30)/100*180) * Math.PI/180)} ${cy + r * Math.sin((Math.min(overflow,30)/100*180) * Math.PI/180)}`}
                fill="none" stroke="#C7A876" strokeWidth="10" strokeLinecap="round" />
        )}
        {/* Pace tick */}
        <line x1={paceTick.x1} y1={paceTick.y1} x2={paceTick.x2} y2={paceTick.y2} stroke={T.ink} strokeWidth="2" strokeLinecap="round" />
        {/* Centered % */}
        <text x={cx} y={cy - 12} textAnchor="middle" fontSize="22" fontWeight="600" fill={T.ink} style={{ fontVariantNumeric: "tabular-nums", letterSpacing: -0.5 }}>
          {Math.round(pctConsumed)}%
        </text>
        <text x={cx} y={cy + 2} textAnchor="middle" fontSize="9" fill={T.inkFaint} style={{ letterSpacing: 0.4, textTransform: "uppercase" }}>
          consumed
        </text>
      </svg>
    </div>
  );
}

function Sparkline({ data, color }) {
  // Larger chart that visually anchors to a 0–100% budget range:
  //   • soft green band = safe zone (0–100%)
  //   • soft amber band = over zone (>100%)
  //   • dashed 100% baseline labeled "BUDGET"
  //   • Y-axis ticks at 50% and 100%
  //   • each window plotted with its % label above the dot
  //   • current window dot is solid black; prior dots in bucket color
  const w = 240, h = 88;
  const padL = 28, padR = 8, padT = 14, padB = 16;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const max = Math.max(130, Math.max(...data) + 10);
  const yFor = (v) => padT + innerH - (v / max) * innerH;
  const xFor = (i) => padL + (i / (data.length - 1)) * innerW;
  const points = data.map((v, i) => [xFor(i), yFor(v)]);
  const pathD = points.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const y0 = yFor(0), y100 = yFor(100), y50 = yFor(50);
  const yTop = padT;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible" }}>
      {/* Safe zone (0–100) */}
      <rect x={padL} y={y100} width={innerW} height={y0 - y100} fill="#EEF3EC" />
      {/* Over zone (>100) */}
      <rect x={padL} y={yTop} width={innerW} height={y100 - yTop} fill="#F7EAD9" opacity="0.55" />

      {/* Y-axis labels */}
      <text x={padL - 4} y={y100 + 3} textAnchor="end" fontSize="8.5" fill={T.inkMute} style={{ fontVariantNumeric: "tabular-nums" }}>100%</text>
      <text x={padL - 4} y={y50 + 3} textAnchor="end" fontSize="8.5" fill={T.inkFaint} style={{ fontVariantNumeric: "tabular-nums" }}>50%</text>
      <text x={padL - 4} y={y0 + 3} textAnchor="end" fontSize="8.5" fill={T.inkFaint} style={{ fontVariantNumeric: "tabular-nums" }}>0</text>

      {/* 50% gridline */}
      <line x1={padL} x2={padL + innerW} y1={y50} y2={y50} stroke={T.borderSoft} strokeWidth="1" strokeDasharray="1 3" />
      {/* 100% budget line */}
      <line x1={padL} x2={padL + innerW} y1={y100} y2={y100} stroke="#8A6A2B" strokeWidth="1.25" strokeDasharray="3 2" />
      <text x={padL + innerW} y={y100 - 3} textAnchor="end" fontSize="8.5" fontWeight="600" fill="#8A6A2B" style={{ letterSpacing: 0.5, textTransform: "uppercase" }}>budget</text>

      {/* Y-axis line */}
      <line x1={padL} x2={padL} y1={yTop} y2={y0} stroke={T.border} strokeWidth="1" />
      {/* X-axis baseline */}
      <line x1={padL} x2={padL + innerW} y1={y0} y2={y0} stroke={T.border} strokeWidth="1" />

      {/* Trend line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.75" />

      {/* Points + per-window labels */}
      {points.map(([x, y], i) => {
        const isLast = i === points.length - 1;
        const v = Math.round(data[i]);
        const over = v > 100;
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={isLast ? 3 : 2.2} fill={isLast ? T.ink : color} stroke="#fff" strokeWidth="1" />
            <text x={x} y={y - 6} textAnchor="middle" fontSize="8.5" fontWeight={isLast ? 600 : 500}
                  fill={over ? "#8A6A2B" : (isLast ? T.ink : T.inkMute)}
                  style={{ fontVariantNumeric: "tabular-nums" }}>
              {v}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DialTxns({ bucketId }) {
  const txns = TXNS[bucketId] || [];
  if (txns.length === 0) {
    return <div style={{ padding: "8px 4px", fontSize: 12, color: T.inkFaint }}>No transactions yet this window.</div>;
  }
  return (
    <div style={{ border: `1px solid ${T.borderSoft}`, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 110px", padding: "10px 14px", fontSize: 10, color: T.inkFaint, letterSpacing: 0.5, textTransform: "uppercase", background: "#FBF8F1" }}>
        <div>Date</div><div>Payee</div><div>Memo</div><div style={{ textAlign: "right" }}>Amount</div>
      </div>
      {txns.map((t, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 110px", padding: "9px 14px", fontSize: 12, color: T.ink, borderTop: `1px solid ${T.borderSoft}`, fontVariantNumeric: "tabular-nums" }}>
          <div style={{ color: T.inkMute }}>{t.date}</div>
          <div>{t.payee}</div>
          <div style={{ color: T.inkMute }}>{t.memo}</div>
          <div style={{ textAlign: "right" }}>{fmtUSDc(t.amount)}</div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { PaceDials });
