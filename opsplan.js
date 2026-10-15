/* 150 Falcon Det: planning and publishing the flying programme (15 Oct 2026, Gordon).
   Schedulers change the programme in PLANNING mode: every editor (sections, compact flying editor, Import Excel, Copy from…,
   Clear day) reads and writes a draft (table ops_drafts via ops_draft_save) laid over the live programme (ops_sections).
   Nobody else sees it until Publish (rpc ops_publish), which copies the draft live and records a version in ops_pubs:
   the first one is the ORIGINAL; later ones are AL1, AL2 … or, for a small slip, a quiet correction of the current version
   (Gordon: "sneak in that small change … either override into the original version or publish as new").
   Each publish stores the change list (opsDiff: time shifts, aircraft, crew, mission, area, added / removed lines, sims,
   ground, day details …) and, for an AL, tags the changed flying lines / sims (a.chg = [{ al, t: [...], d }]) so the
   programme, TV and PDF show "AL2 · +15 · A/C". Flown times stay live (logging is outside planning) and are carried into
   the published plan. */

const OPS_SEC_LABEL = { header: "Day details", flying: "Flying", sim: "Simulator", ground: "Ground", airfield: "Airfield", notes: "Notes", duties: "Duties" };
const opsDraftCount = () => Object.values(OPS.drafts || {}).filter(r => r && r.data).length;
// OPS.rows = what the page shows: the live programme, or in planning mode the draft over it (undrafted sections at version 0).
function opsBuildRows() {
  OPS.rows = {};
  for (const [k, r] of Object.entries(OPS.live || {})) OPS.rows[k] = OPS.plan ? { ...r, version: 0, liveVersion: r.version } : r;
  if (OPS.plan) for (const [k, r] of Object.entries(OPS.drafts || {})) if (r && r.data) OPS.rows[k] = { ...r, draft: true };
}
const opsSecSave = (day, sec, data, version) => OPS.plan
  ? S.sb.rpc("ops_draft_save", { p_day: day, p_section: sec, p_data: data, p_version: version || 0 })
  : S.sb.rpc("ops_save", { p_day: day, p_section: sec, p_data: data, p_version: version || 0 });
// Live + draft for a day (for Import Excel): { cur: section → data (draft wins), ver: section → draft version }.
async function opsPlanRead(day) {
  const [a, b] = await Promise.all([S.sb.from("ops_sections").select("section,data").eq("day", day), S.sb.from("ops_drafts").select("section,data,version").eq("day", day)]);
  if (a.error || b.error) return { error: a.error || b.error };
  const cur = {}, ver = {}, has = d => d && Object.keys(d).length ? d : null;
  for (const r of a.data || []) cur[r.section] = has(r.data);
  for (const r of b.data || []) { ver[r.section] = r.version; if (r.data) cur[r.section] = has(r.data); }
  return { cur, ver };
}

/* ---------- versions ---------- */
const opsPubName = p => !p ? "" : p.al ? "AL" + p.al : "ORIGINAL";
const opsVerName = () => opsPubName((OPS.pubs || [])[OPS.pubs.length - 1]);
const opsCurAl = () => { const p = (OPS.pubs || [])[OPS.pubs.length - 1]; return p ? p.al : null; };
const opsPubWhen = p => { const d = new Date(p.at); return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${typeof tafZ === "function" ? tafZ(d.getTime()) : d.toISOString().slice(11, 16).replace(":", "") + "Z"}`; };
function opsVerTag() {
  const ps = OPS.pubs || []; if (!ps.length) return "";
  const last = ps[ps.length - 1], cur = ps.filter(p => p.al === last.al), pub = cur[0];
  const fixed = cur.length > 1 || last.kind === "fix";
  return `<span class="opsver"><b>${esc(opsPubName(last))}</b> <span class="hint">published ${esc(opsPubWhen(pub))}${pub.by ? " · " + esc(who(pub.by)) : ""}${fixed ? ` · corrected ${esc(opsPubWhen(last))}` : ""}</span>
    <button class="btn small" data-ops="chglog">${ps.length > 1 ? `Changes (${ps.length - 1})` : "History"}</button></span>`;
}

/* ---------- what changed ---------- */
const opsTx = v => String(v || "").trim();
const opsTailKey = v => String(v || "").replace(/[#@\s]/g, "").toUpperCase();
const opsSigned = d => (d > 0 ? "+" : "−") + Math.abs(d);
// Compare two programmes (section → data). Returns { list: [{ s, t }], tags: Map(object in N → { t: [short tags], d: [details] }) }.
function opsDiff(O, N) {
  const list = [], tags = new Map(), add = (s, t) => list.push({ s, t });
  const tag = (obj, t, d) => { if (!obj) return; const e = tags.get(obj) || { t: [], d: [] }; if (t && !e.t.includes(t)) e.t.push(t); if (d) e.d.push(d); tags.set(obj, e); };
  const clone = d => d ? JSON.parse(JSON.stringify(d)) : null;
  /* flying */
  const of = opsNameWaves(clone(O.flying) || { waves: [] }), nf = N.flying ? opsNameWaves(N.flying) : { waves: [] };
  const flat = d => (d.waves || []).flatMap((w, wi) => (w.flights || []).map((f, fi) => ({ w, f, wi, fi })))
    .filter(x => (x.f.ac || []).some(opsLineUsed));
  const oF = flat(of), nF = flat(nf), used = new Set(), etd = x => opsMin(x.f.etd), near = (a, b) => Math.abs((etd(a) ?? 0) - (etd(b) ?? 0));
  const fronts = x => (x.f.ac || []).map(a => opsNorm(a.crew1)).filter(Boolean).sort().join(",");
  const nm = x => `${opsWaveShort(x.w)} ${x.f.callsign || "(no callsign)"}`;
  const crew = a => [a.crew1, a.crew2].map(opsTx).filter(Boolean).join(" / ") || "no crew";
  for (const n of nF) {
    let c = oF.filter(o => !used.has(o) && opsNorm(o.f.callsign) && opsNorm(o.f.callsign) === opsNorm(n.f.callsign)).sort((a, b) => near(a, n) - near(b, n))[0];
    if (c && near(c, n) > 240) c = null;
    if (!c) c = oF.find(o => !used.has(o) && fronts(o) && fronts(o) === fronts(n) && near(o, n) <= 120);
    if (c) { used.add(c); n.o = c; }
  }
  for (const n of nF) {
    const lines = (n.f.ac || []).filter(opsLineUsed);
    if (!n.o) { add("Flying", `${nm(n)} added · ETD ${opsTx(n.f.etd) || "?"}Z · ${lines.map(crew).join(", ")}`); lines.forEach(a => tag(a, "new", "added")); continue; }
    const o = n.o, fd = [], ft = [];
    const d = (etd(n) != null && etd(o) != null) ? etd(n) - etd(o) : 0;
    if (d) { fd.push(`ETD ${o.f.etd} → ${n.f.etd}Z (${opsSigned(d)} min)`); ft.push(opsSigned(d)); }
    else if (opsTx(o.f.eta) !== opsTx(n.f.eta)) { fd.push(`ETA ${o.f.eta || "-"} → ${n.f.eta || "-"}Z`); ft.push("ETA"); }
    if (!d && (opsTx(o.f.brief) !== opsTx(n.f.brief) || opsTx(o.f.step) !== opsTx(n.f.step))) { fd.push(`brief / step ${o.f.brief || "-"}/${o.f.step || "-"} → ${n.f.brief || "-"}/${n.f.step || "-"}Z`); ft.push("brief"); }
    if (opsNorm(o.f.callsign) !== opsNorm(n.f.callsign)) { fd.push(`callsign ${o.f.callsign || "-"} → ${n.f.callsign || "-"}`); ft.push("callsign"); }
    if (opsWaveShort(o.w) !== opsWaveShort(n.w)) { fd.push(`moved ${opsWaveShort(o.w)} → ${opsWaveShort(n.w)}`); ft.push("wave"); }
    if (opsNorm(o.f.area) !== opsNorm(n.f.area) || opsNorm(o.f.areaTime) !== opsNorm(n.f.areaTime)) { fd.push(`area ${[o.f.area, o.f.areaTime].filter(Boolean).join(" ") || "-"} → ${[n.f.area, n.f.areaTime].filter(Boolean).join(" ") || "-"}`); ft.push("area"); }
    const oL = (o.f.ac || []).filter(opsLineUsed), lu = new Set();
    for (const a of lines) {
      let b = oL.find(x => !lu.has(x) && opsNorm(x.crew1) && opsNorm(x.crew1) === opsNorm(a.crew1)) || oL.find(x => !lu.has(x) && opsTx(x.n) && opsTx(x.n) === opsTx(a.n));
      if (!b) { add("Flying", `${nm(n)} ${a.n || ""}: added (${crew(a)}${a.tail ? ", " + a.tail : ""})`); tag(a, "new", "added"); ft.forEach(t => tag(a, t)); continue; }
      lu.add(b);
      const ld = [];
      if (opsNorm(b.crew1) !== opsNorm(a.crew1) || opsNorm(b.crew2) !== opsNorm(a.crew2)) { ld.push(`crew ${crew(b)} → ${crew(a)}`); tag(a, "crew"); }
      if (opsTailKey(b.tail) !== opsTailKey(a.tail)) { ld.push(`A/C ${b.tail || "-"} → ${a.tail || "-"}`); tag(a, "A/C"); }
      if (opsNorm(b.mission).replace(/\b0+(\d)/g, "$1") !== opsNorm(a.mission).replace(/\b0+(\d)/g, "$1")) { ld.push(`mission ${b.mission || "-"} → ${a.mission || "-"}`); tag(a, "mission"); }
      if (!!b.opsAdd !== !!a.opsAdd) { ld.push(a.opsAdd ? "now OPS ADD" : "no longer OPS ADD"); tag(a, "ops add"); }
      ft.forEach(t => tag(a, t, null));
      const all = [...fd, ...ld];
      if (all.length) { tag(a, null, all.join(" · ")); if (ld.length) add("Flying", `${nm(n)} ${a.n || ""}: ${ld.join(" · ")}`); }
    }
    if (fd.length) add("Flying", `${nm(n)}: ${fd.join(" · ")}`);
    for (const b of oL) if (!lu.has(b)) add("Flying", `${nm(n)} ${b.n || ""}: removed (${crew(b)})`);
  }
  for (const o of oF) if (!used.has(o)) add("Flying", `${nm(o)} (ETD ${o.f.etd || "?"}Z) removed · ${(o.f.ac || []).filter(opsLineUsed).map(crew).join(", ")}`);
  // SXO / OPS O / wave remarks, by wave name
  for (const w of nf.waves || []) {
    const ow = (of.waves || []).find(x => x.name === w.name); if (!ow) continue;
    for (const [k, l] of [["sxo", "SXO"], ["opsO", "OPS O"], ["rmks", "remarks"]]) if (opsNorm(ow[k]) !== opsNorm(w[k])) add("Flying", `${opsWaveShort(w)} ${l}: ${ow[k] || "-"} → ${w[k] || "-"}`);
  }
  /* simulator */
  const os = ((O.sim || {}).rows || []).filter(opsSimUsed), ns = ((N.sim || {}).rows || []).filter(opsSimUsed), su = new Set();
  const sname = r => r.callsign || "(no callsign)", screw = r => (r.ac || []).filter(opsLineUsed).map(a => [a.crew1, a.crew2].filter(Boolean).join(" / ")).join(", ");
  for (const r of ns) {
    const c = os.filter(x => !su.has(x) && opsNorm(x.callsign) === opsNorm(r.callsign)).sort((a, b) => Math.abs((opsMin(a.etd) ?? 0) - (opsMin(r.etd) ?? 0)) - Math.abs((opsMin(b.etd) ?? 0) - (opsMin(r.etd) ?? 0)))[0];
    if (!c) { add("Simulator", `${sname(r)} added · ${r.etd || "?"}–${r.eta || "?"}Z · ${screw(r)}`); tag(r, "new", "added"); continue; }
    su.add(c);
    const d = [];
    if (opsTx(c.etd) !== opsTx(r.etd) || opsTx(c.eta) !== opsTx(r.eta)) { const dd = (opsMin(r.etd) ?? 0) - (opsMin(c.etd) ?? 0); d.push(`${c.etd}–${c.eta} → ${r.etd}–${r.eta}Z`); tag(r, dd ? opsSigned(dd) : "time"); }
    (r.ac || []).filter(opsLineUsed).forEach((a, i) => {
      const b = (c.ac || []).filter(opsLineUsed).find(x => opsTx(x.n) === opsTx(a.n)) || (c.ac || []).filter(opsLineUsed)[i];
      if (!b) { d.push(`${a.n || ""} added (${[a.crew1, a.crew2].filter(Boolean).join(" / ")})`); tag(a, "new"); return; }
      if (opsNorm(b.crew1) !== opsNorm(a.crew1) || opsNorm(b.crew2) !== opsNorm(a.crew2)) { d.push(`crew ${[b.crew1, b.crew2].filter(Boolean).join(" / ")} → ${[a.crew1, a.crew2].filter(Boolean).join(" / ")}`); tag(a, "crew"); }
      if (opsNorm(b.mission) !== opsNorm(a.mission)) { d.push(`mission ${b.mission || "-"} → ${a.mission || "-"}`); tag(a, "mission"); }
    });
    if (d.length) { add("Simulator", `${sname(r)}: ${d.join(" · ")}`); tag(r, null, d.join(" · ")); }
  }
  for (const c of os) if (!su.has(c)) add("Simulator", `${sname(c)} (${c.etd || "?"}Z) removed · ${screw(c)}`);
  /* ground */
  const gflat = d => ((d || {}).groups || []).flatMap(g => (g.rows || []).filter(r => r.event || r.personnel).map(r => ({ g: g.name, r })));
  const og = gflat(O.ground), ng = gflat(N.ground), gu = new Set();
  for (const x of ng) {
    const c = og.find(y => !gu.has(y) && y.g === x.g && opsNorm(y.r.event) === opsNorm(x.r.event));
    if (!c) { add("Ground", `${x.r.event || "event"} ${x.r.time || ""} added (${x.r.personnel || "-"})`); continue; }
    gu.add(c);
    const d = [];
    for (const [k, l] of [["time", "time"], ["personnel", "personnel"], ["venue", "venue"]]) if (opsNorm(c.r[k]) !== opsNorm(x.r[k])) d.push(`${l} ${c.r[k] || "-"} → ${x.r[k] || "-"}`);
    if (d.length) add("Ground", `${x.r.event}: ${d.join(" · ")}`);
  }
  for (const y of og) if (!gu.has(y)) add("Ground", `${y.r.event || "event"} ${y.r.time || ""} removed`);
  /* day details */
  const oh = O.header || {}, nh = N.header || {};
  for (const [k, l] of OPS_HEADER_FIELDS) if (opsTx(oh[k]) !== opsTx(nh[k])) add("Day details", `${l}: ${opsTx(oh[k]) || "-"} → ${opsTx(nh[k]) || "-"}`);
  /* airfield, notes */
  const rowsOf = (d, f) => new Set(f(d || {}).map(x => opsNorm(x)));
  const setDiff = (sec, a, b, label) => { for (const x of b) if (!a.has(x)) add(sec, `${label} added: ${x}`); for (const x of a) if (!b.has(x)) add(sec, `${label} removed: ${x}`); };
  setDiff("Airfield", rowsOf(O.airfield, d => (d.rows || []).map(r => `${r.what} ${r.time}`)), rowsOf(N.airfield, d => (d.rows || []).map(r => `${r.what} ${r.time}`)), "restriction");
  setDiff("Notes", rowsOf(O.notes, d => (d.currencies || []).map(r => `${r.who} ${r.note}`)), rowsOf(N.notes, d => (d.currencies || []).map(r => `${r.who} ${r.note}`)), "currency note");
  setDiff("Notes", rowsOf(O.notes, d => (d.aircraft || []).map(r => `${r.ac} ${r.note}`)), rowsOf(N.notes, d => (d.aircraft || []).map(r => `${r.ac} ${r.note}`)), "aircraft restriction");
  /* duties: who changed */
  const drow = d => { const m = {}; for (const g of (d || {}).groups || []) for (const r of g.rows || []) m[opsNorm(r.name)] = JSON.stringify([r.cells || [], r.inTime || "", r.outTime || ""]); return m; };
  const od = drow(O.duties), nd = drow(N.duties), dn = Object.keys(nd).filter(k => k && od[k] !== nd[k] && (od[k] || nd[k] !== JSON.stringify([[], "", ""])));
  if (dn.length && JSON.stringify(O.duties || {}) !== JSON.stringify(N.duties || {})) add("Duties", `updated for ${dn.slice(0, 8).join(", ")}${dn.length > 8 ? ` +${dn.length - 8}` : ""}`);
  return { list, tags };
}
// Change tags on a line / sim row: published ones (x.chg, "AL2 · +15 · A/C"), and in planning mode the not-yet-published ones.
function opsChgHtml(x) {
  if (!x) return "";
  const pub = (x.chg || []).map(c => `<span class="opschg" title="${esc(`Changed in AL${c.al}${c.d ? ": " + c.d : ""}`)}">AL${c.al}${(c.t || []).length ? " · " + esc(c.t.join(" · ")) : ""}</span>`).join("");
  const p = OPS.plan && OPS.pendTags && OPS.pendTags.get(x);
  return pub + (p && (p.t.length || p.d.length) ? `<span class="opschg pend" title="${esc("Not published yet: " + (p.d.join(" · ") || p.t.join(", ")))}">plan${p.t.length ? " · " + esc(p.t.join(" · ")) : ""}</span>` : "");
}
// The plan vs the live programme, for the banner and the pending tags.
function opsPlanDiff() {
  const O = {}, N = {};
  for (const k of OPS_ORDER) { const lv = OPS.live[k]; O[k] = lv && lv.data && Object.keys(lv.data).length ? lv.data : null;
    N[k] = OPS.edit && OPS.edit.section === k ? OPS.edit.data : opsData(k); }
  return opsDiff(O, N);
}
function opsPlanBanner() {
  if (!opsCanEdit()) return "";
  if (!OPS.plan) {
    const n = opsDraftCount(); if (!n) return "";
    const last = Object.values(OPS.drafts).filter(r => r.data).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    return `<div class="opsplanbar idle"><span><b>Unpublished plan</b> for this day (${n} section${n === 1 ? "" : "s"}${last ? ` · last change ${esc(new Date(last.updated_at).toISOString().slice(11, 16).replace(":", ""))}Z${last.updated_by ? " by " + esc(who(last.updated_by)) : ""}` : ""}). Everyone else still sees ${esc(opsVerName() || "the published programme")}.</span><button class="btn small primary" data-ops="plan">Open planning</button></div>`;
  }
  const D = opsPlanDiff(); OPS.pendTags = D.tags;
  const by = {}; for (const c of D.list) (by[c.s] ||= []).push(c.t);
  const base = opsVerName();
  return `<div class="opsplanbar"><div class="opsplanhd"><b>PLANNING</b><span>Not live. ${base ? `Based on <b>${esc(base)}</b>.` : OPS_ORDER.some(k => OPS.live[k] && OPS.live[k].data && Object.keys(OPS.live[k].data).length) ? "Based on the live programme (it becomes the ORIGINAL when you publish)." : "Nothing published for this day yet: the first publish is the ORIGINAL."} ${D.list.length ? `<b>${D.list.length}</b> change${D.list.length === 1 ? "" : "s"} not published yet.` : "No changes yet."}</span>
    <span class="grow"></span>${opsDraftCount() ? `<button class="btn small" data-ops="discard">Discard plan</button>` : ""}<button class="btn small primary" data-ops="publish"${opsDraftCount() ? "" : " disabled title=\"Nothing changed in the plan yet\""}>Publish…</button></div>
    ${D.list.length ? `<details class="opsplanlist"${D.list.length <= 6 ? " open" : ""}><summary>Changes in the plan</summary>${Object.entries(by).map(([s, l]) => `<div><b>${esc(s)}</b><ul>${l.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>`).join("")}</details>` : ""}</div>`;
}

/* ---------- publish ---------- */
// Flown times logged on the live programme while planning stay: copied onto the matching plan lines (callsign + front seat).
function opsMergeLogs(live, plan) {
  const m = {};
  for (const w of (live || {}).waves || []) for (const f of w.flights || []) for (const a of f.ac || []) if (a.log) m[`${opsNorm(f.callsign)}|${opsNorm(a.crew1)}`] = a.log;
  for (const w of (plan || {}).waves || []) for (const f of w.flights || []) for (const a of f.ac || []) { const L = m[`${opsNorm(f.callsign)}|${opsNorm(a.crew1)}`]; if (L) a.log = L; }
}
function opsPublishDlg() {
  if (OPS.edit) return toast("Save or cancel the section you're editing first.");
  const D = opsPlanDiff(), ps = OPS.pubs || [], cur = opsCurAl(), anyLive = OPS_ORDER.some(k => OPS.live[k] && OPS.live[k].data && Object.keys(OPS.live[k].data).length);
  const first = !ps.length && !anyLive, nextAl = !ps.length ? 1 : cur + 1, curName = ps.length ? opsVerName() : "ORIGINAL";
  const by = {}; for (const c of D.list) (by[c.s] ||= []).push(c.t);
  let d = document.getElementById("dlgPub");
  if (!d) { d = document.createElement("dialog"); d.id = "dlgPub"; document.body.appendChild(d);
    d.onclick = e => { if (e.target === d || e.target.closest("[data-x=close]")) return d.close(); const b = e.target.closest("[data-pub]"); if (b) opsPublish(b.dataset.pub, +b.dataset.al, b); }; }
  d.innerHTML = `<div class="dlg"><h2>Publish ${esc(opsLongDay(OPS.day))}</h2>
    ${first ? `<p>This is the first version of the day's programme: it goes live as the <b>ORIGINAL</b>.</p>`
      : `<p class="hint" style="margin-top:-4px">Live now: <b>${esc(curName)}</b>. Publish the plan as a new amendment, or fold a small slip into ${esc(curName)} without a new AL.</p>`}
    ${D.list.length ? `<div class="opspublist">${Object.entries(by).map(([s, l]) => `<div><b>${esc(s)}</b><ul>${l.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>`).join("")}</div>` : `<p class="hint">No changes found against the live programme.</p>`}
    <label>Note (optional)<input id="pubNote" maxlength="200" placeholder="e.g. LEXUS 2 A/C swap due U/S"></label>
    <div class="row" style="flex-wrap:wrap"><button class="btn" data-x="close">Cancel</button>
      ${first ? `<button class="btn primary" data-pub="al" data-al="0">Publish ORIGINAL</button>`
        : `<button class="btn" data-pub="fix" data-al="${ps.length ? cur : 0}" title="No new AL: the lines aren't tagged as changed">Correct ${esc(curName)}</button><button class="btn primary" data-pub="al" data-al="${nextAl}">Publish as AL${nextAl}</button>`}</div></div>`;
  d.showModal();
}
async function opsPublish(kind, al, btn) {
  const day = OPS.day; btn.disabled = true;
  const { data: live, error } = await S.sb.from("ops_sections").select("section,data,version").eq("day", day);
  if (error) { btn.disabled = false; return toast(errMsg(error)); }
  const L = {}, V = {}; for (const r of live || []) { L[r.section] = r.data && Object.keys(r.data).length ? r.data : null; V[r.section] = r.version; }
  const secs = Object.keys(OPS.drafts || {}).filter(k => OPS.drafts[k] && OPS.drafts[k].data);
  if (!secs.length) { btn.disabled = false; return toast("Nothing in the plan to publish."); }
  const P = {}; for (const k of secs) P[k] = opsClone(OPS.drafts[k].data);
  if (P.flying && L.flying) opsMergeLogs(L.flying, P.flying);
  const N = { ...L }; for (const k of secs) N[k] = P[k];
  const D = opsDiff(L, N), anyLive = Object.values(L).some(Boolean);
  if (kind === "al" && (OPS.pubs.length || anyLive)) for (const [obj, e] of D.tags) if (e.t.length) obj.chg = [...(obj.chg || []), { al, t: e.t, d: e.d.join(" · ") }];
  const vers = {}; for (const k of secs) vers[k] = V[k] || 0;
  const note = (document.getElementById("pubNote") || {}).value || "";
  const { data, error: e2 } = await S.sb.rpc("ops_publish", { p_day: day, p_kind: kind, p_al: al, p_data: P, p_versions: vers, p_changes: D.list, p_note: note });
  btn.disabled = false;
  if (e2) return ask("Not published", errMsg(e2), "OK");
  document.getElementById("dlgPub").close();
  const nm = data && data.kind === "fix" ? `${data.al ? "AL" + data.al : "ORIGINAL"} corrected` : `${data && data.al ? "AL" + data.al : "ORIGINAL"} published`;
  toast(`${nm}. Everyone now sees it.`);
  OPS.plan = false; OPS.edit = null; opsLoad(day);
}
function opsChangelog() {
  const ps = (OPS.pubs || []).slice().reverse();
  let d = document.getElementById("dlgChg");
  if (!d) { d = document.createElement("dialog"); d.id = "dlgChg"; document.body.appendChild(d); d.onclick = e => { if (e.target === d || e.target.closest("[data-x=close]")) d.close(); }; }
  const name = p => p.kind === "fix" ? `Correction to ${opsPubName(p)}` : opsPubName(p);
  d.innerHTML = `<div class="dlg"><div class="opshead"><h2>Programme history · ${esc(opsLongDay(OPS.day))}</h2><span class="grow"></span><button class="btn small" data-x="close">Close</button></div>
    ${ps.map(p => { const by = {}; for (const c of p.changes || []) (by[c.s] ||= []).push(c.t);
      return `<div class="opschgv"><div class="opschgh"><b class="${p.kind === "fix" ? "fix" : ""}">${esc(name(p))}</b><span class="hint">${esc(opsPubWhen(p))}${p.by ? " · " + esc(who(p.by)) : ""}</span></div>
        ${p.note ? `<p class="opschgn">${esc(p.note)}</p>` : ""}
        ${(p.changes || []).length ? Object.entries(by).map(([s, l]) => `<div><b>${esc(s)}</b><ul>${l.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>`).join("") : `<p class="hint" style="margin:2px 0 0">${p.al === 0 && p.kind !== "fix" ? "First version of the day." : "No listed changes."}</p>`}</div>`; }).join("")}</div>`;
  d.showModal();
}
async function opsPlanAct(a, el) {
  if (a === "chglog") return opsChangelog();
  if (a === "plan") { if (OPS.edit) return; OPS.plan = true; OPS.logOpen = false; opsBuildRows(); renderOps($("#view")); return toast("Planning: changes stay in the plan until you publish."); }
  if (a === "planexit") { if (OPS.edit && !confirm("Discard your unsaved changes?")) return; OPS.edit = null; OPS.plan = false; opsBuildRows(); return renderOps($("#view")); }
  if (a === "publish") return opsPublishDlg();
  if (a === "discard") {
    if (!await ask("Discard the plan?", `Throws away every unpublished change for ${opsLongDay(OPS.day)} (for all schedulers). The live programme stays as it is.`, "Discard plan")) return;
    el.disabled = true;
    const { error } = await S.sb.rpc("ops_draft_discard", { p_day: OPS.day });
    el.disabled = false;
    if (error) return toast(errMsg(error));
    toast("Plan discarded."); OPS.edit = null; opsLoad(OPS.day);
  }
}
// Realtime: another scheduler changed the plan, or someone published.
function opsPlanRealtime(p, kind) {
  const r = p.new && p.new.day ? p.new : p.old; if (!r || r.day !== OPS.day || OPS.rowsDay !== OPS.day) return;
  if (kind === "draft") {
    if (r.data) OPS.drafts[r.section] = r; else delete OPS.drafts[r.section];
    if (OPS.edit) { if (OPS.edit.section === r.section && r.updated_by !== S.me.id && OPS.plan) toast(`${who(r.updated_by) || "Someone"} just changed ${OPS_TITLES[r.section]} in the plan. Your save will ask you to redo your change.`); return; }
    opsBuildRows(); if (S.tab === "ops") renderOps($("#view"));
  } else if (!OPS.edit) opsLoad(OPS.day);
}

(() => {
  const s = document.createElement("style");
  s.textContent = `
.opsver{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin-left:12px;font:400 .85rem var(--body);text-transform:none;letter-spacing:0;vertical-align:middle}
.opsver b{font:700 .8rem var(--body);padding:2px 8px;border-radius:10px;background:color-mix(in srgb,var(--in) 22%,transparent);color:var(--in)}
.opsplanbar{margin:0 0 12px;padding:10px 12px;border:2px dashed var(--out);border-radius:8px;background:color-mix(in srgb,var(--out) 8%,transparent)}
.opsplanbar.idle{border-style:solid;border-width:1px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font-size:.88rem}.opsplanbar.idle span{flex:1;min-width:220px}
.opsplanhd{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}.opsplanhd>b{font:700 .8rem var(--body);letter-spacing:.08em;padding:2px 8px;border-radius:4px;background:var(--out);color:#1a1200}
.opsplanlist{margin-top:8px;font-size:.85rem}.opsplanlist summary{cursor:pointer;color:var(--muted)}.opsplanlist ul,.opspublist ul,.opschgv ul{margin:2px 0 6px;padding-left:18px}.opsplanlist li,.opspublist li,.opschgv li{margin:1px 0}
.opspublist{max-height:45vh;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin:0 0 10px;font-size:.88rem}
.opschg{display:inline-block;margin:2px 4px 0 0;padding:0 6px;border-radius:9px;font:600 .66rem/1.5 var(--body);background:color-mix(in srgb,var(--out) 20%,transparent);color:var(--out);white-space:nowrap;vertical-align:middle}
.opschg.pend{background:transparent;border:1px dashed var(--out)}
td.fcrew .opschg{display:inline-block}td.nm .opschg{display:inline-block}
#dlgPub,#dlgChg{width:min(760px,calc(100vw - 16px))}#dlgPub label{display:block;margin:6px 0 10px}#dlgPub input{width:100%}
.opschgv{border-top:1px solid var(--line);padding:10px 0;font-size:.88rem}.opschgh{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}.opschgh b{font:700 .85rem var(--body);padding:1px 8px;border-radius:9px;background:color-mix(in srgb,var(--in) 20%,transparent);color:var(--in)}.opschgh b.fix{background:color-mix(in srgb,var(--muted) 20%,transparent);color:var(--ink)}
.opschgn{margin:4px 0;font-style:italic}
`;
  document.head.appendChild(s);
})();
