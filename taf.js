/* 150 Falcon Det: TAF forecast on the ops board (15 Oct 2026, Gordon: "weather trend … well informed … don't clutter").
   The metar edge function stores each airfield's raw TAF in ops_wx.taf ({ raw, issue, from, to }); this file reads it:
   - tafParse: TAF text → groups (base / FM / BECMG / TEMPO / PROB) with visibility (km) and governing cloud base (ft),
   - tafTimeline: hour by hour, the prevailing state and the worst TEMPO / PROB state, coloured with the same FASF / RSAF
     rules as the METARs (obFasfAuto / obRsafAuto, Settings cut-offs),
   - tafBar: the Cazaux forecast strip under the airfield table (waves of today's programme above it, a "now" line),
   - tafChip: a small chip per airfield (worst FASF in the next taf.hrs hours), tap → tafShow dialog with the bar and the raw TAF,
   - tafEorLine: a quiet amber heads-up next to EOR when the TAF has Cazaux at / worse than eor.fasf during today's flying.
   Always reads the live TAF (OB.wxLive), not the METAR snapshot ops accepted with Refresh. */
const TAF_ORD = ["B", "W", "G VFR", "G IFR", "Y", "A", "R"];
const TAF_RS = ["B", "Y1", "Y2", "A1", "A2", "R"];
const tafZ = ms => { const d = new Date(ms); return String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0") + "Z"; };
const tafRow = icao => (OB.wxLive || {})[icao] || null;
const tafOf = icao => { const r = tafRow(icao); return r && r.taf && r.taf.raw ? r.taf : null; };

function tafParse(raw, issueIso) {
  const toks = String(raw || "").replace(/=/g, " ").trim().split(/\s+/).filter(Boolean);
  let i = 0;
  if (toks[i] === "TAF") i++;
  while (/^(AMD|COR|RTD)$/.test(toks[i])) i++;
  const icao = toks[i++] || "";
  let issue = issueIso ? new Date(issueIso) : new Date();
  const im = /^(\d{2})(\d{2})(\d{2})Z$/.exec(toks[i] || "");
  if (im) i++;
  const Y = issue.getUTCFullYear(), M = issue.getUTCMonth(), D = issue.getUTCDate();
  const at = (dd, hh, mm) => { let mo = M; if (dd < D - 15) mo = M + 1; else if (dd > D + 15) mo = M - 1; return Date.UTC(Y, mo, dd, hh, mm || 0); };
  const per = s => { const m = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(s || ""); return m ? [at(+m[1], +m[2]), at(+m[3], +m[4])] : null; };
  const valid = per(toks[i]); if (valid) i++;
  if (!valid) return null;
  const groups = []; let cur = { type: "BASE", from: valid[0], to: valid[1], toks: [] };
  const push = () => { groups.push(cur); };
  while (i < toks.length) {
    const t = toks[i];
    let m;
    if ((m = /^FM(\d{2})(\d{2})(\d{2})$/.exec(t))) { push(); cur = { type: "FM", from: at(+m[1], +m[2], +m[3]), to: valid[1], toks: [] }; i++; continue; }
    if (t === "BECMG" || t === "TEMPO") { push(); cur = { type: t, toks: [] }; const p = per(toks[i + 1]); if (p) { [cur.from, cur.to] = p; i++; } i++; continue; }
    if ((m = /^PROB(\d{2})$/.exec(t))) {
      push(); cur = { type: "PROB", prob: +m[1], toks: [] };
      if (toks[i + 1] === "TEMPO") { cur.tempo = true; i++; }
      const p = per(toks[i + 1]); if (p) { [cur.from, cur.to] = p; i++; }
      i++; continue;
    }
    cur.toks.push(t); i++;
  }
  push();
  for (const g of groups) Object.assign(g, tafDecode(g.toks));
  // FM groups end where the next FM starts.
  const fms = groups.filter(g => g.type === "FM");
  fms.forEach((g, k) => { if (fms[k + 1]) g.to = fms[k + 1].from; });
  const base = groups[0]; if (fms.length) base.to = fms[0].from;
  return { icao, issue: issue.getTime(), from: valid[0], to: valid[1], groups, raw: String(raw || "") };
}
// One group's tokens → { vis (km), ceil (ft), wx: [..], text }. Unset = not given in this group.
function tafDecode(toks) {
  const o = { wx: [] };
  let cloud = false;
  for (const t of toks) {
    let m;
    if (t === "CAVOK") { o.vis = 10; o.ceil = 99999; o.cavok = true; continue; }
    if (/^\d{4}$/.test(t)) { o.vis = t === "9999" ? 10 : +t / 1000; continue; }
    if ((m = /^(\d+)(?:\/(\d))?SM$/.exec(t))) { o.vis = +m[1] * 1.609; continue; }
    if ((m = /^(FEW|SCT|BKN|OVC)(\d{3})/.exec(t))) { cloud = true; if (/BKN|OVC/.test(m[1])) o.ceil = Math.min(o.ceil ?? 99999, +m[2] * 100); continue; }
    if ((m = /^VV(\d{3}|\/\/\/)$/.exec(t))) { cloud = true; o.ceil = Math.min(o.ceil ?? 99999, m[1] === "///" ? 0 : +m[1] * 100); continue; }
    if (/^(NSC|SKC|NCD|CLR)$/.test(t)) { cloud = true; continue; }
    if (t === "NSW") { o.wx = []; o.nsw = true; continue; }
    if (/^(\+|-|VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)*$/.test(t) && /[A-Z]{2}/.test(t) && !/KT$/.test(t)) { o.wx.push(t); continue; }
  }
  if (cloud && o.ceil === undefined) o.ceil = 99999;
  o.text = toks.filter(t => !/^(TX|TN)/.test(t)).join(" ");
  return o;
}
const tafMerge = (a, g) => ({ vis: g.vis ?? a.vis, ceil: g.ceil ?? a.ceil, wx: g.wx.length || g.nsw ? g.wx : a.wx });
const tafFasf = c => obFasfAuto({ vis: c.vis ?? 10, ceil: c.ceil ?? 99999 });
const tafRsaf = c => obRsafAuto({ vis: c.vis ?? 10, ceil: c.ceil ?? 99999 });
const tafWorse = (a, b) => TAF_ORD.indexOf(b) > TAF_ORD.indexOf(a);
const tafCond = c => [c.vis == null || c.vis >= 10 ? "" : c.vis >= 5 ? c.vis + " km" : Math.round(c.vis * 1000) + " m",
  (c.wx || []).join(" "), c.ceil == null || c.ceil >= 99999 ? "" : c.ceil === 0 ? "VV///" : "cloud " + c.ceil + " ft"].filter(Boolean).join(" · ");
// The state at time t: prevailing (base, FM, BECMG; worse of before / after during a BECMG window) and the worst TEMPO / PROB.
function tafAt(T, t) {
  let prev = { vis: T.groups[0].vis, ceil: T.groups[0].ceil, wx: T.groups[0].wx };
  let trans = null;
  for (const g of T.groups.slice(1)) {
    if (g.type === "FM" && g.from <= t) prev = { vis: g.vis ?? 10, ceil: g.ceil ?? 99999, wx: g.wx };
    if (g.type === "BECMG" && g.from <= t) {
      const after = tafMerge(prev, g);
      if (t < g.to) trans = { before: prev, after, g };
      prev = after;
    }
  }
  // During a BECMG window, show the worse of before and after (it may change any time in the window).
  let main = prev, mainSrc = null;
  if (trans) { main = tafWorse(tafFasf(trans.before), tafFasf(trans.after)) ? trans.after : trans.before; mainSrc = trans.g; }
  let ov = null;
  for (const g of T.groups) if ((g.type === "TEMPO" || g.type === "PROB") && g.from <= t && t < g.to) {
    const c = tafMerge(main, g), f = tafFasf(c);
    if (tafWorse(tafFasf(main), f) && (!ov || tafWorse(ov.fasf, f))) ov = { c, fasf: f, rsaf: tafRsaf(c), g };
  }
  return { c: main, fasf: tafFasf(main), rsaf: tafRsaf(main), src: mainSrc, ov };
}
const tafLab = g => !g ? "" : g.type === "PROB" ? `PROB${g.prob}${g.tempo ? " TEMPO" : ""}` : g.type;
// Hour-by-hour segments from t0 to t1: main (prevailing) and ov (TEMPO / PROB worse than prevailing).
function tafTimeline(T, t0, t1) {
  const H = 3600e3, main = [], ov = [];
  for (let t = t0; t < t1; t += H) {
    const s = tafAt(T, t + 60e3), e = Math.min(t + H, t1);
    const lm = main[main.length - 1];
    if (lm && lm.fasf === s.fasf && lm.rsaf === s.rsaf) lm.to = e; else main.push({ from: t, to: e, fasf: s.fasf, rsaf: s.rsaf, c: s.c, src: s.src });
    const lo = ov[ov.length - 1];
    if (s.ov) { if (lo && lo.to === t && lo.fasf === s.ov.fasf && lo.g === s.ov.g) lo.to = e; else ov.push({ from: t, to: e, fasf: s.ov.fasf, rsaf: s.ov.rsaf, c: s.ov.c, g: s.ov.g }); }
  }
  return { main, ov };
}
function tafParsed(icao) {
  const tf = tafOf(icao); if (!tf) return null;
  try { return tafParse(tf.raw, tf.issue); } catch (e) { return null; }
}
// Window shown: from the start of this hour (or the TAF start) to the TAF end, at most 24 h.
function tafWin(T) {
  const now = Date.now(), H = 3600e3, t0 = Math.max(T.from, Math.floor(now / H) * H);
  return [t0, Math.min(T.to, t0 + 24 * H)];
}
// Worst FASF over the next n hours, with when and why.
function tafWorst(T, hrs) {
  const [t0] = tafWin(T), t1 = Math.min(T.to, t0 + hrs * 3600e3), tl = tafTimeline(T, t0, t1);
  let w = null;
  for (const s of [...tl.main.map(x => ({ ...x, lab: "" })), ...tl.ov.map(x => ({ ...x, lab: tafLab(x.g) }))])
    if (!w || tafWorse(w.fasf, s.fasf) || (w.fasf === s.fasf && s.from < w.from && !s.lab)) w = s;
  return { worst: w, now: tl.main[0] };
}
// Plain-English summary of the trend: "B now → R from 2100Z (900 m · FG · cloud 200 ft); TEMPO …"
function tafSummary(T, tl) {
  if (!tl.main.length) return "";
  const bits = [`<b>${esc(tl.main[0].fasf)}</b> now`];
  for (const s of tl.main.slice(1, 4)) bits.push(`${tafWorse(tl.main[0].fasf, s.fasf) ? "▼" : "▲"} <b>${esc(s.fasf)}</b> from ${tafZ(s.from)}${tafCond(s.c) ? ` <span class="hint">(${esc(tafCond(s.c))})</span>` : ""}`);
  const ovs = tl.ov.slice(0, 2).map(s => `${esc(tafLab(s.g))} <b>${esc(s.fasf)}</b> ${tafZ(s.from)}–${tafZ(s.to)}${tafCond(s.c) ? ` <span class="hint">(${esc(tafCond(s.c))})</span>` : ""}`);
  return bits.join(" ") + (ovs.length ? ` · ${ovs.join(" · ")}` : "");
}
// Today's waves as [{ name, s, e }] in ms (Z), from the programme.
function tafWaves() {
  const get = typeof obTodayGet === "function" ? obTodayGet() : null; if (!get) return [];
  const fl = opsNameWaves(get("flying") || {}), wins = opsWindows(fl), day = todayStr(), d0 = Date.parse(day + "T00:00:00Z");
  return (fl.waves || []).map((w, i) => ({ name: (w.night ? "NW" : "W") + (w.name.match(/\d+/) || [i + 1])[0], s: wins[i] && wins[i].s, e: wins[i] && wins[i].e }))
    .filter(w => w.s != null && w.e != null).map(w => ({ ...w, s: d0 + w.s * 60e3, e: d0 + (w.e < w.s ? w.e + 1440 : w.e) * 60e3 }));
}
// The forecast strip for one airfield.
function tafBar(icao, opts = {}) {
  const T = tafParsed(icao);
  if (!T) return opts.big ? `<p class="hint">No TAF for ${esc(icao)} yet.</p>` : "";
  const [t0, t1] = tafWin(T); if (t1 <= t0) return `<p class="hint">The ${esc(icao)} TAF has run out (valid to ${tafZ(T.to)}).</p>`;
  const tl = tafTimeline(T, t0, t1), span = t1 - t0, pc = ms => ((ms - t0) / span * 100).toFixed(2) + "%";
  const seg = (s, cls) => { const w = (s.to - s.from) / span * 100;
    return `<span class="tseg ${obCsCls(s.fasf)} ${cls || ""}" style="left:${pc(s.from)};width:${w.toFixed(2)}%" title="${esc(`${tafLab(s.g) || "Prevailing"} ${tafZ(s.from)}–${tafZ(s.to)}: FASF ${s.fasf} · RSAF ${s.rsaf}${tafCond(s.c) ? " · " + tafCond(s.c) : ""}`)}">${w > 7 ? `<b>${esc(s.fasf)}</b>${s.g ? `<small>${esc(tafLab(s.g))}</small>` : ""}${w > 22 && tafCond(s.c) ? `<small>${esc(tafCond(s.c))}</small>` : ""}` : ""}</span>`; };
  const now = Date.now(), near = t => Math.abs(t - now) / span < 0.035;
  const ticks = []; for (let t = t0; t <= t1; t += 3600e3) { const h = new Date(t).getUTCHours(); if (h % 3 === 0 && !(now > t0 && now < t1 && near(t))) ticks.push(`<span style="left:${pc(t)}">${String(h).padStart(2, "0")}Z</span>`); }
  const waves = tafWaves().filter(w => w.e > t0 && w.s < t1);
  const wv = waves.map(w => { const s = Math.max(w.s, t0), e = Math.min(w.e, t1), wd = (e - s) / span * 100; return `<span class="tafwv${w.e < now ? " done" : ""}" style="left:${pc(s)};width:${wd.toFixed(2)}%" title="${esc(w.name)} ${tafZ(w.s)}–${tafZ(w.e)}">${wd > 3.5 ? esc(w.name) : ""}</span>`; }).join("");
  const iss = tafZ(T.issue);
  return `<div class="tafbar${opts.big ? " big" : ""}" ${opts.big ? "" : `data-taf="${esc(icao)}" role="button" tabindex="0" title="Tap for the full TAF"`}>
    ${opts.big ? "" : `<div class="tafhd"><span class="tafttl">${obH("taf", `${esc(opts.title || icao)} forecast`)}</span><span class="tafsum">${tafSummary(T, tl)}</span><span class="tafiss">TAF ${iss} · to ${tafZ(T.to)}</span></div>`}
    <div class="taftrack">${wv ? `<div class="tafwvs">${wv}</div>` : ""}
      <div class="tafmain">${tl.main.map(s => seg(s)).join("")}</div>
      <div class="tafov">${tl.ov.map(s => seg(s, "tempo")).join("")}</div>
      ${now > t0 && now < t1 ? `<i class="tafnow" style="left:${pc(now)}" title="Now ${tafZ(now)}"></i>` : ""}
      <div class="taftk">${ticks.join("")}</div></div></div>`;
}
// Chip next to each airfield: worst FASF in the next taf.hrs hours ("▼ R 19Z" when it gets worse than now).
function tafChip(icao) {
  const T = tafParsed(icao); if (!T) return "";
  const hrs = cfgN("taf.hrs") || 6, w = tafWorst(T, hrs); if (!w.worst) return "";
  const worse = w.now && tafWorse(w.now.fasf, w.worst.fasf);
  const tip = `TAF next ${hrs} h: worst ${w.worst.fasf}${w.worst.lab ? " (" + w.worst.lab + ")" : ""} from ${tafZ(w.worst.from)}${tafCond(w.worst.c) ? " · " + tafCond(w.worst.c) : ""}. Tap for the TAF.`;
  return `<button class="tafchip ${worse ? obCsCls(w.worst.fasf) : ""}" data-taf="${esc(icao)}" title="${esc(tip)}" aria-label="${esc(tip)}">${worse ? `▼ ${esc(w.worst.fasf)} <small>${tafZ(w.worst.from).slice(0, 2)}Z${w.worst.lab ? " " + esc(w.worst.lab.replace(" TEMPO", "")) : ""}</small>` : `<i class="${obCsCls(w.worst.fasf)}"></i>`}</button>`;
}
// Heads-up next to EOR: the Cazaux TAF reaches eor.fasf or worse during today's flying (or the next 12 h) and is worse than now.
function tafEorLine(b) {
  const T = tafParsed("LFBC"); if (!T) return "";
  const l = (b.airfields || []).find(a => a.icao === "LFBC"), cur = l ? obState(l, "fasf").v : "";
  const lim = TAF_ORD.indexOf(String(cfg("eor.fasf")).toUpperCase().trim()); if (lim < 0) return "";
  const waves = tafWaves(), now = Date.now(), end = waves.length ? Math.max(...waves.map(w => w.e)) : now + 12 * 3600e3;
  if (end <= now) return "";
  const [t0] = tafWin(T), tl = tafTimeline(T, t0, Math.min(T.to, end));
  const hit = [...tl.main.map(s => ({ ...s, lab: "" })), ...tl.ov.map(s => ({ ...s, lab: tafLab(s.g) }))]
    .filter(s => s.to > now && TAF_ORD.indexOf(s.fasf) >= lim && (!cur || tafWorse(cur, s.fasf))).sort((a, c) => a.from - c.from)[0];
  if (!hit) return "";
  return `<span class="tafeor" data-taf="LFBC" role="button" tabindex="0" title="From the Cazaux TAF: ${esc(tafCond(hit.c) || hit.fasf)}. Tap for the TAF.">TAF: <b class="obcs ${obCsCls(hit.fasf)}">${esc(hit.fasf)}</b> from ${tafZ(Math.max(hit.from, now))}${hit.lab ? ` (${esc(hit.lab)})` : ""}</span>`;
}
// Dialog: the airfield's bar, each TAF group decoded with its colour, and the raw TAF.
function tafShow(icao) {
  const T = tafParsed(icao), tf = tafOf(icao), a = ((obGet("board") || {}).airfields || []).find(x => x.icao === icao);
  let d = document.getElementById("dlgTaf");
  if (!d) { d = document.createElement("dialog"); d.id = "dlgTaf"; document.body.appendChild(d); d.onclick = e => { if (e.target === d || e.target.closest("[data-x=close]")) d.close(); }; }
  const rows = T ? T.groups.map((g, k) => {
    const c = k === 0 || g.type === "FM" ? { vis: g.vis ?? 10, ceil: g.ceil ?? 99999, wx: g.wx } : tafMerge({ vis: T.groups[0].vis, ceil: T.groups[0].ceil, wx: [] }, g);
    const giv = g.vis != null || g.ceil != null, f = giv ? tafFasf(c) : "";
    return `<tr><td><b>${k === 0 ? "Main" : esc(tafLab(g))}</b></td><td class="nw">${g.from != null ? `${tafZ(g.from)}–${tafZ(g.to)}` : ""}</td><td>${f ? `<span class="obcs ${obCsCls(f)}">${esc(f)}</span>` : `<span class="hint">no change</span>`}</td><td><code>${esc(g.text || "")}</code></td></tr>`;
  }).join("") : "";
  d.innerHTML = `<div class="dlg"><div class="opshead"><h2>${esc(icao)} forecast</h2><span class="grow"></span><button class="btn small" data-x="close">Close</button></div>
    ${tf ? `<p class="hint" style="margin:0 0 8px">TAF issued ${esc(tafZ(Date.parse(tf.issue)))}${T ? ` · valid ${tafZ(T.from)} to ${tafZ(T.to)}` : ""}${a ? ` · METAR now: FASF <span class="obcs ${obCsCls(obState(a, "fasf").v)}">${esc(obState(a, "fasf").v || "-")}</span> RSAF <span class="obcs ${obCsCls(obState(a, "rsaf").v)}">${esc(obState(a, "rsaf").v || "-")}</span>` : ""}</p>` : ""}
    ${tafBar(icao, { big: true })}
    ${T ? `<p class="tafsum" style="margin:10px 0">${tafSummary(T, tafTimeline(T, ...tafWin(T)))}</p>
    <div class="tablewrap"><table class="opst taftbl"><thead><tr><th>Part</th><th>Time (Z)</th><th>FASF</th><th>As written</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
    ${tf ? `<pre class="tafraw">${esc(tf.raw)}</pre>` : `<p class="hint">No TAF stored for ${esc(icao)}.</p>`}
    <p class="hint" style="margin:6px 0 0">Colours use the same FASF rules as the METARs (Settings → Colour states). TEMPO / PROB parts show hatched under the main bar when they're worse. The bar starts this hour and runs to the end of the TAF (24 h at most).</p></div>`;
  if (!d.open) d.showModal();
}
document.addEventListener("click", e => {
  const el = e.target.closest("[data-taf]"); if (!el || e.target.closest(".obhelp")) return;
  e.preventDefault(); tafShow(el.dataset.taf);
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches && e.target.matches("[data-taf][role=button]")) tafShow(e.target.dataset.taf); });

(() => {
  const s = document.createElement("style");
  s.textContent = `
.obafcard>.tafbar{grid-column:1/-1}.tafbar{margin:10px 0 2px;padding:10px 12px 6px;border:1px solid var(--line);border-radius:8px;background:color-mix(in srgb,var(--paper) 70%,transparent);cursor:pointer}
.tafbar:hover{border-color:color-mix(in srgb,var(--in) 60%,var(--line))}.tafbar.big{cursor:default;padding:10px 8px 4px}
.tafhd{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;margin:0 0 8px}.tafttl{font:700 .95rem var(--cond);text-transform:uppercase;letter-spacing:.05em}
.tafsum{font-size:.86rem;flex:1;min-width:200px}.tafsum .hint{font-size:.78rem}.tafiss{font-size:.75rem;color:var(--muted);white-space:nowrap}
.taftrack{position:relative;padding-bottom:16px}
.tafwvs{position:relative;height:16px;margin-bottom:3px}.tafwv.done{opacity:.45}.tafwv{position:absolute;top:0;height:14px;border:1px solid color-mix(in srgb,var(--muted) 55%,transparent);border-bottom:0;border-radius:4px 4px 0 0;font:600 .66rem/13px var(--body);color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap}
.tafmain,.tafov{position:relative}.tafmain{height:24px;border-radius:5px;overflow:hidden;background:color-mix(in srgb,var(--muted) 15%,transparent)}
.tafov{height:14px;margin-top:3px}
.tseg{position:absolute;top:0;bottom:0;display:flex;align-items:center;justify-content:center;gap:4px;overflow:hidden;white-space:nowrap;border:0!important;box-shadow:inset -1px 0 0 rgba(0,0,0,.25)}
.tseg b{font:700 .78rem var(--body)}.tseg small{font-size:.66rem;opacity:.85;overflow:hidden;text-overflow:ellipsis}
.tseg.tempo{border-radius:4px;background-image:repeating-linear-gradient(135deg,rgba(0,0,0,.28) 0 4px,transparent 4px 9px)}
.tafov .tseg b{font-size:.66rem}
.tafnow{position:absolute;top:0;bottom:14px;width:2px;margin-left:-1px;background:var(--ink);box-shadow:0 0 0 2px color-mix(in srgb,var(--bg) 70%,transparent);border-radius:1px}
.tafnow::after{content:"now";position:absolute;bottom:-13px;left:50%;transform:translateX(-50%);font:600 .6rem var(--body);color:var(--ink)}
.taftk{position:absolute;left:0;right:0;bottom:0;height:12px}.taftk span{position:absolute;transform:translateX(-50%);font:.62rem var(--body);color:var(--muted)}
.tafchip{display:inline-flex;align-items:center;gap:3px;margin-left:6px;padding:1px 6px;border-radius:10px;border:1px solid var(--line);font:700 .72rem var(--body);cursor:pointer;vertical-align:middle;line-height:1.4}
.tafchip small{font-weight:600;font-size:.62rem;opacity:.9}.tafchip i{display:inline-block;width:9px;height:9px;border-radius:50%;border:1px solid rgba(0,0,0,.3)}
.tafchip:not([class*=" cs-"]){padding:2px 5px;background:transparent;color:var(--ink)}
.tafeor{font-size:.82rem;color:var(--out);margin-left:6px;cursor:pointer;white-space:nowrap}.tafeor .obcs{min-width:0;padding:0 5px;font-size:.72rem}
#dlgTaf{width:min(980px,calc(100vw - 16px))}.tafraw{white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;background:color-mix(in srgb,var(--muted) 10%,transparent);padding:8px 10px;border-radius:6px;margin:10px 0 0}
.obt td.nw{white-space:nowrap}.taftbl td{vertical-align:top}.taftbl code{font-size:.8rem;white-space:normal}.taftbl .nw{white-space:nowrap}
body.tvmode .tafbar{cursor:default}body.tvmode .tafsum{font-size:.95rem}
@media (max-width:640px){.tafsum{min-width:100%;order:3}.tafbar{padding:8px 8px 4px}}
`;
  document.head.appendChild(s);
})();
