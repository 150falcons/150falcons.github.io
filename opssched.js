/* 150 Falcon Det: scheduler view (15 Oct 2026, Gordon: "a scheduler's mode … see everything together … a time slice of
   12 hours … flights on the top, SXO and OPS O, then simulator, then ground … show conflicts … hover over the name … links
   his day activities").
   Tab `sched` (Flying program → Scheduler). One timeline (Z) for the shown day: per wave the SXO / OPS O band and one row per
   formation (brief · step · airborne · 30 min debrief), then the simulator slots and the ground programme packed into rows.
   Clashes (schClashes, rules from Gordon 15 Oct): the same person in two places (flight brief → landing + 30 min, sim from
   its 1 h brief to its end, SXO / OPS O over their wave, ground events, briefs they give); after a sim, take-off at least
   3 h after the sim ends; after a flight, a sim no earlier than 1 h after landing; a tail on two flights at once; van / DL
   warnings from opsPlan; IRT without an IRE. A clash can be accepted (the scheduler carries on, e.g. briefed the day before):
   stored in the plan as flying.acc[key] = { by, at } (the key holds the times, so a re-timed clash comes back).
   Hovering a name lights up all that person's blocks, joins them with a line and lists their day in the side panel.
   Editors work in planning mode: clicking a formation or sim opens a small form that saves to the plan (opsSecSave). */
const SCH = { start: null, span: 12, sel: null, pin: null, edit: null };
const schM = v => { const m = opsMin(v); return m == null ? null : m; };
const schZ = m => opsZ4(((m % 1440) + 1440) % 1440);
const schNames = s => String(s || "").split(/[,/&]|\bAND\b/i).map(x => opsNorm(x.replace(/\(.*?\)/g, ""))).filter(Boolean);
const schSimRmk = a => { const out = []; for (const m of String(a.rmks || "").matchAll(/\b(SXO|SUPP|SUP|SUPPORT|CONSOLE|INSTR?)\s*:\s*([^/;\n]+)/gi)) out.push(...schNames(m[2])); return out; };

// Move a formation / sim by d minutes (brief, step, ETD, ETA together), or stretch its ETA / end ("end"). Mutates data.
function schShift(data, ref, mode, d) {
  const t = ref.kind === "fly" ? (((data.waves || [])[ref.wi] || {}).flights || [])[ref.fi] : (data.rows || [])[ref.ri];
  if (!t) return null;
  let id = ref.id, wave = null;
  if (mode === "move") {
    for (const k of ["brief", "step", "etd", "eta"]) { const m = opsMin(t[k]); if (m != null && String(t[k] || "").trim()) t[k] = schZ(m + d); }
    // dragged into another wave's time (and out of its own): it joins that wave, in ETD order
    if (ref.kind === "fly") {
      const e = opsMin(t.etd), win = (w, skip) => { const fs = (w.flights || []).filter(f => f !== skip && (f.ac || []).some(opsLineUsed) && opsMin(f.etd) != null); if (!fs.length) return null; const a = Math.min(...fs.map(f => opsMin(f.etd))), z = Math.max(...fs.map(f => { const s0 = opsMin(f.etd), x = opsMin(f.eta); return x == null ? s0 + 60 : x < s0 ? x + 1440 : x; })); return [a - 15, z]; };
      const inW = w => { const r = win(w, t); return r && e >= r[0] && e <= r[1]; }, ws = data.waves || [];
      if (e != null && !inW(ws[ref.wi])) {
        const to = ws.findIndex((w, i) => i !== ref.wi && inW(w));
        if (to >= 0) { ws[ref.wi].flights.splice(ref.fi, 1); const fs = ws[to].flights = ws[to].flights || []; let at = fs.findIndex(f => (opsMin(f.etd) ?? 1e9) > e); if (at < 0) at = fs.length; fs.splice(at, 0, t); id = `f${to}.${at}`; wave = ws[to].name || opsWaveShort(ws[to]); }
      }
    }
  } else { const st = opsMin(t.etd); if (st == null) return { t, id }; let e = opsMin(t.eta); e = e == null ? st + 60 : e < st ? e + 1440 : e; t.eta = schZ(Math.max(st + 15, e + d)); if (ref.kind === "fly") t.man = { ...(t.man || {}), eta: true }; }
  return { t, id, wave };
}
// Everything on the day as blocks (for drawing) and per-person items (for clashes).
function schModel() {
  let fl = opsGet("flying"), sim = opsGet("sim");
  const gnd = opsGet("ground"), h = opsGet("header"), off = opsAutoOff(), dr = SCH.drag;
  if (dr && dr.d) { const r = dr.kind === "fly" ? schShift(fl = opsNameWaves(opsClone(fl)), dr, dr.mode, dr.d) : schShift(sim = opsClone(sim), dr, dr.mode, dr.d); dr.res = r; }
  const blocks = [], items = [], ppl = new Map();
  const put = (who, it) => { for (const n of who) { if (!n) continue; items.push({ ...it, who: n }); ppl.set(n, true); } };
  const end = (s, e) => (e != null && s != null && e < s ? e + 1440 : e);
  const plan = opsPlan(fl, h);
  (fl.waves || []).forEach((w, wi) => {
    let ws = null, we = null;
    (w.flights || []).forEach((f, fi) => {
      const lines = (f.ac || []).filter(opsLineUsed); if (!lines.length) return;
      const etd = schM(f.etd); if (etd == null) return;
      const eta = end(etd, schM(f.eta) ?? etd + 60), br = schM(f.brief) ?? etd + off.brief, st = schM(f.step) ?? etd + off.step;
      const id = `f${wi}.${fi}`, nm = `${opsWaveShort(w)} ${f.callsign || "?"}`, key = `${nm} ${f.etd}`;
      const ps = [...new Set(lines.flatMap(a => [a.crew1, a.crew2]).map(opsNorm).filter(Boolean))];
      blocks.push({ id, kind: "fly", wi, fi, f, w, s: br, e: eta + 30, br, st, etd, eta, nm, key, lines, ps, add: lines.every(a => opsIsAdd(f, a)), pl: plan.byF.get(f) });
      for (const a of lines) put([a.crew1, a.crew2].map(opsNorm), { kind: "fly", id, s: br, e: eta + 30, etd, eta, label: `${nm} ${a.n || ""} · ${f.etd}–${f.eta}Z`, key });
      ws = ws == null ? Math.min(br, st) : Math.min(ws, br, st); we = we == null ? eta : Math.max(we, eta);
    });
    if (ws != null) {
      const sx = schNames(w.sxo), oo = schNames(w.opsO), st = Math.min(...blocks.filter(b => b.kind === "fly" && b.wi === wi).map(b => b.st));
      blocks.push({ id: `w${wi}`, kind: "duty", wi, w, s: ws, e: we + 30, sxo: sx, opsO: oo, ps: [...sx, ...oo], nm: opsWaveShort(w) });
      put(sx, { kind: "sxo", id: `w${wi}`, s: st, e: we, label: `SXO ${opsWaveShort(w)} · ${schZ(st)}–${schZ(we)}Z`, key: `SXO ${opsWaveShort(w)}` });
      put(oo, { kind: "opso", id: `w${wi}`, s: ws, e: we + 30, label: `OPS O ${opsWaveShort(w)} · ${schZ(ws)}–${schZ(we + 30)}Z`, key: `OPS O ${opsWaveShort(w)}` });
    }
  });
  (sim.rows || []).forEach((r, ri) => {
    if (!opsSimUsed(r)) return;
    const s = schM(r.etd); if (s == null) return;
    const e = end(s, schM(r.eta) ?? s + 60), id = `s${ri}`, nm = `SIM ${r.callsign || ""}`.trim(), key = `${nm} ${r.etd}`;
    const lines = (r.ac || []).filter(opsLineUsed);
    const ps = [...new Set(lines.flatMap(a => [a.crew1, a.crew2, ...schSimRmk(a)]).map(opsNorm).filter(Boolean))];
    blocks.push({ id, kind: "sim", ri, r, s: s - 60, e, simS: s, simE: e, nm, key, lines, ps });
    // the aircrew (front seat) brief 1 h before and get the 3 h / 1 h sim-flight gaps; console and SXO / SUPP only cover the slot
    const crew = [...new Set(lines.map(a => opsNorm(a.crew1)).filter(Boolean))];
    put(crew, { kind: "sim", id, s: s - 60, e, simS: s, simE: e, label: `${nm} · ${r.etd}–${r.eta}Z`, key });
    put(ps.filter(n => !crew.includes(n)), { kind: "simsup", id, s, e, label: `${nm} (console / support) · ${r.etd}–${r.eta}Z`, key });
  });
  ((gnd || {}).groups || []).forEach((g, gi) => (g.rows || []).forEach((r, ri) => {
    const s = schM(r.time); if (s == null || !(r.event || r.personnel)) return;
    const e = opsEndMin(r.time) ?? s + 60, id = `g${gi}.${ri}`;
    const ps = [...new Set([...schNames(r.personnel), ...(typeof active === "function" ? active() : []).filter(t => opsGroundHas(r.personnel, t.name) && !schNames(r.personnel).includes(opsNorm(t.name))).map(t => opsNorm(t.name))])];
    blocks.push({ id, kind: "gnd", r, g, s, e, nm: r.event || "Ground", ps });
    put(ps, { kind: "gnd", id, s, e, label: `${r.event || "Ground"} · ${opsZ4(s)}Z${r.venue ? " · " + r.venue : ""}`, key: `${r.event} ${r.time}` });
  }));
  for (const b of opsBriefs(h)) { const s = schM(b.time); if (s != null) put(b.names, { kind: "brief", id: null, s, e: s + 30, label: `gives the ${b.lab} · ${b.time}Z`, key: `${b.lab} ${b.time}` }); }
  return { fl, blocks, items, people: [...ppl.keys()], plan };
}
// Clashes: [{ key, text, ids, who, sev }]
function schClashes(M) {
  const out = [], by = new Map(), seen = new Set();
  for (const it of M.items) { if (!by.has(it.who)) by.set(it.who, []); by.get(it.who).push(it); }
  const add = (key, text, ids, who, sev) => { if (seen.has(key)) return; seen.add(key); out.push({ key, text, ids: ids.filter(Boolean), who, sev: sev || "conf" }); };
  for (const [who, its] of by) {
    its.sort((a, b) => a.s - b.s);
    for (let i = 0; i < its.length; i++) for (let j = i + 1; j < its.length; j++) {
      const a = its[i], b = its[j]; if (a.id && a.id === b.id) continue;
      // a brief given by the wave's SXO / OPS O is part of that duty
      if ([a, b].some(x => x.kind === "brief") && [a, b].some(x => x.kind === "sxo" || x.kind === "opso")) continue;
      const pair = [a, b].sort((x, y) => x.s - y.s), [p, q] = pair, key = `${who}|${p.key}|${q.key}`;
      const fl = pair.find(x => x.kind === "fly"), sm = pair.find(x => x.kind === "sim");
      if (fl && sm) {
        if (sm.simE <= fl.etd) { const gap = fl.etd - sm.simE; if (gap < 180) add(key, `${who}: takes off ${opsHM(gap)} after the sim ends (needs 3 h) · ${sm.label} → ${fl.label}`, [sm.id, fl.id], who); continue; }
        if (sm.simS >= fl.eta) { const gap = sm.simS - fl.eta; if (gap < 60) add(key, `${who}: sim starts ${gap} min after landing (needs 1 h) · ${fl.label} → ${sm.label}`, [fl.id, sm.id], who); continue; }
        add(key, `${who}: flight and sim overlap · ${fl.label} / ${sm.label}`, [fl.id, sm.id], who); continue;
      }
      if (q.s < p.e) add(key, `${who}: ${p.label} overlaps ${q.label}`, [p.id, q.id], who);
    }
  }
  // the same tail on two flights at once
  const fb = M.blocks.filter(b => b.kind === "fly"), tk = t => String(t || "").replace(/[#@\s]/g, "").toUpperCase();
  for (let i = 0; i < fb.length; i++) for (let j = i + 1; j < fb.length; j++) for (const a of fb[i].lines) for (const c of fb[j].lines) {
    if (!tk(a.tail) || tk(a.tail) !== tk(c.tail)) continue;
    const [x, y] = [fb[i], fb[j]].sort((m, n) => m.etd - n.etd);
    if (y.etd < x.eta + 15) add(`TAIL ${tk(a.tail)}|${x.key}|${y.key}`, `A/C ${tk(a.tail)} on ${x.nm} (${x.f.etd}–${x.f.eta}Z) and ${y.nm} (${y.f.etd}Z)`, [x.id, y.id], "");
  }
  // van / DL warnings and IRT without IRE
  for (const b of fb) {
    for (const w of [...((b.pl || {}).warn || []), (b.pl || {}).dlWarn].filter(Boolean)) add(`PLAN|${b.key}|${w}`, `${b.nm}: ${w}`, [b.id], "", "warn");
    for (const a of b.lines) if (opsIrtBad(a)) add(`IRT|${b.key}|${opsNorm(a.crew1)}`, `${b.nm} ${a.n || ""}: IRT needs an IRE in the back seat (${a.crew2 || "none"})`, [b.id], "", "warn");
  }
  const acc = (M.fl && M.fl.acc) || {};
  for (const c of out) c.acc = acc[c.key] || null;
  return out;
}

/* ---------- drawing ---------- */
function schWindow(M) {
  const ss = M.blocks.map(b => b.s), ee = M.blocks.map(b => b.e);
  const first = ss.length ? Math.min(...ss) : 6 * 60, last = ee.length ? Math.max(...ee) : first + 600;
  if (SCH.start == null || SCH.day !== OPS.day) { SCH.day = OPS.day; SCH.start = Math.floor((first - 30) / 60) * 60; SCH.span = Math.min(24, Math.max(12, Math.ceil((last - SCH.start) / 60))); if (SCH.span > 16) SCH.span = 12; }
  return [SCH.start, SCH.start + SCH.span * 60];
}
// pack blocks into rows so none overlap
function schPack(bs) {
  const rows = [];
  for (const b of bs.slice().sort((x, y) => x.s - y.s)) { let r = rows.find(r => r[r.length - 1].e <= b.s); if (!r) rows.push(r = []); r.push(b); }
  return rows;
}
function renderSched(v) {
  if (SCH.G && SCH.G.armed) return; // mid-drag: the drop re-renders
  if (!OPS.day) OPS.day = todayStr();
  const can = opsCanEdit();
  if (can && !OPS.plan) { OPS.plan = true; if (OPS.rowsDay === OPS.day) opsBuildRows(); }
  if (OPS.rowsDay !== OPS.day) { v.innerHTML = `<div class="empty">Loading the programme…</div>`; if (!OPS.loading) opsLoad(OPS.day); return; }
  OPS.pendTags = OPS.plan && typeof opsPlanDiff === "function" ? opsPlanDiff().tags : null;
  const M = schModel(), C = schClashes(M), [t0, t1] = schWindow(M), span = t1 - t0;
  SCH.M = M; SCH.C = C; SCH.t0 = t0; SCH.spanM = span;
  const pc = m => ((Math.max(t0, Math.min(t1, m)) - t0) / span * 100).toFixed(3) + "%";
  const wd = (s, e) => ((Math.min(t1, e) - Math.max(t0, s)) / span * 100).toFixed(3) + "%";
  const vis = b => b.e > t0 && b.s < t1;
  const bad = new Set(), soft = new Set();
  for (const c of C) for (const id of c.ids) (c.acc ? soft : bad).add(id);
  const cls = b => [b.kind, bad.has(b.id) ? "bad" : soft.has(b.id) ? "acc" : "", SCH.sel === b.id ? "sel" : ""].join(" ");
  const nm = n => `<span class="schp" data-p="${esc(n)}">${esc(n)}</span>`;
  const pl = b => `data-ps="|${esc(b.ps.join("|"))}|"`;
  const chg = x => typeof opsChgHtml === "function" ? opsChgHtml(x) : "";
  const canDrag = OPS.plan && can, dg = b => canDrag && !(b.kind === "fly" && b.lines.some(a => a.log)), rz = b => dg(b) ? `<i class="schrz" title="Drag to change the ${b.kind === "fly" ? "landing" : "end"} time"></i>` : "";
  const fly = b => `<div class="schb ${cls(b)}${b.add ? " oadd" : ""}${dg(b) ? " dg" : ""}" data-sid="${b.id}" ${pl(b)} style="left:${pc(b.s)};width:${wd(b.s, b.e)}">${rz(b)}
      <i class="seg brf" style="left:0;width:${((b.st - b.s) / (b.e - b.s) * 100).toFixed(2)}%"></i><i class="seg stp" style="left:${((b.st - b.s) / (b.e - b.s) * 100).toFixed(2)}%;width:${((b.etd - b.st) / (b.e - b.s) * 100).toFixed(2)}%"></i><i class="seg air" style="left:${((b.etd - b.s) / (b.e - b.s) * 100).toFixed(2)}%;width:${((b.eta - b.etd) / (b.e - b.s) * 100).toFixed(2)}%"></i>
      <div class="schbt"><b>${esc(b.f.callsign || "?")}</b> ${esc(b.f.etd)}–${esc(b.f.eta)}Z${b.f.area ? ` · ${esc(b.f.area)}` : ""}${b.add ? " · OPS ADD" : ""}${b.pl && b.pl.veh ? ` · ${esc(b.pl.veh)}` : ""}${chg(b.f)}</div>
      ${b.lines.map(a => `<div class="schl">${esc(a.n || "")} ${nm(opsNorm(a.crew1) || "?")}${a.crew2 ? " / " + nm(opsNorm(a.crew2)) : ""} <span class="hint">${esc(a.mission || "")} ${esc(a.tail || "")}</span>${chg(a)}</div>`).join("")}</div>`;
  const simb = b => `<div class="schb ${cls(b)}${dg(b) ? " dg" : ""}" data-sid="${b.id}" ${pl(b)} style="left:${pc(b.s)};width:${wd(b.s, b.e)}">${rz(b)}
      <i class="seg brf" style="left:0;width:${(60 / (b.e - b.s) * 100).toFixed(2)}%"></i><i class="seg air" style="left:${(60 / (b.e - b.s) * 100).toFixed(2)}%;width:${((b.e - b.simS) / (b.e - b.s) * 100).toFixed(2)}%"></i>
      <div class="schbt"><b>${esc(b.r.callsign || "SIM")}</b> ${esc(b.r.etd)}–${esc(b.r.eta)}Z${chg(b.r)}</div>
      ${b.lines.map(a => `<div class="schl">${nm(opsNorm(a.crew1) || "?")}${a.crew2 ? " / " + nm(opsNorm(a.crew2)) : ""} <span class="hint">${esc(a.mission || "")}</span>${schSimRmk(a).length ? ` <span class="hint">+ ${schSimRmk(a).map(nm).join(", ")}</span>` : ""}</div>`).join("")}</div>`;
  const gndb = b => `<div class="schb ${cls(b)}" data-sid="${b.id}" ${pl(b)} title="${esc([b.nm, b.r.time, b.r.venue, b.r.personnel].filter(Boolean).join(" · "))}" style="left:${pc(b.s)};width:${wd(b.s, b.e)}"><div class="schbt"><b>${esc(b.nm)}</b> ${esc(b.r.time || "")}${b.r.venue ? " · " + esc(b.r.venue) : ""}</div><div class="schl">${schNames(b.r.personnel).map(nm).join(", ") || esc(b.r.personnel || "")}</div></div>`;
  const row = (lab, inner, c, n) => `<div class="schrow ${c || ""}"${n ? ` style="--n:${n}"` : ""}><div class="schlab">${lab}</div><div class="schtrk">${inner}</div></div>`;
  let rows = "";
  // TAF strip for Cazaux (when there is one)
  if (OPS.day === todayStr() && typeof tafParsed === "function") {
    const T = tafParsed("LFBC");
    if (T) { const d0 = Date.parse(OPS.day + "T00:00:00Z"), a = Math.max(T.from, d0 + t0 * 60e3), z = Math.min(T.to, d0 + t1 * 60e3);
      if (z > a) { const tl = tafTimeline(T, a, z), mm = ms => (ms - d0) / 60e3;
        rows += row(`<span class="hint">CZX TAF</span>`, tl.main.map(s => `<span class="schtaf ${obCsCls(s.fasf)}" style="left:${pc(mm(s.from))};width:${wd(mm(s.from), mm(s.to))}" title="${esc(`${tafZ(s.from)}–${tafZ(s.to)}: FASF ${s.fasf}`)}">${esc(s.fasf)}</span>`).join("")
          + tl.ov.map(s => `<span class="schtaf tempo ${obCsCls(s.fasf)}" style="left:${pc(mm(s.from))};width:${wd(mm(s.from), mm(s.to))}" title="${esc(`${tafLab(s.g)} ${tafZ(s.from)}–${tafZ(s.to)}: FASF ${s.fasf}`)}"></span>`).join(""), "taf"); } }
  }
  const waves = M.fl.waves || [];
  waves.forEach((w, wi) => {
    const fbs = M.blocks.filter(b => b.kind === "fly" && b.wi === wi && vis(b)), dd = M.blocks.find(b => b.kind === "duty" && b.wi === wi);
    if (!fbs.length && !(dd && vis(dd))) return;
    rows += `<div class="schsec">${esc(w.name)}${w.rmks ? ` <span class="schrmk">⚠ ${esc(w.rmks)}</span>` : ""}</div>`;
    if (dd && vis(dd)) rows += row("SXO · OPS O", `<div class="schb duty ${cls(dd)}" data-sid="${dd.id}" ${pl(dd)} style="left:${pc(dd.s)};width:${wd(dd.s, dd.e)}"><div class="schbt">SXO ${dd.sxo.map(nm).join(", ") || "-"} · OPS O ${dd.opsO.map(nm).join(", ") || "-"}</div></div>`, "dutyrow");
    for (const b of fbs) rows += row(`${esc(b.f.callsign || "?")}<small>${esc(b.f.etd)}Z</small>`, fly(b), "", 1 + b.lines.length);
  });
  const sims = schPack(M.blocks.filter(b => b.kind === "sim" && vis(b)));
  if (sims.length) { rows += `<div class="schsec">SIMULATOR</div>`; sims.forEach((r, i) => rows += row(i ? "" : "Sims", r.map(simb).join(""), "", 1 + Math.max(...r.map(b => b.lines.length)))); }
  const gnds = schPack(M.blocks.filter(b => b.kind === "gnd" && vis(b)));
  if (gnds.length) { rows += `<div class="schsec">GROUND</div>`; gnds.forEach((r, i) => rows += row(i ? "" : "Ground", r.map(gndb).join(""), "", 2)); }
  const ticks = []; for (let m = Math.ceil(t0 / 60) * 60; m <= t1; m += 60) ticks.push(`<span style="left:${pc(m)}">${schZ(m).slice(0, 2)}${m % 180 === 0 ? "Z" : ""}</span>`);
  const nowZ = new Date(), nowM = nowZ.getUTCHours() * 60 + nowZ.getUTCMinutes(), showNow = OPS.day === todayStr() && nowM > t0 && nowM < t1;
  const open = C.filter(c => !c.acc), acc = C.filter(c => c.acc);
  const side = SCH.edit ? schEditForm() : `<div class="schcl"><h3>Clashes <span class="${open.some(c => c.sev === "conf") ? "bad" : ""}">${open.length}</span></h3>
      ${open.length ? open.map(c => `<div class="schc ${c.sev}" data-ck="${esc(c.key)}"><span>${esc(c.text)}</span>${OPS.plan ? `<button class="btn small" data-schacc="${esc(c.key)}" title="Accept and carry on planning (e.g. briefed the day before)">Accept</button>` : ""}</div>`).join("") : `<p class="hint">No clashes. 👍</p>`}
      ${acc.length ? `<details><summary>Accepted (${acc.length})</summary>${acc.map(c => `<div class="schc acc" data-ck="${esc(c.key)}"><span>${esc(c.text)} <small class="hint">· accepted by ${esc(c.acc.by || "?")} ${esc(c.acc.at || "")}</small></span>${OPS.plan ? `<button class="btn small" data-schunacc="${esc(c.key)}">Undo</button>` : ""}</div>`).join("")}</details>` : ""}
      <p class="hint schrules">Rules: flight = brief to landing + 30 min; sim = 1 h brief to its end (console / SXO / SUPP: the slot only); a brief given by the wave's SXO / OPS O is part of the duty; after a sim, take-off ≥ 3 h after it ends; after a flight, a sim ≥ 1 h after landing; SXO / OPS O over their wave; ground events; briefs given. Hover a name to see that person's day.${OPS.plan && can ? " <b>Drag</b> a formation or sim to re-time it (5 min steps; on a phone, hold it first); drag its right edge to change the landing / end. Tap it to edit crew and times." : ""}</p></div>
      <div id="schDay"></div>`;
  v.innerHTML = `<div class="schbar opsbar grp">
      <div class="opsgrp"><span class="opsgrpl">Day</span><div class="opsgrpb"><button class="btn small" data-sch="day" data-n="-1">‹</button><b class="schday">${esc(opsLongDay(OPS.day))}</b><button class="btn small" data-sch="day" data-n="1">›</button></div></div>
      <div class="opsgrp"><span class="opsgrpl">Time (Z)</span><div class="opsgrpb"><button class="btn small" data-sch="pan" data-n="-60">◀ 1h</button><select data-sch="span">${[8, 10, 12, 14, 16, 24].map(h => `<option value="${h}"${h === SCH.span ? " selected" : ""}>${h} h</option>`).join("")}</select><button class="btn small" data-sch="pan" data-n="60">1h ▶</button>${OPS.day === todayStr() ? `<button class="btn small" data-sch="now">Now</button>` : ""}</div></div>
      <span class="grow"></span>
      ${can ? `<div class="opsgrp"><span class="opsgrpl">Plan</span><div class="opsgrpb"><span class="schst">${opsDraftCount() ? `<b>${opsDraftCount()}</b> section${opsDraftCount() === 1 ? "" : "s"} unpublished` : "No unpublished changes"} · live: <b>${esc(opsVerName() || "not published yet")}</b></span>${SCH.undo && SCH.undo.day === OPS.day ? `<button class="btn small" data-sch="undo" title="Undo: ${esc(SCH.undo.label)}">↶ Undo</button>` : ""}<button class="btn small primary" data-ops="publish"${opsDraftCount() ? "" : " disabled"}>Publish…</button></div></div>` : `<span class="schst">Published: <b>${esc(opsVerName() || "ORIGINAL")}</b></span>`}
      <div class="opsgrp"><span class="opsgrpl">View</span><div class="opsgrpb"><button class="btn small" data-tab="ops">Programme</button></div></div></div>
    <div class="schwrap"><div class="schscroll"><div class="schgrid" id="schGrid">
      ${row("", ticks.join(""), "schhead")}${rows || `<div class="empty">Nothing on the programme in this window.</div>`}
      ${showNow ? `<i class="schnow" style="left:calc(var(--lab) + (100% - var(--lab)) * ${((nowM - t0) / span).toFixed(4)})"></i>` : ""}<svg class="schlink" id="schLink"></svg></div>
      </div><aside class="schside">${side}</aside></div>`;
}
/* ---------- hover a person: their blocks, a line through them, their day ---------- */
function schHover(n) {
  const g = document.getElementById("schGrid"); if (!g) return;
  g.classList.toggle("hov", !!n);
  g.querySelectorAll(".schb").forEach(b => b.classList.toggle("on", !!n && b.dataset.ps && b.dataset.ps.includes("|" + n + "|")));
  g.querySelectorAll(".schp").forEach(s => s.classList.toggle("on", s.dataset.p === n));
  const svg = document.getElementById("schLink"), gr = g.getBoundingClientRect();
  if (!n) { svg.innerHTML = ""; const d = document.getElementById("schDay"); if (d) d.innerHTML = ""; return; }
  const pts = [...g.querySelectorAll(".schb.on")].map(b => { const r = b.getBoundingClientRect(); return [r.left - gr.left + Math.min(r.width / 2, 40), r.top - gr.top + Math.min(r.height / 2, 14)]; }).sort((a, b) => a[0] - b[0]);
  svg.setAttribute("width", g.scrollWidth); svg.setAttribute("height", g.scrollHeight);
  svg.innerHTML = pts.length > 1 ? `<polyline points="${pts.map(p => p.join(",")).join(" ")}" /> ${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4"/>`).join("")}` : "";
  const M = SCH.M, its = M.items.filter(i => i.who === n).sort((a, b) => a.s - b.s), cl = SCH.C.filter(c => c.who === n && !c.acc);
  const d = document.getElementById("schDay");
  if (d) d.innerHTML = `<div class="schdaycard"><h3>${esc(n)}</h3>${its.length ? `<ol>${its.map(i => `<li><b>${schZ(i.s)}Z</b> ${esc(i.label)}</li>`).join("")}</ol>` : `<p class="hint">Nothing on today's programme.</p>`}
    ${cl.length ? `<p class="schdaybad">⚠ ${cl.length} clash${cl.length === 1 ? "" : "es"}</p>` : ""}</div>`;
}
document.addEventListener("mouseover", e => {
  if (S.tab !== "sched" || SCH.pin) return;
  const p = e.target.closest(".schp"); const n = p ? p.dataset.p : null;
  if (n !== SCH.hov) { SCH.hov = n; schHover(n); }
});
/* ---------- edit a formation / sim in the plan ---------- */
function schEditForm() {
  const E = SCH.edit, inp = (k, v, w, ph) => `<input data-se="${k}" value="${esc(v ?? "")}" style="width:${w || "100%"}"${ph ? ` placeholder="${esc(ph)}"` : ""}>`;
  if (E.kind === "fly") {
    const f = E.f;
    return `<div class="sched"><h3>${esc(E.title)}</h3>
      <div class="schfg"><label>Callsign${inp("callsign", f.callsign)}</label><label>ETD (Z)${inp("etd", f.etd, "", "0715")}</label><label>ETA (Z)${inp("eta", f.eta)}</label><label>Brief${inp("brief", f.brief)}</label><label>Step${inp("step", f.step)}</label><label>Area${inp("area", f.area)}</label></div>
      <p class="hint" style="margin:2px 0 8px">Changing the ETD moves the brief, step and ETA by the same amount (unless you change them here too).</p>
      <table class="opst schft"><thead><tr><th>#</th><th>Front</th><th>Back</th><th>Mission</th><th>A/C</th><th>Ops add</th></tr></thead><tbody>
      ${(f.ac || []).map((a, i) => `<tr><td>${esc(a.n || "")}</td><td>${inp(`ac.${i}.crew1`, a.crew1)}</td><td>${inp(`ac.${i}.crew2`, a.crew2)}</td><td>${inp(`ac.${i}.mission`, a.mission)}</td><td>${inp(`ac.${i}.tail`, a.tail, "60px")}</td><td style="text-align:center"><input type="checkbox" data-se="ac.${i}.opsAdd"${a.opsAdd ? " checked" : ""}></td></tr>`).join("")}</tbody></table>
      <div class="row"><button class="btn" data-sch="edcancel">Cancel</button><button class="btn primary" data-sch="edsave">Save to the plan</button></div></div>`;
  }
  const r = E.r;
  return `<div class="sched"><h3>${esc(E.title)}</h3>
    <div class="schfg"><label>Callsign${inp("callsign", r.callsign)}</label><label>Start (Z)${inp("etd", r.etd)}</label><label>End (Z)${inp("eta", r.eta)}</label></div>
    <table class="opst schft"><thead><tr><th>#</th><th>Aircrew</th><th>Console</th><th>Mission</th><th>Rmks</th></tr></thead><tbody>
    ${(r.ac || []).map((a, i) => `<tr><td>${esc(a.n || "")}</td><td>${inp(`ac.${i}.crew1`, a.crew1)}</td><td>${inp(`ac.${i}.crew2`, a.crew2)}</td><td>${inp(`ac.${i}.mission`, a.mission)}</td><td>${inp(`ac.${i}.rmks`, a.rmks)}</td></tr>`).join("")}</tbody></table>
    <div class="row"><button class="btn" data-sch="edcancel">Cancel</button><button class="btn primary" data-sch="edsave">Save to the plan</button></div></div>`;
}
// Save a section to the plan, keeping the previous version for Undo.
async function schCommit(sec, data, label) {
  const prev = opsClone(opsGet(sec));
  const { data: ver, error } = await opsSecSave(OPS.day, sec, data, OPS.rows[sec] ? OPS.rows[sec].version : 0);
  if (error) { toast(errMsg(error)); return false; }
  OPS.rows[sec] = { ...(OPS.rows[sec] || {}), day: OPS.day, section: sec, data, version: ver, draft: true, updated_at: new Date().toISOString(), updated_by: S.me.id };
  OPS.drafts[sec] = OPS.rows[sec];
  if (label) SCH.undo = { day: OPS.day, sec, data: prev, label };
  return true;
}
async function schSaveEdit(btn) {
  const E = SCH.edit, sec = E.kind === "fly" ? "flying" : "sim";
  const data = opsClone(opsGet(sec)), tgt = E.kind === "fly" ? data.waves[E.wi].flights[E.fi] : data.rows[E.ri];
  if (!tgt) return toast("That line has moved; reopen it.");
  const oldEtd = tgt.etd;
  document.querySelectorAll("[data-se]").forEach(el => { const path = el.dataset.se.split("."); let o = tgt; for (const k of path.slice(0, -1)) o = o[k]; o[path[path.length - 1]] = el.type === "checkbox" ? el.checked : el.value.trim().toUpperCase(); });
  if (E.kind === "fly") {
    tgt.etd = opsT4(tgt.etd) || tgt.etd;
    // moving the ETD moves the brief, step and ETA by the same amount (typed ones keep their gap to the ETD)
    const d = opsMin(tgt.etd) != null && opsMin(oldEtd) != null ? opsMin(tgt.etd) - opsMin(oldEtd) : 0;
    if (d) for (const k of ["brief", "step", "eta"]) if (tgt[k] === E.f[k]) tgt[k] = opsIsMan({ ...E.f }, k) && opsMin(tgt[k]) != null ? opsZ4(((opsMin(tgt[k]) + d) % 1440 + 1440) % 1440) : opsAutoT(tgt, k);
  }
  btn.disabled = true;
  const ok = await schCommit(sec, data, `edit ${E.title}`);
  btn.disabled = false;
  if (!ok) return;
  SCH.edit = null; toast("Saved to the plan (not live until you publish)."); render();
}
async function schAccept(key, on) {
  const data = opsClone(opsGet("flying")); data.acc = data.acc || {};
  if (on) data.acc[key] = { by: pLabel(S.me) || "", at: new Date().toISOString().slice(11, 16).replace(":", "") + "Z" }; else delete data.acc[key];
  const { data: ver, error } = await opsSecSave(OPS.day, "flying", data, OPS.rows.flying ? OPS.rows.flying.version : 0);
  if (error) return toast(errMsg(error));
  OPS.rows.flying = { ...(OPS.rows.flying || {}), day: OPS.day, section: "flying", data, version: ver, draft: true, updated_at: new Date().toISOString(), updated_by: S.me.id };
  OPS.drafts.flying = OPS.rows.flying; render();
}
document.addEventListener("click", e => {
  if (S.tab !== "sched") return;
  if (SCH.justDragged) { SCH.justDragged = false; if (e.target.closest(".schb")) return; }
  const a = e.target.closest("[data-sch]"), ac = e.target.closest("[data-schacc]"), un = e.target.closest("[data-schunacc]");
  if (ac) return schAccept(ac.dataset.schacc, true);
  if (un) return schAccept(un.dataset.schunacc, false);
  if (a) {
    const k = a.dataset.sch;
    if (k === "day") { if (SCH.edit && !confirm("Discard your unsaved changes?")) return; SCH.edit = null; SCH.start = null; OPS.day = opsShift(OPS.day, +a.dataset.n); OPS.rowsDay = null; return render(); }
    if (k === "pan") { SCH.start += +a.dataset.n; return render(); }
    if (k === "now") { const n = new Date(); SCH.start = Math.floor((n.getUTCHours() * 60 + n.getUTCMinutes() - 60) / 60) * 60; return render(); }
    if (k === "edcancel") { SCH.edit = null; return render(); }
    if (k === "edsave") return schSaveEdit(a);
    if (k === "undo" && SCH.undo) { const U = SCH.undo; SCH.undo = null; a.disabled = true; return schCommit(U.sec, U.data, null).then(ok => { if (ok) toast(`Undone: ${U.label}.`); else SCH.undo = U; render(); }); }
    return;
  }
  const c = e.target.closest(".schc[data-ck]");
  if (c && !e.target.closest("button")) { const cl = SCH.C.find(x => x.key === c.dataset.ck); SCH.sel = null; document.querySelectorAll(".schb").forEach(b => b.classList.toggle("flash", !!cl && cl.ids.includes(b.dataset.sid))); const f = cl && document.querySelector(`.schb[data-sid="${cl.ids[0]}"]`); if (f) f.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
  const p = e.target.closest(".schp");
  if (p) { SCH.pin = SCH.pin === p.dataset.p ? null : p.dataset.p; schHover(SCH.pin); return; }
  const b = e.target.closest(".schb[data-sid]");
  if (b && OPS.plan && opsCanEdit()) {
    const B = SCH.M.blocks.find(x => x.id === b.dataset.sid); if (!B) return;
    if (B.kind === "fly") SCH.edit = { kind: "fly", wi: B.wi, fi: B.fi, f: opsClone(B.f), title: `${opsWaveShort(B.w)} ${B.f.callsign || ""}` };
    else if (B.kind === "sim") SCH.edit = { kind: "sim", ri: B.ri, r: opsClone(B.r), title: `Sim ${B.r.callsign || ""}` };
    else return;
    SCH.sel = B.id; render();
  }
});
document.addEventListener("change", e => { if (S.tab === "sched" && e.target.dataset.sch === "span") { SCH.span = +e.target.value; render(); } });

/* ---------- drag to re-time (planning, editors) ---------- */
// Mouse / pen: press and move. Touch: hold ~0.35 s first (a quick horizontal swipe scrolls the timeline, vertical scrolls the page).
function schTip(x, y, html) {
  let t = document.getElementById("schTip");
  if (!html) { if (t) t.remove(); return; }
  if (!t) { t = document.createElement("div"); t.id = "schTip"; document.body.appendChild(t); }
  t.innerHTML = html; t.style.left = Math.min(x + 14, innerWidth - t.offsetWidth - 8) + "px"; t.style.top = Math.max(8, y - t.offsetHeight - 14) + "px";
}
function schDragUpdate(G, d) {
  if (d === G.d) return; G.d = d;
  const px = d * G.ppm;
  if (G.mode === "move") G.el.style.transform = d ? `translateX(${px}px)` : "";
  else G.el.style.width = Math.max(G.minW, G.w0 + px) + "px";
  const dr = SCH.drag = { ...G.ref, mode: G.mode, d };
  const M = schModel(), nid = (dr.res && dr.res.id) || G.ref.id, C = schClashes(M).filter(c => !c.acc && c.ids.includes(nid));
  SCH.drag = null;
  const B = M.blocks.find(b => b.id === nid), t = G.ref.kind === "fly" ? B.f : B.r, wave = dr.res && dr.res.wave;
  const sg = d ? ` <span>(${opsSigned(d)}${Math.abs(d) < 60 ? " min" : ""})</span>` : "";
  const when = G.mode === "move" ? (G.ref.kind === "fly" ? `ETD <b>${esc(t.etd)}Z</b> · ETA ${esc(t.eta || "")}Z${t.brief ? ` · brief ${esc(t.brief)}Z` : ""}` : `<b>${esc(t.etd)}–${esc(t.eta)}Z</b>`) : `${G.ref.kind === "fly" ? "ETA" : "End"} <b>${esc(t.eta)}Z</b>`;
  G.el.classList.toggle("dbad", C.some(c => c.sev === "conf")); G.el.classList.toggle("dok", !C.length);
  G.html = `<div>${esc(G.title)} · ${when}${sg}</div>${wave ? `<div class="wv">→ joins ${esc(wave)}</div>` : ""}${C.length ? `<ul>${C.slice(0, 4).map(c => `<li class="${c.sev}">${esc(c.text)}</li>`).join("")}${C.length > 4 ? `<li>+ ${C.length - 4} more</li>` : ""}</ul>` : `<div class="ok">✓ No clashes</div>`}`;
  schTip(G.x, G.y, G.html);
}
function schDragEnd(G, commit) {
  clearTimeout(G.hold); schTip(); document.body.classList.remove("schdragging");
  if (G.el) { G.el.classList.remove("dragging", "dbad", "dok"); }
  SCH.G = null;
  if (!G.armed) return;
  SCH.justDragged = true; setTimeout(() => { SCH.justDragged = false; }, 400);
  if (!commit || !G.d) { G.el.style.transform = ""; G.el.style.width = ""; return; }
  const sec = G.ref.kind === "fly" ? "flying" : "sim", data = opsClone(opsGet(sec));
  const r = schShift(data, G.ref, G.mode, G.d); if (!r) return render();
  if (sec === "flying") opsNameWaves(data);
  schCommit(sec, data, `${G.mode === "move" ? "move" : "re-time"} ${G.title} ${opsSigned(G.d)}`).then(ok => { if (ok) toast(`${G.title} ${G.mode === "move" ? "moved" : (G.ref.kind === "fly" ? "landing" : "end") + " moved"} ${opsSigned(G.d)}${Math.abs(G.d) < 60 ? " min" : ""}${r.wave ? `, now in ${r.wave}` : ""} (plan).`); render(); });
}
document.addEventListener("pointerdown", e => {
  if (S.tab !== "sched" || e.button > 0 || SCH.G) return;
  const el = e.target.closest(".schb.dg"); if (!el || e.target.closest("button,input") || (e.pointerType !== "touch" && e.target.closest(".schp"))) return;
  const B = SCH.M && SCH.M.blocks.find(b => b.id === el.dataset.sid); if (!B) return;
  const trk = el.parentElement, ppm = trk.clientWidth / SCH.spanM, sc = el.closest(".schscroll");
  const G = SCH.G = { el, ppm, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, d: 0, w0: el.getBoundingClientRect().width, minW: 15 * ppm, sc, sl: sc ? sc.scrollLeft : 0,
    mode: e.target.closest(".schrz") ? "end" : "move", touch: e.pointerType === "touch", armed: false, id: e.pointerId,
    ref: B.kind === "fly" ? { kind: "fly", id: B.id, wi: B.wi, fi: B.fi } : { kind: "sim", id: B.id, ri: B.ri }, title: B.kind === "fly" ? B.nm : B.nm };
  const arm = () => { G.armed = true; el.classList.add("dragging"); document.body.classList.add("schdragging"); try { el.setPointerCapture(G.id); } catch (_) {} if (G.touch && navigator.vibrate) navigator.vibrate(15); G.d = null; schDragUpdate(G, 0); };
  if (G.touch) G.hold = setTimeout(() => { if (SCH.G === G && !G.armed) arm(); }, 350);
  G.arm = arm;
});
document.addEventListener("pointermove", e => {
  const G = SCH.G; if (!G || e.pointerId !== G.id) return;
  G.x = e.clientX; G.y = e.clientY;
  const dx = e.clientX - G.x0, dy = e.clientY - G.y0;
  if (!G.armed) {
    if (G.touch) { if (Math.abs(dy) > 10) return schDragEnd(G, false); if (G.sc && Math.abs(dx) > 6) { clearTimeout(G.hold); G.scrolling = true; G.sc.scrollLeft = G.sl - dx; } return; }
    if (Math.hypot(dx, dy) < 4) return; G.arm();
  }
  e.preventDefault();
  schDragUpdate(G, Math.round(dx / G.ppm / 5) * 5);
  schTip(G.x, G.y, G.html);
}, { passive: false });
document.addEventListener("pointerup", e => { const G = SCH.G; if (G && e.pointerId === G.id) { if (G.scrolling) SCH.justDragged = true; schDragEnd(G, true); } });
document.addEventListener("pointercancel", e => { const G = SCH.G; if (G && e.pointerId === G.id) schDragEnd(G, false); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && SCH.G) schDragEnd(SCH.G, false); });

(() => {
  const s = document.createElement("style");
  s.textContent = `
.schbar{margin-bottom:8px}.schday{font:700 1rem var(--cond);padding:0 6px;white-space:nowrap}.schst{font-size:.82rem;color:var(--muted);white-space:nowrap}.schbar select{width:auto;margin:0;padding:3px 4px}
.schwrap{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:12px;align-items:start}
.schscroll{min-width:0}@media (max-width:1100px){.schwrap{grid-template-columns:1fr}.schscroll{overflow-x:auto}.schscroll .schgrid{min-width:900px}}
.schgrid{--lab:96px;position:relative;border:1px solid var(--line);border-radius:8px;background:var(--paper);padding:0 0 6px;min-width:0}
.schrow{display:grid;grid-template-columns:var(--lab) 1fr;min-height:30px;border-top:1px solid color-mix(in srgb,var(--line) 60%,transparent)}
.schlab{padding:4px 6px;font:600 .78rem var(--body);color:var(--muted);border-right:1px solid var(--line);display:flex;flex-direction:column;justify-content:center}.schlab small{font-weight:400;font-size:.7rem}
.schtrk{position:relative;min-height:30px;background-image:repeating-linear-gradient(90deg,transparent 0,transparent calc(100% / ${24} - 1px),transparent 0)}
.schhead{position:sticky;top:0;z-index:3;background:var(--paper);min-height:22px;border-top:0}.schhead .schtrk span{position:absolute;top:4px;transform:translateX(-50%);font:600 .68rem var(--body);color:var(--muted)}
.schsec{padding:6px 8px 3px;font:700 .8rem var(--cond);letter-spacing:.06em;text-transform:uppercase;color:var(--ink);background:color-mix(in srgb,var(--muted) 10%,transparent);border-top:1px solid var(--line)}.schrmk{font:600 .72rem var(--body);color:var(--out);text-transform:none;letter-spacing:0;margin-left:8px}
.schb{position:absolute;top:3px;bottom:3px;border-radius:6px;border:1px solid color-mix(in srgb,var(--in) 55%,var(--line));background:color-mix(in srgb,var(--paper) 85%,var(--in));overflow:hidden;cursor:default;font-size:.74rem;line-height:1.3;padding:2px 6px;box-sizing:border-box;min-width:6px}
.schb .seg{position:absolute;top:0;bottom:0;pointer-events:none}.schb .brf{background:color-mix(in srgb,var(--in) 8%,transparent)}.schb .stp{background:color-mix(in srgb,var(--in) 18%,transparent)}.schb .air{background:color-mix(in srgb,var(--in) 34%,transparent);border-left:2px solid var(--in)}
.schb.sim{border-color:color-mix(in srgb,#a855f7 60%,var(--line))}.schb.sim .brf{background:color-mix(in srgb,#a855f7 10%,transparent)}.schb.sim .air{background:color-mix(in srgb,#a855f7 32%,transparent);border-left-color:#a855f7}
.schb.gnd{border-color:color-mix(in srgb,var(--muted) 60%,var(--line));background:color-mix(in srgb,var(--muted) 14%,var(--paper))}
.schb.duty{background:color-mix(in srgb,var(--out) 14%,var(--paper));border-color:color-mix(in srgb,var(--out) 55%,var(--line));top:3px;bottom:3px}
.schb.oadd{border-style:dashed;opacity:.85}
.schb .hint{font-size:inherit}.schb>div{position:relative;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.schbt b{font-weight:700}
.schrow[style] .schtrk{min-height:calc(var(--n) * 17px + 12px)}
.schb.dg{cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none}.schb.dg .schp{cursor:pointer}
.schrz{position:absolute;top:0;bottom:0;right:0;width:9px;cursor:ew-resize;z-index:2;border-right:3px solid transparent}.schb.dg:hover .schrz,.schb.dragging .schrz{border-right-color:color-mix(in srgb,var(--ink) 45%,transparent)}
.schb.dragging{cursor:grabbing;z-index:5;opacity:.95;box-shadow:0 6px 18px rgba(0,0,0,.35),0 0 0 2px var(--in)}.schb.dragging.dbad{box-shadow:0 6px 18px rgba(0,0,0,.35),0 0 0 2px var(--late)}.schb.dragging.dok{box-shadow:0 6px 18px rgba(0,0,0,.35),0 0 0 2px var(--ok)}
body.schdragging{cursor:grabbing;user-select:none;-webkit-user-select:none}
#schTip{position:fixed;z-index:1000;max-width:340px;padding:7px 10px;border-radius:8px;background:#141b26;color:#f1f4f8;border:1px solid rgba(255,255,255,.18);font:500 .8rem/1.35 var(--body);pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.3)}#schTip span{opacity:.75}#schTip ul{margin:4px 0 0;padding-left:16px}#schTip li{margin:1px 0;color:#ff9b9b}#schTip li.warn{color:#ffd27a}#schTip .ok{margin-top:3px;color:#7ee2a0}#schTip .wv{margin-top:2px;color:#9cc8ff;font-weight:700}
.schb.bad{box-shadow:0 0 0 2px var(--late);border-color:var(--late)}.schb.acc{box-shadow:0 0 0 1px var(--out);outline:1px dashed var(--out)}
.schb.sel{box-shadow:0 0 0 3px var(--ink)}.schb.flash{animation:schfl 1s ease 2}@keyframes schfl{50%{box-shadow:0 0 0 4px var(--late)}}
.schp{cursor:pointer;border-radius:3px;padding:0 1px}.schp:hover,.schp.on{background:var(--ink);color:var(--paper)}
.schgrid.hov .schb:not(.on){opacity:.28}.schgrid.hov .schb.on{box-shadow:0 0 0 2px var(--ink);z-index:2}
.schlink{position:absolute;left:0;top:0;pointer-events:none;z-index:4;overflow:visible}.schlink polyline{fill:none;stroke:var(--ink);stroke-width:2;stroke-dasharray:5 4;opacity:.8}.schlink circle{fill:var(--ink)}
.schnow{position:absolute;top:0;bottom:0;width:2px;background:var(--late);z-index:3;pointer-events:none;opacity:.8}
.schtaf{position:absolute;top:8px;bottom:8px;display:flex;align-items:center;justify-content:center;font:700 .66rem var(--body);border-radius:3px;overflow:hidden;border:0!important}.schtaf.tempo{top:auto;bottom:2px;height:5px;background-image:repeating-linear-gradient(135deg,rgba(0,0,0,.3) 0 3px,transparent 3px 6px)}
.schside{position:sticky;top:8px;max-height:calc(100vh - 16px);overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--paper);padding:10px 12px;font-size:.85rem}
.schside h3{margin:0 0 6px;font-size:1rem}.schside h3 span{display:inline-block;min-width:22px;text-align:center;border-radius:10px;padding:0 6px;background:color-mix(in srgb,var(--muted) 20%,transparent)}.schside h3 span.bad{background:var(--late);color:#fff}
.schc{display:flex;gap:8px;align-items:flex-start;justify-content:space-between;padding:6px 8px;margin:0 0 6px;border-radius:6px;border-left:3px solid var(--late);background:color-mix(in srgb,var(--late) 8%,transparent);cursor:pointer}.schc.warn{border-left-color:var(--out);background:color-mix(in srgb,var(--out) 8%,transparent)}.schc.acc{border-left-color:var(--muted);background:transparent;opacity:.8}
.schc button{flex:none}.schrules{font-size:.74rem;margin-top:10px}
.schdaycard{margin-top:10px;border-top:1px solid var(--line);padding-top:8px}.schdaycard ol{margin:0;padding-left:18px}.schdaycard li{margin:2px 0}.schdaybad{color:var(--late);font-weight:600;margin:6px 0 0}
.sched h3{margin:0 0 8px}.schfg{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.schfg label{margin:0;font-size:.75rem}.schfg input{margin-top:2px;padding:4px 6px}
.schft{width:100%;min-width:0;font-size:.78rem}.schft td,.schft th{padding:2px 3px}.schft input{padding:3px 4px;margin:0;font-size:.78rem}
`;
  document.head.appendChild(s);
})();
