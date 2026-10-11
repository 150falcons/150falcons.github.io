/* Currencies (Gordon, 11 Oct): replaces the "M346 E-MONITORING" Excel (NEW COVER + DATA ENTRY sheets). Phase 1:
   the currency board (everyone by group, green / amber / red, Expired / Expiring box) and the Records page to key the dates.
   Records live in ops_state key 'currency' ({ people: { NAME: {...} } }, saved with ops_state_save, can_edit_cur()).
   Last flown / night / FCF dates also come from Log flown times on the board (latest of typed and logged).
   Formulas follow the Excel (see CUR_RULES); amber = within cur.amber days (Settings). */
const CUR_GROUPS = [["QFI", "QFI"], ["ST", "ST Tow (FWP)"], ["FIC", "FIC"], ["PGF", "PGF"], ["TR", "Trainees"], ["WSO", "WSO trainees"], ["ATCO", "ATCO"]];
const CUR_RULES = [
  "Day currency (QFI, ST Tow, FIC): expires last flown + 31 days (30th day still current). PGF: 7 days.",
  "Night currency: last night sortie + 91 days. Day > Night: NO GO if more than 14 days since last flown (night-qualified only).",
  "IRT expires at the end of the month, one year after the IRT date.",
  "IPC (FTI): CAT A yearly, B1 6-monthly, B2 2-monthly (all to the end of the month); CAT C monthly, date to date.",
  "EP sims: last EP sim + 90 days. The last EP sim fills in from i-SATR (keyed EP dates and EP sims on the simulator programme); a date typed under Records overrides it.",
  "i-SATR: per QFI per half-year (Jan–Jun, Jul–Dec), each List 1 / List 2 / simulator item done vs required. Required numbers are worked out from the QFI's quals (GH/IF only for a QFI just out of FIC: List 1 = 6 × GH/IF, List 2 = the 15 GH/IF items, + night flying and 2 normal CCT night if night qualified. Otherwise A/G qual and night qual, ticked on the i-SATR page or under Records): A/A only = List 1 GH/IF, BFM, CAP 2 each and List 2 = 20; A/G = List 1 GH/IF, BFM, CAP, SAT 1 each + surface attack 2 (or 1 + night flying 1 when night qualified) and List 2 = 28; night qualified adds 1 night flying to List 1 and the 4 night items (2 normal CCT night, 2 TI 1 v 1 night) to List 2 (A/G + night = 32; A/A + night = 24). Any one number can be overridden on the person's page; clear it to go back to automatic. List % counts done items up to the number required. Flying days remaining = working days (Mon–Fri) from today to the end of cycle, less non-flying days. EP 1–8 fill in from the simulator programme (mission containing \"EP n\", aircrew seat) once the sim has ended. Excel note: CAT A / B1 / B2 need only 3 EP sims per quarter, CAT C all 4; set the requirements to match.",
  "ST Tow: FCF sims prof check and TOW qual prof check valid 12 months; FCF flight currency = last flown on type + 15 days.",
  "Trainee solo currency: last solo + 2 days (MOD 1–3), + 3 (MOD 4–6), + 4 (MOD 7+).",
  "Non-syllabus flying days (since last syllabus / DCO sortie): 8–13 optional flex, 14–30 flex, 31–59 2 × flex, 60+ flex package.",
  "Medical: blank = GO; anything typed (e.g. MC till 20 Oct) = NO GO.",
  "Hours limits: hours left = limit − hours flown in the last 24 h, 48 h, 7 days, 30 days, 3 months and 12 months (limits in Settings; trainees and WSO trainees have their own).",
  "IF monitoring: IF hours, precision (P) and non-precision (NP) approaches in the last 91 days, keyed per person in Log flown times. Days without IF approach count from the last sortie with a P or NP approach.",
  "Last flown, night and FCF dates fill in by themselves from Log flown times (front seat for trainees, back seat for WSO trainees). Type a date under Records only to correct one; clearing it goes back to automatic.",
];
const CUR = { view: "board", edit: null };
const curDoc = () => (typeof OB !== "undefined" && OB.state && OB.state.currency && OB.state.currency.data) || { people: {} };
const curCanEdit = () => !!S.me && (S.me.user_admin || S.me.cur_editor || (S.me.role === "admin" && ["CO", "DYCO", "OC A", "OC B"].includes(S.me.appointment)));
// Dates as YYYY-MM-DD strings (UTC maths so DST can't shift a day).
const cuD = s => { if (!s || !/^\d{4}-\d\d-\d\d/.test(s)) return null; const [y, m, d] = s.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
const cuS = t => t == null ? "" : new Date(t).toISOString().slice(0, 10);
const cuAdd = (s, n) => { const t = cuD(s); return t == null ? "" : cuS(t + n * 864e5); };
const cuEom = (s, m) => { const t = cuD(s); if (t == null) return ""; const d = new Date(t); return cuS(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m + 1, 0)); };
const cuEdate = (s, m) => { const t = cuD(s); if (t == null) return ""; const d = new Date(t), y = d.getUTCFullYear(), mo = d.getUTCMonth() + m, last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(); return cuS(Date.UTC(y, mo, Math.min(d.getUTCDate(), last))); };
const cuDays = (a, b) => { const x = cuD(a), y = cuD(b); return x == null || y == null ? null : Math.round((y - x) / 864e5); };
const cuMax = (...xs) => xs.filter(Boolean).sort().pop() || "";
const cuFmt = s => { const t = cuD(s); return t == null ? "" : new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" }); };

// Latest logged sorties per person from every day's flying section (OPS.hrs, shared with the Hours tab).
function curFlown() {
  if (!OPS.hrs) {
    if (!OPS.hrsLoading) { OPS.hrsLoading = true; S.sb.from("ops_sections").select("day,data").eq("section", "flying").order("day").then(({ data, error }) => { OPS.hrsLoading = false; if (error) return toast(errMsg(error)); OPS.hrs = { days: data || [] }; if (S.tab === "cur") render(); }); }
    return null;
  }
  const o = {}, h = curHist();
  // Excel history (up to h.upTo) first: hours per day and IF per day; the board's logs take over after that date.
  for (const [n, days] of Object.entries(h.hrs)) { const p = o[n] || (o[n] = { sorties: [], ifs: [] }); for (const [d, x] of days) p.sorties.push({ day: d, mins: Math.round(x * 60), hist: true }); }
  for (const [n, days] of Object.entries(h.if)) { const p = o[n] || (o[n] = { sorties: [], ifs: [] }); for (const [d, v] of days) { p.ifs.push([d, ...v]); if (v[1] + v[2] > 0) p.ifapp = cuMax(p.ifapp, d); } }
  for (const r of OPS.hrs.days) if (r.day > h.upTo) opsNameWaves(opsClone(r.data || {})).waves?.forEach(w => (w.flights || []).forEach(f => (f.ac || []).forEach(a => {
    const L = a.log; if (!L || !L.if || opsLogMins(L) == null) return;
    for (const [n, v] of Object.entries(L.if)) { const p = o[n] || (o[n] = { sorties: [], ifs: [] }); p.ifs.push([r.day, +v[0] || 0, +v[1] || 0, +v[2] || 0]); if ((+v[1] || 0) + (+v[2] || 0) > 0) p.ifapp = cuMax(p.ifapp, r.day); }
  })));
  for (const e of hrsEntries(OPS.hrs.days)) {
    const p = o[e.name] || (o[e.name] = { sorties: [], ifs: [] });
    if (e.day > h.upTo) p.sorties.push({ day: e.day, mins: e.mins, to: e.to, ldg: e.ldg });
    p.any = cuMax(p.any, e.day);
    if (e.seat === "Front") p.front = cuMax(p.front, e.day); else p.back = cuMax(p.back, e.day);
    if (e.night) p.night = cuMax(p.night, e.day);
    if (/FCF/i.test(e.mission || "")) p.fcf = cuMax(p.fcf, e.day);
  }
  return o;
}
// Excel history (ops_state 'curhist', imported 11 Oct): "offset:hours" / "offset:h:p:np" strings from base date.
let CUR_H = null;
function curHist() {
  const r = typeof OB !== "undefined" && OB.state && OB.state.curhist; if (!r || !r.data) return { upTo: "0000", hrs: {}, if: {} };
  if (CUR_H && CUR_H.v === r.version) return CUR_H.h;
  const d = r.data, parse = str => String(str || "").split(" ").filter(Boolean).map(t => { const [o, ...v] = t.split(":"); return [cuAdd(d.base, +o), v.map(Number)]; });
  const h = { upTo: d.upTo || "0000", hrs: {}, if: {} };
  for (const [n, v] of Object.entries(d.hrs || {})) h.hrs[opsNorm(n)] = parse(v).map(([dd, x]) => [dd, x[0]]);
  for (const [n, v] of Object.entries(d.if || {})) h.if[opsNorm(n)] = parse(v);
  CUR_H = { v: r.version, h }; return h;
}
// Hours flown in a window ending now: 24 h / 48 h use the logged take-off and landing times (Z); longer windows count whole days
// including today (7, 30, 90 and 365 days), like the Excel's HRS MONITORING.
const CUR_WIN = [["24 h", "h", 24], ["48 h", "h", 48], ["7 days", "d", 7], ["30 days", "d", 30], ["3 months", "d", 90], ["12 months", "d", 365]];
function curFlownIn(x, win) {
  const [, kind, n] = win, today = todayStr(), list = (x.fl || {}).sorties || [];
  if (kind === "h") {
    const now = Date.now(), from = now - n * 36e5; let m = 0;
    for (const s of list) {
      const day = cuD(s.day), l = opsMin(s.ldg);
      const end = day + (l != null ? l : 12 * 60) * 6e4 + (l != null && opsMin(s.to) != null && opsMin(s.to) > l ? 864e5 : 0), start = end - s.mins * 6e4;
      m += Math.max(0, Math.min(end, now) - Math.max(start, from)) / 6e4;
    }
    return m / 60;
  }
  const since = cuAdd(today, -(n - 1));
  return list.filter(s => s.day >= since && s.day <= today).reduce((a, s) => a + s.mins, 0) / 60;
}
const curLimits = grp => cfgList(grp === "TR" || grp === "WSO" ? "lim.tr" : "lim.qfi");
function curLeftCell(left) {
  const [y, o, r] = cfgList("lim.warn");
  const c = left < 0 ? "bad" : left <= r ? "bad" : left <= o ? "orange" : left <= y ? "warn" : "ok";
  return c;
}
// IF monitoring: IF hours, precision and non-precision approaches in the last 91 days (Excel: TODAY()-91).
function curIf(x) {
  const since = cuAdd(todayStr(), -91), t = [0, 0, 0];
  for (const [d, h, p, np] of (x.fl || {}).ifs || []) if (d >= since) { t[0] += h; t[1] += p; t[2] += np; }
  return t;
}
// Everyone to show, by group: from the logins and roster first, then records with no login (kept in their recorded group).
function curPeople() {
  const doc = curDoc().people || {}, out = [], seen = new Set(), names = new Set();
  const add = (grp, name, extra) => { const n = opsNorm(name); if (!n || seen.has(grp + "|" + n)) return; seen.add(grp + "|" + n); names.add(n); out.push({ grp, name: n, rec: doc[n] || doc[Object.keys(doc).find(k => opsNorm(k) === n)] || {}, ...extra }); };
  const profs = (S.profiles || []).filter(p => p.display_name);
  profs.filter(p => p.role === "admin" && !["CC", "FIC"].includes(p.appointment)).sort(instrSort).forEach(p => add("QFI", p.display_name, { prof: p }));
  profs.filter(p => p.staff_role === "ST").forEach(p => add("ST", p.display_name, { prof: p }));
  profs.filter(p => p.role === "admin" && p.appointment === "FIC").forEach(p => add("FIC", p.display_name, { prof: p }));
  const rank = c => /PGF/i.test(c) ? 0 : /FWC/i.test(c) ? 1 : /WSO/i.test(c) ? 2 : 3;
  active().slice().sort((a, b) => rank(a.course || "") - rank(b.course || "") || String(a.course || "").localeCompare(String(b.course || ""), undefined, { numeric: true }) || a.name.localeCompare(b.name))
    .forEach(t => add(/PGF/i.test(t.course || "") ? "PGF" : /WSO/i.test(t.course || "") ? "WSO" : "TR", t.name, { course: t.course }));
  profs.filter(p => p.staff_role === "ATCO").forEach(p => add("ATCO", p.display_name, { prof: p }));
  // QFIs still on the instructor course appear under FIC too (as in the Excel), and records with no login keep their group.
  // Only people with a login show (Gordon, 11 Oct); a record with no login waits in the archive. QFIs still on the instructor
  // course with a fic record also show under FIC.
  for (const [k, r] of Object.entries(doc)) if (r.fic && names.has(opsNorm(k))) add("FIC", k, {});
  return out;
}
// One cell: date with its state. kind "exp" = valid until this date (red after), "expx" = first day out (red from), "info" = plain.
function curCell(date, kind, amber, done, doneLab) {
  if (date === "NA") return { t: "NA", c: "na" };
  if (!date) return { t: "–", c: "na" };
  const today = todayStr(), left = cuDays(today, date);
  let c = "ok";
  if (kind === "exp" ? left < 0 : kind === "expx" ? left <= 0 : false) c = "bad";
  else if (kind !== "info" && left <= amber) c = "warn";
  return { t: cuFmt(date), c, left, date, done, doneLab, kind };
}
const curGo = ok => ({ t: ok ? "GO" : "NO GO", c: ok ? "ok" : "bad" });
function curFlex(days) {
  if (days == null) return { t: "–", c: "na" };
  return days > 59 ? { t: "FLEX package", c: "bad" } : days > 30 ? { t: "2 × FLEX", c: "bad" } : days > 13 ? { t: "FLEX", c: "warn" } : days > 7 ? { t: "Optional flex", c: "warn" } : { t: "NIL", c: "ok" };
}
// Dates the board works out from logged sorties (per group: field → which logged date). A typed date overrides it;
// the Excel's dates sit in rec.seed as a starting point only (the later of seed and logged is used).
const CUR_AUTO = { QFI: { last: "any", night: "night", ep: "ep" }, ST: { last: "any", fcf: "fcf" }, FIC: { "fic.last": "front", "fic.lastBack": "back" }, PGF: { last: "any", ifApp: "ifapp" }, TR: { last: "front", ifApp: "ifapp" }, WSO: { last: "back" } };
function curV(x, k, grp) {
  const ov = k.split(".").reduce((o, p) => o && o[p], x.rec);
  const auto = cuMax((x.rec.seed || {})[k], (x.fl || {})[(CUR_AUTO[grp || x.grp] || {})[k] || ({ last: "any", night: "night", ep: "ep", fcf: "fcf", "fic.last": "front", "fic.lastBack": "back", ifApp: "ifapp" })[k]]);
  return ov ? { v: ov, set: true, auto } : { v: auto, set: false, auto };
}
const curVv = (x, k) => curV(x, k).v;
// The columns of each group's table: [header, (person, flown) → cell, summary label for Expired / Expiring].
function curCols(grp) {
  const am = cfgN("cur.amber"), amD = cfgN("cur.amberDay"), today = todayStr();
  const med = { h: "Medical", f: x => curGo(!String(x.rec.med || "").trim()), lab: "MED" };
  const lastF = x => curVv(x, "last");
  const irt = { h: "IRT expires", f: x => curCell(x.rec.irt ? cuEom(x.rec.irt, 12) : "", "exp", am, x.rec.irt, "IRT done"), lab: "IRT" };
  const days = d => d ? cuDays(d, today) : null;
  const ifc = { h: "IF 3 mths (h · P · NP)", f: x => { const [h, p, np] = curIf(x); return { t: `${h.toFixed(1)} · ${p} · ${np}`, c: "na" }; } };
  const noIf = { h: "Days w/o IF app", f: x => { const d = days(curVv(x, "ifApp")); return d == null ? { t: "–", c: "na" } : { t: String(d), c: "na", left: null }; } };
  if (grp === "QFI") return [med, { h: "IRT rating", f: x => ({ t: x.rec.rating || "G", c: "na" }) }, { h: "Ops CAT", f: x => ({ t: x.rec.opsCat || "-", c: "na" }) }, { h: "QFI CAT", f: x => ({ t: (x.prof && x.prof.qfi_cat) || x.rec.qfiCat || "-", c: "na" }) },
    { h: "Last flown", f: x => curCell(lastF(x), "info") }, { h: "Day expires", f: x => curCell(lastF(x) ? cuAdd(lastF(x), 31) : "", "expx", amD, lastF(x), "Last flown"), lab: "DAY CURR" }, irt,
    { h: "Night expires", f: x => x.rec.noNight ? { t: "NA", c: "na" } : curCell(curVv(x, "night") ? cuAdd(curVv(x, "night"), 91) : "", "exp", am, curVv(x, "night"), "Last night sortie"), lab: "NIGHT" },
    { h: "Day > Night", f: x => x.rec.noNight ? { t: "NA", c: "na" } : lastF(x) ? curGo(days(lastF(x)) <= 14) : { t: "–", c: "na" }, lab: "DAY>NIGHT" },
    { h: "EP sims", f: x => { const d = curVv(x, "ep"); return curCell(d ? cuAdd(d, 90) : "", "exp", am, d, "Last EP sim"); }, lab: "EP SIMS" },
    { h: "IPC done", f: x => curCell(x.rec.ipc, "info") },
    { h: "IPC expires", f: x => { const cat = (x.prof && x.prof.qfi_cat) || x.rec.qfiCat, d = x.rec.ipc; if (!d) return { t: "–", c: "na" };
      return curCell(cat === "A" ? cuEom(d, 12) : cat === "B1" ? cuEom(d, 6) : cat === "B2" ? cuEom(d, 2) : cuEdate(d, 1), "exp", am, d, "IPC done"); }, lab: "IPC" }, ifc];
  if (grp === "ST") return [med, { h: "Last flown", f: x => curCell(lastF(x), "info") }, { h: "Day expires", f: x => curCell(lastF(x) ? cuAdd(lastF(x), 31) : "", "expx", amD, lastF(x), "Last flown"), lab: "DAY CURR" }, irt,
    { h: "FCF sims prof chk", f: x => curCell(x.rec.fcfSim ? cuEdate(x.rec.fcfSim, 12) : "", "exp", am, x.rec.fcfSim, "Done"), lab: "FCF SIMS" },
    { h: "TOW prof chk", f: x => curCell(x.rec.tow ? cuEdate(x.rec.tow, 12) : "", "exp", am, x.rec.tow, "Done"), lab: "TOW CHK" },
    { h: "Last FCF flight", f: x => curCell(curVv(x, "fcf"), "info") },
    { h: "FCF flight currency", f: x => curCell(lastF(x) ? cuAdd(lastF(x), 15) : "", "exp", Math.min(amD, 5), lastF(x), "Last flown"), lab: "FCF CURR" }, ifc];
  if (grp === "FIC") return [med, { h: "Last flown", f: x => curCell(cuMax(curVv(x, "fic.last"), curVv(x, "fic.lastBack")), "info") },
    { h: "Day expires", f: x => { const d = curVv(x, "fic.last"); return curCell(d ? cuAdd(d, 31) : "", "expx", amD, d, "Last flown (front)"); }, lab: "DAY CURR" },
    { h: "Non-syllabus days", f: x => { const d = days((x.rec.fic || {}).lastSyl); return d == null ? { t: "–", c: "na" } : { t: String(d), c: d > 7 ? "warn" : "ok" }; } }, irt, ifc];
  if (grp === "PGF") return [med, { h: "Last flown", f: x => curCell(lastF(x), "info") }, { h: "Day expires (7 days)", f: x => curCell(lastF(x) ? cuAdd(lastF(x), 7) : "", "expx", 2, lastF(x), "Last flown"), lab: "DAY CURR" },
    { h: "Non-syllabus days", f: x => { const d = days(x.rec.lastSyl); return d == null ? { t: "–", c: "na" } : { t: String(d), c: "na" }; } }, irt,
    noIf, ifc];
  if (grp === "TR") return [med, { h: "IRT rating", f: x => ({ t: x.rec.rating || "W", c: "na" }) }, { h: "MOD", f: x => ({ t: x.rec.mod || "-", c: "na" }) },
    { h: "Solo expires", f: x => { const m = Number(x.rec.mod) || 0, s = x.rec.solo; return s && m ? curCell(cuAdd(s, m >= 7 ? 4 : m >= 4 ? 3 : 2), "exp", 1, s, "Last solo") : { t: "–", c: "na" }; } },
    { h: "Last flown (front)", f: x => curCell(lastF(x), "info") }, { h: "Last DCO sortie", f: x => curCell(x.rec.lastSyl, "info") },
    { h: "Non-syllabus days", f: x => { const d = days(x.rec.lastSyl); return d == null ? { t: "–", c: "na" } : { t: String(d), c: "na" }; } },
    { h: "Flex", f: x => curFlex(days(x.rec.lastSyl)), lab: "FLEX" }, irt,
    noIf, ifc];
  if (grp === "WSO") return [med, { h: "MOD", f: x => ({ t: x.rec.mod || "-", c: "na" }) }, { h: "Last flown (back)", f: x => curCell(lastF(x), "info") },
    { h: "Last DCO sortie", f: x => curCell(x.rec.lastSyl, "info") },
    { h: "Non-syllabus days", f: x => { const d = days(x.rec.lastSyl); return d == null ? { t: "–", c: "na" } : { t: String(d), c: "na" }; } },
    { h: "Flex", f: x => curFlex(days(x.rec.lastSyl)), lab: "FLEX" }];
  return [med];
}
function renderCur(v) {
  if (typeof OB === "undefined" || !OB.loaded) { v.innerHTML = `<div class="empty">Loading…</div>`; if (typeof obLoad === "function" && !OB.loading) obLoad(); return; }
  const flown = curFlown();
  if (!flown) { v.innerHTML = `<div class="empty">Loading flown sorties…</div>`; return; }
  const can = curCanEdit(), meta = typeof obMeta === "function" ? obMeta("currency") : "";
  const bar = `<div class="opsbar"><span class="seg"><button class="btn small${CUR.view === "board" ? " primary" : ""}" data-cur="view" data-k="board">Currency board</button><button class="btn small${CUR.view === "hours" ? " primary" : ""}" data-cur="view" data-k="hours">Hours limits</button><button class="btn small${CUR.view === "isatr" ? " primary" : ""}" data-cur="view" data-k="isatr">i-SATR</button><button class="btn small${CUR.view === "records" ? " primary" : ""}" data-cur="view" data-k="records">Records</button><button class="btn small${CUR.view === "archive" ? " primary" : ""}" data-cur="view" data-k="archive">Archived</button><button class="btn small${CUR.view === "rules" ? " primary" : ""}" data-cur="view" data-k="rules">How it's worked out</button></span><span class="grow"></span><span class="opsmeta">${esc(meta)}</span></div>`;
  const sims = curSims(); if (!sims) { v.innerHTML = `<div class="empty">Loading the simulator programme…</div>`; return; }
  const people = curPeople().map(x => { const y = { ...x, fl: { ...(flown[x.name] || {}) } }; if (x.grp === "QFI") y.fl.ep = isLastEp(y); return y; });
  if (CUR.view === "rules") { v.innerHTML = bar + `<section class="card opscard"><div class="opshead"><h2>How it's worked out</h2></div><ul class="cfgrules">${CUR_RULES.map(r => `<li>${esc(r)}</li>`).join("")}<li>${esc(`Amber = expiring within ${cfgN("cur.amber")} days (day currency: ${cfgN("cur.amberDay")} days; change under Operations → Settings). Red = expired or NO GO.`)}</li></ul></section>`; return; }
  if (CUR.view === "records") { v.innerHTML = bar + curRecords(people, can); return; }
  if (CUR.view === "hours") { v.innerHTML = bar + curHoursView(people); return; }
  if (CUR.view === "isatr") { v.innerHTML = bar + isView(people.filter(x => x.grp === "QFI"), can); return; }
  if (CUR.view === "archive") { v.innerHTML = bar + curArchiveView(can); return; }
  // Board: one card per group, then the Expired / Expiring summary at the top.
  const expired = {}, expiring = {};
  const cards = CUR_GROUPS.map(([g, title]) => {
    const ps = people.filter(x => x.grp === g); if (!ps.length) return "";
    const cols = curCols(g);
    const rows = ps.map(x => `<tr><td class="cuname"><b>${esc(x.name)}</b>${x.nologin ? ` <span class="hint" title="No login on the board with this name">no login</span>` : ""}${x.prof && x.prof.callsign ? ` <span class="hint">${esc(x.prof.callsign)}</span>` : ""}</td>${cols.map(c => {
      const r = c.f(x);
      if (c.lab && r.c === "bad") (expired[c.lab] ||= []).push(x.name); else if (c.lab && r.c === "warn") (expiring[c.lab] ||= []).push(x.name);
      return `<td class="cu ${r.c}"${r.left != null ? ` title="${esc([r.done ? `${r.doneLab || "Done"}: ${cuFmt(r.done)}` : "", r.kind === "info" ? `${-r.left} days ago` : r.left < 0 ? `expired ${-r.left} days ago` : `${r.left} days left`].filter(Boolean).join(" · "))}"` : ""}>${esc(r.t)}</td>`; }).join("")}</tr>`).join("");
    return `<section class="card opscard"><div class="opshead"><h2>${esc(title)}</h2><span class="opsmeta">${ps.length}</span></div><div class="tablewrap"><table class="opst cut"><thead><tr><th>Name</th>${cols.map(c => `<th>${esc(c.h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }).join("");
  for (const x of people) { if (x.grp === "ATCO") continue; const lim = curLimits(x.grp);
    CUR_WIN.forEach((w, i) => { const left = (lim[i] ?? 0) - curFlownIn(x, w), c = curLeftCell(left); if (c === "bad") (left < 0 ? (expired[`HRS ${w[0].toUpperCase()}`] ||= []) : (expiring[`HRS ${w[0].toUpperCase()}`] ||= [])).push(x.name); }); }
  const sum = (o, cls) => Object.keys(o).length ? Object.entries(o).map(([k, ns]) => `<div><b>${esc(k)}</b> – ${esc([...new Set(ns)].join(", "))}</div>`).join("") : `<div class="hint">Nil</div>`;
  const legend = `<div class="culeg"><span><i class="cusw ok"></i>Green = current</span><span><i class="cusw warn"></i>Amber = expiring within ${cfgN("cur.amber")} days (day currency ${cfgN("cur.amberDay")} days)</span><span><i class="cusw bad"></i>Red = expired / NO GO</span><span><i class="cusw na"></i>Grey = not applicable or no date yet</span></div>`;
  v.innerHTML = bar + legend + `<div class="cusum"><section class="card opscard"><div class="opshead"><h2>Items expired</h2></div><div class="cul bad">${sum(expired)}</div></section>
    <section class="card opscard"><div class="opshead"><h2>Items expiring</h2><span class="opsmeta">within ${cfgN("cur.amber")} days</span></div><div class="cul warn">${sum(expiring)}</div></section></div>${cards}
    <p class="hint">Last flown, night and FCF dates fill in from Log flown times, the last EP sim from i-SATR; a date corrected by hand under Records takes over. Hover a date to see when it was done and the days left.</p>`;
}
// Hours limits (Excel HRS MONITORING): hours left in each window = limit − flown. Colours by hours left (lim.warn).
function curHoursView(people) {
  const [y, o, r] = cfgList("lim.warn");
  const key = `<div class="culeg"><span><i class="cusw ok"></i>Green = more than ${y} h left</span><span><i class="cusw warn"></i>Amber ≤ ${y} h</span><span><i class="cusw orange"></i>Orange ≤ ${o} h</span><span><i class="cusw bad"></i>Red ≤ ${r} h or over the limit</span></div>`;
  const cards = CUR_GROUPS.filter(([g]) => g !== "ATCO").map(([g, title]) => {
    const ps = people.filter(x => x.grp === g); if (!ps.length) return "";
    const lim = curLimits(g);
    const rows = ps.map(x => `<tr><td class="cuname"><b>${esc(x.name)}</b></td>${CUR_WIN.map((w, i) => { const f = curFlownIn(x, w), left = (lim[i] ?? 0) - f;
      return `<td class="cu ${curLeftCell(left)}" title="${esc(`Flown ${f.toFixed(1)} h of ${lim[i]} h in the last ${w[0]}`)}"><b>${left < 0 ? "over " + (-left).toFixed(1) : left.toFixed(1)}</b><small class="cusub">${f.toFixed(1)} / ${lim[i]}</small></td>`; }).join("")}</tr>`).join("");
    return `<section class="card opscard"><div class="opshead"><h2>${esc(title)}</h2><span class="opsmeta">limits ${esc(lim.join(" / "))} h</span></div><div class="tablewrap"><table class="opst cut"><thead><tr><th>Name</th>${CUR_WIN.map(w => `<th>${esc(w[0])}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }).join("");
  return key + `<p class="hint" style="margin:0 0 8px">Hours left in each window (big) and hours flown / limit (small), from Log flown times (24 h / 48 h by the actual take-off and landing times, longer windows by day, including today). Before ${esc(cuFmt(curHist().upTo))} the Excel's DAILY FLOWN hours are used.</p>` + cards;
}
// Archive (Gordon, 11 Oct): when someone is posted out or their login removed, their currency record moves to data.archive
// (with the date and why), so it can be looked up or restored later. Restore = back onto the board.
const CUR_LAB = { last: "Last flown", night: "Last night sortie", irt: "IRT achieved", ipc: "Last IPC", ep: "Last EP sim", tow: "TOW prof chk", fcf: "Last FCF flight", fcfSim: "FCF sims prof chk", solo: "Last solo", lastSyl: "Last syllabus", ifApp: "Last IF app", mod: "MOD", med: "Medical", qfiCat: "QFI CAT", opsCat: "Ops CAT", rating: "IRT rating" };
function curArchiveView(can) {
  const ar = curDoc().archive || {}, ks = Object.keys(ar).sort((a, b) => String(ar[b].archivedAt).localeCompare(String(ar[a].archivedAt)) || a.localeCompare(b));
  const grpName = g => (CUR_GROUPS.find(x => x[0] === g) || [, g || "-"])[1];
  const detail = r => Object.entries({ ...(r.seed || {}), ...r }).filter(([k, v]) => CUR_LAB[k] && v !== "" && v != null && typeof v !== "object").map(([k, v]) => `${CUR_LAB[k]}: ${/^\d{4}-\d\d-\d\d$/.test(v) ? cuFmt(v) : esc(String(v))}`).join(" · ");
  return `<section class="card opscard"><div class="opshead"><h2>Archived currency records</h2><span class="opsmeta">${ks.length}</span></div>
    <p class="hint" style="margin:0 0 8px">Records move here by themselves when someone is posted out or their login is removed, so they can be checked later.${can ? " Restore puts the record back on the board (the person needs a login to show)." : ""}</p>
    ${ks.length ? `<div class="tablewrap"><table class="opst cut"><thead><tr><th>Name</th><th>Group</th><th>Archived</th><th>Why</th><th>Last record</th>${can ? "<th></th>" : ""}</tr></thead><tbody>${ks.map(k => `<tr><td class="cuname"><b>${esc(k)}</b></td><td>${esc(grpName(ar[k].grp))}</td><td>${esc(cuFmt(ar[k].archivedAt))}</td><td>${esc(ar[k].archiveWhy || "")}</td><td style="text-align:left;white-space:normal;min-width:260px">${detail(ar[k]) || "–"}</td>${can ? `<td><button class="btn small" data-cur="restore" data-k="${esc(k)}">Restore</button></td>` : ""}</tr>`).join("")}</tbody></table></div>` : `<p class="hint">Nothing archived yet.</p>`}</section>`;
}
// Move a record between people and archive, from the latest saved copy (retry once if someone saved in between).
async function curMove(name, toArchive, why) {
  for (let tries = 0; tries < 2; tries++) {
    const { data: row } = await S.sb.from("ops_state").select("*").eq("key", "currency").maybeSingle();
    if (!row) return false;
    const d = JSON.parse(JSON.stringify(row.data || {})), from = toArchive ? (d.people ||= {}) : (d.archive ||= {}), to = toArchive ? (d.archive ||= {}) : (d.people ||= {});
    const k = Object.keys(from).find(x => opsNorm(x) === opsNorm(name)); if (!k) return false;
    const r = from[k]; delete from[k];
    if (toArchive) to[k] = { ...r, archivedAt: todayStr(), archiveWhy: why || "" }; else { delete r.archivedAt; delete r.archiveWhy; to[k] = r; }
    const { data: ver, error } = await S.sb.rpc("ops_state_save", { p_key: "currency", p_data: d, p_version: row.version });
    if (!error) { if (OB.state) OB.state.currency = { ...row, data: d, version: ver, updated_at: new Date().toISOString(), updated_by: S.me.id }; return true; }
    if (!/changed/i.test(error.message)) { toast("Currency record not moved: " + errMsg(error)); return false; }
  }
  return false;
}
const curArchive = (name, why) => curCanEdit() ? curMove(name, true, why) : Promise.resolve(false);
const curRestore = name => curCanEdit() ? curMove(name, false) : Promise.resolve(false);
// Records: the dates behind the board, per group (like the Excel's DATA ENTRY). Editors type, everyone else views.
const CUR_FIELDS = {
  QFI: [["last", "Last flown", "d"], ["irt", "IRT achieved", "d"], ["night", "Last night sortie", "d"], ["noNight", "Not night qual", "c"], ["ag", "A/G qual", "c"], ["ghOnly", "GH/IF only (new QFI)", "c"], ["ipc", "Most recent IPC (FTI)", "d"], ["ep", "Last EP sim", "d"], ["rating", "IRT rating", "t"], ["opsCat", "Ops CAT", "t"], ["qfiCat", "QFI CAT (if no login)", "t"], ["med", "Medical (blank = GO)", "t"]],
  ST: [["last", "Last flown", "d"], ["irt", "IRT achieved", "d"], ["fcfSim", "FCF sims prof chk", "d"], ["tow", "TOW qual prof chk", "d"], ["fcf", "Last FCF flight", "d"], ["med", "Medical (blank = GO)", "t"]],
  FIC: [["fic.last", "Last flown (front)", "d"], ["fic.lastBack", "Last flown (back)", "d"], ["fic.lastSyl", "Last syllabus", "d"], ["irt", "IRT achieved", "d"], ["med", "Medical (blank = GO)", "t"]],
  PGF: [["last", "Last flown", "d"], ["lastSyl", "Last syllabus", "d"], ["ifApp", "Last IF app", "d"], ["irt", "IRT achieved", "d"], ["med", "Medical (blank = GO)", "t"]],
  TR: [["mod", "MOD", "t"], ["solo", "Last solo", "d"], ["last", "Last flown (front)", "d"], ["lastSyl", "Last DCO sortie", "d"], ["ifApp", "Last IF app", "d"], ["irt", "IRT achieved", "d"], ["rating", "IRT rating", "t"], ["med", "Medical (blank = GO)", "t"]],
  WSO: [["mod", "MOD", "t"], ["last", "Last flown (back)", "d"], ["lastSyl", "Last DCO sortie", "d"], ["med", "Medical (blank = GO)", "t"]],
  ATCO: [["med", "Medical (blank = GO)", "t"]],
};
const curGet = (r, k) => k.split(".").reduce((o, p) => o && o[p], r);
function curRecords(people, can) {
  const ed = CUR.edit, src = ed || curDoc().people || {};
  const recOf = n => src[n] || src[Object.keys(src).find(k => opsNorm(k) === n)] || {};
  const cards = CUR_GROUPS.map(([g, title]) => {
    const ps = people.filter(x => x.grp === g); if (!ps.length) return "";
    const fs = CUR_FIELDS[g];
    const rows = ps.map(x => { const r = recOf(x.name); return `<tr><td class="cuname"><b>${esc(x.name)}</b></td>${fs.map(([k, , t]) => {
      const v = curGet(r, k), isAuto = !!(CUR_AUTO[g] || {})[k], cv = isAuto ? curV({ ...x, rec: r }, k, g) : null;
      if (isAuto && !ed) return `<td class="${cv.set ? "cuset" : "cuauto"}" title="${cv.set ? `Set by hand (worked out: ${esc(cuFmt(cv.auto) || "none")})` : "Worked out from logged sorties"}">${esc(cuFmt(cv.v)) || "–"}${cv.set ? " ✎" : ""}</td>`;
      if (!ed) return `<td>${t === "c" ? (v ? "✓" : "") : t === "d" ? esc(cuFmt(v)) : esc(v || "")}</td>`;
      const at = `data-cuf="${esc(x.name)}|${g}|${k}"`;
      if (isAuto) return `<td><input type="date" ${at} value="${esc(v || "")}" class="${v ? "cusetin" : ""}"><small class="cuautol">${cv.auto ? "auto " + esc(cuFmt(cv.auto)) : "no sorties logged"}</small></td>`;
      return `<td>${t === "c" ? `<input type="checkbox" ${at} ${v ? "checked" : ""} style="width:auto">` : t === "d" ? `<input type="date" ${at} value="${esc(v || "")}">` : `<input ${at} value="${esc(v || "")}" style="width:${k === "med" ? "150px" : "60px"}">`}</td>`; }).join("")}</tr>`; }).join("");
    return `<section class="card opscard"><div class="opshead"><h2>${esc(title)}</h2></div><div class="tablewrap"><table class="opst cut cuedit"><thead><tr><th>Name</th>${fs.map(f => `<th>${esc(f[1])}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }).join("");
  const btns = can ? (ed ? `<button class="btn small" data-cur="cancel">Cancel</button><button class="btn small primary" data-cur="save">Save</button>` : `<button class="btn small primary" data-cur="edit">Edit records</button>`) : "";
  return `<div class="opsbar"><span class="hint">${can ? "Key in the date each item was achieved; the board works out the expiry. Last flown / night / FCF dates fill in from Log flown times and the last EP sim from i-SATR (grey); type a date only to correct one (✎), clear it to go back to automatic." : "Only currency editors can change these (Admin → Edit → Can edit currencies). Grey dates fill in from Log flown times; ✎ = corrected by hand."}</span><span class="grow"></span>${btns}</div>${cards}
    ${ed ? `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn" data-cur="cancel">Cancel</button><button class="btn primary" data-cur="save">Save</button></div>` : ""}`;
}
// ---- i-SATR (phase 3, 11 Oct; replaces the Excel's i-SATR, i-SATR Summary and DATA I-SATR sheets) ----
// Per QFI, per half-year (Jan–Jun / Jul–Dec): each item's dates done vs the number required. Dates are kept on the
// person's record (rec.isatr = { req: {item: n}, done: {item: [dates]}, skip: ["day|item"], note }), so they move with
// the record to the archive. EP sims fill in from the simulator programme (mission "EP n", aircrew seat) for days after
// data.isatrUpTo (the Excel import); a typed date on the same day isn't counted twice, ✕ on an auto one hides it.
const IS_LISTS = [
  ["L1", "List 1", [["gh", "GH / IF"], ["bfm", "BFM / ACM"], ["cap", "CAP / SWP (INT)"], ["sa", "Surface attack (BSA / ASA)"], ["sat", "SAT"], ["night", "Night flying"]]],
  ["L2", "List 2", [["ncct", "Normal CCT"], ["notef", "No TEF app"], ["seng", "Single eng app"], ["llcct", "Low level CCT"], ["ah", "AH manoeuvres"], ["spat", "Scan pattern S1–S4"], ["ua", "U/A nose high / low"], ["bfm2", "BFM / ACM off / def / neutral"], ["ti", "TI 1 v X / 2 v X"], ["vishi", "Vis delivery (hi / med angle)"], ["vislo", "Vis delivery (low angle)"], ["strafe", "Strafe"], ["eoir", "EO/IR delivery"], ["llthr", "Low level threat reaction"], ["ncctn", "Normal CCT night"], ["tin", "TI 1 v 1 night"]]],
  ["SIM", "Simulator", [["ep1", "EP 1"], ["ep2", "EP 2 (night IF qual)"], ["ep3", "EP 3"], ["ep4", "EP 4 (night IF qual)"], ["ep5", "EP 5"], ["ep6", "EP 6 (night IF qual)"], ["ep7", "EP 7"], ["ep8", "EP 8 (night IF qual)"], ["x1", "Extra (if req)"], ["x2", "Extra (if req) 2"]]],
];
const IS_ITEMS = IS_LISTS.flatMap(l => l[2].map(([k, lab]) => ({ k, lab, list: l[0] })));
// Requirements per half-year worked out from the QFI's quals (Gordon, 11 Oct: "it was supposed to be that way"):
// A/A only: List 1 GH/IF 2, BFM 2, CAP 2; List 2 the 20 A/A items. A/G qual (rec.ag, Records): List 1 GH/IF, BFM, CAP, SAT 1 each
// and surface attack 2 (1 + night flying 1 if night qual); List 2 + the 8 A/G items (28). Night qual (no "Not night qual" tick):
// List 1 + night flying 1, List 2 + the 4 night items (32; A/A + night = 24). Sims EP 1–8 once each. A number typed on the person's page (rec.isatr.req) overrides one item.
const IS_A2A = { ncct: 4, notef: 2, seng: 2, llcct: 2, ah: 1, spat: 1, ua: 3, bfm2: 3, ti: 2 }, IS_AG = { vishi: 2, vislo: 2, strafe: 2, eoir: 1, llthr: 1 }, IS_NIGHT = { ncctn: 2, tin: 2 };
// GH/IF only (rec.ghOnly, a QFI just out of FIC, cleared to instruct the fundamental sorties only; Gordon 11 Oct):
// List 1 = 6 × GH/IF; List 2 = the GH/IF block only (normal CCT … U/A, 15), + normal CCT night if night qualified.
const IS_GH = { ncct: 4, notef: 2, seng: 2, llcct: 2, ah: 1, spat: 1, ua: 3 };
function isReqAuto(rec) {
  if (rec.ghOnly) { const r = { gh: 6, ...IS_GH }; if (!rec.noNight) { r.night = 1; r.ncctn = 2; } for (let i = 1; i <= 8; i++) r["ep" + i] = 1; return r; }
  const ag = !!rec.ag, night = !rec.noNight, r = ag ? { gh: 1, bfm: 1, cap: 1, sa: night ? 1 : 2, sat: 1 } : { gh: 2, bfm: 2, cap: 2 };
  if (night) r.night = 1; // night qualified: 1 × night flying on List 1 (A/A + night confirmed by Gordon's QFI, 11 Oct)
  Object.assign(r, IS_A2A, ag ? IS_AG : {}, night ? IS_NIGHT : {});
  for (let i = 1; i <= 8; i++) r["ep" + i] = 1;
  return r;
}
function isPer(key) {
  const k = key || (todayStr().slice(0, 4) + "H" + (+todayStr().slice(5, 7) <= 6 ? 1 : 2)), y = +k.slice(0, 4), h = +k.slice(5);
  const cfgP = (curDoc().isatrCfg || {})[k] || {};
  return { key: k, start: `${y}-${h === 1 ? "01-01" : "07-01"}`, last: `${y}-${h === 1 ? "06-30" : "12-31"}`, end: cfgP.end || `${y}-${h === 1 ? "06-30" : "12-31"}`, nonFly: +cfgP.nonFly || 0,
    lab: `${h === 1 ? "JAN – JUN" : "JUL – DEC"} ${String(y).slice(2)}`, prev: h === 1 ? `${y - 1}H2` : `${y}H1`, next: h === 1 ? `${y}H2` : `${y + 1}H1` };
}
// Working days (Mon–Fri) from a to b inclusive, like the Excel's NETWORKDAYS.
function isWorkDays(a, b) { let n = 0; for (let t = cuD(a), e = cuD(b); t != null && t <= e; t += 864e5) { const w = new Date(t).getUTCDay(); if (w && w < 6) n++; } return n; }
// Simulator programme (all days after the Excel import), loaded once and refreshed when a sim section changes.
function curSims() {
  if (CUR.sims) return CUR.sims;
  if (!CUR.simsLoading) { CUR.simsLoading = true; S.sb.from("ops_sections").select("day,data").eq("section", "sim").gt("day", curDoc().isatrUpTo || "2000-01-01").order("day").then(({ data, error }) => { CUR.simsLoading = false; if (error) return toast(errMsg(error)); CUR.sims = data || []; if (S.tab === "cur") render(); }); }
  return null;
}
// EP sims from the simulator programme for one person: [{ day, k: "ep5", mission }], only sims already finished.
function isAutoEps(name) {
  const out = [], today = todayStr(), now = new Date(), zNow = now.getUTCHours() * 60 + now.getUTCMinutes(), upTo = curDoc().isatrUpTo || "";
  for (const r of CUR.sims || []) {
    if (r.day <= upTo || r.day > today) continue;
    for (const row of (r.data && r.data.rows) || []) for (const a of row.ac || []) {
      if (opsNorm(a.crew1) !== name) continue;
      const m = /\bEP\s*-?\s*([1-8])\b/i.exec(a.mission || ""); if (!m) continue;
      if (r.day === today) { const e = opsMin(row.eta || ""); if (e == null || e > zNow) continue; }
      out.push({ day: r.day, k: "ep" + m[1], mission: a.mission });
    }
  }
  return out;
}
// Everything done for one person: { item: [{ d, auto, mission }] } (all periods), typed first then auto.
function isDone(x) {
  const I = x.rec.isatr || {}, skip = new Set(I.skip || []), o = {};
  for (const [k, ds] of Object.entries(I.done || {})) o[k] = ds.map(d => ({ d }));
  for (const e of isAutoEps(x.name)) { const l = o[e.k] || (o[e.k] = []); if (skip.has(e.day + "|" + e.k) || l.some(y => y.d === e.day)) continue; l.push({ d: e.day, auto: true, mission: e.mission }); }
  for (const l of Object.values(o)) l.sort((a, b) => a.d.localeCompare(b.d));
  return o;
}
const isLastEp = x => { const o = isDone(x); return cuMax(...IS_ITEMS.filter(i => /^ep/.test(i.k)).flatMap(i => (o[i.k] || []).map(y => y.d))); };
// One person in one period: per item done (in the period) and required; per list totals and what's outstanding.
function isSum(x, P) {
  const over = (x.rec.isatr || {}).req || {}, auto = isReqAuto(x.rec), done = isDone(x), items = {}, lists = {};
  for (const it of IS_ITEMS) {
    const ds = (done[it.k] || []).filter(y => y.d >= P.start && y.d <= P.last), set = over[it.k] != null, r = set ? +over[it.k] || 0 : auto[it.k] || 0;
    items[it.k] = { ds, n: ds.length, r, set, auto: auto[it.k] || 0, owe: Math.max(0, r - ds.length) };
    const L = lists[it.list] || (lists[it.list] = { n: 0, r: 0, owe: [] });
    L.n += Math.min(ds.length, r); L.r += r; if (r > ds.length) L.owe.push(`${r - ds.length} × ${it.lab}`);
  }
  return { set: true, items, lists, overs: Object.keys(over).filter(k => over[k] != null).length };
}
function isView(people, can) {
  const P = isPer(CUR.isp), today = todayStr();
  const left = today > P.end ? 0 : Math.max(0, isWorkDays(today < P.start ? P.start : today, P.end) - P.nonFly);
  const sel = CUR.isOpen && people.find(x => x.name === CUR.isOpen);
  const pct = L => L.r ? Math.round(L.n / L.r * 100) : null;
  const cell = L => { const p = pct(L); return p == null ? `<td class="cu na">–</td>` : `<td class="cu ${p >= 100 ? "ok" : today > P.end ? "bad" : "warn"}"><b>${L.n} / ${L.r}</b><small class="cusub">${p}%</small></td>`; };
  const rows = people.map(x => { const s = isSum(x, P), cat = (x.prof && x.prof.qfi_cat) || x.rec.qfiCat || "-";
    const owe = id => s.set ? (s.lists[id].owe.length ? s.lists[id].owe.map(esc).join("<br>") : `<span class="isdone">Completed</span>`) : "";
    return `<tr class="isrow${sel === x ? " on" : ""}" data-cur="isopen" data-k="${esc(x.name)}"><td class="cuname"><b>${esc(x.name)}</b>${(x.rec.isatr || {}).note ? ` <span class="hint" title="${esc(x.rec.isatr.note)}">📝</span>` : ""}</td><td>${esc(cat)}<small class="cusub">${x.rec.ghOnly ? "GH/IF" : x.rec.ag ? "A/G" : "A/A"}${!x.rec.noNight ? " + N" : ""}</small></td>${s.set ? IS_LISTS.map(l => cell(s.lists[l[0]])).join("") : `<td class="cu na" colspan="3">Requirements not set</td>`}<td class="isowe">${owe("L1")}</td><td class="isowe">${owe("L2")}</td><td class="isowe">${owe("SIM")}</td></tr>`; }).join("");
  const tot = IS_LISTS.map(l => people.reduce((a, x) => { const s = isSum(x, P); if (s.set) { a.n += s.lists[l[0]].n; a.r += s.lists[l[0]].r; } return a; }, { n: 0, r: 0 }));
  const perBar = `<div class="opsbar"><span class="seg"><button class="btn small" data-cur="isp" data-k="${P.prev}">‹</button><b style="padding:0 8px">${esc(P.lab)}</b><button class="btn small" data-cur="isp" data-k="${P.next}">›</button>${CUR.isp ? `<button class="btn small" data-cur="isp" data-k="">This half</button>` : ""}</span><span class="grow"></span>
    <span class="isleft"><b>${left}</b> flying days remaining for i-SATR List 1 &amp; 2</span>
    ${can ? `<label class="hint">End of cycle <input type="date" data-isc="end" value="${esc(P.end)}"></label><label class="hint">Non-flying days <input type="number" min="0" data-isc="nonFly" value="${P.nonFly}" style="width:64px"></label>` : `<span class="hint">to ${esc(cuFmt(P.end))}${P.nonFly ? `, less ${P.nonFly} non-flying days` : ""}</span>`}</div>`;
  const legend = `<div class="culeg"><span><i class="cusw ok"></i>Green = all required items done</span><span><i class="cusw warn"></i>Amber = items still to do</span><span><i class="cusw bad"></i>Red = cycle ended with items not done</span><span>Tap a name to see the dates${can ? " and add or remove one" : ""}.</span></div>`;
  return perBar + legend + `<section class="card opscard"><div class="opshead"><h2>i-SATR summary</h2><span class="opsmeta">${tot.map((t, i) => `${IS_LISTS[i][1]} ${t.r ? Math.round(t.n / t.r * 100) : 0}%`).join(" · ")}</span></div>
    <div class="tablewrap"><table class="opst cut ist"><thead><tr><th>QFI</th><th>CAT</th><th>List 1</th><th>List 2</th><th>Sims</th><th>List 1 to do</th><th>List 2 to do</th><th>Sims to do</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    ${sel ? isPerson(sel, P, can) : ""}
    <p class="hint">Done counts dates in ${esc(P.lab)}; extra items above the requirement don't count towards the list %. EP sims fill in from the simulator programme (mission "EP 1" … "EP 8", aircrew seat) once the sim has ended; ✕ removes a wrong one. Dates up to ${esc(cuFmt(curDoc().isatrUpTo) || "-")} came from the Excel. The latest EP sim also sets "Last EP sim" on the currency board.</p>`;
}
function isPerson(x, P, can) {
  const s = isSum(x, P), I = x.rec.isatr || {}, nm = esc(x.name);
  const lists = IS_LISTS.map(([id, title, items]) => `<div class="isl"><h3>${esc(title)} <span class="opsmeta">${s.set ? `${s.lists[id].n} / ${s.lists[id].r}` : ""}</span></h3><table class="opst ispt"><tbody>${items.map(([k, lab]) => { const it = s.items[k], c = !s.set || !it.r ? (it.n ? "ok" : "na") : it.n >= it.r ? "ok" : todayStr() > P.end ? "bad" : "warn";
    return `<tr><td class="isit">${esc(lab)}</td><td class="cu ${c}">${it.n}${s.set ? ` / ${can ? `<input type="number" min="0" max="9" data-isr="${nm}|${k}" value="${it.set ? it.r : ""}" placeholder="${it.auto}" class="isreq${it.set ? " isover" : ""}" title="${it.set ? `Set by hand (worked out: ${it.auto}); clear to go back to automatic` : "Worked out from the quals; type a number to override"}">` : it.r}` : ""}</td><td class="isds">${it.ds.map(y => `<span class="isd${y.auto ? " auto" : ""}" title="${y.auto ? esc(`From the simulator programme: ${y.mission}`) : "Keyed in"}">${esc(cuFmt(y.d))}${can ? `<button class="isx" data-cur="isdel" data-k="${nm}|${k}|${y.d}|${y.auto ? 1 : ""}" title="Remove">✕</button>` : ""}</span>`).join("")}</td></tr>`; }).join("")}</tbody></table></div>`).join("");
  return `<section class="card opscard" id="isPerson"><div class="opshead"><h2>${nm} · ${esc(P.lab)}</h2><span class="grow"></span>${can ? `<label class="isq">Cleared for <select data-isl="${nm}"><option value="gh"${x.rec.ghOnly ? " selected" : ""}>GH/IF only (new QFI)</option><option value="aa"${!x.rec.ghOnly && !x.rec.ag ? " selected" : ""}>A/A</option><option value="ag"${!x.rec.ghOnly && x.rec.ag ? " selected" : ""}>A/A + A/G</option></select></label><label class="isq"><input type="checkbox" data-isq="${nm}|night"${!x.rec.noNight ? " checked" : ""}> Night qual</label>` : `<span class="opsmeta">${x.rec.ghOnly ? "GH/IF only" : x.rec.ag ? "A/G" : "A/A only"}${!x.rec.noNight ? " + night" : ""}</span>`}<button class="btn small" data-cur="isopen" data-k="">Close</button></div>
    <p class="hint" style="margin:0 0 8px">Required numbers are worked out from what the QFI is cleared for (GH/IF only: List 1 = 6 × GH/IF, List 2 = 15; A/A: 20; A/A + A/G: 28; night adds the night items).${s.overs ? ` Amber boxes are set by hand; clear one to go back to automatic.` : ""}</p>
    ${can ? `<div class="isaddbar"><b>Add done:</b><select id="isItem">${IS_LISTS.map(([, t, items]) => `<optgroup label="${esc(t)}">${items.map(([k, lab]) => `<option value="${k}"${CUR.isItem === k ? " selected" : ""}>${esc(lab)}</option>`).join("")}</optgroup>`).join("")}</select><input type="date" id="isDate" value="${esc(CUR.isDate || (todayStr() > P.last ? P.last : todayStr()))}"><button class="btn small primary" data-cur="isadd" data-k="${nm}">+ Done</button></div>` : ""}
    <div class="isls">${lists}</div>
    <label class="hint" style="display:block;margin-top:8px">Note (e.g. owed from last cycle) ${can ? `<input data-isn="${nm}" value="${esc(I.note || "")}" style="width:100%">` : `<div>${esc(I.note || "–")}</div>`}</label></section>`;
}
// Save one change to the latest copy of the record (retry once if someone saved in between).
async function isSave(name, fn, cfgFn) {
  for (let tries = 0; tries < 2; tries++) {
    const { data: row } = await S.sb.from("ops_state").select("*").eq("key", "currency").maybeSingle();
    const d = JSON.parse(JSON.stringify((row && row.data) || { people: {} })), ppl = d.people || (d.people = {});
    if (cfgFn) cfgFn(d); else { const k = Object.keys(ppl).find(x => opsNorm(x) === name) || name; const r = ppl[k] || (ppl[k] = { grp: "QFI" }); fn(r.isatr || (r.isatr = {}), r); }
    const { data: ver, error } = await S.sb.rpc("ops_state_save", { p_key: "currency", p_data: d, p_version: row ? row.version : 0 });
    if (!error) { OB.state.currency = { ...(row || { key: "currency" }), data: d, version: ver, updated_at: new Date().toISOString(), updated_by: S.me.id }; return true; }
    if (!/changed/i.test(error.message)) { toast("Not saved: " + errMsg(error)); return false; }
  }
  toast("Not saved: someone else saved at the same time, try again."); return false;
}
document.addEventListener("change", async e => {
  const t = e.target, ds = t.dataset || {}; if (S.tab !== "cur" || !curCanEdit()) return;
  if (ds.isr) { const [n, k] = ds.isr.split("|"), raw = t.value.trim(), v = Math.max(0, Math.min(9, parseInt(raw) || 0));
    if (await isSave(n, (I, r) => { const auto = isReqAuto(r)[k] || 0; I.req ||= {}; if (raw === "" || v === auto) delete I.req[k]; else I.req[k] = v; if (!Object.keys(I.req).length) delete I.req; })) render(); }
  else if (ds.isl) { const n = ds.isl, v = t.value; if (await isSave(n, (I, r) => { if (v === "gh") r.ghOnly = true; else delete r.ghOnly; if (v === "ag") r.ag = true; else delete r.ag; })) render(); }
  else if (ds.isq) { const [n, q] = ds.isq.split("|"), on = t.checked; if (await isSave(n, (I, r) => { if (q === "ag") { if (on) r.ag = true; else delete r.ag; } else r.noNight = !on; })) render(); }
  else if (ds.isn != null) { const n = ds.isn, v = t.value.trim(); if (await isSave(n, I => { if (v) I.note = v; else delete I.note; })) toast("Note saved."); }
  else if (ds.isc) { const P = isPer(CUR.isp), f = ds.isc, v = t.value; if (await isSave(null, null, d => { const c = (d.isatrCfg ||= {})[P.key] || (d.isatrCfg[P.key] = {}); if (f === "end") { if (v) c.end = v; else delete c.end; } else c.nonFly = Math.max(0, parseInt(v) || 0); })) render(); }
});
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-cur]"); if (!b || S.tab !== "cur") return;
  const a = b.dataset.cur, k = b.dataset.k;
  if (a === "isp") { CUR.isp = k || null; return render(); }
  if (a === "isopen") { if (e.target.closest("input,button:not([data-cur=isopen])")) return; CUR.isOpen = CUR.isOpen === k || !k ? null : k; render(); const el = $("#isPerson"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (!curCanEdit()) return;
  if (a === "isadd") { const n = k, it = ($("#isItem") || {}).value, d = ($("#isDate") || {}).value; if (!it || !d) return toast("Pick the item and the date first.");
    CUR.isItem = it; CUR.isDate = d;
    b.disabled = true; if (await isSave(n, I => { const l = ((I.done ||= {})[it] ||= []); l.push(d); l.sort(); I.skip = (I.skip || []).filter(s => s !== d + "|" + it); })) render(); return; }
  if (a === "isdel") { const [n, it, d, auto] = k.split("|"); if (!confirm(`Remove ${(IS_ITEMS.find(i => i.k === it) || {}).lab} on ${cuFmt(d)} for ${n}?`)) return;
    if (await isSave(n, I => { if (auto) { (I.skip ||= []).push(d + "|" + it); return; } const l = (I.done || {})[it] || [], i = l.indexOf(d); if (i >= 0) l.splice(i, 1); if (!l.length && I.done) delete I.done[it]; })) render(); return; }
});
document.addEventListener("input", e => {
  const k = e.target.dataset && e.target.dataset.cuf; if (!k || !CUR.edit) return;
  const [name, grp, field] = k.split("|"), r = CUR.edit[name] || (CUR.edit[name] = { grp }), val = e.target.type === "checkbox" ? e.target.checked : e.target.value.trim();
  const path = field.split("."); let o = r; for (const p of path.slice(0, -1)) o = o[p] || (o[p] = {});
  if (val === "" || val === false) delete o[path[path.length - 1]]; else o[path[path.length - 1]] = val;
});
document.addEventListener("change", e => { if (e.target.dataset && e.target.dataset.cuf && e.target.type === "checkbox") e.target.dispatchEvent(new Event("input", { bubbles: true })); });
// Phones have no hover: tapping a date shows the same "done … · days left" text.
document.addEventListener("click", e => { const td = e.target.closest(".cut td[title]"); if (td && td.title && S.tab === "cur") toast(td.closest("tr").querySelector(".cuname b").textContent + ": " + td.title); });
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-cur]"); if (!b) return;
  const a = b.dataset.cur;
  if (a === "view") { CUR.view = b.dataset.k; return render(); }
  if (a === "restore") { b.disabled = true; if (await curRestore(b.dataset.k)) toast(`${b.dataset.k} restored to the board.`); return render(); }
  if (a === "edit") { CUR.edit = JSON.parse(JSON.stringify(curDoc().people || {})); return render(); }
  if (a === "cancel") { CUR.edit = null; return render(); }
  if (a === "save") {
    const r = OB.state.currency, data = { ...curDoc(), people: CUR.edit };
    b.disabled = true;
    const { data: ver, error } = await S.sb.rpc("ops_state_save", { p_key: "currency", p_data: data, p_version: r ? r.version : 0 });
    b.disabled = false;
    if (error) { toast(errMsg(error)); if (/changed/i.test(error.message) && typeof obLoad === "function") obLoad(); return; }
    OB.state.currency = { key: "currency", data, version: ver, updated_at: new Date().toISOString(), updated_by: S.me.id };
    CUR.edit = null; toast("Records saved."); render();
  }
});
document.head.insertAdjacentHTML("beforeend", `<style>
.cusum{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:12px;margin-bottom:12px}
.cul div{padding:2px 0}.cul.bad b{color:var(--late)}.cul.warn b{color:var(--out)}
table.cut{min-width:0;width:auto}.cut th{white-space:nowrap;font-size:.78rem}.cut td{white-space:nowrap;padding:5px 8px;text-align:center}.cut td.cuname{text-align:left}
.cut td.cuname,.cut th:first-child{position:sticky;left:0;background:var(--paper);z-index:1}
.cut td.cu.ok{color:var(--ok,#1F8A4C)}.cut td.cu.warn{background:color-mix(in srgb,var(--out) 22%,transparent);font-weight:600}.cut td.cu.bad{background:color-mix(in srgb,var(--late) 25%,transparent);color:var(--late);font-weight:700}.cut td.cu.na{color:var(--muted)}.cut td.cu.orange{background:color-mix(in srgb,#e8590c 30%,transparent);font-weight:700}.cusub{display:block;font-size:.7rem;color:var(--muted);font-weight:400}.cusw.orange{background:color-mix(in srgb,#e8590c 65%,transparent)}
.cuedit input{padding:3px 6px;margin:0}.cuedit input[type=date]{width:140px}
.seg .btn+.btn{margin-left:4px}
.cut td.cuauto{color:var(--muted);font-style:italic}.cut td.cuset{color:var(--out);font-weight:600}.cuedit input.cusetin{border-color:var(--out)}.cuautol{display:block;color:var(--muted);font-size:.72rem;font-style:italic;text-align:left}
.culeg{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0 0 10px;font-size:.85rem;color:var(--muted)}.culeg span{display:inline-flex;align-items:center;gap:6px}
.cusw{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid var(--line)}.cusw.ok{background:var(--ok,#1F8A4C)}.cusw.warn{background:color-mix(in srgb,var(--out) 60%,transparent)}.cusw.bad{background:color-mix(in srgb,var(--late) 70%,transparent)}.cusw.na{background:var(--muted);opacity:.5}
.ist tr.isrow{cursor:pointer}.ist tr.isrow:hover td,.ist tr.isrow.on td{background:color-mix(in srgb,var(--accent,#2563eb) 10%,var(--paper))}.ist td.isowe{text-align:left;white-space:normal;font-size:.8rem;min-width:170px;vertical-align:top}.isdone{color:var(--ok,#1F8A4C);font-weight:600}
.isleft{margin-right:12px}.isleft b{font-size:1.3rem}.opsbar label.hint input{width:auto;margin:0 0 0 4px;padding:3px 6px}
.isls{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,430px),1fr));gap:14px}.isl h3{margin:4px 0 6px;font-size:1rem}
table.ispt{width:100%;min-width:0;table-layout:fixed}.ispt td{padding:4px 6px;vertical-align:top}.ispt td.isit{white-space:normal;width:40%}.ispt td.isds{white-space:normal}.ispt td.cu{white-space:nowrap;text-align:center;width:70px}.ispt td.cu.ok{color:var(--ok,#1F8A4C);font-weight:600}.ispt td.cu.warn{background:color-mix(in srgb,var(--out) 22%,transparent);font-weight:600}.ispt td.cu.bad{background:color-mix(in srgb,var(--late) 25%,transparent);color:var(--late);font-weight:700}.ispt td.cu.na{color:var(--muted)}
.isq{display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:.85rem}.isq input{width:auto;margin:0}.isq select{width:auto;margin:0;padding:3px 6px}.isreq.isover{border-color:var(--out);color:var(--out);font-weight:700}.isreq::placeholder{color:var(--muted);font-style:italic;opacity:1}.isreq{width:42px!important;padding:2px 4px!important;margin:0!important;display:inline-block}
.isds{font-size:.82rem}.isd{display:inline-flex;align-items:center;gap:2px;background:var(--chip,color-mix(in srgb,var(--muted) 15%,transparent));border-radius:10px;padding:1px 8px;margin:1px 3px 1px 0;white-space:nowrap}.isd.auto{font-style:italic;color:var(--muted)}
.isx{border:0;background:none;color:var(--muted);cursor:pointer;padding:0 0 0 3px;font-size:.75rem}.isaddbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px}.isaddbar select,.isaddbar input{width:auto;margin:0;padding:4px 6px}.isadd input{width:135px;padding:2px 4px;margin:0}
</style>`);
