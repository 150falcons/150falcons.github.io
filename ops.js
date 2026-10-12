/* =====================================================================
   Ops board: the daily flying programme (replaces the Excel sheet).
   Data: table ops_sections, one row per (day, section). Everyone signed in
   can view; CO / DYCO / OC A / OC B and profiles with ops_editor can edit,
   through rpc ops_save (which refuses if someone else saved in between).
   Loaded before the main script and uses its helpers at call time
   ($, esc, S, toast, ask, errMsg, who, me, active, todayStr).
   ===================================================================== */
const OPS = { day: null, rowsDay: null, rows: {}, prevDuties: null, lastDuties: null, namesOpen: false, edit: null, loading: false };
const OPS_TITLES = {
  header: "Day details", flying: "Flying program", sim: "Simulator program", ground: "Ground program",
  airfield: "Airfield restrictions", notes: "Currencies & aircraft restrictions", duties: "Duties",
};
const OPS_ORDER = ["header", "flying", "sim", "ground", "airfield", "notes", "duties"];

const opsTpl = {
  wave: night => ({ name: "", night: !!night, sxo: "", opsO: "", rmks: "", flights: [] }),
  flight: () => ({ brief: "", step: "", etd: "", eta: "", callsign: "", area: "", areaTime: "", opsAdd: false, ac: [opsTpl.ac("1"), opsTpl.ac("2")] }),
  ac: n => ({ n: n || "", crew1: "", crew2: "", mission: "", tail: "", config: "", rmks: "" }),
  sim: () => ({ etd: "", eta: "", callsign: "", ac: [opsTpl.simac("")] }),
  simac: n => ({ n: n || "", crew1: "", crew2: "", mission: "", fms: "", config: "", rmks: "" }),
  group: n => ({ name: n || "", rows: [] }),
  grow: () => ({ time: "", event: "", personnel: "", venue: "" }),
  af: () => ({ what: "", time: "" }),
  cur: () => ({ who: "", note: "" }),
  acr: () => ({ ac: "", note: "" }),
  dgroup: (n, hours) => ({ name: n || "", hours: !!hours, rows: [] }),
  drow: name => ({ name: name || "", cells: [], inTime: "", outTime: "" }),
  // People not on the standing duty list who are on today's programme (auditors, visitors…): names typed per day.
  xgroup: () => ({ name: "ADDITIONAL (AUDITORS ETC.)", extra: true, hours: false, rows: [] }),
};
const opsBlank = {
  header: () => ({ inTime: "", lateIn: "", wxBrief: "", modb: "", nightBrief: "", eowd: "", sqnSii: "", emer: "", dailyReq: "", tower: "", di: "", sdo: "", tdo: "", gym: "", plannedBy: "", vettedBy: "", currencyBy: "" }),
  flying: () => ({ waves: [] }),
  sim: () => ({ rows: [] }),
  ground: () => ({ groups: ["GROUND PROGRAM", "QFI GROUND PROGRAM"].map(opsTpl.group) }),
  airfield: () => ({ rows: [], sunset: "" }),
  notes: () => ({ currencies: [], aircraft: [] }),
  duties: () => ({ groups: [opsTpl.dgroup("QFI", true), opsTpl.dgroup("ST TOW"), opsTpl.dgroup("TRAINEES"), opsTpl.dgroup("ATCO / AOSX")] }),
};
const OPS_HEADER_FIELDS = [
  ["inTime", "In time", 3], ["lateIn", "Late in", 2], ["wxBrief", "WX/NTM brief"], ["modb", "MODB"], ["nightBrief", "Night ops brief"], ["eowd", "EOWD (end of week debrief)"],
  ["sqnSii", "SQN SII of the qtr"], ["emer", "Emer of the day"], ["dailyReq", "Daily req"], ["tower", "Tower"], ["di", "DI"],
  ["sdo", "Squadron duty officer"], ["tdo", "Trainee duty officer"], ["gym", "Gym training / SFT"],
  ["plannedBy", "Planned by"], ["vettedBy", "Vetted & approved by"], ["currencyBy", "Currency checked by"],
];

/* ---------- helpers ---------- */
const opsClone = o => JSON.parse(JSON.stringify(o));
const opsData = sec => { const r = OPS.rows[sec]; return r && r.data && Object.keys(r.data).length ? r.data : null; };
const opsGet = sec => { const d = (OPS.edit && OPS.edit.section === sec) ? OPS.edit.data : (opsData(sec) || (sec === "duties" && opsSeedDuties()) || opsBlank[sec]()); if (sec === "flying") opsNameWaves(d); return d; };
// The duty list is a standing list of the squadron's people: a day with no duties yet starts with the names
// (not the notes or times) from the latest earlier day. Additional people are added per day.
function opsSeedDuties() {
  const src = OPS.lastDuties; if (!src || !(src.groups || []).some(g => (g.rows || []).length)) return null;
  return { groups: src.groups.filter(g => !g.extra).map(g => ({ name: g.name, hours: !!g.hours, rows: (g.rows || []).map(r => opsTpl.drow(r.name)) })).concat([opsTpl.xgroup()]) };
}
// Waves are numbered by order: WAVE 1, WAVE 2… and NIGHT WAVE 1, NIGHT WAVE 2… (older data: "night" read from the name).
function opsNameWaves(fl) {
  let day = 0, night = 0;
  for (const w of fl.waves || []) {
    if (w.night === undefined) w.night = /NIGHT/i.test(w.name || "");
    w.name = w.night ? `NIGHT WAVE ${++night}` : `WAVE ${++day}`;
  }
  return fl;
}
// Flying program editing (incl. flown times) is its own permission, separate from the ops board (Gordon, 10 Oct).
const opsCommand = () => !!S.me && S.me.role === "admin" && ["CO", "DYCO", "OC A", "OC B"].includes(S.me.appointment);
const opsCanEdit = () => opsCommand() || !!(S.me && S.me.prog_editor);
const obCanBoard = () => opsCommand() || !!(S.me && S.me.ops_editor);
const opsShift = (day, n) => { const d = new Date(day + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const opsLongDay = day => new Date(day + "T12:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", weekday: "long" });
// "0725", "725", "7:25", "0725Z" -> minutes after midnight, else null. A range ("0900-1000Z") gives its start.
function opsMin(t) {
  const m = /^\s*(\d{1,2}):?(\d{2})\s*Z?\s*(?:[-–]\s*\d{1,2}:?\d{2}\s*Z?\s*)?$/i.exec(String(t ?? ""));
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
// End of a range ("0900-1000Z" -> 1000), else null.
function opsEndMin(t) { const m = /[-–]\s*(\d{1,2}:?\d{2}\s*Z?)\s*$/i.exec(String(t ?? "")); return m ? opsMin(m[1]) : null; }
const opsHM = m => m == null ? "" : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const opsSpan = (a, b) => (a == null || b == null) ? null : (b - a + 1440) % 1440;
const opsNorm = s => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const opsHas = (text, name) => { const n = opsNorm(name); return !!n && (" " + opsNorm(text) + " ").includes(" " + n + " "); };
const opsCrewHas = (a, n) => opsNorm(a.crew1) === n || opsNorm(a.crew2) === n;
// Sims: besides Aircrew / Console, people named in the remarks as "SXO: SNG J" or "SUPP: V CHIN" (the sim SXO and the
// support at the console outside) take part too (Gordon, 12 Oct). Returns "" or the role: "crew", "SXO", "SUPP"…
function opsSimRole(a, n) {
  if (opsCrewHas(a, n)) return "crew";
  for (const m of String(a.rmks || "").matchAll(/\b(SXO|SUPP|SUP|SUPPORT|CONSOLE|INSTR?)\s*:\s*([^/;\n]+)/gi))
    if (m[2].split(/,|&|\band\b/i).some(x => opsNorm(x) === n)) return m[1].toUpperCase().replace(/^SUP(PORT)?$/, "SUPP");
  return "";
}
const opsSimHas = (a, n) => !!opsSimRole(a, n);
// A/C as shown on the programme: the CFH mark comes from the Aircraft page (CFH 3 "#", CFH 2 "@"; Gordon, 10 Oct).
// For a tail on the Aircraft page any typed #/@ is replaced by its current mark; other tails show as typed. Past days keep what was typed.
function opsTail(tail, day) {
  const t = String(tail ?? "").trim(), m = /^\d{3}/.exec(t);
  if (!m || (day && day < todayStr()) || typeof OB === "undefined" || !OB.loaded) return t;
  const ac = ((OB.state.aircraft || {}).data || {}).tails || [], hit = ac.find(x => String(x.tail || "").trim().startsWith(m[0]));
  if (!hit) return t;
  return m[0] + (hit.cfh3 ? "#" : hit.cfh2 ? "@" : "") + t.slice(3).replace(/[#@]/g, "");
}
const opsLineUsed = a => !!(a.crew1 || a.crew2 || a.tail || a.mission);
// Ops add: the whole flight, or just one aircraft in it (e.g. "#1 OPS ADD"). Shown as *, not counted.
const opsIsAdd = (f, a) => !!(f.opsAdd || (a && a.opsAdd));
// Whole formation is ops add (every line ticked, or the old flight-level flag).
const opsAllAdd = f => !!f.opsAdd || ((f.ac || []).length > 0 && (f.ac || []).every(a => a.opsAdd));
const opsSimUsed = s => !!(s.etd || s.eta || s.callsign || (s.ac || []).some(opsLineUsed));
const opsMyNames = () => [me() && me().name, S.me && S.me.display_name, S.me && S.me.callsign, ...(typeof OB !== "undefined" ? obMyCrew().map(c => c.name) : [])].filter(Boolean).map(opsNorm).filter((n, i, a) => n && a.indexOf(n) === i);
// Escape, and highlight the signed-in person's name.
function opsX(v) {
  let h = esc(v);
  for (const n of opsMyNames()) {
    const re = new RegExp("(^|[^A-Za-z0-9])(" + n.split(" ").map(w => w.replace(/[^A-Z0-9]/g, "")).join("[^A-Za-z0-9]+") + ")(?=$|[^A-Za-z0-9])", "gi");
    h = h.replace(re, '$1<mark class="opsme">$2</mark>');
  }
  return h;
}
const opsNl = v => opsX(v).replace(/\n/g, "<br>");

/* ---------- derived figures ---------- */
function opsStats(fl) {
  let sorties = 0, mins = 0, first = null, last = null;
  for (const w of fl.waves || []) for (const f of w.flights || []) {
    if (f.opsAdd) continue;
    const d = opsMin(f.etd), a = opsMin(f.eta), lines = (f.ac || []).filter(x => opsLineUsed(x) && !x.opsAdd).length;
    sorties += lines;
    if (d != null && a != null) mins += lines * opsSpan(d, a);
    if (d != null && (first == null || d < first)) first = d;
    if (a != null && (last == null || a > last)) last = a;
  }
  return { sorties, hours: (mins / 60).toFixed(1), first, last, span: opsSpan(first, last) };
}
// Each wave's time window (earliest brief/step/ETD to latest ETA), used to place sims in a wave.
function opsWindows(fl) {
  return (fl.waves || []).map(w => {
    let s = null, e = null;
    for (const f of w.flights || []) {
      for (const t of [f.brief, f.step, f.etd]) { const m = opsMin(t); if (m != null && (s == null || m < s)) s = m; }
      const a = opsMin(f.eta); if (a != null && (e == null || a > e)) e = a;
    }
    return { s, e: e ?? s };
  });
}
const opsSimWave = (sim, wins) => opsTimeWave(sim.etd, wins);
// The wave whose time window (brief to last landing) a time falls in, or the nearest one.
function opsTimeWave(time, wins) {
  const t = opsMin(time); if (t == null) return -1;
  let best = -1, bd = Infinity;
  wins.forEach((w, i) => {
    if (w.s == null) return;
    const d = t >= w.s && t <= w.e ? -1 : Math.min(Math.abs(t - w.s), Math.abs(t - w.e));
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
// Short duty-table label for a ground event (as the squadron writes it on the duty sheet).
const OPS_SHORT = [[/\bTDM\b|MEETING|\bMTG\b/i, "MTG"], [/IN[- ]?BRIEF/i, "IN BRIEF"], [/\bPUBS\b/i, "PUBS"], [/INDUCTION/i, "IND"], [/\bLSS\b/i, "LSS"], [/\bACP\b/i, "ACP"]];
const opsShortEvent = ev => { const e = String(ev || "").trim(); const m = OPS_SHORT.find(([re]) => re.test(e)); return m ? m[1] : e.toUpperCase(); };
// Is this person in a ground event's personnel? Names, or a course ("203 FWC") meaning everyone on that course.
function opsGroundHas(personnel, n) {
  n = opsNorm(n); if (!n) return false;
  // whole entries only: "LIM J, TAN B" must not match "J TAN"
  const parts = String(personnel || "").split(/[,;&\/]|\bAND\b/i).map(p => opsNorm(p.replace(/\(.*?\)/g, ""))).filter(Boolean);
  if (parts.includes(n)) return true;
  const t = (typeof active === "function" ? active() : []).find(x => opsNorm(x.name) === n);
  return !!(t && t.course && parts.includes(opsNorm(t.course)));
}
// What the programme already says a person does in each wave: # (flying), (#) ops add, SXO, OPS O, SIMS,
// and ground events from the ground programme (placed in the wave whose time window they fall in; course
// ground programmes show as ACAD).
function opsAuto(name, fl, sim, ground) {
  const waves = fl.waves || [], out = waves.map(() => []), n = opsNorm(name);
  if (!n) return out;
  waves.forEach((w, i) => {
    if (opsHas(w.sxo, n)) out[i].push("SXO");
    if (opsHas(w.opsO, n)) out[i].push("OPS O");
    const f = (w.flights || []).find(f => (f.ac || []).some(a => opsCrewHas(a, n)));
    if (f) out[i].push(opsIsAdd(f, (f.ac || []).find(a => opsCrewHas(a, n))) ? "(#)" : "#");
  });
  const wins = opsWindows(fl);
  for (const s of sim.rows || []) if ((s.ac || []).some(a => opsSimHas(a, n))) {
    const i = opsSimWave(s, wins);
    if (i >= 0 && !out[i].includes("SIMS")) out[i].push("SIMS");
  }
  for (const g of (ground || opsGet("ground")).groups || []) {
    const acad = /\b(FWC|WSO|COURSE|PGF)\b/i.test(g.name || "");
    for (const r of g.rows || []) {
      if (!opsGroundHas(r.personnel, n)) continue;
      const i = opsTimeWave(r.time, wins), lab = acad ? "ACAD" : opsShortEvent(r.event);
      if (i >= 0 && lab && !out[i].includes(lab)) out[i].push(lab);
    }
  }
  return out;
}
const opsCell = (auto, manual) => [...new Set([...auto, ...(manual ? String(manual).split(/\s*\/\s*/) : [])].map(s => s.trim().toUpperCase()).filter(Boolean))].join(" / ");
// Yesterday's out time: typed in yesterday's duties, else worked out from yesterday's programme.
function opsPrevOut(groupName, name) {
  const g = ((OPS.prevDuties || {}).groups || []).find(g => opsNorm(g.name) === opsNorm(groupName));
  const r = g && (g.rows || []).find(r => opsNorm(r.name) === opsNorm(name));
  if (r && r.outTime) return r.outTime;
  const pr = OPS.prevRows || {};
  return opsAutoInOut(name, sec => (pr[sec] && Object.keys(pr[sec]).length ? pr[sec] : opsBlank[sec]())).out;
}
// In / out worked out from the programme (Gordon, 11 Oct). In = the person's first brief / step / take-off / sim /
// ground event / start of a wave they're SXO or OPS O for. Out = the latest of: flights and sims 2 h after landing /
// sim end; SXO = the wave's last landing; OPS O = the wave's last landing + 30 min; ground events = their end time
// (type the time as a range, e.g. 0900-1000Z; a single time counts as its start).
// Offsets come from Settings (duty.fly / duty.sim / duty.sxo / duty.opso).
const OPS_OUT = { get fly() { return cfgN("duty.fly"); }, get sim() { return cfgN("duty.sim"); }, get sxo() { return cfgN("duty.sxo"); }, get opsO() { return cfgN("duty.opso"); } };
function opsAutoInOut(name, get) {
  const n = opsNorm(name), st = [], en = [];
  if (!n) return { in: "", out: "" };
  const s0 = (...ts) => ts.map(opsMin).forEach(x => x != null && st.push(x));
  const e0 = (t, plus) => { const x = opsMin(t); if (x != null) en.push(x + plus); };
  const fl = opsNameWaves(opsClone(get("flying")));
  for (const w of fl.waves || []) {
    const fs = w.flights || [];
    for (const f of fs) for (const a of f.ac || []) if (opsCrewHas(a, n)) { s0(f.brief, f.step, f.etd); e0(f.eta, OPS_OUT.fly); }
    const sxo = opsHas(w.sxo, n), oo = opsHas(w.opsO, n);
    if (sxo || oo) {
      fs.forEach(f => s0(f.brief, f.step, f.etd));
      const last = Math.max(...fs.map(f => opsMin(f.eta)).filter(x => x != null));
      if (isFinite(last)) en.push(last + (oo ? OPS_OUT.opsO : OPS_OUT.sxo));
    }
  }
  for (const r of get("sim").rows || []) for (const a of r.ac || []) if (opsSimHas(a, n)) { s0(r.etd); e0(r.eta, OPS_OUT.sim); }
  for (const g of get("ground").groups || []) for (const r of g.rows || []) if (opsGroundHas(r.personnel, n)) {
    s0(r.time); const e = opsEndMin(r.time); en.push(e != null ? e : opsMin(r.time));
  }
  const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, "0") + String(m % 60).padStart(2, "0");
  const ends = en.filter(x => x != null && !isNaN(x));
  return st.length ? { in: hhmm(Math.min(...st)), out: ends.length ? hhmm(Math.max(...ends)) : "" } : { in: "", out: "" };
}
// A duty row's in / out: typed wins, else worked out (auto flags say which).
function opsInOut(r, get) {
  const a = opsAutoInOut(r.name, get || opsGet);
  return { in: r.inTime || a.in, out: r.outTime || a.out, inAuto: !r.inTime && !!a.in, outAuto: !r.outTime && !!a.out, autoIn: a.in, autoOut: a.out };
}
// QFI duty rows follow the seniority order set on Admin (view and PDF; the editor keeps the stored order).
const opsDutyRows = g => opsNorm(g.name) === "QFI" && typeof instrRank === "function" ? (g.rows || []).map((r, i) => [r, i]).sort((a, b) => instrRank(a[0].name) - instrRank(b[0].name) || a[1] - b[1]).map(x => x[0]) : (g.rows || []);
const opsWaveShort = w => String(w.name || "").replace(/^WAVE\s*/i, "W").replace(/^NIGHT WAVE$/i, "N") || "-";

/* ---------- data ---------- */
async function opsLoad(day) {
  OPS.loading = true;
  const [r1, r2] = await Promise.all([
    S.sb.from("ops_sections").select("*").eq("day", day),
    S.sb.from("ops_sections").select("section,data").eq("day", opsShift(day, -1)),
  ]);
  const r3 = await S.sb.from("ops_sections").select("data").lt("day", day).eq("section", "duties").order("day", { ascending: false }).limit(10);
  OPS.loading = false;
  if (OPS.day !== day) return;
  if (r1.error) { toast("Couldn't load the programme: " + errMsg(r1.error)); return; }
  OPS.rows = {};
  for (const r of r1.data || []) OPS.rows[r.section] = r;
  OPS.prevRows = {}; for (const r of r2.data || []) OPS.prevRows[r.section] = r.data;
  OPS.prevDuties = OPS.prevRows.duties || null;
  const ld = (r3.data || []).find(r => r.data && (r.data.groups || []).length); // skip cleared days
  OPS.lastDuties = ld ? ld.data : null;
  OPS.rowsDay = day;
  if (S.tab === "ops") renderOps($("#view")); else if (S.tab === "flytv") render();
}
// Realtime: another editor saved a section.
function opsRealtime(p) {
  const r = p.new && p.new.day ? p.new : p.old;
  if (r && r.section === "flying") { OPS.hrs = null; if (S.tab === "hours") return render(); }
  if (r && r.section === "sim" && typeof CUR !== "undefined") { CUR.sims = null; if (S.tab === "cur") return render(); }
  if (r && r.section === "flying" && r.day === OPS.day && p.new && OPS.rows.flying && p.new.version <= OPS.rows.flying.version) return; // our own save
  if (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.log) { OPS.pendingLoad = true; return; }
  if (!r || !OPS.day) return;
  if (r.day === opsShift(OPS.day, -1) && r.section === "duties") return opsLoad(OPS.day);
  if (r.day !== OPS.day) return;
  if (OPS.edit && OPS.edit.section === r.section) {
    if (p.new && p.new.version !== OPS.edit.version) toast(`${who(p.new.updated_by) || "Someone"} just saved ${OPS_TITLES[r.section]}. Your save will ask you to redo your change.`);
    return;
  }
  if (OPS.edit) { OPS.rows[r.section] = p.new; return; } // keep the editor open; other sections refresh on save
  opsLoad(OPS.day);
}

/* ---------- TV mode (Gordon, 10 Oct): today's flying lines on the left (2/3), sim and ground programme on the right ---------- */
function renderFlyTv(v) {
  document.body.classList.add("tvmode");
  if ("wakeLock" in navigator && !obWake) navigator.wakeLock.request("screen").then(l => { obWake = l; l.addEventListener("release", () => obWake = null); }).catch(() => {});
  const day = todayStr();
  if (OPS.day !== day && !OPS.edit) { OPS.day = day; OPS.rowsDay = null; }
  if (OPS.rowsDay !== OPS.day) { v.innerHTML = `<div class="empty">Loading today's programme…</div>`; if (!OPS.loading) opsLoad(OPS.day); return; }
  const fl = opsGet("flying"), st = opsStats(fl), n = new Date(), tw = opsFlyTvWaves(fl), phone = OPS.tvPhone = opsTvPhone();
  document.body.classList.toggle("tvscroll", phone); // phone: the page scrolls (TV mode otherwise locks it)
  const pane = (cls, key, title, body) => `<section class="card opscard flypane ${cls}">${title ? `<div class="opshead"><h2>${title}</h2></div>` : ""}<div class="tvpane" data-pane="${key}">${body || `<p class="hint" style="display:block;margin:0">Nothing entered.</p>`}</div></section>`;
  v.innerHTML = `<div class="tvstage${phone ? " phone" : ""}"><div class="tvbar"><b>150 Falcon Det · Flying program</b><span>${esc(opsLongDay(OPS.day))}</span>
      <span class="tvclock">${esc(n.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}L <small>${esc(n.toISOString().slice(11, 19).replace(/:/g, ""))}Z</small></span>
      <span class="grow"></span><span>${st.sorties} sorties · ${st.hours} h · first T/O ${esc(opsHM(st.first) || "-")} · last landing ${esc(opsHM(st.last) || "-")}</span>
      ${phone ? "" : `<label class="tvspd">Auto-scroll <select data-flyspd aria-label="Auto-scroll speed">${Object.keys(OPS_TV_SPEEDS).map(k => `<option value="${k}" ${k === opsTvSpeed() ? "selected" : ""}>${k[0].toUpperCase() + k.slice(1)}</option>`).join("")}</select></label>`}
      <button class="btn small" data-tab="ops">Exit TV</button></div>
    ${OPS_ORDER.some(opsData) ? `<div class="flytv"><div class="flytvl">${pane("fly", "fly", "", "")}</div>
      <div class="flytvr">${pane("sim", "sim", OPS_TITLES.sim, opsView.sim(opsGet("sim")))}${pane("gnd", "gnd", OPS_TITLES.ground, opsFlyTvGround(opsGet("ground")))}</div></div>`
      : `<div class="empty"><strong>No programme for today yet</strong></div>`}</div>`;
  // Text size is set by the ~3 waves (tw.fl); the flying window then holds every wave and scrolls within itself (Gordon, 10 Oct).
  if (phone) { // phone: every wave in the compact list, the page scrolls normally (no zoom, no fixed windows)
    const c = document.querySelector('.tvpane[data-pane="fly"]'); if (c) c.innerHTML = opsView.flyPhone(tw.all) || `<p class="hint" style="display:block;margin:0">No flights.</p>`;
    const stg = document.querySelector(".tvstage"); if (stg) stg.style.zoom = ""; return;
  }
  OPS.tvLeft = { part: opsView.flying(tw.fl, tw.n0, tw.all) || `<p class="hint" style="display:block;margin:0">No flights.</p>`, all: tw.more ? opsView.flying(tw.all) : "" };
  opsFlyTvLeft(false);
  requestAnimationFrame(opsFlyTvFit); setTimeout(opsFlyTvFit, 1200);
}
// Fill the flying window: the ~3-wave part (to size the text) or every wave.
function opsFlyTvLeft(all) {
  const c = document.querySelector('.tvpane[data-pane="fly"]'); if (!c || !OPS.tvLeft) return;
  c.innerHTML = all && OPS.tvLeft.all ? OPS.tvLeft.all : OPS.tvLeft.part;
  // Save height so everything can be shown bigger: wave remarks sit on the wave band, column headings only once.
  c.querySelectorAll(".opsrmk").forEach(r => { const w = r.previousElementSibling; if (w && w.classList.contains("opswave")) { r.classList.add("inband"); w.insertBefore(r, w.querySelector(".opswavest")); } });
  c.querySelectorAll("table.opsfly").forEach((t, i) => { if (i) t.querySelector("thead")?.remove(); });
  c.querySelectorAll(".tablewrap").forEach(w => { w.style.flexGrow = w.querySelectorAll("tbody tr").length || 1; }); // spare height shared by rows
}
// The page itself never scrolls: the flying, simulator and ground windows each scroll on their own when they hold more
// than fits, panning slowly down and back up. Scrolling one by hand (wheel / touch / click) pauses it for 20 s; a key pauses all.
const TVPANE = { st: {}, raf: 0, last: 0 };
// Auto-scroll speed picked on the TV bar (Off stops it); remembered on that screen (Gordon, 10 Oct). Down speed in px per ms, up is 3× faster.
const OPS_TV_SPEEDS = { off: 0, slow: 0.015, normal: 0.03, fast: 0.06 };
const opsTvSpeed = () => { try { const v = localStorage.getItem("flyTvSpeed"); return v in OPS_TV_SPEEDS ? v : "normal"; } catch { return "normal"; } };
document.addEventListener("change", e => {
  if (!e.target.matches || !e.target.matches("[data-flyspd]")) return;
  try { localStorage.setItem("flyTvSpeed", e.target.value); } catch {}
  for (const p of Object.values(TVPANE.st)) { p.pos = null; p.user = 0; p.pause = 0; }
  e.target.blur();
});
function opsPaneTick(t) {
  if (S.tab !== "flytv") { TVPANE.raf = 0; return; }
  const dt = Math.min(100, t - (TVPANE.last || t)); TVPANE.last = t;
  document.querySelectorAll(".flytv .tvpane").forEach(el => {
    const p = TVPANE.st[el.dataset.pane] || (TVPANE.st[el.dataset.pane] = { dir: 1, pos: null, pause: t + 6000, user: 0 });
    const max = el.scrollHeight - el.clientHeight;
    const v = OPS_TV_SPEEDS[opsTvSpeed()];
    if (!v || max <= 2 || t < p.pause || Date.now() < p.user) return;
    if (p.pos == null) p.pos = el.scrollTop;
    p.pos += p.dir * dt * (p.dir > 0 ? v : v * 3);
    if (p.pos >= max) { p.pos = max; p.dir = -1; p.pause = t + 8000; }
    if (p.pos <= 0) { p.pos = 0; p.dir = 1; p.pause = t + 10000; }
    el.scrollTop = p.pos;
  });
  TVPANE.raf = requestAnimationFrame(opsPaneTick);
}
for (const ev of ["wheel", "touchstart", "mousedown"]) addEventListener(ev, e => {
  const el = S.tab === "flytv" && e.target.closest && e.target.closest(".tvpane"); if (!el) return;
  const p = TVPANE.st[el.dataset.pane]; if (p) { p.user = Date.now() + 20000; p.pos = null; }
}, { passive: true });
addEventListener("keydown", e => { if (S.tab === "flytv" && !(e.target.matches && e.target.matches("select"))) for (const p of Object.values(TVPANE.st)) { p.user = Date.now() + 20000; p.pos = null; } });
// TV shows about 3 waves (Gordon, 10 Oct): empty waves are left out; from the first wave not yet finished, 3 waves
// (or the last 3 once the day is nearly over). Line numbers carry on from the hidden earlier waves.
const opsTvWaves = () => Math.max(1, Math.round(cfgN("tv.waves")));
function opsFlyTvWaves(fl) {
  const all = opsNameWaves(JSON.parse(JSON.stringify(fl))).waves || [];
  const used = all.filter(w => (w.flights || []).some(f => (f.ac || []).some(opsLineUsed)));
  const wins = opsWindows({ waves: used }), d = new Date(), now = d.getUTCHours() * 60 + d.getUTCMinutes();
  let i = wins.findIndex(x => x.e == null || x.e >= now); if (i < 0) i = used.length;
  const NW = opsTvWaves(); i = Math.max(0, Math.min(i, used.length - NW));
  const shown = used.slice(i, i + NW);
  let n0 = 0; for (const w of used.slice(0, i)) for (const f of w.flights || []) for (const a of f.ac || []) if (!opsIsAdd(f, a) && opsLineUsed(a)) n0++;
  const before = used.slice(0, i).map(w => w.name), after = used.slice(i + NW).map(w => w.name);
  const note = [before.length ? `Done: ${before.join(", ")}` : "", after.length ? `Later: ${after.join(", ")}` : ""].filter(Boolean).join(" · ");
  return { fl: { ...fl, waves: shown }, n0, note, more: used.length > shown.length, all: { ...fl, waves: used } };
}
// Size the text so ~3 waves fill the flying window (capped so a quiet day isn't huge), then fix the windows to the screen.
const opsTvPhone = () => Math.min(innerWidth, innerHeight) < 500;
function opsFlyTvFit() {
  if (S.tab === "flytv" && OPS.tvPhone) return;
  const g = document.querySelector(".flytv"); if (!g || S.tab !== "flytv") return obTvFit();
  const st = document.querySelector(".tvstage");
  st.classList.remove("noautofit"); g.classList.add("measure"); g.style.height = ""; opsFlyTvLeft(false);
  obTvFit();
  const cap = Math.min(innerWidth / 1920, innerHeight / 1080) * 1.15;
  if ((parseFloat(st.style.zoom) || 1) > cap) st.style.zoom = cap;
  const z = parseFloat(st.style.zoom) || 1;
  opsFlyTvLeft(true); g.classList.remove("measure");
  g.style.height = Math.max(200, innerHeight - g.getBoundingClientRect().top - 6) / z + "px";
  st.classList.add("noautofit");
  document.querySelectorAll(".flytv .tvpane").forEach(el => { const p = TVPANE.st[el.dataset.pane]; if (p && p.pos != null) el.scrollTop = p.pos; });
  if (!TVPANE.raf) TVPANE.raf = requestAnimationFrame(opsPaneTick);
}
window.addEventListener("resize", () => { if (S.tab !== "flytv") return; if (opsTvPhone() !== !!OPS.tvPhone) return render(); clearTimeout(opsFlyTvFit.t); opsFlyTvFit.t = setTimeout(opsFlyTvFit, 300); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (S.tab === "flytv") opsFlyTvFit(); });

// Ground programme for the TV: one compact table, a thin row per group.
function opsFlyTvGround(g) {
  const groups = (g.groups || []).map(x => ({ ...x, rows: (x.rows || []).filter(r => r.time || r.event || r.personnel) })).filter(x => x.rows.length);
  if (!groups.length) return "";
  return `<table class="opst flytvg"><thead><tr><th>Time</th><th>Event</th><th>Personnel</th><th>Venue</th></tr></thead><tbody>${groups.map(x =>
    `<tr class="grp"><td colspan="4">${esc(x.name || "")}</td></tr>` + x.rows.map(r => `<tr><td class="nw">${esc(r.time)}</td><td>${esc(r.event)}</td><td>${opsX(r.personnel || "")}</td><td>${esc(r.venue)}</td></tr>`).join("")).join("")}</tbody></table>`;
}

/* ---------- Flown times (Gordon, 10 Oct): after landing, ops log actual take-off / landing per aircraft line ---------- */
// Stored on the line as a.log = { to, ldg, st: "flown" | "cx" } through ops_log_flight (no version clash with the programme editor).
// "ips" = flown, but an instructor proficiency sortie: no instructional hours (Gordon, 11 Oct).
const opsFlown = L => !!L && (L.st === "flown" || L.st === "ips");
// Result of a logged line (Matthias / Gordon, 11 Oct): DCO by default once flown, DPCO / DNCO picked by ops, CX; a reason
// (Settings → Flown times, log.why) for CX / DPCO / DNCO. Saved as log.res / log.why through ops_log_res.
const OPS_RES = ["DCO", "DPCO", "DNCO"];
const opsRes = L => !L || !L.st ? "" : L.st === "cx" ? "CX" : opsFlown(L) ? (L.res || "DCO") : "";
function opsResText(a, L, withHrs) {
  const r = opsRes(L); if (!r) return "";
  if (r === "CX") return "CX" + (L.why ? " DUE " + L.why : "");
  const m = opsLogMins(L), t = (/\bIRT\b/i.test(a.mission || "") ? "IRT " : "") + r + (r !== "DCO" && L.why ? " " + L.why : "");
  return withHrs && m != null ? `${t} / ${opsHrs(m)}` : t;
}
const opsLogMins = L => { if (!opsFlown(L)) return null; const a = opsMin(L.to), b = opsMin(L.ldg); return a == null || b == null ? null : (b - a + 1440) % 1440; };
const opsHrs = m => m == null ? "" : (m / 60).toFixed(1);
const opsT4 = v => { const m = opsMin(String(v || "").replace(/[^0-9:]/g, "").replace(/^(\d{3})$/, "0$1")); return m == null ? "" : opsZ4(m); };
const opsLogLine = k => { const [w, f, a] = k.split(".").map(Number); return (((((OPS.rows.flying || {}).data || {}).waves || [])[w] || {}).flights || [])[f]?.ac?.[a] || {}; };
function opsLogCard() {
  const fl = opsGet("flying"), auto = opsInstrAuto(); let rows = "", logged = 0, lines = 0, mins = 0;
  (fl.waves || []).forEach((w, wi) => {
    let wr = "";
    (w.flights || []).forEach((f, fi) => {
      const ls = (f.ac || []).map((a, ai) => [a, ai]).filter(([a]) => opsLineUsed(a)); if (!ls.length) return;
      ls.forEach(([a, ai], k) => {
        const L = a.log || {}, key = `${wi}.${fi}.${ai}`, m = opsLogMins(L); lines++; if (L.st) logged++; if (m != null) mins += m;
        wr += `<tr class="${opsFlown(L) ? "lgok" : L.st === "cx" ? "lgcx" : ""}${k === 0 ? " lgf" : ""}">
          ${k === 0 ? `<td rowspan="${ls.length}" class="lgcs"><b>${esc(f.callsign || "-")}</b><small>${esc(f.etd || "?")}–${esc(f.eta || "?")}Z${opsAllAdd(f) ? " · ops add" : ""}</small><button class="btn small" data-ops="logplan" data-k="${wi}.${fi}">✓ As planned</button></td>` : ""}
          <td class="lgcrew">${esc(a.n || "")} <b>${opsX(a.crew1)}</b>${a.crew2 ? ` / ${opsX(a.crew2)}` : ""}<small>${esc([a.mission, opsTail(a.tail, OPS.day)].filter(Boolean).join(" · "))}${opsIsAdd(f, a) ? " · ops add" : ""}</small></td>
          <td><input data-log="to" data-k="${key}" value="${esc(L.to || "")}" placeholder="${esc(f.etd || "T/O")}" inputmode="numeric" maxlength="5" aria-label="Take-off"></td>
          <td><input data-log="ldg" data-k="${key}" value="${esc(L.ldg || "")}" placeholder="${esc(f.eta || "LDG")}" inputmode="numeric" maxlength="5" aria-label="Landing"></td>
          <td class="lghrs" data-hrs="${key}">${m != null ? opsHrs(m) : ""}</td>
          <td><input data-instr="${key}" class="${typeof L.instr === "number" ? "lgset" : ""}" value="${typeof L.instr === "number" ? opsHrs(L.instr) : ""}" placeholder="${m != null ? opsHrs(auto[key] || 0) : ""}" inputmode="decimal" maxlength="4" ${m == null ? "disabled" : ""} aria-label="Instructional hours" title="Worked out from who flew with whom; type to change (0 = none), clear to go back to the worked-out figure"></td>
          <td class="lgif">${[a.crew1, a.crew2].filter(n => opsNorm(n)).map(n => { const v = ((L.if || {})[opsNorm(n)] || []), dis = m == null ? "disabled" : "";
            return `<span class="lgifp"><small>${esc(opsNorm(n))}</small><input data-if="${key}|${esc(opsNorm(n))}|0" value="${esc(v[0] ?? "")}" placeholder="IF h" inputmode="decimal" ${dis} aria-label="IF hours ${esc(n)}"><input data-if="${key}|${esc(opsNorm(n))}|1" value="${esc(v[1] ?? "")}" placeholder="P" inputmode="numeric" ${dis} aria-label="Precision approaches ${esc(n)}"><input data-if="${key}|${esc(opsNorm(n))}|2" value="${esc(v[2] ?? "")}" placeholder="NP" inputmode="numeric" ${dis} aria-label="Non-precision approaches ${esc(n)}"></span>`; }).join("")}</td>
          <td class="lgres">${opsFlown(L) ? `<select data-res="${key}" aria-label="Result" title="Result: DCO unless changed">${OPS_RES.map(r => `<option${opsRes(L) === r ? " selected" : ""}>${r}</option>`).join("")}</select>` : L.st === "cx" ? `<b class="lgcxl">CX due</b>` : ""}${L.st === "cx" || (opsFlown(L) && L.res && L.res !== "DCO") ? `<select data-why="${key}" aria-label="Reason" title="Reason for CX / DPCO / DNCO"><option value="">Reason…</option>${[...new Set([...cfgWords("log.why"), ...(L.why ? [L.why] : [])])].map(w => `<option${L.why === w ? " selected" : ""}>${esc(w)}</option>`).join("")}</select>` : ""}</td>
          <td class="lgbtn">${opsIpsMission(a) ? `<span class="tag nd" title="Mission says IPS: no instructional hours">IPS</span>` : `<button class="btn small${L.st === "ips" ? " primary" : ""}" data-ops="logips" data-k="${key}" title="Instructor proficiency sortie: flown, but no instructional hours">IPS</button>`}<button class="btn small${L.st === "cx" ? " danger" : ""}" data-ops="logcx" data-k="${key}" title="Cancelled: no hours">CX</button>${L.st ? `<button class="btn small" data-ops="logclr" data-k="${key}" title="Clear">✕</button>` : ""}</td></tr>`;
      });
    });
    if (wr) rows += `<tr class="lgwv"><td colspan="9">${esc(w.name)}</td></tr>` + wr;
  });
  return `<section class="card opscard" id="ops-log"><div class="opshead"><h2>Flown times</h2><span class="opsmeta">${logged} of ${lines} lines logged · ${opsHrs(mins) || "0.0"} h flown <button class="btn small primary" data-ops="log">Done logging</button></span></div>
    <div class="tablewrap"><table class="opst opslog"><thead><tr><th>Flight</th><th>Aircrew</th><th>T/O (Z)</th><th>LDG (Z)</th><th>Hrs</th><th title="Instructional hours, for the Hours stats only">Instr h</th><th title="Instrument flying for the Currencies IF monitoring (per person: IF hours, precision and non-precision approaches)">IF h · P · NP</th><th title="DCO / DPCO / DNCO, and the reason for CX / DPCO / DNCO">Result · reason</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint" style="margin:6px 0 0">After landing, key in the actual take-off and landing times (Z, e.g. 0718). <b>✓ As planned</b> fills in the planned ETD / ETA for the whole flight; type over any that differ. <b>CX</b> = cancelled (no hours); pick the reason next to it. <b>Result</b> is DCO once times are keyed; change it to DPCO or DNCO and pick the reason when needed (the reasons list is under Operations → Settings → Flown times). <b>IPS</b> = flown as an instructor proficiency sortie: hours count, but no instructional hours (missions named IPS count as IPS by themselves). Both crew on a line get the hours; they add up on the <b>Hours</b> tab. <b>Instr h</b> = instructional hours for the Hours stats, worked out from who flew with whom (grey); type over it if it's wrong (0 = none), clear it to go back to the worked-out figure. <b>IF h · P · NP</b> = instrument flying hours and precision / non-precision approaches for each person on the line (leave blank if none); the Currencies tab adds them up for the 3-month IF monitoring.</p>
    <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn primary" data-ops="log">Done logging</button></div></section>`;
}
// IF hours and approaches per person on a line (Gordon, 11 Oct: keyed once, here; the Currencies IF monitoring adds them up).
// Saved as log.if = { NAME: [hours, P, NP] } through ops_log_if.
document.addEventListener("change", async e => {
  const el = e.target, d = el.dataset && el.dataset.if; if (!d) return;
  const key = d.split("|")[0], line = opsLogLine(key), out = {};
  for (const i of document.querySelectorAll(`[data-if^="${key}|"]`)) {
    const [, n, k] = i.dataset.if.split("|"), v = i.value.trim().replace(",", ".");
    if (v !== "" && !(Number(v) >= 0)) { toast("IF hours and approaches are numbers, e.g. 0.3 and 1."); return; }
    if (v !== "" && Number(v) > 0) { (out[n] ||= [0, 0, 0])[k] = Number(v); }
  }
  const [w, f, a] = key.split(".").map(Number);
  const { data, error } = await S.sb.rpc("ops_log_if", { p_day: OPS.day, p_w: w, p_f: f, p_a: a, p_crew1: line.crew1 || "", p_if: Object.keys(out).length ? out : null });
  if (error) { toast(errMsg(error)); if (/changed|no longer/i.test(error.message)) opsLoad(OPS.day); return; }
  if (line.log) { if (Object.keys(out).length) line.log.if = out; else delete line.log.if; }
  OPS.rows.flying.version = data; OPS.hrs = null;
});
document.addEventListener("change", async e => {
  const el = e.target, k = el.dataset && (el.dataset.res || el.dataset.why); if (!k) return;
  const tr = el.closest("tr"), res = tr.querySelector(`[data-res="${k}"]`), why = tr.querySelector(`[data-why="${k}"]`), line = opsLogLine(k), L = line.log || {};
  const r = L.st === "cx" || !res ? null : (res.value === "DCO" ? null : res.value), w = (L.st === "cx" || r) && why ? why.value || null : null;
  const [wi, fi, ai] = k.split(".").map(Number);
  const { data, error } = await S.sb.rpc("ops_log_res", { p_day: OPS.day, p_w: wi, p_f: fi, p_a: ai, p_crew1: line.crew1 || "", p_res: r, p_why: w });
  if (error) { toast(errMsg(error)); if (/changed|no longer/i.test(error.message)) opsLoad(OPS.day); return; }
  if (line.log) { if (r) line.log.res = r; else delete line.log.res; if (w) line.log.why = w; else delete line.log.why; }
  OPS.rows.flying.version = data;
  if (el.dataset.res) { const y = scrollY; renderOps($("#view")); scrollTo(0, y); }
});
// Worked-out instructional minutes per line (key w.f.a) for the day being logged, before any ops override.
function opsInstrAuto() { const o = {}; for (const e of hrsEntries([{ day: OPS.day, data: (OPS.rows.flying || {}).data || {} }])) o[e.k] = (o[e.k] || 0) + e.auto; return o; }
// After a time changes, refresh every line's worked-out figure (a solo trainee's landing changes the lead's) and enable / disable the boxes.
function opsInstrRefresh() { const a = opsInstrAuto();
  document.querySelectorAll("[data-instr]").forEach(i => { const m = opsLogMins(opsLogLine(i.dataset.instr).log); i.disabled = m == null; i.placeholder = m == null ? "" : opsHrs(a[i.dataset.instr] || 0); }); }
document.addEventListener("change", async e => {
  const el = e.target, k = el.dataset && el.dataset.instr; if (!k) return;
  const v = el.value.trim(), h = v === "" ? null : Number(v.replace(",", "."));
  if (v !== "" && !(h >= 0 && h <= 24)) { toast("Instructional hours as a number, e.g. 0.8 (0 = none)."); return; }
  const [w, f, a] = k.split(".").map(Number), line = opsLogLine(k), mins = h == null ? null : Math.round(h * 60);
  const { data, error } = await S.sb.rpc("ops_log_instr", { p_day: OPS.day, p_w: w, p_f: f, p_a: a, p_crew1: line.crew1 || "", p_mins: mins });
  if (error) { toast(errMsg(error)); if (/changed|no longer/i.test(error.message)) opsLoad(OPS.day); return; }
  if (line.log) { if (mins == null) delete line.log.instr; else line.log.instr = mins; }
  OPS.rows.flying.version = data; OPS.hrs = null;
  el.value = mins == null ? "" : opsHrs(mins); el.classList.toggle("lgset", mins != null);
});
async function opsLogSave(k, to, ldg, st, rerender) {
  const [w, f, a] = k.split(".").map(Number), line = opsLogLine(k);
  const { data, error } = await S.sb.rpc("ops_log_flight", { p_day: OPS.day, p_w: w, p_f: f, p_a: a, p_crew1: line.crew1 || "", p_to: to || null, p_ldg: ldg || null, p_status: st });
  if (error) { toast(errMsg(error)); if (/changed|no longer/i.test(error.message)) opsLoad(OPS.day); return false; }
  if (!st && !to && !ldg) delete line.log; else line.log = { to: to || null, ldg: ldg || null, st, ...(line.log && typeof line.log.instr === "number" ? { instr: line.log.instr } : {}), ...(line.log && line.log.if ? { if: line.log.if } : {}), ...(line.log && line.log.res ? { res: line.log.res } : {}), ...(line.log && line.log.why ? { why: line.log.why } : {}) };
  OPS.rows.flying.version = data; OPS.hrs = null;
  if (rerender) { const y = scrollY; renderOps($("#view")); scrollTo(0, y); }
  else { // update the row in place so typing carries on
    const m = opsLogMins(line.log), cell = document.querySelector(`[data-hrs="${k}"]`); if (cell) cell.textContent = m != null ? opsHrs(m) : "";
    const tr = cell && cell.closest("tr"); if (tr) { tr.classList.toggle("lgok", st === "flown" || st === "ips"); tr.classList.toggle("lgcx", st === "cx"); }
    opsInstrRefresh();
    document.querySelectorAll(`[data-if^="${k}|"]`).forEach(i => i.disabled = opsLogMins(line.log) == null);
  }
  return true;
}
async function opsLogPlanned(btn) {
  const [w, f] = btn.dataset.k.split(".").map(Number), fl = (OPS.rows.flying.data.waves[w] || {}).flights[f] || {};
  const to = opsT4(fl.etd), ldg = opsT4(fl.eta); if (!to || !ldg) return toast("This flight has no planned ETD / ETA to copy.");
  btn.disabled = true;
  for (const [a, ai] of (fl.ac || []).map((a, ai) => [a, ai]).filter(([a]) => opsLineUsed(a)))
    if (!await opsLogSave(`${w}.${f}.${ai}`, to, ldg, "flown", false)) break;
  const y = scrollY; renderOps($("#view")); scrollTo(0, y);
}
document.addEventListener("change", e => {
  const el = e.target; if (!el.dataset || !el.dataset.log) return;
  const tr = el.closest("tr"), get = n => tr.querySelector(`[data-log="${n}"]`);
  const to = opsT4(get("to").value), ldg = opsT4(get("ldg").value);
  if (el.value.trim() && !opsT4(el.value)) return toast("Times are 4 digits in Z, e.g. 0718.");
  get("to").value = to; get("ldg").value = ldg;
  const cur = (opsLogLine(el.dataset.k).log || {}).st;
  opsLogSave(el.dataset.k, to, ldg, to || ldg ? (cur === "ips" ? "ips" : "flown") : "", false);
});
document.addEventListener("focusout", () => setTimeout(() => {
  if (OPS.pendingLoad && !(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.log)) { OPS.pendingLoad = false; opsLoad(OPS.day); }
}, 300));

/* ---------- Hours tab (Gordon, 10 Oct): hours flown per person from the logged times on every day's programme ---------- */
const HRS_PERIODS = [["month", "This month"], ["lastmonth", "Last month"], ["30", "Last 30 days"], ["year", "This year"], ["all", "All time"]];
function hrsRange(p) {
  const t = todayStr(), y = +t.slice(0, 4), mo = +t.slice(5, 7), pad = n => String(n).padStart(2, "0");
  if (p === "month") return [`${y}-${pad(mo)}-01`, t];
  if (p === "lastmonth") { const ly = mo === 1 ? y - 1 : y, lm = mo === 1 ? 12 : mo - 1; return [`${ly}-${pad(lm)}-01`, `${ly}-${pad(lm)}-31`]; }
  if (p === "30") return [opsShift(t, -29), t];
  if (p === "year") return [`${y}-01-01`, t];
  return ["0000-01-01", "9999-12-31"];
}
// Who is who (Gordon, 11 Oct): from the logins first (QFI logins = instructors, ST logins = ST Tow, trainee logins /
// roster = trainees), then the Go / No-Go crew list for anyone without a login. WSO trainees = roster course with "WSO".
// IRT (instrument rating test): the back seat (second name) must be an IRE (Gordon, 11 Oct).
const opsIrtBad = a => /\bIRT\b/i.test(String(a && a.mission || "")) && !(a.crew2 && hasQual(a.crew2, "IRE"));
const OPS_IRT_MSG = "IRT: the back seat must be an IRE";
const opsIpsMission = a => /\bIPS\b/i.test(String(a && a.mission || ""));
function hrsRoles() {
  const crew = typeof OB !== "undefined" ? OB.crew || [] : [], r = {};
  for (const c of crew) { const n = opsNorm(c.name); if (n) r[n] = { grp: c.grp }; }
  for (const t of S.roster || []) { const n = opsNorm(t.name); if (!n) continue; r[n] = { ...(r[n] || {}), trainee: true, wso: /WSO/i.test(t.course || "") }; }
  for (const k in r) { const g = String(r[k].grp || "").toUpperCase(); if (g === "PGF" || g === "TRAINEES") r[k].trainee = true; r[k].instr = g === "QFI"; }
  for (const p of S.profiles || []) {
    const n = opsNorm(p.display_name); if (!n) continue;
    const x = r[n] = r[n] || {};
    if (p.role === "admin" && p.appointment === "FIC") { x.fic = true; x.instr = false; x.trainee = true; x.grp = "FIC"; } // instructor course: a QFI flying with them logs instructional
    else if (p.role === "admin" && p.appointment !== "CC") { x.instr = true; x.grp = "QFI"; x.trainee = false; }
    else if (p.staff_role === "ST") { x.grp = "ST"; x.instr = false; }
    else if (p.trainee_id) x.trainee = true;
  }
  return r;
}
// Every flown line on every day → one entry per crew member. Instructors also get instructional minutes:
//  · a trainee in the same aircraft → the whole sortie (not if the line is IPS: logged as IPS or mission says IPS);
//  · leading a solo trainee in the same flight → from the instructor's take-off to the solo trainee's landing.
//  WSO-trainee instructional minutes are also counted on their own ("WSO instr"), and are part of the instructional total.
function hrsEntries(days) {
  const out = [], R = hrsRoles(), role = n => R[opsNorm(n)] || {};
  const isTr = n => !!role(n).trainee, isIn = n => !!role(n).instr;
  for (const r of days) {
    const fl = opsNameWaves(opsClone(r.data || {}));
    (fl.waves || []).forEach((w, wi) => (w.flights || []).forEach((f, fi) => {
      const ac = f.ac || [];
      // solo trainees in this flight (one person on the line, a trainee), with their landing time
      const solos = ac.filter(a => opsLogMins(a.log) != null && opsNorm(a.crew1) && !opsNorm(a.crew2) && isTr(a.crew1)).map(a => opsMin(a.log.ldg));
      ac.forEach((a, ai) => {
        const m = opsLogMins(a.log); if (m == null) return;
        const ips = a.log.st === "ips" || opsIpsMission(a), le = [];
        [[a.crew1, a.crew2], [a.crew2, a.crew1]].forEach(([who, mate], seat) => {
          const n = opsNorm(who); if (!n) return;
          let instr = 0, wso = 0, how = "";
          if (isIn(who)) {
            if (mate && isTr(mate)) {
              if (ips) how = "IPS";
              else if (role(mate).wso && !hasQual(who, "WSO")) how = "WSO trainee, not a WSO instructor"; // only WSO instructors log WSO instruction
              else { instr = m; how = "dual"; if (role(mate).wso) wso = m; }
            }
            else if (solos.length) {
              const t0 = opsMin(a.log.to), end = Math.max(...solos);
              if (t0 != null && isFinite(end)) { instr = Math.max(0, (end - t0 + 1440) % 1440); how = "solo lead"; }
            }
          }
          le.push({ name: n, day: r.day, wave: w.name, night: !!w.night, callsign: f.callsign, ac: a.n, tail: opsTail(a.tail, r.day), mission: a.mission, mate: mate || "", seat: seat ? "Back" : "Front", to: a.log.to, ldg: a.log.ldg, mins: m, instr, wso, how, solo: !opsNorm(mate), k: `${wi}.${fi}.${ai}`, auto: instr });
        });
        // Instructional time typed by ops in Flown times (Gordon, 11 Oct) replaces the worked-out figure for this line:
        // it goes to the instructor on the line (front seat if neither / both are instructors), 0 = none.
        const set = a.log.instr;
        if (typeof set === "number" && le.length) {
          const t = le.find(e => isIn(e.name)) || le[0], hadWso = le.some(e => e.wso);
          le.forEach(e => { e.instr = e === t ? set : 0; e.wso = e === t && hadWso ? set : 0; e.how = e === t ? "set by ops" : e.how; });
        }
        out.push(...le);
      });
    }));
  }
  return out;
}
const HRS_CATS = [["instr", "Instructors (QFI)"], ["fic", "FIC (instructor course)"], ["st", "ST Tow"], ["tr", "Trainees"], ["oth", "Others / not on crew list"]];
function renderHours(v) {
  if (!OPS.hrs) {
    v.innerHTML = `<div class="empty">Loading hours…</div>`;
    if (!OPS.hrsLoading) { OPS.hrsLoading = true; S.sb.from("ops_sections").select("day,data").eq("section", "flying").order("day").then(({ data, error }) => { OPS.hrsLoading = false; if (error) return toast(errMsg(error)); OPS.hrs = { days: data || [] }; if (S.tab === "hours") render(); }); }
    return;
  }
  const per = OPS.hrsPer || "month", [from, to] = hrsRange(per), sort = OPS.hrsSort || "group";
  const ents = hrsEntries(OPS.hrs.days).filter(e => e.day >= from && e.day <= to);
  const crew = typeof OB !== "undefined" ? OB.crew || [] : [], R = hrsRoles();
  const crewOf = n => crew.find(c => opsNorm(c.name) === n);
  const catOf = n => { const x = R[n] || {}, g = String(x.grp || "").toUpperCase(); return x.fic ? "fic" : x.instr ? "instr" : g === "ST" ? "st" : x.trainee ? "tr" : "oth"; };
  const people = {};
  const blank = n => ({ name: n, sorties: 0, day: 0, night: 0, instr: 0, wso: 0, solo: 0, last: "", list: [] });
  // Everyone with a flying login (QFI except CC, ST Tow, active trainees) shows even with no hours, plus active crew-list entries.
  if (typeof obFlyers === "function") for (const f of obFlyers()) { const n = opsNorm(f.name); if (n && !people[n]) people[n] = blank(n); }
  for (const c of crew.filter(c => c.active)) { const n = opsNorm(c.name); if (n && !people[n]) people[n] = blank(n); }
  for (const e of ents) { const p = people[e.name] || (people[e.name] = blank(e.name)); p.sorties++; p[e.night ? "night" : "day"] += e.mins; p.instr += e.instr; p.wso += e.wso; if (e.solo) p.solo += e.mins; if (e.day > p.last) p.last = e.day; p.list.push(e); }
  const mine = new Set(opsMyNames()), fd = d => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const tot = p => p.day + p.night;
  // Crew list order (default, Gordon 11 Oct) = the Admin hierarchy: CO, DYCO, OC A, OC B, then QFIs by CAT A, B1, B2, C,
  // no CAT; trainees PGF, FWC, WSO, then course number; then name. "Most hours" sorts by total.
  const prof = n => (S.profiles || []).find(p => opsNorm(p.display_name) === n);
  const tr = n => (S.roster || []).find(t => opsNorm(t.name) === n);
  const rank = n => { const p = prof(n), t = tr(n), c = t ? t.course || "" : "";
    return [p && p.role === "admin" ? instrRank(n) : 9999, t ? (/PGF/i.test(c) ? 0 : /FWC/i.test(c) ? 1 : /WSO/i.test(c) ? 2 : 3) : 4, parseInt(c) || 999]; };
  const byRank = (a, b) => { const x = rank(a.name), y = rank(b.name); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return (crewOf(a.name)?.sort ?? 999) - (crewOf(b.name)?.sort ?? 999) || a.name.localeCompare(b.name); };
  const order = (a, b) => sort === "hours" ? tot(b) - tot(a) || byRank(a, b) : byRank(a, b);
  const H = m => opsHrs(m) || "0.0";
  const sections = HRS_CATS.map(([cat, title]) => {
    const list = Object.values(people).filter(p => catOf(p.name) === cat).sort(order); if (!list.length) return "";
    const isI = cat === "instr", isT = cat === "tr";
    const cols = ["Name", "Sorties", "Day", "Night", "Total h", ...(isI ? ["Instr h", "of which WSO"] : []), ...(isT ? ["Solo h"] : []), "Last flown"];
    const n = cols.length;
    const rows = list.map(p => {
      const open = OPS.hrsOpen && OPS.hrsOpen[p.name], none = !p.sorties;
      const cells = [p.sorties, H(p.day), H(p.night), `<b>${H(tot(p))}</b>`, ...(isI ? [`<b>${H(p.instr)}</b>`, H(p.wso)] : []), ...(isT ? [H(p.solo)] : [])];
      return `<tr class="hrrow${none ? " none" : ""}${mine.has(p.name) ? " me" : ""}"${none ? "" : ` data-hrs-p="${esc(p.name)}"`}><td><b>${esc(p.name)}</b>${none ? "" : ` <span class="hint">${open ? "▲" : "▼"}</span>`}</td>${cells.map(c => `<td class="n">${c}</td>`).join("")}<td class="hint">${p.last ? fd(p.last) : "–"}</td></tr>`
        + (open ? `<tr class="hrdet"><td colspan="${n}"><table class="opst"><thead><tr><th>Date</th><th>Wave</th><th>Callsign</th><th>Seat</th><th>With</th><th>Mission</th><th>A/C</th><th>T/O–LDG (Z)</th><th>Hrs</th>${isI ? "<th>Instr</th>" : ""}</tr></thead><tbody>${p.list.slice().sort((a, b) => b.day.localeCompare(a.day)).map(e => `<tr><td>${fd(e.day)}</td><td>${esc(e.wave)}</td><td>${esc([e.callsign, e.ac].filter(Boolean).join(" "))}</td><td>${e.seat}</td><td>${esc(e.mate || (e.solo ? "solo" : ""))}</td><td>${esc(e.mission)}</td><td>${esc(e.tail)}</td><td>${esc(e.to)}–${esc(e.ldg)}</td><td class="n">${opsHrs(e.mins)}</td>${isI ? `<td class="n">${e.instr ? opsHrs(e.instr) + ` <span class="hint">${esc(e.how)}${e.wso ? ", WSO" : ""}</span>` : `<span class="hint">${esc(e.how)}</span>`}</td>` : ""}</tr>`).join("")}</tbody></table></td></tr>` : "");
    }).join("");
    // Bar chart: one bar per person, length = total hours; for instructors the instructional part is the darker segment.
    const flown = list.filter(p => tot(p) > 0).sort((a, b) => tot(b) - tot(a)), max = Math.max(1, ...flown.map(tot));
    const chart = flown.length ? `<div class="hrchart" role="img" aria-label="${esc(title)}: hours flown per person">
      ${isI ? `<div class="hrleg"><span><i class="hrsw in"></i>Instructional</span><span><i class="hrsw fl"></i>Other flying</span></div>` : ""}
      ${flown.map(p => { const w = tot(p) / max * 100, wi = isI ? Math.min(p.instr, tot(p)) / max * 100 : 0;
        return `<div class="hrbar${mine.has(p.name) ? " me" : ""}" title="${esc(p.name)}: ${H(tot(p))} h${isI ? ` · instructional ${H(p.instr)} h${p.wso ? ` (WSO ${H(p.wso)})` : ""}` : ""} · ${p.sorties} sorties"><span class="hrn">${esc(p.name)}</span><span class="hrtrack"><span class="hrfill" style="width:${w}%">${wi ? `<span class="hrin" style="width:${wi / w * 100}%"></span>` : ""}</span></span><span class="hrv">${H(tot(p))}${isI && p.instr ? ` <small>(${H(p.instr)})</small>` : ""}</span></div>`; }).join("")}</div>` : "";
    const sum = list.reduce((a, p) => a + tot(p), 0), si = list.reduce((a, p) => a + p.instr, 0);
    return `<section class="card opscard"><div class="opshead"><h2>${esc(title)}</h2><span class="opsmeta">${list.length} · ${H(sum)} h flown${isI ? ` · ${H(si)} h instructional` : ""}</span></div>
      ${chart}<div class="tablewrap"><table class="opst hrst"><thead><tr>${cols.map((c, k) => `<th${k && k < n - 1 ? ' class="n"' : ""}>${c}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }).join("");
  v.innerHTML = `<div class="opsbar"><label class="hrsper">Period <select data-hrs="per">${HRS_PERIODS.map(([k, l]) => `<option value="${k}" ${k === per ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <span class="hint">${per === "all" ? "" : `${fd(from)} – ${fd(to > todayStr() ? todayStr() : to)}`}</span><span class="grow"></span>
      <button class="btn small${sort === "group" ? " primary" : ""}" data-hrs="sort" data-v="group">Crew list order</button><button class="btn small${sort === "hours" ? " primary" : ""}" data-hrs="sort" data-v="hours">Most hours</button></div>
    ${sections || `<section class="card opscard"><p class="hint">No flown times logged in this period yet. Ops log them on the Flying program with <b>Log flown times</b> after the aircrew land.</p></section>`}
    <p class="hint" style="margin:8px 0 0">From the take-off / landing times logged on each day's flying program. Both crew on a line get the hours; night waves count as night. <b>Instructional hours</b> (instructors): the whole sortie when a trainee is in the same aircraft (not when the line is IPS); when leading a solo trainee, from the instructor's take-off to the solo trainee's landing. Sorties with WSO trainees count only for instructors ticked as WSO instructor (Admin → Edit) and are also shown on their own (of which WSO). Tap a name for their sorties.</p>`;
}
document.addEventListener("click", e => {
  const r = e.target.closest("[data-hrs-p]"); if (r && S.tab === "hours") { OPS.hrsOpen = OPS.hrsOpen || {}; OPS.hrsOpen[r.dataset.hrsP] = !OPS.hrsOpen[r.dataset.hrsP]; return render(); }
  const b = e.target.closest('[data-hrs="sort"]'); if (b) { OPS.hrsSort = b.dataset.v; render(); }
});
document.addEventListener("change", e => { if (e.target.dataset && e.target.dataset.hrs === "per") { OPS.hrsPer = e.target.value; render(); } });

/* ---------- view ---------- */
function renderOps(v) {
  if (!OPS.day) OPS.day = todayStr();
  if (OPS.rowsDay !== OPS.day) {
    v.innerHTML = opsBar() + `<div class="empty">Loading the programme…</div>`;
    if (!OPS.loading) opsLoad(OPS.day);
    return;
  }
  const any = OPS_ORDER.some(opsData), canEdit = opsCanEdit();
  opsGet("flying");
  let html = opsBar() + `<h2 class="opstitle">150 Squadron flying program<span>${esc(opsLongDay(OPS.day))}</span></h2>`;
  if (!any && !OPS.edit) {
    html += `<div class="empty"><strong>No programme for this day yet</strong>${canEdit
      ? `Start from another day's programme, or fill in each section below.<div style="margin-top:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn primary" data-ops="copy">Copy from another day</button></div>`
      : "Check back later."}</div>`;
    if (!canEdit) { v.innerHTML = html; return; }
  }
  const h = opsGet("header");
  if (any && !h.vettedBy && !OPS.edit) html += `<div class="opsbanner">Not yet vetted &amp; approved. This programme may still change.</div>`;
  if (OPS.edit) { html += opsMyDay(); for (const sec of OPS_ORDER) html += opsSection(sec, canEdit); }
  else { // wide screens: pairs side by side so the page width is used; the flying program and duties stay full width
    const pair = (...xs) => `<div class="opsrow">${xs.join("")}</div>`, s = sec => opsSection(sec, canEdit);
    html += opsMyDay() + s("header") + (OPS.logOpen && canEdit && opsData("flying") ? opsLogCard() : "") + s("flying") + pair(s("sim"), s("ground")) + pair(s("airfield"), s("notes")) + s("duties");
  }
  v.innerHTML = html;
  const d = $("#opsDate"); if (d) d.onchange = e => { if (e.target.value) opsGo(e.target.value); };
}
// Toolbar in labelled groups (Gordon, 11 Oct "arrange this properly"): Day · Edit · Print · Display.
function opsBar() {
  const here = OPS.rowsDay === OPS.day, fly = here && opsData("flying"), can = opsCanEdit();
  const grp = (label, body) => body ? `<div class="opsgrp"><span class="opsgrpl">${label}</span><div class="opsgrpb">${body}</div></div>` : "";
  const edit = can ? [
    fly && !OPS.edit ? `<button class="btn small${OPS.logOpen ? " primary" : ""}" data-ops="log">${OPS.logOpen ? "Done logging" : "Log flown times"}</button>` : "",
    `<button class="btn small" data-ops="copy">Copy from…</button>`,
    here && OPS_ORDER.some(opsData) && !OPS.edit ? `<button class="btn small danger" data-ops="clear">Clear day</button>` : ""].join("") : "";
  const print = `<button class="btn small" data-ops="pdf" title="Daily programme to send out">Daily PDF</button>${fly ? `<button class="btn small" data-ops="pdfeod" title="End-of-day copy with flown times, for filing">End of day PDF</button>` : ""}${here && OPS_ORDER.some(opsData) && !OPS.edit ? `<button class="btn small attbtn" data-ops="att" title="Who should be at the Ops brief / WX-NOTAM / EOWD, and who's away">Attendance</button>` : ""}`;
  return `<div class="opsbar grp">
    ${grp("Day", `<button class="btn small" data-ops="day" data-n="-1" aria-label="Previous day">‹</button><input type="date" id="opsDate" value="${esc(OPS.day)}"><button class="btn small" data-ops="day" data-n="1" aria-label="Next day">›</button><button class="btn small" data-ops="today">Today</button>`)}
    <span class="grow"></span>
    ${grp("Edit", edit)}${grp("Print", print)}${OPS.edit ? "" : grp("Display", `<button class="btn small primary" data-tab="flytv">TV mode</button>`)}</div>`;
}
function opsGo(day) {
  if (OPS.edit && !confirm("Discard your unsaved changes?")) { const d = $("#opsDate"); if (d) d.value = OPS.day; return; }
  OPS.edit = null; OPS.day = day; OPS.rowsDay = null; renderOps($("#view"));
}
function opsSection(sec, canEdit) {
  const r = OPS.rows[sec], editing = OPS.edit && OPS.edit.section === sec;
  const meta = r && r.updated_at ? `Updated ${new Date(r.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${r.updated_by ? " by " + esc(who(r.updated_by)) : ""}` : "";
  const body = editing ? opsEditor(sec) : opsView[sec](opsGet(sec));
  if (!editing && !body && !canEdit) return "";
  return `<section class="card opscard" id="ops-${sec}"><div class="opshead"><h2>${OPS_TITLES[sec]}</h2>
    <span class="opsmeta">${meta}${canEdit && !editing && !OPS.edit ? ` <button class="btn small" data-ops="edit" data-sec="${sec}">Edit</button>` : ""}${editing ? ` <button class="btn small" data-ops="cancel">Cancel</button><button class="btn small primary" data-ops="save">Save</button>` : ""}</span></div>
    ${body || `<p class="hint" style="margin:0">Nothing entered.</p>`}</section>`;
}
// Everything on today's programme for the signed-in person.
function opsMyDay() {
  const items = opsMyItems(opsGet);
  if (!items.length) return "";
  return `<section class="card opscard opsmine"><div class="opshead"><h2>Your day</h2></div><ul>${items.join("")}</ul></section>`;
}
// The signed-in person's lines on a day's programme (get = section → data), as <li> items. Used by "Your day" and the home dashboard.
// opts.now (Z minutes) greys out finished lines; opts.noDuty leaves SXO / OPS O out (the home card shows them on their own row).
function opsMyItems(get, opts) {
  const names = opsMyNames(); if (!names.length) return [];
  const opsGet = get, o = opts || {};
  const li = end => o.now != null && end != null && end < o.now ? `<li class="done">` : `<li>`;
  const fl = opsNameWaves(opsGet("flying")), sim = opsGet("sim"), items = [];
  for (const w of fl.waves || []) for (const f of w.flights || []) for (const a of f.ac || []) {
    const n = names.find(n => opsCrewHas(a, n)); if (!n) continue;
    const mate = opsNorm(a.crew1) === n ? a.crew2 : a.crew1;
    items.push(`${li(opsMin(f.eta))}<b>${esc(w.name)}</b> ${esc(f.etd)}–${esc(f.eta)}Z · ${esc([f.callsign, a.n].filter(Boolean).join(" "))} · ${esc(a.mission)}${mate ? " with " + esc(mate) : ""}${a.tail ? " · " + esc(opsTail(a.tail)) : ""}${f.area ? " · " + esc(f.area) : ""}${opsIsAdd(f, a) ? " <em>(ops add)</em>" : ""}</li>`);
  }
  for (const s of sim.rows || []) for (const a of s.ac || []) {
    const n = names.find(n => opsSimHas(a, n)); if (!n) continue;
    const role = opsSimRole(a, n), mate = role !== "crew" ? [a.crew1, a.crew2].filter(Boolean).join(" / ") : opsNorm(a.crew1) === n ? a.crew2 : a.crew1;
    items.push(`${li(opsMin(s.eta))}<b>SIM${role !== "crew" ? " " + esc(role) : ""}</b> ${esc(s.etd)}–${esc(s.eta)}Z · ${esc([s.callsign, a.n].filter(Boolean).join(" "))} · ${esc(a.mission)}${mate ? (role !== "crew" ? " for " : " with ") + esc(mate) : ""}</li>`);
  }
  for (const g of opsGet("ground").groups || []) for (const r of g.rows || [])
    if (names.some(n => opsGroundHas(r.personnel, n))) items.push(`${li(opsMin(r.time))}<b>${esc(r.time)}</b> ${esc(r.event)}${r.venue ? " · " + esc(r.venue) : ""}</li>`);
  if (!o.noDuty) (fl.waves || []).forEach(w => {
    if (names.some(n => opsHas(w.sxo, n))) items.push(`<li><b>${esc(w.name)}</b> SXO</li>`);
    if (names.some(n => opsHas(w.opsO, n))) items.push(`<li><b>${esc(w.name)}</b> OPS O</li>`);
  });
  for (const g of opsGet("duties").groups || []) for (const r of g.rows || [])
    if (names.includes(opsNorm(r.name))) {
      const notes = (r.cells || []).map((c, i) => c && (fl.waves[i] ? fl.waves[i].name : "") + ": " + c).filter(Boolean);
      if (notes.length) items.push(`<li>${esc(notes.join(" · "))}</li>`);
    }
  return items;
}
// The signed-in person's timed events on a day (Z minutes), for the home card's "Next up":
/* ---------- Datalink channels and flight-line vehicles per formation (Gordon, 11 Oct) ---------- */
// f.dl = "A" | "B" | "C" | "D" (blank = none). f.veh = "VAN" | "ZOE" typed by ops, blank = worked out by opsPlan.
const OPS_DL = ["A", "B", "C", "D"], OPS_VEH = ["VAN", "ZOE"];
const opsStepMin = f => { const s = opsMin(f.step); if (s != null) return s; const e = opsMin(f.etd); return e == null ? null : e - cfgN("fly.step"); };
const opsFltPeople = f => [...new Set((f.ac || []).flatMap(a => [a.crew1, a.crew2]).map(opsNorm).filter(Boolean))].length;
const opsFltAc = f => (f.ac || []).filter(opsLineUsed).length;
// Works out, for every formation of the day, its vehicle and any warnings. Returns { "wi.fi": { veh, auto, people, warn: [], dl, dlWarn } }.
//  · Formations stepping within veh.share min of the first one in a van run share it while seats last (veh.van); each run is
//    numbered per wave (VAN 1, VAN 2 …). The van can start a new run veh.turn min after the last one left.
//  · Van still out → the ZOE (veh.zoe seats, veh.zoeMax squeezed), driven by the crew and parked at the flight line until they
//    land: busy until ETA + veh.zoeBack. If the ZOE is out too, the formation still gets the next van run, with a warning.
//  · Datalink: aircraft on the same channel whose ETD–ETA overlap this formation's; more than dl.max → warning (not blocked).
function opsPlan(fl) {
  const out = {}, list = [], byF = new Map(); Object.defineProperty(out, "byF", { value: byF });
  (fl.waves || []).forEach((w, wi) => (w.flights || []).forEach((f, fi) => {
    const k = `${wi}.${fi}`, people = opsFltPeople(f);
    out[k] = { veh: "", auto: true, people, warn: [], dl: OPS_DL.includes(f.dl) ? f.dl : "", dlWarn: "" }; byF.set(f, out[k]);
    const t = opsStepMin(f); if (t != null && people) list.push({ k, wi, f, t, people });
  }));
  list.sort((a, b) => a.t - b.t);
  const VAN = cfgN("veh.van"), ZOE = cfgN("veh.zoe"), ZMAX = cfgN("veh.zoeMax"), SHARE = cfgN("veh.share"), TURN = cfgN("veh.turn"), ZBACK = cfgN("veh.zoeBack");
  const runs = {}; let run = null, vanFree = -1e9, zoeFree = -1e9, zoeWith = "";
  const z4 = m => opsZ4(((m % 1440) + 1440) % 1440) + "Z";
  const newRun = x => { const wr = runs[x.wi] = (runs[x.wi] || 0) + 1; if (x.t < vanFree) out[x.k].warn.push(`van still out on its last run (back about ${z4(vanFree)})`); run = { wi: x.wi, n: wr, t: x.t, seats: 0 }; vanFree = x.t + TURN; };
  for (const x of list) {
    const o = out[x.k], typed = OPS_VEH.includes(x.f.veh) ? x.f.veh : "";
    o.auto = !typed;
    const canJoin = run && run.wi === x.wi && x.t - run.t <= SHARE && run.seats + x.people <= VAN;
    let use = typed;
    if (!use) use = canJoin || x.t >= vanFree ? "VAN" : x.t >= zoeFree && x.people <= ZMAX ? "ZOE" : "VAN";
    if (use === "VAN") {
      if (!(run && run.wi === x.wi && x.t - run.t <= SHARE)) newRun(x);
      else if (run.seats + x.people > VAN) { if (typed) o.warn.push(`van over ${VAN} seats`); else newRun(x); }
      run.seats += x.people; o.veh = `VAN ${run.n}`;
    } else {
      if (x.t < zoeFree) o.warn.push(`ZOE still at the flight line with ${zoeWith} (free about ${z4(zoeFree)})`);
      if (x.people > ZMAX) o.warn.push(`${x.people} people: ZOE seats ${ZMAX} at most`);
      else if (x.people > ZOE) o.warn.push(`${x.people} people in the ZOE (squeezed)`);
      const eta = opsMin(x.f.eta); zoeFree = (eta != null ? eta : x.t + 60 + cfgN("fly.step")) + ZBACK; zoeWith = x.f.callsign || "another formation";
      o.veh = "ZOE";
    }
  }
  // Datalink: count aircraft on the same channel airborne at the same time as each formation.
  const fls = []; (fl.waves || []).forEach((w, wi) => (w.flights || []).forEach((f, fi) => { const s0 = opsMin(f.etd), e0 = opsMin(f.eta); if (OPS_DL.includes(f.dl) && s0 != null) fls.push({ k: `${wi}.${fi}`, dl: f.dl, s: s0, e: e0 != null ? e0 : s0 + 60, n: opsFltAc(f) }); }));
  const MAXDL = cfgN("dl.max");
  for (const a of fls) { const n = fls.filter(b => b.dl === a.dl && b.s < a.e && a.s < b.e).reduce((t, b) => t + b.n, 0); if (n > MAXDL) out[a.k].dlWarn = `${n} aircraft on DL ${a.dl} at the same time (more than ${MAXDL})`; }
  return out;
}
// One formation's DL / vehicle as small lines for the views (flying program, TV, Aircraft this wave).
function opsPlanTags(p) {
  if (!p) return "";
  return [p.dl ? `<span class="opsdl${p.dlWarn ? " bad" : ""}" title="${esc(p.dlWarn || "Datalink channel")}">DL ${esc(p.dl)}</span>` : "",
    p.veh ? `<span class="opsveh${p.warn.length ? " bad" : ""}" title="${esc(p.warn.join("; ") || (p.auto ? "Worked out" : "Set by ops"))}">${esc(p.veh)}</span>` : ""].filter(Boolean).join("");
}
// brief / step / take-off for their flights, sim start, ground events, and the start of a wave they are SXO / OPS O for.
function opsMyEvents(get) {
  const names = opsMyNames(); if (!names.length) return [];
  const fl = opsNameWaves(get("flying")), out = [], add = (t, label) => { const m = opsMin(t); if (m != null) out.push({ t: m, label }); }, plan = opsPlan(fl);
  for (const [wi, w] of (fl.waves || []).entries()) {
    for (const [fi, f] of (w.flights || []).entries()) for (const a of f.ac || []) {
      if (!names.some(n => opsCrewHas(a, n))) continue;
      const cs = esc([f.callsign, a.n].filter(Boolean).join(" ")), wn = esc(w.name);
      if (f.brief && f.brief !== "NA") add(f.brief, `Brief · <b>${wn}</b> ${cs}`);
      if (f.step && f.step !== "NA") { const pv = plan[`${wi}.${fi}`] || {}; add(f.step, `Step · <b>${wn}</b> ${cs}${pv.veh ? ` · <b>${esc(pv.veh)}</b>` : ""}${pv.dl ? ` · DL ${esc(pv.dl)}` : ""}`); }
      add(f.etd, `Take-off · <b>${wn}</b> ${cs}${a.tail ? " · " + esc(opsTail(a.tail)) : ""}`);
    }
    const duty = [names.some(n => opsHas(w.sxo, n)) && "SXO", names.some(n => opsHas(w.opsO, n)) && "OPS O"].filter(Boolean);
    if (duty.length) {
      const ts = (w.flights || []).flatMap(f => [f.brief, f.step, f.etd].map(opsMin)).filter(x => x != null);
      if (ts.length) out.push({ t: Math.min(...ts), label: `${duty.join(" + ")} · <b>${esc(w.name)}</b>` });
    }
  }
  for (const s of get("sim").rows || []) for (const a of s.ac || []) if (names.some(n => opsSimHas(a, n))) { const r = opsSimRole(a, names.find(n => opsSimHas(a, n))); add(s.etd, `Sim${r !== "crew" ? " " + esc(r) : ""} · ${esc([s.callsign, a.n].filter(Boolean).join(" "))} ${esc(a.mission || "")}`); }
  for (const g of get("ground").groups || []) for (const r of g.rows || []) if (names.some(n => opsGroundHas(r.personnel, n))) add(r.time, `${esc(r.event)}${r.venue ? " · " + esc(r.venue) : ""}`);
  return out.sort((a, b) => a.t - b.t);
}
// The signed-in person's SXO / OPS O duties on a day: ["WAVE 1 SXO", …].
function opsMyDuties(get) {
  const names = opsMyNames(), fl = opsNameWaves(get("flying")), out = [];
  for (const w of fl.waves || []) {
    if (names.some(n => opsHas(w.sxo, n))) out.push(`${w.name} SXO`);
    if (names.some(n => opsHas(w.opsO, n))) out.push(`${w.name} OPS O`);
  }
  return out;
}
// Tails the signed-in person flies on a day (with now = Z minutes: only flights not yet landed).
function opsMyTails(get, now) {
  const names = opsMyNames(), fl = get("flying"), out = [];
  for (const w of fl.waves || []) for (const f of w.flights || []) for (const a of f.ac || []) {
    const end = opsMin(f.eta);
    if (now != null && end != null && end < now) continue;
    if (a.tail && names.some(n => opsCrewHas(a, n))) out.push(String(a.tail).trim());
  }
  const k = t => t.replace(/[#@\s]/g, "");
  return out.filter((t, i) => out.findIndex(x => k(x) === k(t)) === i); // as written (keeps # / @), one per tail
}
const opsView = {
  header(h) {
    const fl = opsGet("flying"), st = opsStats(fl);
    const stats = `<div class="opsstats">
      <div><b>${esc(h.dailyReq || "-")}</b><span>Daily req</span></div><div><b>${st.sorties}</b><span>Planned sorties</span></div>
      <div><b>${st.hours}</b><span>Planned hours</span></div><div><b>${opsHM(st.first) || "-"}</b><span>First takeoff</span></div>
      <div><b>${opsHM(st.last) || "-"}</b><span>Last landing</span></div><div><b>${opsHM(st.span) || "-"}</b><span>HH:MM</span></div></div>`;
    const rows = OPS_HEADER_FIELDS.filter(([k]) => k !== "dailyReq" && h[k]).map(([k, label]) => `<dt>${esc(label)}</dt><dd>${opsNl(h[k])}</dd>`).join("");
    return stats + (rows ? `<dl class="opsdl">${rows}</dl>` : "");
  },
  flying(fl, n0, planFl) {
    let n = n0 || 0, out = "";
    const z4 = m => String(Math.floor(m / 60) % 24).padStart(2, "0") + String(m % 60).padStart(2, "0");
    // Planned ETD / ETA as their own columns (brief / step underneath); once any line is logged, ATD / ATA / Hrs columns too (Gordon, 10 Oct).
    const logged = (fl.waves || []).some(w => (w.flights || []).some(f => (f.ac || []).some(a => a.log && a.log.st)));
    const cols = `<colgroup>${(logged ? [5, 6, 6, 8, 3, 14, 9, 10, 5, 5, 5, 5, 4, 15] : [5, 7, 7, 8, 3, 15, 9, 11, 6, 5, 24]).map(p => `<col style="width:${p}%">`).join("")}</colgroup>`;
    const plan = opsPlan(planFl || fl);
    for (const w of fl.waves || []) {
      const fs = w.flights || [], ws = opsStats({ waves: [w] });
      out += `<div class="opswave${w.night ? " night" : ""}"><b>${esc(w.name)}</b>${w.sxo ? `<span>SXO <strong>${opsX(w.sxo)}</strong></span>` : ""}${w.opsO ? `<span>OPS O <strong>${opsX(w.opsO)}</strong></span>` : ""}
        <span class="opswavest">${ws.sorties} sortie${ws.sorties === 1 ? "" : "s"}${ws.first != null ? ` · ${z4(ws.first)}–${z4(ws.last)}Z` : ""}</span></div>`;
      if (w.rmks) out += `<div class="opsrmk">⚠ ${opsNl(w.rmks)}</div>`;
      if (!fs.length) { out += `<p class="hint">No flights.</p>`; continue; }
      out += `<div class="tablewrap"><table class="opst opsfly${logged ? " logged" : ""}">${cols}<thead><tr><th>No</th><th>ETD (Z)</th><th>ETA (Z)</th><th>Callsign</th><th>#</th><th>Aircrew</th><th>Mission</th><th>Area</th><th>A/C</th><th>Cfg</th>${logged ? `<th class="act">ATD</th><th class="act">ATA</th><th class="act">Hrs</th>` : ""}<th>Remarks</th></tr></thead>`;
      for (const f of fs) {
        const ac = (f.ac || []).length ? f.ac : [opsTpl.ac("")], span = ac.length;
        out += `<tbody class="fl${opsAllAdd(f) ? " opsadd" : ""}">`;
        ac.forEach((a, i) => {
          const add = opsIsAdd(f, a), no = add ? `<span class="opsaddtag">OPS ADD</span>` : opsLineUsed(a) ? String(++n).padStart(2, "0") : "";
          const bs = [f.brief && f.brief !== "NA" ? "Brief " + f.brief : "", f.step && f.step !== "NA" ? "Step " + f.step : ""].filter(Boolean).join(" · ");
          const L = a.log || {}, m = opsLogMins(L);
          const act = !logged ? "" : L.st === "cx" ? `<td colspan="3" class="act"><span class="opscx">${esc(opsResText(a, L))}</span></td>`
            : `<td class="act">${esc(L.st ? L.to || "" : "")}</td><td class="act">${esc(L.st ? L.ldg || "" : "")}</td><td class="act hrs">${m != null ? opsHrs(m) : ""}${L.res && L.res !== "DCO" ? `<small class="opsres">${esc(opsResText(a, L))}</small>` : ""}</td>`;
          out += `<tr class="${add ? "opsadd" : ""}"><td class="no">${no}</td>
            ${i === 0 ? `<td rowspan="${span}" class="tm rs"><b>${esc(f.etd)}</b>${bs ? `<small class="bs">${esc(bs)}</small>` : ""}</td><td rowspan="${span}" class="tm rs"><b>${esc(f.eta)}</b></td><td rowspan="${span}" class="cs rs">${esc(f.callsign)}${opsPlanTags(plan.byF.get(f))}</td>` : ""}
            <td class="n">${esc(a.n)}</td><td class="fcrew">${opsX(a.crew1)}${a.crew2 ? `<span class="c2"> / ${opsX(a.crew2)}</span>` : ""}</td><td class="nw">${esc(a.mission)}</td>
            ${i === 0 ? `<td rowspan="${span}" class="area rs">${esc(f.area)}${f.areaTime ? `<small>${esc(f.areaTime)}</small>` : ""}</td>` : ""}<td class="nw">${esc(opsTail(a.tail, OPS.day))}</td><td class="nw">${esc(a.config)}</td>${act}<td class="rm">${opsIrtBad(a) ? `<span class="opsirt">⚠ ${OPS_IRT_MSG}</span>${a.rmks ? "<br>" : ""}` : ""}${opsNl(a.rmks)}</td></tr>`;
        });
        out += `</tbody>`;
      }
      out += `</table></div>`;
    }
    return out;
  },
  // Phone TV (Gordon, 11 Oct): narrow screens get a compact list instead of the 14-column table: per line
  // No · Time (ETD–ETA, callsign + #, tags) · Crew (mission · area) · A/C (cfg) · Actual (ATD–ATA, hrs / result); remarks under it.
  flyPhone(fl, n0, planFl) {
    let n = n0 || 0, out = "";
    const logged = (fl.waves || []).some(w => (w.flights || []).some(f => (f.ac || []).some(a => a.log && a.log.st)));
    const plan = opsPlan(planFl || fl), z4 = m => String(Math.floor(m / 60) % 24).padStart(2, "0") + String(m % 60).padStart(2, "0");
    for (const w of fl.waves || []) {
      const fs = w.flights || [], ws = opsStats({ waves: [w] });
      out += `<div class="opswave${w.night ? " night" : ""}"><b>${esc(w.name)}</b>${w.sxo ? `<span>SXO <strong>${opsX(w.sxo)}</strong></span>` : ""}${w.opsO ? `<span>OPS O <strong>${opsX(w.opsO)}</strong></span>` : ""}
        <span class="opswavest">${ws.sorties} sortie${ws.sorties === 1 ? "" : "s"}${ws.first != null ? ` · ${z4(ws.first)}–${z4(ws.last)}Z` : ""}</span></div>`;
      if (w.rmks) out += `<div class="opsrmk">⚠ ${opsNl(w.rmks)}</div>`;
      if (!fs.length) continue;
      out += `<table class="opst flyph${logged ? " logged" : ""}"><colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4">${logged ? `<col class="c5">` : ""}</colgroup><tbody>`;
      for (const f of fs) {
        const ac = (f.ac || []).length ? f.ac : [opsTpl.ac("")];
        ac.forEach((a, i) => {
          if (!opsLineUsed(a) && i) return;
          const add = opsIsAdd(f, a), no = add ? "*" : opsLineUsed(a) ? String(++n).padStart(2, "0") : "";
          const L = a.log || {}, m = opsLogMins(L), rt = opsResText(a, L);
          const bs = i === 0 ? [f.brief && f.brief !== "NA" ? "B " + f.brief : "", f.step && f.step !== "NA" ? "S " + f.step : ""].filter(Boolean).join(" ") : "";
          const act = !logged ? "" : `<td class="act">${L.st === "cx" ? `<span class="opscx">${esc(rt)}</span>` : L.st ? `<b>${esc(L.to || "")}–${esc(L.ldg || "")}</b><small>${m != null ? opsHrs(m) + " h" : ""}${L.res && L.res !== "DCO" ? " " + esc(rt) : ""}</small>` : ""}</td>`;
          const rm = [opsIrtBad(a) ? `<span class="opsirt">⚠ ${OPS_IRT_MSG}</span>` : "", a.rmks ? opsNl(a.rmks) : ""].filter(Boolean).join(" ");
          out += `<tr class="${i === 0 ? "f" : ""}${add ? " opsadd" : ""}"><td class="no">${no}</td>
            <td class="tm">${i === 0 ? `<b>${esc(f.etd)}–${esc(f.eta)}</b>` : ""}<small>${esc([i === 0 ? f.callsign : "", a.n].filter(Boolean).join(" "))}${add ? " · OPS ADD" : ""}</small>${i === 0 && bs ? `<small>${esc(bs)}</small>` : ""}${i === 0 ? opsPlanTags(plan.byF.get(f)) : ""}</td>
            <td class="cr"><b>${opsX(a.crew1)}</b>${a.crew2 ? ` / ${opsX(a.crew2)}` : ""}<small>${esc([a.mission, i === 0 ? f.area : ""].filter(Boolean).join(" · "))}</small></td>
            <td class="ac">${esc(opsTail(a.tail, OPS.day))}<small>${esc(a.config)}</small></td>${act}</tr>${rm ? `<tr class="rmk${add ? " opsadd" : ""}"><td></td><td colspan="${logged ? 4 : 3}">${rm}</td></tr>` : ""}`;
        });
      }
      out += `</tbody></table>`;
    }
    return out;
  },
  sim(sim) {
    sim = { rows: (sim.rows || []).filter(opsSimUsed) };
    if (!sim.rows.length) return "";
    let n = 0, out = `<div class="tablewrap"><table class="opst"><thead><tr><th>No</th><th>ETD</th><th>ETA</th><th>Callsign</th><th>Aircrew</th><th>Console</th><th>Mission</th><th>FMS</th><th>Config</th><th>Rmks</th></tr></thead><tbody>`;
    for (const s of sim.rows) {
      const ac = (s.ac || []).length ? s.ac : [opsTpl.simac("")], span = ac.length;
      ac.forEach((a, i) => {
        out += `<tr class="${i === 0 ? "first" : ""}"><td>${opsLineUsed(a) ? String(++n).padStart(2, "0") : ""}</td>${i === 0 ? `<td rowspan="${span}">${esc(s.etd)}</td><td rowspan="${span}">${esc(s.eta)}</td>` : ""}
          <td>${esc([i === 0 ? s.callsign : "", a.n].filter(Boolean).join(" "))}</td><td class="nm">${opsX(a.crew1)}</td><td class="nm">${opsX(a.crew2 || "")}</td><td>${esc(a.mission)}</td><td>${esc(a.fms)}</td><td>${esc(a.config)}</td><td>${opsNl(a.rmks)}</td></tr>`;
      });
    }
    return out + `</tbody></table></div>`;
  },
  ground(g) {
    const gs = (g.groups || []).filter(x => (x.rows || []).length);
    return gs.map(x => `<h3 class="opssub">${esc(x.name)}</h3><div class="tablewrap"><table class="opst opsnarrow opsgnd"><colgroup><col style="width:13%"><col style="width:33%"><col style="width:34%"><col style="width:20%"></colgroup><thead><tr><th>Time</th><th>Event</th><th>Personnel</th><th>Venue</th></tr></thead><tbody>${x.rows.map(r =>
      `<tr><td>${esc(r.time)}</td><td>${esc(r.event)}</td><td>${opsX(r.personnel)}</td><td>${esc(r.venue)}</td></tr>`).join("")}</tbody></table></div>`).join("");
  },
  airfield(a) {
    if (!(a.rows || []).length && !a.sunset) return "";
    return `<dl class="opsdl">${(a.rows || []).map(r => `<dt>${esc(r.what)}</dt><dd>${esc(r.time)}</dd>`).join("")}${a.sunset ? `<dt>Sunset</dt><dd>${esc(a.sunset)}</dd>` : ""}</dl>`;
  },
  notes(nt) {
    const c = nt.currencies || [], ac = nt.aircraft || [];
    if (!c.length && !ac.length) return "";
    return (c.length ? `<h3 class="opssub">Currencies</h3><dl class="opsdl">${c.map(r => `<dt>${opsX(r.who)}</dt><dd>${esc(r.note)}</dd>`).join("")}</dl>` : "")
      + (ac.length ? `<h3 class="opssub">Aircraft restrictions</h3><dl class="opsdl">${ac.map(r => `<dt>${esc(r.ac)}</dt><dd>${esc(r.note)}</dd>`).join("")}</dl>` : "");
  },
  duties(d) {
    const fl = opsGet("flying"), sim = opsGet("sim"), waves = fl.waves || [];
    const gs = (d.groups || []).filter(x => (x.rows || []).length);
    // Compact tables side by side so everyone fits on one screen; tokens coloured so flying / SIMS / SXO stand out.
    const tok = t => { const c = t === "#" ? "fly" : t === "(#)" ? "add" : t === "SIMS" ? "sim" : /^(SXO|OPS O)$/.test(t) ? "duty" : "txt"; return `<span class="dt dt-${c}">${esc(t)}</span>`; };
    const cell = (auto, manual) => [...new Set([...auto, ...(manual ? String(manual).split(/\s*\/\s*/) : [])].map(s => s.trim().toUpperCase()).filter(Boolean))].map(tok).join("");
    const short = w => esc(String(w.name || "").replace(/^NIGHT WAVE\s*/i, "N").replace(/^WAVE\s*/i, "W"));
    return `<div class="opsduty">${gs.map(g => `<div class="opsdutyg${g.hours ? " hrs" : ""}"><h3 class="opssub">${esc(g.name)} <span class="hint">${g.rows.length}</span></h3><div class="tablewrap"><table class="opst opsdt"><thead><tr><th></th><th>Name</th>${waves.map(w => `<th title="${esc(w.name)}">${short(w)}</th>`).join("")}${g.hours ? `<th title="Previous day's out time">Prev</th><th>In</th><th>Rest</th><th>Out</th><th>Duty</th>` : ""}</tr></thead><tbody>${opsDutyRows(g).map((r, i) => {
      const auto = opsAuto(r.name, fl, sim);
      let hrs = "";
      if (g.hours) {
        const io = opsInOut(r), prev = opsPrevOut(g.name, r.name), pi = opsMin(prev), ii = opsMin(io.in), oo = opsMin(io.out);
        const at = (v, a) => a ? `<i class="opsautot" title="Worked out from the programme">${esc(v)}</i>` : esc(v);
        hrs = `<td class="t">${esc(prev)}</td><td class="t">${at(io.in, io.inAuto)}</td><td class="t">${pi != null && ii != null ? opsHM(ii + 1440 - pi) : ""}</td><td class="t">${at(io.out, io.outAuto)}</td><td class="t"><b>${ii != null && oo != null ? opsHM(opsSpan(ii, oo)) : ""}</b></td>`;
      }
      return `<tr><td class="i">${i + 1}</td><td class="nm">${opsX(r.name)}</td>${waves.map((w, j) => `<td class="c">${cell(auto[j] || [], (r.cells || [])[j])}</td>`).join("")}${hrs}</tr>`;
    }).join("")}</tbody></table></div></div>`).join("")}</div>` + (gs.length ? `<p class="hint"><span class="dt dt-fly">#</span> flying · <span class="dt dt-add">(#)</span> ops add · <span class="dt dt-sim">SIMS</span> · <span class="dt dt-duty">SXO / OPS O</span> and ground events (MTG, IN BRIEF, ACAD…) fill in automatically from the programme. W1, W2… = waves.</p>` : "");
  },
};

/* ---------- editing ---------- */
const oI = (p, v, w, ph) => `<input data-p="${p}" value="${esc(v ?? "")}"${w ? ` style="width:${w}"` : ""}${ph ? ` placeholder="${esc(ph)}"` : ""}>`;
const oP = (p, v, w) => `<input data-p="${p}" value="${esc(v ?? "")}" list="opsPeople"${w ? ` style="width:${w}"` : ""}>`;
const oT = (p, v, rows) => `<textarea data-p="${p}" rows="${rows || 2}">${esc(v ?? "")}</textarea>`;
const oSel = (p, v, opts) => `<select data-p="${p}" style="width:auto;min-width:64px">${opts.map(([k, l]) => `<option value="${esc(k)}"${(v || "") === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const oC = (p, v, label) => `<label class="opschk"><input type="checkbox" data-p="${p}" ${v ? "checked" : ""}>${label}</label>`;
const oB = (op, p, i, label, tpl, title) => `<button type="button" class="btn small" data-op="${op}" data-p="${p}" data-i="${i ?? ""}" data-tpl="${tpl || ""}"${title ? ` title="${title}" aria-label="${title}"` : ""}>${label}</button>`;
const oTools = (p, i) => `<span class="tools">${oB("up", p, i, "↑", "", "Move up")}${oB("down", p, i, "↓", "", "Move down")}${oB("del", p, i, "✕", "", "Remove")}</span>`;

function opsEditor(sec) {
  const d = OPS.edit.data;
  if (sec === "flying") opsNameWaves(d);
  const people = [...new Set([...active().map(t => t.name), ...S.profiles.filter(p => p.role === "admin").map(p => p.display_name)].filter(Boolean))];
  return `<div class="opsed" id="opsEdit"><datalist id="opsPeople">${people.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
    ${opsEd[sec](d)}
    <div class="err" id="opsErr"></div>
    <div class="row" style="display:flex;justify-content:flex-end;gap:8px"><button class="btn" data-ops="cancel">Cancel</button><button class="btn primary" data-ops="save">Save</button></div></div>`;
}
const opsEd = {
  header(h) {
    return `<div class="grid">${OPS_HEADER_FIELDS.map(([k, label, rows]) => `<label>${esc(label)}${rows ? oT(k, h[k], rows) : oI(k, h[k])}</label>`).join("")}</div>
      <p class="hint">Planned sorties, planned hours, first takeoff, last landing and HH:MM are worked out from the flying program.</p>`;
  },
  flying(fl) {
    setTimeout(opsPlanRefresh);
    return (fl.waves || []).map((w, wi) => `<div class="blk">
      <div class="tools" style="margin-bottom:4px"><b class="opswavename">${esc(w.name)}</b>${oC(`waves.${wi}.night`, w.night, "Night wave")}<span class="grow"></span>${oTools("waves", wi)}</div>
      <div class="grid"><label>SXO${oP(`waves.${wi}.sxo`, w.sxo)}</label><label>OPS O${oI(`waves.${wi}.opsO`, w.opsO, "", "e.g. LIM Y / LEE L (TKOVER @ 1100Z)")}</label></div>
      <label>Wave remarks (airfield notes for this wave)${oT(`waves.${wi}.rmks`, w.rmks)}</label>
      ${(w.flights || []).map((f, fi) => { const p = `waves.${wi}.flights.${fi}`; return `<div class="blk flt">
        <div class="tablewrap"><table><thead><tr><th>Brief</th><th>Step</th><th class="opsetdh">ETD (key in first)</th><th>ETA</th><th>Callsign</th><th>DL</th><th>Vehicle</th><th>Area</th><th>Area time</th><th></th></tr></thead><tbody><tr>
          <td>${opsAutoIn(p, f, "brief")}</td><td>${opsAutoIn(p, f, "step")}</td><td>${oI(p + ".etd", f.etd, "80px", "e.g. 0715").replace("<input", '<input class="opsetd"')}</td><td>${opsAutoIn(p, f, "eta")}</td>
          <td>${oI(p + ".callsign", f.callsign, "120px")}</td><td>${oSel(p + ".dl", f.dl, [["", "-"], ...OPS_DL.map(x => [x, x])])}</td><td>${oSel(p + ".veh", f.veh, [["", "Auto"], ...OPS_VEH.map(x => [x, x])])} <span class="opsplan" data-plan="${wi}.${fi}"></span></td><td>${oI(p + ".area", f.area, "120px")}</td><td>${oI(p + ".areaTime", f.areaTime, "110px")}</td>
          <td>${oTools(`waves.${wi}.flights`, fi)}</td></tr></tbody></table>
        <table><thead><tr><th>#</th><th>Aircrew</th><th>Aircrew</th><th>Mission</th><th>A/C</th><th>Config</th><th>Rmks</th><th></th><th></th></tr></thead><tbody>
          ${(f.ac || []).map((a, ai) => { const q = `${p}.ac.${ai}`; return `<tr><td>${oI(q + ".n", a.n, "40px")}</td><td>${oP(q + ".crew1", a.crew1, "120px")}</td><td>${oP(q + ".crew2", a.crew2, "120px")}</td><td>${oI(q + ".mission", a.mission, "110px")}</td><td>${oI(q + ".tail", a.tail, "60px")}</td><td>${oI(q + ".config", a.config, "60px")}</td><td>${oI(q + ".rmks", a.rmks, "200px")}</td><td>${oC(q + ".opsAdd", a.opsAdd, "Ops add")}</td><td>${oB("del", p + ".ac", ai, "✕", "", "Remove aircraft")}</td></tr>${opsIrtBad(a) ? `<tr class="opswarn"><td colspan="9">⚠ ${OPS_IRT_MSG}${a.crew2 ? ` (${esc(a.crew2)} isn't ticked as IRE)` : " (no back seat)"}</td></tr>` : ""}`; }).join("")}
        </tbody></table></div>${oB("add", p + ".ac", "", "+ Aircraft", "ac")}</div>`; }).join("")}
      <div class="tools">${oB("add", `waves.${wi}.flights`, "", "+ Flight", "flight")}</div></div>`).join("")
      + `<div class="tools">${oB("add", "waves", "", "+ Wave", "wave")}${oB("add", "waves", "", "+ Night wave", "nwave")}</div>` + `<p class="hint"><b>Key in the ETD first:</b> ETA (ETD + ${cfgN("fly.eta")} min), step (ETD − ${cfgN("fly.step")} min) and brief (step − ${cfgN("fly.brief")} min) fill in by themselves (shown in grey). Type over any of them to match the ops or WX / NOTAM brief; clear a box to go back to the worked-out time. Times as 0725 (Zulu). Tick "Ops add" on the flight (whole flight) or on one aircraft line (e.g. #1 ops add): they show as * and don't count in planned sorties or hours.</p>`;
  },
  sim(sim) {
    return (sim.rows || []).map((s, si) => { const p = `rows.${si}`; return `<div class="blk flt"><div class="tablewrap">
      <table><thead><tr><th>ETD</th><th>ETA</th><th>Callsign</th><th></th></tr></thead><tbody><tr><td>${oI(p + ".etd", s.etd, "70px")}</td><td>${oI(p + ".eta", s.eta, "70px")}</td><td>${oI(p + ".callsign", s.callsign, "140px")}</td><td>${oTools("rows", si)}</td></tr></tbody></table>
      <table><thead><tr><th>#</th><th>Aircrew</th><th>Console</th><th>Mission</th><th>FMS</th><th>Config</th><th>Rmks</th><th></th></tr></thead><tbody>
      ${(s.ac || []).map((a, ai) => { const q = `${p}.ac.${ai}`; return `<tr><td>${oI(q + ".n", a.n, "40px")}</td><td>${oP(q + ".crew1", a.crew1, "120px")}</td><td>${oP(q + ".crew2", a.crew2, "120px")}</td><td>${oI(q + ".mission", a.mission, "150px")}</td><td>${oI(q + ".fms", a.fms, "50px")}</td><td>${oI(q + ".config", a.config, "60px")}</td><td>${oI(q + ".rmks", a.rmks, "160px")}</td><td>${oB("del", p + ".ac", ai, "✕", "", "Remove")}</td></tr>`; }).join("")}
      </tbody></table></div>${oB("add", p + ".ac", "", "+ Line", "simac")}</div>`; }).join("") + oB("add", "rows", "", "+ Sim", "sim");
  },
  ground(g) {
    return (g.groups || []).map((x, gi) => `<div class="blk"><div class="tools"><label style="flex:1">Group${oI(`groups.${gi}.name`, x.name, "", "e.g. 200 FWC GROUND PROGRAM")}</label>${oTools("groups", gi)}</div>
      <div class="tablewrap"><table><thead><tr><th>Time</th><th>Event</th><th>Personnel</th><th>Venue</th><th></th></tr></thead><tbody>${(x.rows || []).map((r, ri) => { const q = `groups.${gi}.rows.${ri}`;
        return `<tr><td>${oI(q + ".time", r.time, "70px")}</td><td>${oI(q + ".event", r.event, "200px")}</td><td>${oI(q + ".personnel", r.personnel, "240px")}</td><td>${oI(q + ".venue", r.venue, "110px")}</td><td>${oTools(`groups.${gi}.rows`, ri)}</td></tr>`; }).join("")}</tbody></table></div>
      ${oB("add", `groups.${gi}.rows`, "", "+ Row", "grow")}</div>`).join("") + oB("add", "groups", "", "+ Group", "group");
  },
  airfield(a) {
    return `<div class="tablewrap"><table><thead><tr><th>Restriction</th><th>Time</th><th></th></tr></thead><tbody>${(a.rows || []).map((r, i) =>
      `<tr><td>${oI(`rows.${i}.what`, r.what, "260px", "e.g. RWY BLACK / REGULATION (2 A/C PER 15MINS)")}</td><td>${oI(`rows.${i}.time`, r.time, "160px", "0730Z - 0800Z")}</td><td>${oTools("rows", i)}</td></tr>`).join("")}</tbody></table></div>
      ${oB("add", "rows", "", "+ Restriction", "af")}<label style="margin-top:10px;max-width:220px">Sunset${oI("sunset", a.sunset)}</label>`;
  },
  notes(nt) {
    const list = (key, a, b, ha, hb, tpl) => `<h3 class="opssub">${ha === "Name(s)" ? "Currencies" : "Aircraft restrictions"}</h3><div class="tablewrap"><table><thead><tr><th>${ha}</th><th>${hb}</th><th></th></tr></thead><tbody>${(nt[key] || []).map((r, i) =>
      `<tr><td>${ha === "Name(s)" ? oP(`${key}.${i}.${a}`, r[a], "220px") : oI(`${key}.${i}.${a}`, r[a], "160px")}</td><td>${oI(`${key}.${i}.${b}`, r[b], "320px")}</td><td>${oTools(key, i)}</td></tr>`).join("")}</tbody></table></div>${oB("add", key, "", "+ Row", tpl)}`;
    return list("currencies", "who", "note", "Name(s)", "Note", "cur") + list("aircraft", "ac", "note", "Aircraft", "Restriction", "acr");
  },
  duties(d) {
    const fl = opsGet("flying"), sim = opsGet("sim"), waves = fl.waves || [];
    if (!(d.groups || []).some(g => g.extra)) (d.groups = d.groups || []).push(opsTpl.xgroup());
    const open = OPS.namesOpen;
    return (d.groups || []).map((g, gi) => {
      const free = open || g.extra; // standing names are fixed unless "Change standing names" is on
      return `<div class="blk${g.extra ? " opsextra" : ""}"><div class="tools">${open && !g.extra ? `<label style="flex:1">Group${oI(`groups.${gi}.name`, g.name)}</label>${oC(`groups.${gi}.hours`, g.hours, "Duty hours")}${oTools("groups", gi)}` : `<h3 class="opssub" style="flex:1;margin:0">${esc(g.name)}</h3>`}</div>
      ${g.extra ? `<p class="hint" style="margin:0 0 4px">Anyone else on today's programme who isn't on the standing list (auditors, visitors…). Only for this day.</p>` : ""}
      <div class="tablewrap"><table><thead><tr><th>Name</th>${waves.map(w => `<th>${esc(w.name)}</th>`).join("")}${g.hours ? "<th>In</th><th>Out</th>" : ""}${free ? "<th></th>" : ""}</tr></thead><tbody>${(g.rows || []).map((r, ri) => {
        const q = `groups.${gi}.rows.${ri}`, auto = opsAuto(r.name, fl, sim);
        return `<tr><td>${free ? oP(q + ".name", r.name, "120px") : `<b class="opsfixed">${esc(r.name)}</b>`}</td>${waves.map((w, j) => `<td>${oI(`${q}.cells.${j}`, (r.cells || [])[j], "110px")}${auto[j] && auto[j].length ? `<div class="opsauto">+ ${esc(auto[j].join(" / "))}</div>` : ""}</td>`).join("")}${g.hours ? (() => { const a = opsAutoInOut(r.name, opsGet); return `<td>${oI(q + ".inTime", r.inTime, "60px", a.in)}</td><td>${oI(q + ".outTime", r.outTime, "60px", a.out)}</td>`; })() : ""}${free ? `<td>${g.extra ? oB("del", `groups.${gi}.rows`, ri, "✕", "", "Remove") : oTools(`groups.${gi}.rows`, ri)}</td>` : ""}</tr>`;
      }).join("")}</tbody></table></div>
      ${free ? `<div class="tools">${oB("add", `groups.${gi}.rows`, "", "+ Person", "drow")}${open && !g.extra ? oB("roster", `groups.${gi}.rows`, "", "+ All trainees on roster") : ""}</div>` : ""}</div>`;
    }).join("")
      + (open ? oB("add", "groups", "", "+ Group", "dgroup") : "")
      + `<p class="hint">Only type what isn't in the programme (LATE IN, ACAD, PARADE+RUN…). #, SIMS, SXO, OPS O and ground-programme events (MTG, IN BRIEF, ACAD…) are added automatically (shown under each box). In / Out as 0530.</p>
      <p class="hint">The names are the squadron's standing list and carry over to each new day. <a href="#" data-ops="names">${open ? "Done changing names" : "Change standing names"}</a> (when someone is posted in or out).</p>`;
  },
};
// Flight times worked out from the ETD (Gordon, 10 Oct): ETA = ETD + 1 h, step = ETD − 1 h, brief = step − 45 min.
// A typed value overrides (f.man[k] = true); clearing the box goes back to the worked-out time.
const OPS_AUTO_T = ["eta", "step", "brief"]; // offsets from the ETD come from Settings (fly.eta / fly.step / fly.brief)
const opsAutoOff = () => ({ eta: cfgN("fly.eta"), step: -cfgN("fly.step"), brief: -(cfgN("fly.step") + cfgN("fly.brief")) });
const opsZ4 = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + String(m % 60).padStart(2, "0"); };
const opsAutoT = (f, k) => { const e = opsMin(f.etd); return e == null ? "" : opsZ4(e + opsAutoOff()[k]); };
// Older flights have no f.man: a filled time that differs from the worked-out one counts as typed.
const opsIsMan = (f, k) => f.man ? !!f.man[k] : !!String(f[k] || "").trim() && f[k] !== opsAutoT(f, k);
function opsAutoIn(p, f, k) {
  // Settle the flight in the edit copy first: which times are typed over, and fill the worked-out ones.
  if (!f.man) f.man = Object.fromEntries(OPS_AUTO_T.map(t => [t, opsIsMan(f, t)]));
  if (!f.man[k] && opsAutoT(f, k)) f[k] = opsAutoT(f, k);
  const man = f.man[k], v = f[k] || "";
  return `<input data-p="${p}.${k}" data-auto="${k}" class="${man ? "opsman" : "opsauto"}" value="${esc(v)}" style="width:70px" placeholder="auto" title="${man ? "Typed over. Clear it to go back to the worked-out time." : "Worked out from the ETD. Type over it to change."}">`;
}
// ETD typed: refill the auto times (in the data and the boxes on screen). Auto box typed: mark it typed over, or back to auto when cleared.
function opsAutoTimes(el) {
  const m = /^(waves\.\d+\.flights\.\d+)\.(etd|eta|step|brief)$/.exec(el.dataset.p); if (!m) return;
  const f = opsPath(OPS.edit.data, m[1]); if (!f) return;
  if (!f.man) f.man = {};
  if (m[2] !== "etd") { f.man[m[2]] = !!el.value.trim(); if (!f.man[m[2]]) f[m[2]] = opsAutoT(f, m[2]); el.className = f.man[m[2]] ? "opsman" : "opsauto"; return; }
  for (const k of OPS_AUTO_T) if (!f.man[k]) {
    f[k] = opsAutoT(f, k);
    const box = el.closest("tr").querySelector(`[data-auto="${k}"]`); if (box) box.value = f[k];
  }
}
function opsPath(obj, path) { return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }
function opsSetPath(obj, path, val) {
  const ks = path.split("."), last = ks.pop();
  const parent = ks.reduce((o, k, i) => { if (o[k] == null) o[k] = /^\d+$/.test(ks[i + 1] ?? last) ? [] : {}; return o[k]; }, obj);
  parent[last] = val;
}
// Flying editor: show each formation's worked-out vehicle and any DL / vehicle warnings next to its boxes.
function opsPlanRefresh() {
  if (!OPS.edit || OPS.edit.section !== "flying") return;
  const plan = opsPlan(OPS.edit.data);
  document.querySelectorAll("#opsEdit [data-plan]").forEach(el => { const p = plan[el.dataset.plan]; if (!p) return;
    el.innerHTML = `${p.veh ? `<b>${esc(p.veh)}</b>${p.auto ? "" : " (set)"}` : ""}${p.people ? ` <span class="hint">${p.people} crew</span>` : ""}${[...p.warn, p.dlWarn].filter(Boolean).map(w => `<span class="opsplanw">⚠ ${esc(w)}</span>`).join("")}`; });
}
function opsRerenderEdit() {
  if (!OPS.edit) return;
  const sec = OPS.edit.section, card = $("#ops-" + sec);
  if (!card) return renderOps($("#view"));
  const y = window.scrollY; card.outerHTML = opsSection(sec, true); window.scrollTo(0, y);
}
document.addEventListener("input", e => {
  const el = e.target; if (!OPS.edit || !el.dataset || !el.dataset.p || !el.closest("#opsEdit")) return;
  opsSetPath(OPS.edit.data, el.dataset.p, el.type === "checkbox" ? el.checked : el.value);
  if (OPS.edit.section === "flying") { opsAutoTimes(el); opsPlanRefresh(); }
  if (OPS.edit.section === "duties" && el.dataset.p.endsWith(".name")) return; // auto hints refresh on next re-render
});
document.addEventListener("change", e => {
  const el = e.target; if (!OPS.edit || !el.dataset || !el.dataset.p || !el.closest("#opsEdit")) return;
  if (el.dataset.auto && !el.value.trim()) { // cleared: back to the worked-out time
    const f = opsPath(OPS.edit.data, el.dataset.p.replace(/\.\w+$/, ""));
    if (f) { (f.man ||= {})[el.dataset.auto] = false; f[el.dataset.auto] = opsAutoT(f, el.dataset.auto); el.value = f[el.dataset.auto]; el.className = "opsauto"; }
    return;
  }
  opsSetPath(OPS.edit.data, el.dataset.p, el.type === "checkbox" ? el.checked : el.value);
  // Re-draw after the browser finishes the blur that fired this change (re-drawing mid-blur throws).
  if (el.type === "checkbox" || (OPS.edit.section === "duties" && el.dataset.p.endsWith(".name"))) setTimeout(opsRerenderEdit);
});
document.addEventListener("click", async e => {
  const op = e.target.closest("#opsEdit [data-op]");
  if (op && OPS.edit) {
    const p = op.dataset.p, i = +op.dataset.i, arr = opsPath(OPS.edit.data, p) || (opsSetPath(OPS.edit.data, p, []), opsPath(OPS.edit.data, p));
    if (op.dataset.op === "add") {
      const t = op.dataset.tpl;
      arr.push(t === "ac" ? opsTpl.ac(String(arr.length + 1)) : t === "simac" ? opsTpl.simac(String(arr.length + 1)) : t === "wave" ? opsTpl.wave(false) : t === "nwave" ? opsTpl.wave(true) : opsTpl[t]());
    } else if (op.dataset.op === "del") arr.splice(i, 1);
    else if (op.dataset.op === "up" && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    else if (op.dataset.op === "down" && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    else if (op.dataset.op === "roster") {
      const have = new Set(arr.map(r => opsNorm(r.name)));
      for (const t of active()) if (!have.has(opsNorm(t.name))) arr.push(opsTpl.drow(t.name));
    }
    return opsRerenderEdit();
  }
  const el = e.target.closest("[data-ops]"); if (!el) return;
  const a = el.dataset.ops;
  if (a === "day") opsGo(opsShift(OPS.day, +el.dataset.n));
  else if (a === "today") opsGo(todayStr());
  else if (a === "edit") {
    const sec = el.dataset.sec;
    OPS.namesOpen = false;
    OPS.edit = { section: sec, data: opsClone(opsData(sec) || (sec === "duties" && opsSeedDuties()) || opsBlank[sec]()), version: OPS.rows[sec] ? OPS.rows[sec].version : 0 };
    // One "Ops add" tick per aircraft line (Gordon, 12 Oct): an old flight-level tick becomes a tick on each of its lines.
    if (sec === "flying") for (const w of OPS.edit.data.waves || []) for (const f of w.flights || []) if (f.opsAdd) { for (const a of f.ac || []) a.opsAdd = true; f.opsAdd = false; }
    renderOps($("#view")); const c = $("#ops-" + sec); if (c) c.scrollIntoView({ block: "start" });
  } else if (a === "names") { e.preventDefault(); OPS.namesOpen = !OPS.namesOpen; opsRerenderEdit(); }
  else if (a === "cancel") { OPS.edit = null; renderOps($("#view")); }
  else if (a === "save") opsSave(el);
  else if (a === "copy") opsCopy();
  else if (a === "clear") opsClearDay(el);
  else if (a === "pdf") opsPrint(false);
  else if (a === "pdfeod") opsPrint(true);
  else if (a === "att") opsAttendance();
  else if (a === "log") { OPS.logOpen = !OPS.logOpen; renderOps($("#view")); if (OPS.logOpen) { const c = $("#ops-log"); if (c) c.scrollIntoView({ block: "start" }); } }
  else if (a === "logplan") opsLogPlanned(el);
  else if (a === "logcx") { const L = opsLogLine(el.dataset.k).log || {}; opsLogSave(el.dataset.k, null, null, L.st === "cx" ? "" : "cx", true); }
  else if (a === "logips") {
    const L = opsLogLine(el.dataset.k).log || {};
    if (!opsFlown(L)) return toast("Key in the take-off and landing times first, then tap IPS.");
    opsLogSave(el.dataset.k, L.to, L.ldg, L.st === "ips" ? "flown" : "ips", true);
  }
  else if (a === "logclr") opsLogSave(el.dataset.k, null, null, "", true);
});
// Clear the whole programme for the shown day (two warnings first). Sections are emptied, not deleted.
async function opsClearDay(btn) {
  const day = OPS.day, long = opsLongDay(day);
  if (!await ask("Clear this day's programme?", `This empties everything for ${long}: header, flying, sims, ground, airfield, notes and duties.`, "Clear day")) return;
  if (!await ask("Are you sure?", `You are about to clear the WHOLE programme for ${long}. Everyone will see it disappear. This can't be undone (you'd have to copy it in again).`, `Yes, clear ${long}`)) return;
  btn.disabled = true;
  const { error } = await S.sb.rpc("ops_clear_day", { p_day: day });
  btn.disabled = false;
  if (error) return toast(errMsg(error));
  toast(`${long} cleared.`); OPS.edit = null; opsLoad(day);
}
async function opsSave(btn) {
  const ed = OPS.edit; if (!ed) return;
  if (ed.section === "flying") {
    const bad = []; (opsNameWaves(ed.data).waves || []).forEach(w => (w.flights || []).forEach(f => (f.ac || []).forEach(a => { if (opsIrtBad(a)) bad.push(`${w.name} ${[f.callsign, a.n].filter(Boolean).join(" ")}: ${a.crew1 || "?"} / ${a.crew2 || "no back seat"}`); })));
    if (bad.length && !await ask("IRT needs an IRE in the back seat", `${bad.join("; ")}. The back seat isn't ticked as IRE (Admin → Edit). Save anyway?`, "Save anyway")) return;
  }
  btn.disabled = true;
  const { data, error } = await S.sb.rpc("ops_save", { p_day: OPS.day, p_section: ed.section, p_data: ed.data, p_version: ed.version });
  btn.disabled = false;
  if (error) {
    if (/someone else/i.test(error.message)) { await ask("Not saved", error.message, "OK"); OPS.edit = null; return opsLoad(OPS.day); }
    const err = $("#opsErr"); if (err) err.textContent = errMsg(error); toast(errMsg(error)); return;
  }
  OPS.rows[ed.section] = { day: OPS.day, section: ed.section, data: ed.data, version: data, updated_at: new Date().toISOString(), updated_by: S.me.id };
  OPS.edit = null; toast(`${OPS_TITLES[ed.section]} saved.`); renderOps($("#view"));
}
async function opsCopy() {
  if (OPS.edit) return toast("Save or cancel your changes first.");
  const from = await ask("Copy from another day", `Copies that day's programme into ${opsLongDay(OPS.day)}. Duty notes and in/out times aren't copied; names are.`, "Copy", { type: "date", value: opsShift(OPS.day, -1) });
  if (!from) return;
  if (from === OPS.day) return toast("Pick a different day.");
  const { data, error } = await S.sb.from("ops_sections").select("section,data").eq("day", from);
  if (error) return toast(errMsg(error));
  const src = (data || []).filter(r => r.data && Object.keys(r.data).length);
  if (!src.length) return toast(`Nothing on ${opsLongDay(from)} to copy.`);
  if (OPS_ORDER.some(opsData) && !await ask("Replace this day's programme?", `${opsLongDay(OPS.day)} already has entries. Sections on ${opsLongDay(from)} will replace them.`, "Replace")) return;
  const fails = [];
  for (const r of src) {
    const d = opsClone(r.data);
    if (r.section === "duties") for (const g of d.groups || []) for (const row of g.rows || []) { row.cells = []; row.inTime = ""; row.outTime = ""; }
    if (r.section === "flying") for (const w of d.waves || []) for (const f of w.flights || []) for (const a of f.ac || []) delete a.log; // flown times belong to their own day
    const cur = OPS.rows[r.section];
    const res = await S.sb.rpc("ops_save", { p_day: OPS.day, p_section: r.section, p_data: d, p_version: cur ? cur.version : 0 });
    if (res.error) fails.push(`${OPS_TITLES[r.section]}: ${errMsg(res.error)}`);
  }
  toast(fails.length ? "Some sections weren't copied: " + fails.join("; ") : `Copied from ${opsLongDay(from)}. Now update what's different.`);
  OPS.rowsDay = null; opsLoad(OPS.day);
}

/* ---------- PDF (print view in the sheet's layout) ---------- */
// eod = end-of-day copy for filing: same sheet plus ATD / ATA / HRS per line and flown totals (Gordon, 10 Oct).
// Printed programme (Gordon, 12 Oct "more readable … neater and more ergonomic"): A4 landscape, light rules, one shaded
// block per formation, dark wave bands; day details in one strip at the top (briefs | waves SXO / OPS O | numbers & duty
// officers); flying lines full width; then simulator + ground on the left and airfield / currencies / aircraft notes on the
// right; duties side by side; sign-off line at the foot. End of day: actual times instead of planned, result in RMKS.
function opsPrint(eod) {
  if (OPS.rowsDay !== OPS.day) return toast("Still loading.");
  const h = opsGet("header"), fl = opsGet("flying"), sim = opsGet("sim"), st = opsStats(fl), e = v => esc(v ?? "");
  const nl = v => e(v).replace(/\n/g, "<br>"), waves = fl.waves || [], pplan = opsPlan(fl);
  const z4 = m => m == null ? "" : String(Math.floor(m / 60) % 24).padStart(2, "0") + String(m % 60).padStart(2, "0");
  const crew = a => `<b>${e(a.crew1)}</b>${a.crew2 ? ` / <b>${e(a.crew2)}</b>` : ""}`;
  let n = 0;
  // Flying lines: No · Brief / Step · ETD–ETA (or ATD–ATA) · Callsign (DL / van) · # · Aircrew · Mission · Area · A/C · Cfg · Remarks / Result.
  const flying = waves.map(w => {
    const ws = opsStats({ waves: [w] });
    let rows = `<tbody class="wv"><tr><td colspan="10"><b>${e(w.name)}</b><span>SXO <b>${e(w.sxo || "-")}</b></span><span>OPS O <b>${e(w.opsO || "-")}</b></span><span class="ws">${ws.sorties} sortie${ws.sorties === 1 ? "" : "s"}${ws.first != null ? ` · ${z4(ws.first)}–${z4(ws.last)}Z` : ""}</span></td></tr>${w.rmks ? `<tr class="wr"><td colspan="10">⚠ ${nl(w.rmks)}</td></tr>` : ""}</tbody>`;
    (w.flights || []).forEach((f, fi) => {
      const ac = ((f.ac || []).length ? f.ac : [opsTpl.ac("")]).filter((a, i) => i === 0 || opsLineUsed(a)), sp = ac.length, pl = pplan.byF.get(f) || {};
      const tags = [pl.dl ? "DL " + e(pl.dl) : "", pl.veh ? e(pl.veh) : ""].filter(Boolean).join(" · ");
      rows += `<tbody class="fl${fi % 2 ? " alt" : ""}">`;
      ac.forEach((a, i) => {
        const add = opsIsAdd(f, a), no = add ? "*" : opsLineUsed(a) ? String(++n).padStart(2, "0") : "", L = a.log || {};
        const tm = eod ? `<td class="t">${L.st && L.st !== "cx" ? `<b>${e(L.to)}</b>–${e(L.ldg)}` : ""}</td>`
          : i === 0 ? `<td rowspan="${sp}" class="t"><b>${e(f.etd)}</b>–${e(f.eta)}<small>${[f.brief && f.brief !== "NA" ? "B " + e(f.brief) : "", f.step && f.step !== "NA" ? "S " + e(f.step) : ""].filter(Boolean).join(" ")}</small></td>` : "";
        rows += `<tr class="${add ? "ad" : ""}"><td class="no">${no}</td>${tm}${i === 0 ? `<td rowspan="${sp}" class="cs"><b>${e(f.callsign)}</b>${tags ? `<small>${tags}</small>` : ""}</td>` : ""}<td class="n">${e(a.n)}</td><td>${crew(a)}</td><td>${e(a.mission)}${add ? ` <span class="oa">OPS ADD</span>` : ""}</td>${i === 0 ? `<td rowspan="${sp}">${e(f.area)}${f.areaTime ? `<small>${e(f.areaTime)}</small>` : ""}</td>` : ""}<td class="t">${e(opsTail(a.tail, OPS.day))}</td><td class="t">${e(a.config)}</td><td class="rm">${eod ? `<b>${e(opsResText(a, L, true))}</b>` : `${opsIrtBad(a) ? `<b>⚠ ${OPS_IRT_MSG}</b> ` : ""}${nl(a.rmks)}`}</td></tr>`;
      });
      rows += `</tbody>`;
    });
    return rows;
  }).join("");
  const fly = `<table class="g fly"><colgroup><col style="width:3.5%"><col style="width:11%"><col style="width:10%"><col style="width:2.5%"><col style="width:21%"><col style="width:11%"><col style="width:11%"><col style="width:5.5%"><col style="width:4.5%"><col></colgroup>
    <thead><tr><th>No</th><th>${eod ? "ATD–ATA" : "ETD–ETA <small>brief · step</small>"}</th><th>Callsign</th><th>#</th><th>Aircrew</th><th>Mission</th><th>Area</th><th>A/C</th><th>Cfg</th><th>${eod ? "Result" : "Remarks"}</th></tr></thead>${flying}</table>`;
  // Simulator: No · ETD–ETA · Callsign · Aircrew / Console · Mission (FMS, cfg) · Remarks.
  let sn = 0;
  const sims = (sim.rows || []).filter(opsSimUsed).map((s, si) => `<tbody class="fl${si % 2 ? " alt" : ""}">` + (s.ac || []).filter((a, i) => i === 0 || opsLineUsed(a)).map((a, i, arr) =>
    `<tr><td class="no">${opsLineUsed(a) ? String(++sn).padStart(2, "0") : ""}</td>${i === 0 ? `<td rowspan="${arr.length}" class="t"><b>${e(s.etd)}</b>–${e(s.eta)}</td><td rowspan="${arr.length}" class="cs"><b>${e(s.callsign)}</b></td>` : ""}<td>${e(a.n ? a.n + " " : "")}${crew(a)}</td><td>${e(a.mission)}${a.fms || a.config ? `<small>${[a.fms ? "FMS " + e(a.fms) : "", e(a.config)].filter(Boolean).join(" · ")}</small>` : ""}</td><td class="rm">${nl(a.rmks)}</td></tr>`).join("") + `</tbody>`).join("");
  const ground = (opsGet("ground").groups || []).filter(g => (g.rows || []).length).map(g => `<tbody class="fl"><tr class="gh"><td colspan="4">${e(g.name)}</td></tr>${g.rows.map(r => `<tr><td class="t"><b>${e(r.time)}</b></td><td>${e(r.event)}</td><td>${e(r.personnel)}</td><td>${e(r.venue)}</td></tr>`).join("")}</tbody>`).join("");
  const af = opsGet("airfield"), nt = opsGet("notes");
  const box = (title, body) => body ? `<div class="box"><div class="bt">${title}</div>${body}</div>` : "";
  const kv = (k, v) => v ? `<tr><th>${k}</th><td>${nl(v)}</td></tr>` : "";
  const listT = rows => rows.length ? `<table class="g lt">${rows.map(r => `<tr><td><b>${e(r[0])}</b></td><td>${e(r[1])}</td></tr>`).join("")}</table>` : "";
  const fs = eod ? opsFlownStats(fl) : null;
  const nums = `<div class="nums">${[["Daily req", h.dailyReq], ["Sorties", st.sorties], ["Hours", st.hours], ["First T/O", opsHM(st.first)], ["Last LDG", opsHM(st.last)], ["HH:MM", opsHM(st.span)],
    ...(eod ? [["Flown", fs.sorties], ["Flown h", opsHrs(fs.mins) || "0.0"], ["CX / open", `${fs.cx} / ${fs.open}`]] : [])].map(([k, v]) => `<div><small>${k}</small><b>${e(v ?? "")}</b></div>`).join("")}</div>`;
  const briefs = `<table class="kv">${kv("In time", h.inTime)}${kv("Late in", h.lateIn)}${kv("WX / NTM", h.wxBrief)}${kv("MODB", h.modb)}${kv("Night ops brief", h.nightBrief)}${kv("EOWD", h.eowd)}${kv("SII of the qtr", h.sqnSii)}${kv("Emer of the day", h.emer)}</table>`;
  const pp = [["Tower", h.tower], ["DI", h.di], ["SDO", h.sdo], ["TDO", h.tdo]].filter(x => x[1]);
  const people = `<table class="kv">${Array.from({ length: Math.ceil(pp.length / 2) }, (_, i) => `<tr>${pp.slice(i * 2, i * 2 + 2).map(([k, v]) => `<th>${k}</th><td>${nl(v)}</td>`).join("")}</tr>`).join("")}${h.gym ? `<tr><th>Gym / SFT</th><td colspan="3">${nl(h.gym)}</td></tr>` : ""}</table>`;
  const duties = (opsGet("duties").groups || []).filter(g => (g.rows || []).length).map(g => `<table class="g dt"><thead><tr><th colspan="${waves.length + 1 + (g.hours ? 3 : 0)}">${e(g.name)}</th></tr><tr class="sub"><th>Name</th>${waves.map((w, j) => `<th>W${j + 1}</th>`).join("")}${g.hours ? "<th>In</th><th>Out</th><th>Duty</th>" : ""}</tr></thead><tbody>${opsDutyRows(g).map(r => {
    const auto = opsAuto(r.name, fl, sim);
    let hrs = ""; if (g.hours) { const io = opsInOut(r), ii = opsMin(io.in), oo = opsMin(io.out); hrs = `<td class="t">${e(io.in)}</td><td class="t">${e(io.out)}</td><td class="t">${ii != null && oo != null ? opsHM(opsSpan(ii, oo)) : ""}</td>`; }
    return `<tr><td><b>${e(r.name)}</b></td>${waves.map((w, j) => `<td class="t">${e(opsCell(auto[j] || [], (r.cells || [])[j]))}</td>`).join("")}${hrs}</tr>`;
  }).join("")}</tbody></table>`).join("");
  let el = document.getElementById("opsPrint");
  if (!el) { el = document.createElement("div"); el.id = "opsPrint"; document.body.appendChild(el); }
  el.innerHTML = `<div class="pg">
    <div class="top"><div class="ttl">150 SQUADRON ${eod ? "ACTUAL DAY PROGRAM" : "FLYING PROGRAM"}<span>${e(opsLongDay(OPS.day))}</span></div><div class="cls">OFFICIAL (CLOSED)</div></div>
    <div class="strip">${box("Briefs", briefs)}${box("Day", nums + people)}</div>
    <div class="main"><div class="l">${fly}</div><div class="r">
      ${sims ? box("Simulator program", `<table class="g sm"><colgroup><col style="width:7%"><col style="width:17%"><col style="width:15%"><col style="width:27%"><col style="width:20%"><col></colgroup><thead><tr><th>No</th><th>${eod ? "ATD–ATA" : "ETD–ETA"}</th><th>Callsign</th><th>Aircrew / Console</th><th>Mission</th><th>Rmks</th></tr></thead>${sims}</table>`) : ""}
      ${ground ? box("Ground program", `<table class="g sm"><colgroup><col style="width:13%"><col style="width:33%"><col style="width:36%"><col></colgroup><thead><tr><th>Time</th><th>Event</th><th>Personnel</th><th>Venue</th></tr></thead>${ground}</table>`) : ""}
      ${box("Airfield restrictions", listT([...(af.rows || []).map(r => [r.time, r.what]), ...(af.sunset ? [[af.sunset, "SUNSET"]] : [])]))}
      ${box("Currencies", listT((nt.currencies || []).map(r => [r.who, r.note])))}
      ${box("Aircraft restrictions", listT((nt.aircraft || []).map(r => [r.ac, r.note])))}
    </div></div>
    <div class="sign"><span>Planned by <b>${e(h.plannedBy)}</b></span><span>Vetted &amp; approved by <b>${e(h.vettedBy)}</b></span><span>Currency checked by <b>${e(h.currencyBy)}</b></span><span class="stamp">Printed ${e(new Date().toLocaleString("en-GB"))}</span><span class="cls">OFFICIAL (CLOSED)</span></div>
  </div>
  ${duties ? `<div class="pg pg2"><div class="top"><div class="ttl">DUTIES<span>${e(opsLongDay(OPS.day))}</span></div><div class="cls">OFFICIAL (CLOSED)</div></div><div class="duties">${duties}</div></div>` : ""}`;
  opsPrintFit(el);
  window.print();
}
// One page (Gordon, 12 Oct "see the entire program in one page"): lay the sheet out at A4-landscape width, measure it and
// shrink it with zoom until it fits one page (widening the layout as it shrinks so the space is used). Floor 0.55, then it
// simply runs onto a second page.
function opsPrintFit(el) {
  el.classList.add("measure");
  el.querySelectorAll(".pg").forEach(pg => opsPrintFitPage(pg, pg.classList.contains("pg2") ? 1.6 : 1.3));
  el.classList.remove("measure");
}
// Page 1 (programme) and page 2 (duties) are each fitted to one page; a quiet day prints larger (up to max).
function opsPrintFitPage(pg, max) {
  const mm = 96 / 25.4, W = 281 * mm, H = 189 * mm; let z = 1;
  // Balance the two columns: move notes boxes from the bottom of the right column under the flying lines while that
  // makes the taller column shorter.
  pg.style.zoom = 1; pg.style.width = W + "px";
  const L = pg.querySelector(".main .l"), R = pg.querySelector(".main .r");
  for (let k = 0; k < 6 && R && L; k++) {
    const bx = R.lastElementChild; if (!bx) break;
    const lh = L.offsetHeight, rh = R.offsetHeight, bh = bx.offsetHeight + 6;
    if (Math.max(lh + bh, rh - bh) >= Math.max(lh, rh)) break;
    let nb = L.querySelector(".lnotes"); if (!nb) { nb = document.createElement("div"); nb.className = "lnotes"; L.appendChild(nb); }
    nb.insertBefore(bx, nb.firstChild);
  }
  for (let i = 0; i < 8; i++) { pg.style.zoom = 1; pg.style.width = W / z + "px"; const hh = pg.scrollHeight, nz = Math.max(0.55, Math.min(max, H / hh)); if (Math.abs(nz - z) < 0.005) { z = nz; break; } z = nz; }
  pg.style.width = W / z + "px"; pg.style.zoom = z;
}

/* ---------- Attendance for a brief (Gordon, 12 Oct): who should be at the Ops brief / WX-NOTAM / EOWD and who's away ---------- */
// For the briefer to copy onto his slides. People: every login except engineers and FSI; ST Tow only if flying that day;
// trainees from the roster. Away when, at the brief time (Z): on leave / out of base (movement board, today), late in (named
// with a later time in the In time / Late in lines), flying (flight brief to landing + 30 min), in sims (sim start − 1 h to
// end + 30 min, incl. SXO / SUPP named in the sim remarks), SXO / OPS O of a wave under way, a ground event, or a typed duty note.
const ATT = { ev: "", t: "" };
function opsAttEvents(h) {
  const tm = s => { const m = /(\d{4})\s*Z?/.exec(String(s || "")); return m ? m[1] : ""; };
  const ob = /(?:OPS BRIEF|SODB)\s*:?\s*(\d{4})/i.exec(`${h.inTime || ""}\n${h.lateIn || ""}`);
  return [["ops", "Ops brief", ob ? ob[1] : ""], ["wx", "WX / NOTAM brief", tm(h.wxBrief)], ["modb", "MODB", tm(h.modb)], ["night", "Night ops brief", tm(h.nightBrief)], ["eowd", "EOWD", tm(h.eowd)], ["other", "Other time", ""]];
}
function opsAttPeople(fl) {
  const flying = new Set(); for (const w of fl.waves || []) for (const f of w.flights || []) for (const a of f.ac || []) for (const n of [a.crew1, a.crew2]) if (opsNorm(n)) flying.add(opsNorm(n));
  const out = [], seen = new Set(), add = (grp, name, extra) => { const n = opsNorm(name); if (!n || seen.has(n)) return; seen.add(n); out.push({ grp, name: n, ...extra }); };
  const profs = (S.profiles || []).filter(p => p.display_name && !p.trainee_id);
  profs.filter(p => p.role === "admin" && !["CC", "FIC"].includes(p.appointment)).sort(instrSort).forEach(p => add("QFI", p.display_name));
  profs.filter(p => p.role === "admin" && p.appointment === "FIC").forEach(p => add("FIC", p.display_name));
  profs.filter(p => p.staff_role === "ST" && flying.has(opsNorm(p.display_name))).forEach(p => add("ST Tow", p.display_name));
  const rank = c => /PGF/i.test(c) ? 0 : /FWC/i.test(c) ? 1 : /WSO/i.test(c) ? 2 : 3;
  active().slice().sort((a, b) => rank(a.course || "") - rank(b.course || "") || String(a.course || "").localeCompare(String(b.course || ""), undefined, { numeric: true }) || a.name.localeCompare(b.name)).forEach(t => add("Trainees", t.name, { tid: t.id, course: t.course }));
  profs.filter(p => p.role === "admin" && p.appointment === "CC").forEach(p => add("CEN", p.display_name));
  profs.filter(p => ["HD CEN", "CEN"].includes(p.staff_role)).sort((a, b) => (a.staff_role === "HD CEN" ? 0 : 1) - (b.staff_role === "HD CEN" ? 0 : 1)).forEach(p => add("CEN", p.display_name));
  profs.filter(p => p.role !== "admin" && (!p.staff_role || p.staff_role === "AOSX")).forEach(p => add("AOSX", p.display_name));
  profs.filter(p => p.staff_role === "ATCO").forEach(p => add("ATCO", p.display_name));
  return out;
}
// Why a person isn't at the brief at time t (minutes Z), or "".
function opsAttWhy(x, t, ctx) {
  const { fl, sim, ground, duties, h, today, wins } = ctx, n = x.name, hm = m => opsZ4(((m % 1440) + 1440) % 1440);
  if (x.tid) {
    const lv = (S.leaves || []).find(l => l.trainee_id === x.tid && (!l.until || l.until >= OPS.day));
    if (lv) return `On leave${lv.until ? " till " + cuFmt(lv.until) : ""}`;
    if (today) { const o = (S.open || []).find(m => m.status === "out" && (m.member_ids || []).includes(x.tid)); if (o) return `Out of base (${o.destination || "booked out"})`; }
  }
  for (const [txt, late] of [[h.lateIn, true], [h.inTime, false]]) for (const m of String(txt || "").matchAll(/(\d{4})\s*Z?\s*\(([^)]*)\)/g)) {
    if (m[2].split(/[,/]/).some(s => opsNorm(s) === n)) { const it = opsMin(m[1]); if (it != null && it > t) return `Late in ${m[1]}Z`; if (late) break; }
  }
  for (const w of fl.waves || []) for (const f of w.flights || []) for (const a of f.ac || []) {
    if (!opsCrewHas(a, n)) continue;
    const etd = opsMin(f.etd), s = [f.brief, f.step].map(opsMin).find(v => v != null) ?? (etd != null ? etd + opsAutoOff().brief : null), e = opsMin(f.eta);
    if (s != null && e != null && t >= s && t <= e + 30) return `Flying · ${[f.callsign, a.n].filter(Boolean).join(" ")} ${f.etd}–${f.eta}Z (${w.name})`;
  }
  for (const r of sim.rows || []) for (const a of r.ac || []) {
    const role = opsSimRole(a, n); if (!role) continue;
    const s = opsMin(r.etd), e = opsMin(r.eta);
    if (s != null && e != null && t >= s - 60 && t <= e + 30) return `Sims${role !== "crew" ? " (" + role + ")" : ""} · ${r.callsign || ""} ${r.etd}–${r.eta}Z`;
  }
  for (let i = 0; i < (fl.waves || []).length; i++) { const w = fl.waves[i], win = wins[i]; if (!win || win.s == null || t < win.s || t > win.e) continue;
    if (opsHas(w.sxo, n)) return `SXO ${w.name}`; if (opsHas(w.opsO, n)) return `OPS O ${w.name}`; }
  for (const g of ground.groups || []) for (const r of g.rows || []) {
    if (!opsGroundHas(r.personnel, n) && !(x.course && opsGroundHas(r.personnel, x.course))) continue;
    const s = opsMin(r.time), e = opsEndMin(r.time) ?? (s != null ? s + 60 : null);
    if (s != null && t >= s && t < e) return `${r.event || "Ground event"} ${hm(s)}Z${r.venue ? " · " + r.venue : ""}`;
  }
  const wi = opsTimeWave(hm(t), wins);
  if (wi >= 0) for (const g of duties.groups || []) { const r = (g.rows || []).find(r => opsNorm(r.name) === n); const c = r && String((r.cells || [])[wi] || "").trim(); if (c) return `Duty: ${c}`; }
  return "";
}
function opsAttendance() {
  if (OPS.rowsDay !== OPS.day) return toast("Still loading.");
  const h = opsGet("header"), evs = opsAttEvents(h);
  if (!ATT.ev || !evs.find(e => e[0] === ATT.ev)) { const f = evs.find(e => e[2]) || evs[evs.length - 1]; ATT.ev = f[0]; ATT.t = f[2]; }
  let d = document.getElementById("dlgAtt");
  if (!d) { d = document.createElement("dialog"); d.id = "dlgAtt"; document.body.appendChild(d);
    d.onclick = e => { if (e.target.closest("[data-x=close]") || e.target === d) return d.close();
      if (e.target.closest("[data-x=copy]")) { const txt = d.querySelector("textarea").value; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast("Copied. Paste it into your slides."), () => { d.querySelector("textarea").select(); document.execCommand("copy"); toast("Copied."); }); } };
    d.onchange = e => { if (e.target.id === "attEv") { ATT.ev = e.target.value; ATT.t = (opsAttEvents(opsGet("header")).find(x => x[0] === ATT.ev) || [])[2] || ATT.t; } if (e.target.id === "attT") ATT.t = e.target.value.replace(/\D/g, "").padStart(4, "0").slice(-4); opsAttendance(); }; }
  const t = opsMin(ATT.t), fl = opsNameWaves(opsGet("flying")), ev = evs.find(e => e[0] === ATT.ev);
  const ctx = { fl, sim: opsGet("sim"), ground: opsGet("ground"), duties: opsGet("duties"), h, today: OPS.day === todayStr(), wins: opsWindows(fl) };
  const ppl = opsAttPeople(fl).map(x => ({ ...x, why: t == null ? "" : opsAttWhy(x, t, ctx) }));
  const grps = [...new Set(ppl.map(x => x.grp))], here = ppl.filter(x => !x.why), away = ppl.filter(x => x.why);
  const title = `${(ev ? ev[1] : "Brief").toUpperCase()}${t != null ? " " + ATT.t + "Z" : ""} · ${opsLongDay(OPS.day).toUpperCase()}`;
  const text = [title, "", `ATTENDING (${here.length})`, ...grps.map(g => { const ns = here.filter(x => x.grp === g).map(x => x.name); return ns.length ? `${g}: ${ns.join(", ")}` : ""; }).filter(Boolean), "", `NOT ATTENDING (${away.length})`, ...away.map(x => `${x.name} – ${x.why}`)].join("\n");
  d.innerHTML = `<div class="dlg"><div class="opshead"><h2>Attendance</h2><span class="grow"></span><button class="btn small primary" data-x="copy">Copy list</button><button class="btn small" data-x="close">Close</button></div>
    <div class="attbar"><select id="attEv">${evs.map(([k, l, tt]) => `<option value="${k}"${k === ATT.ev ? " selected" : ""}>${esc(l)}${tt ? " · " + tt + "Z" : ""}</option>`).join("")}</select><label>Time (Z) <input id="attT" value="${esc(ATT.t)}" inputmode="numeric" maxlength="4" placeholder="0800"></label><span class="hint">${t == null ? "Key in the brief time." : `${here.length} attending · ${away.length} away`}</span></div>
    ${t == null ? "" : `<div class="attcols"><div><h3>Attending (${here.length})</h3>${grps.map(g => { const ns = here.filter(x => x.grp === g); return ns.length ? `<div class="attg"><b>${esc(g)}</b> <span class="hint">${ns.length}</span><div>${ns.map(x => esc(x.name)).join(", ")}</div></div>` : ""; }).join("")}</div>
      <div><h3>Not attending (${away.length})</h3>${away.length ? `<table class="opst attaway"><tbody>${away.map(x => `<tr><td><b>${esc(x.name)}</b><small class="hint">${esc(x.grp)}</small></td><td>${esc(x.why)}</td></tr>`).join("")}</tbody></table>` : `<p class="hint">Everyone should be there.</p>`}</div></div>
      <details class="atttxt"><summary>Text to copy</summary><textarea readonly rows="10">${esc(text)}</textarea></details>`}
    <p class="hint" style="margin:8px 0 0">Away = on leave / out of base, late in (from the In time / Late in lines), flying (flight brief to landing + 30 min), sims (start − 1 h to end + 30 min, incl. the SXO / SUPP in the sim remarks), SXO / OPS O of a wave under way, a ground event, or a duty note. ST Tow are listed only on days they fly; engineers and FSI aren't listed.</p></div>`;
  if (!d.open) d.showModal();
}
// Flown totals for the end-of-day sheet: every flown line counts (ops adds too), CX and lines not yet logged are counted separately.
function opsFlownStats(fl) {
  let sorties = 0, mins = 0, cx = 0, open = 0;
  for (const w of fl.waves || []) for (const f of w.flights || []) for (const a of f.ac || []) {
    if (!opsLineUsed(a)) continue;
    const L = a.log || {}, m = opsLogMins(L);
    if (opsFlown(L) && m != null) { sorties++; mins += m; } else if (L.st === "cx") cx++; else if (!opsIsAdd(f, a)) open++;
  }
  return { sorties, mins, cx, open };
}

/* ---------- styles ---------- */
(() => {
  const s = document.createElement("style");
  s.textContent = `
.opsautot{color:var(--muted)}
table.opsgnd{table-layout:fixed;width:100%}table.opsgnd td{overflow-wrap:anywhere}
.attbtn{opacity:.7}#dlgAtt{width:min(1100px,calc(100vw - 16px))}.attbar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:0 0 10px}.attbar select,.attbar input{width:auto;margin:0;padding:4px 6px}.attbar input{width:70px}
.attcols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:14px}.attcols h3{margin:0 0 6px;font-size:1rem}.attg{margin:0 0 8px}.attg div{line-height:1.5}
table.attaway{min-width:0;width:100%}.attaway td{padding:4px 6px;vertical-align:top}.attaway small{display:block}.atttxt{margin-top:10px}.atttxt textarea{width:100%;font:12px/1.4 ui-monospace,monospace}
.opslog td.lgres select{width:auto;margin:0 0 2px;padding:3px 4px;display:block}.lgcxl{display:block;font-size:.75rem;color:var(--late);margin-bottom:2px}.opsres{display:block;font-size:.72rem;font-weight:700;color:var(--out)}
.opswarn td{color:var(--late);font-size:.85rem;padding-top:0}.opsirt{color:var(--late);font-weight:600;font-size:.85em}
.opsbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px}
.opsbar.grp{gap:8px 18px;align-items:flex-end;margin-bottom:12px}
.opsgrp{display:flex;flex-direction:column;gap:3px}.opsgrpl{font:700 .68rem var(--cond);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.opsgrpb{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.opsgrp+.opsgrp{padding-left:18px;border-left:1px solid var(--line)}.grow+.opsgrp{padding-left:0;border-left:0}
@media (max-width:700px){.opsbar.grp .grow{flex-basis:100%;height:0}.opsgrp+.opsgrp{padding-left:0;border-left:0}}
.opsbar input[type=date]{width:auto;padding:5px 8px}
.opsbar .grow,.opsed .grow{flex:1}
.opstitle{font:700 1.4rem/1.1 var(--cond);margin:4px 0 12px;text-transform:uppercase}
.opstitle span{display:block;font:500 .95rem var(--body);color:var(--muted);text-transform:none;margin-top:2px}
.opscard{margin-bottom:14px}
.opshead{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.opshead h2{margin:0}
.opsmeta{font-size:.78rem;color:var(--muted);display:flex;align-items:center;gap:8px}
.opsbanner{border:1px solid var(--out);background:color-mix(in srgb,var(--out) 12%,transparent);border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:.9rem}
.opsmine{border-left:4px solid var(--out)} .opsmine ul{margin:0;padding-left:18px} .opsmine li{margin:3px 0}
.opsstats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:6px;overflow:hidden;margin-bottom:10px}
@media (min-width:700px){.opsstats{grid-template-columns:repeat(6,1fr)}}
.opsstats div{background:var(--paper);padding:6px 10px}
.opsstats b{display:block;font:700 1.4rem/1.1 var(--cond);font-variant-numeric:tabular-nums}
.opsstats span{font-size:.75rem;color:var(--muted)}
.opsdl{display:grid;grid-template-columns:minmax(90px,max-content) 1fr;gap:4px 14px;margin:0 0 6px;font-size:.9rem}
.opsdl dt{color:var(--muted)} .opsdl dd{margin:0}
.opswave{margin:16px 0 6px;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline;font-size:.9rem}
.opswave:first-child{margin-top:0}
.opswave b{font:700 1.15rem var(--cond);text-transform:uppercase}
.opswave span{color:var(--muted)} .opswave strong{color:var(--ink);font-weight:600}
.opsrmk{color:var(--out);font-size:.85rem;margin:0 0 6px;font-weight:600;padding:4px 10px;border-radius:4px;background:color-mix(in srgb,var(--out) 12%,transparent)}
/* Flying program table: fixed columns so every wave lines up; one shaded block per flight */
.opswave{border-left:4px solid var(--in);padding:4px 0 4px 10px;background:color-mix(in srgb,var(--in) 8%,transparent);border-radius:0 4px 4px 0}
.opswave.night{border-left-color:#8b5cf6;background:color-mix(in srgb,#8b5cf6 10%,transparent)}
.opswavest{margin-left:auto;padding-right:10px;font-size:.8rem}
table.opsfly{table-layout:fixed;min-width:940px;width:100%;border-collapse:collapse}
table.opsfly td{font-family:var(--body)}
table.opsfly td,table.opsfly th{vertical-align:top;padding:6px 8px}
table.opsfly tbody.fl{border-top:2px solid var(--line)}
table.opsfly tbody.fl:nth-of-type(even){background:color-mix(in srgb,var(--muted) 7%,transparent)}
table.opsfly tbody.fl tr+tr td{border-top:1px dashed color-mix(in srgb,var(--line) 70%,transparent)}
table.opsfly td.tm b{display:block;font-variant-numeric:tabular-nums;white-space:nowrap}
table.opsfly td.tm small.bs{overflow:visible;position:relative;z-index:1} /* brief / step runs on under ETA */
table.opsfly td.tm{overflow:visible}
table.opsfly .act{font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ok,#1F8A4C);font-weight:600}
table.opsfly th.act{color:var(--muted)}
table.opsfly td.act{background:color-mix(in srgb,var(--ok,#1F8A4C) 6%,transparent)}
table.opsfly td small{display:block;color:var(--muted);font-size:.74rem;white-space:nowrap;margin-top:2px}
table.opsfly td.cs{font:700 .95rem var(--cond);letter-spacing:.02em;white-space:nowrap}
table.opsfly td.no{font-variant-numeric:tabular-nums;color:var(--muted);font-weight:600}
table.opsfly td.n{color:var(--muted)}
table.opsfly td.fcrew{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
table.opsfly td.fcrew{font-weight:600}table.opsfly td.fcrew .c2{font-weight:400}
table.opsfly td.nw,table.opsfly td.area{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
table.opsfly td.rm{font-size:.8rem}
table.opsfly tr.opsadd td:not(.rs),table.opsfly tbody.opsadd td{color:var(--muted);font-style:italic}
.opsaddtag{display:inline-block;white-space:nowrap;font:700 .62rem var(--body);font-style:normal;letter-spacing:.03em;padding:1px 4px;border-radius:3px;border:1px dashed var(--muted);color:var(--muted)}
mark.opsme{white-space:nowrap}
.btn.danger{color:var(--late);border-color:color-mix(in srgb,var(--late) 60%,transparent)}.btn.danger:hover{background:color-mix(in srgb,var(--late) 15%,transparent)}
/* Duties: compact tables that sit side by side */
.opsduty{display:flex;flex-wrap:wrap;gap:4px 22px;align-items:flex-start}
.opsdutyg{flex:0 1 auto;min-width:0;max-width:100%}
.opsdutyg .opssub{margin:8px 0 4px}
table.opsdt{width:auto;min-width:0;border-collapse:collapse}
table.opsdt th,table.opsdt td{padding:3px 8px;white-space:nowrap;font-size:.84rem}
table.opsdt td.i{color:var(--muted);text-align:right;padding-right:4px}
table.opsdt td.nm{font-weight:600;padding-right:14px}
table.opsdt td.c{min-width:64px}
table.opsdt td.t{font-variant-numeric:tabular-nums;text-align:right}
table.opsdt tbody tr:nth-child(even){background:color-mix(in srgb,var(--muted) 7%,transparent)}
.dt{display:inline-block;padding:0 5px;border-radius:3px;font-size:.78rem;font-weight:600;margin-right:3px;line-height:1.5}
.dt-fly{background:color-mix(in srgb,var(--in) 22%,transparent);color:var(--ink)}
.dt-add{border:1px dashed var(--muted);color:var(--muted)}
.dt-sim{background:color-mix(in srgb,#8b5cf6 25%,transparent);color:var(--ink)}
.dt-duty{background:color-mix(in srgb,var(--out) 30%,transparent);color:var(--ink)}
.dt-txt{background:color-mix(in srgb,var(--muted) 16%,transparent);color:var(--ink)}
@media (min-width:1200px){.opsrow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 14px;align-items:stretch}.opsrow>:only-child{grid-column:1/-1}
  .opsrow>.card{margin-bottom:14px}.opsrow>.opsmine{grid-column:span 1}
  #ops-header .opsdl{grid-template-columns:max-content 1fr max-content 1fr;column-gap:20px}
  .opsmine ul{columns:2;column-gap:32px}.opsmine li{break-inside:avoid;margin:0 0 6px}}
@media (min-width:1500px){#ops-header .opsdl{grid-template-columns:max-content 1fr max-content 1fr max-content 1fr}}
.opssub{font:700 1rem var(--cond);margin:12px 0 4px;text-transform:uppercase}
.opssub:first-child{margin-top:0}
table.opst th,table.opst td{padding:5px 8px;font-size:.85rem}
table.opst tr.first td{border-top:2px solid var(--line)}
table.opst:not(.opsfly) tr.opsadd td{color:var(--muted)}
table.opsnarrow{min-width:560px}
mark.opsme{background:color-mix(in srgb,var(--out) 40%,transparent);color:inherit;border-radius:2px;padding:0 2px}
.opsed input:not([type=checkbox]),.opsed textarea{padding:4px 6px;font-size:.85rem;margin-top:2px}
.opsed textarea{min-height:0}
.opsed table{min-width:0;width:auto;margin-bottom:6px;background:none}
.opsed th,.opsed td{padding:2px 3px;border:0;font-size:.78rem;background:none}
.opsed .tablewrap{background:none;border:0}
.opsed .blk{border:1px solid var(--line);border-radius:6px;padding:8px;margin-bottom:10px;background:var(--field)}
.opsed .blk.flt{background:var(--paper)}
.opsed .tools{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.opsed .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 10px}
.opsed label{margin-bottom:6px}
.opsfly td.cs .opsdl,.opsfly td.cs .opsveh,.obwvac .opsdl,.obwvac .opsveh{display:block;font:600 .74rem var(--body);color:var(--muted);margin-top:2px;white-space:nowrap}
.opsveh::before{content:"🚐 "}.opsdl.bad,.opsveh.bad{color:var(--late)}.opsdl.bad::after,.opsveh.bad::after{content:" ⚠"}
.opsplan{font-size:.8rem}.opsplan .opsplanw{display:block;color:var(--late);font-size:.75rem;white-space:normal;max-width:220px}
.opslog td{vertical-align:middle;padding:4px 6px}
.opslog td small{display:block;color:var(--muted);font-size:.75rem}
.opslog td.lgcs{white-space:nowrap}.opslog td.lgcs .btn{margin-top:4px}
.opslog input{width:72px;margin:0;padding:4px 6px;font-variant-numeric:tabular-nums}
.opslog input[data-instr]{width:58px}.opslog td.lgif{white-space:nowrap}.lgifp{display:flex;align-items:center;gap:3px;margin:1px 0}.lgifp small{width:62px;overflow:hidden;text-overflow:ellipsis;color:var(--muted);font-size:.7rem}.opslog .lgifp input{width:44px;padding:3px 4px}.opslog input.lgset{border-color:var(--out)}.opslog input[data-instr]::placeholder{font-style:italic}
.opslog td.lghrs{font-weight:700;font-variant-numeric:tabular-nums;min-width:40px}
.opslog td.lgbtn{white-space:nowrap}.opslog td.lgbtn .btn{margin-left:4px}
.opslog tr.lgf td{border-top:2px solid var(--line)}
.opslog tr.lgwv td{font:700 .95rem var(--cond);text-transform:uppercase;background:color-mix(in srgb,var(--in) 10%,transparent);padding:4px 8px}
.hrchart{margin:0 0 12px;display:flex;flex-direction:column;gap:4px}
.hrleg{display:flex;gap:14px;font-size:.8rem;color:var(--muted);margin-bottom:4px}.hrleg span{display:inline-flex;align-items:center;gap:5px}
.hrsw{display:inline-block;width:10px;height:10px;border-radius:2px}.hrsw.in{background:var(--accent)}.hrsw.fl{background:color-mix(in srgb,var(--accent) 35%,transparent)}
.hrbar{display:grid;grid-template-columns:110px 1fr 74px;gap:8px;align-items:center;font-size:.85rem}
.hrbar .hrn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hrbar.me .hrn{font-weight:700}
.hrtrack{height:14px;display:block}.hrfill{display:block;height:100%;background:color-mix(in srgb,var(--accent) 35%,transparent);border-radius:0 4px 4px 0;min-width:2px;overflow:hidden}
.hrin{display:block;height:100%;background:var(--accent);border-right:2px solid var(--paper)}
.hrv{font-variant-numeric:tabular-nums;text-align:right;color:var(--ink)}.hrv small{color:var(--muted)}
.opslog tr.lgok td.lgcrew{box-shadow:inset 3px 0 0 var(--ok,#1F8A4C)}
.opslog tr.lgcx td.lgcrew{box-shadow:inset 3px 0 0 var(--late);opacity:.7}
@media (max-width:700px){ /* phone: flight on its own line, then crew | T/O | LDG | hrs | buttons */
  .opslog,.opslog tbody{display:block;min-width:0}.opslog thead{display:none}
  .opslog tr{display:grid;grid-template-columns:minmax(0,1fr) 62px 62px 30px auto;align-items:center;gap:0 4px}
  .opslog tr.lgwv{display:block}.opslog td.lgcs{grid-column:1/-1;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .opslog td.lgcs small{display:inline}.opslog td.lgcs .btn{margin:0 0 0 auto}
  .opslog input{width:58px;padding:4px}.opslog td{padding:3px 2px}}
.opsflown{display:inline-block;font-size:.75rem;font-weight:600;color:var(--ok,#1F8A4C);white-space:nowrap}
.opscx{display:inline-block;font-size:.7rem;font-weight:700;color:var(--late);border:1px solid var(--late);border-radius:3px;padding:0 4px}
.hrsper{display:inline-flex;align-items:center;gap:6px;margin:0;font-size:.9rem}.hrsper select{width:auto;margin:0}
.hrst td.n,.hrst th.n{text-align:right;font-variant-numeric:tabular-nums}
.hrst tr.hrrow{cursor:pointer}.hrst tr.hrrow:hover td{background:color-mix(in srgb,var(--muted) 8%,transparent)}
.hrst tr.none{cursor:default}.hrst tr.none td{color:var(--muted)}
.hrst tr.me td{background:color-mix(in srgb,var(--in) 10%,transparent)}
.hrst tr.hrdet>td{padding:4px 8px 12px 24px}.hrst tr.hrdet table{font-size:.85rem}
.tvspd{display:inline-flex;align-items:center;gap:6px;margin:0;font-size:.85rem;color:var(--muted)}
.tvspd select{width:auto;margin:0;padding:3px 6px;font-size:.85rem}
.flytv{display:grid;grid-template-columns:minmax(0,1.8fr) minmax(0,1fr);gap:12px}
.tvstage.phone .flytv{display:block;height:auto!important}.tvstage.phone .flytv .card.flypane{margin-bottom:10px;padding:8px}
.tvstage.phone .flytv .tvpane{overflow:visible;display:block}.tvstage.phone .flytv .tvpane>.tablewrap{overflow-x:auto}
.tvstage.phone .tvbar{flex-wrap:wrap;gap:4px 10px}
table.flyph{width:100%;min-width:0!important;table-layout:fixed;margin-bottom:6px}
.flyph col.c1{width:8%}.flyph col.c2{width:27%}.flyph col.c3{width:36%}.flyph col.c4{width:13%}.flyph.logged col.c3{width:28%}.flyph col.c5{width:20%}
.flyph td.no{white-space:nowrap;font-size:.78rem}.flyph td.tm b,.flyph td.act b{white-space:nowrap;font-size:.82rem;letter-spacing:-.02em}.tvstage.phone .tvbar b{font-size:1rem}.tvstage.phone .tvclock{font-size:1.1rem}
.flyph td{padding:4px 4px!important;vertical-align:top;overflow-wrap:anywhere;line-height:1.25!important}
.flyph td small{display:block;font-size:.72rem;color:var(--muted);font-weight:400}
.flyph tr.f td{border-top:1px solid var(--line)}.flyph tr.rmk td{border-top:0;padding-top:0!important;font-size:.75rem;color:var(--out);font-style:italic}
.flyph td.act{background:color-mix(in srgb,var(--ok,#1F8A4C) 10%,transparent)}.flyph td.act b{color:var(--ok,#1F8A4C)}
.flyph tr.opsadd td{font-style:italic;opacity:.85}
body.tvmode.tvscroll{overflow:visible!important;height:auto!important;touch-action:auto}html:has(body.tvscroll){overflow:visible!important;height:auto!important}
.flyph td.tm .opsdl,.flyph td.tm .opsveh{display:inline-block;font:600 .72rem var(--body);color:var(--muted);margin:2px 8px 0 0;white-space:nowrap}.flyph .opsplan{display:block}
/* Fixed windows (Gordon, 10 Oct): the page doesn't scroll; each window scrolls inside itself. */
.flytvl,.flytvr{display:flex;flex-direction:column;min-height:0}
.flytv .card.flypane{display:flex;flex-direction:column;min-height:0;margin:0;padding:10px 12px}
.flytvl .flypane{flex:1 1 auto}
.flytvr .flypane.sim{flex:0 1 auto;margin-bottom:12px}
.flytvr .flypane.gnd{flex:1 1 auto}
.flytv .tvpane{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;display:flex;flex-direction:column}
/* Slim, see-through scroll bars in the TV windows (Gordon, 10 Oct); a little clearer on hover */
.flytv .tvpane{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--muted) 30%,transparent) transparent}
.flytv .tvpane:hover{scrollbar-color:color-mix(in srgb,var(--muted) 60%,transparent) transparent}
.flytv .tvpane::-webkit-scrollbar{width:5px}
.flytv .tvpane::-webkit-scrollbar-track{background:transparent}
.flytv .tvpane::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--muted) 30%,transparent);border-radius:3px}
.flytv .tvpane:hover::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--muted) 60%,transparent)}
.flytv .tvpane::-webkit-scrollbar-button{display:none;height:0}
.flytv .tvpane>*{flex-shrink:0}
.flytv .tvpane>.tablewrap{overflow:visible;flex:1 0 auto}
.flytv .tvpane>.tablewrap>table,.flytv .flypane.gnd .tvpane>table{height:100%}
.flytv .flypane.gnd .tvpane>table{flex:1 0 auto}
.flytv.measure{height:auto!important}
.flytv.measure .flytvr{visibility:hidden;height:0;overflow:hidden}
.flytv.measure .tvpane{overflow:visible}
.flytv.measure .tvpane>.tablewrap{flex-grow:0!important}
.flytv.measure table{height:auto!important}
body.tvmode .flytv td,body.tvmode .flytv th{padding:3px 6px!important;line-height:1.25}
/* Flying lines a little more spaced out (Gordon, 10 Oct) */
body.tvmode .flytv .fly td{padding:6px 6px!important;line-height:1.35}
body.tvmode .flytv .fly .opswave{margin:12px 0 5px;padding:5px 0 5px 10px}
body.tvmode .flytv .fly .opswave:first-child{margin-top:0}
body.tvmode .flytv td{font-weight:500}
body.tvmode .flytv table.opsfly{min-width:0}
body.tvmode .flytv td.cs{white-space:normal}
body.tvmode .flytv .opsaddtag{font-size:.6rem;padding:0 3px}
body.tvmode .flytv td small{color:color-mix(in srgb,var(--ink) 65%,transparent);margin-top:0}
body.tvmode .flytv .opswave{margin:8px 0 3px;padding:3px 0 3px 10px}
body.tvmode .flytv .opswave:first-child{margin-top:0}
body.tvmode .flytv .opsrmk.inband{margin:0;padding:1px 8px;font-size:.85rem}
body.tvmode .flytv .opscard h2{margin:0 0 4px}
.flytvg tr.grp td{font:700 .8rem var(--cond);letter-spacing:.04em;text-transform:uppercase;color:var(--in);padding-top:6px!important;border-bottom:1px solid var(--line)}
.flytvr table{min-width:0!important;width:100%}
body.tvmode .flytvr td.nm{white-space:nowrap!important}.flytvr td,.flytvr th{white-space:normal!important}
@media (max-aspect-ratio:1/1){.flytv{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1.6fr) minmax(0,1fr)}.flytv.measure{grid-template-rows:auto}}
.opsed input.opsauto{color:var(--muted);font-style:italic}
.opsed input.opsman{border-color:var(--out);color:var(--ink);font-weight:600}
.opsed input.opsetd{border:2px solid var(--in);font-weight:700}
.opsed th.opsetdh{color:var(--in)!important;white-space:nowrap}
.opsed .opschk{display:flex;align-items:center;gap:4px;margin:0;color:var(--ink);white-space:nowrap}
.opsed .opschk input{width:auto;margin:0}
.opsauto{font-size:.7rem;color:var(--muted);margin-top:1px}
.opsfixed{white-space:nowrap;display:inline-block;padding:4px 6px 4px 0}
.opswavename{font:700 1.1rem var(--cond);margin-right:8px}
#opsPrint{position:absolute;left:-100000px;top:0;visibility:hidden}
#opsPrint.measure{visibility:hidden}
#opsPrint .pg{font:7.4pt/1.28 Arial,Helvetica,sans-serif;color:#111;background:#fff}
#opsPrint .pg *{box-sizing:border-box;background:transparent;color:#111;box-shadow:none;text-shadow:none;font-family:Arial,Helvetica,sans-serif;letter-spacing:0;text-transform:none;min-width:0;max-width:none;float:none}
#opsPrint th,#opsPrint td{font-size:inherit;line-height:1.28;font-weight:400;padding:1.3pt 2.6pt;text-align:left;vertical-align:top;border:0}
#opsPrint b{font-weight:700}
#opsPrint small{display:block;font-size:.84em;color:#5a6472;font-weight:400}
#opsPrint .top{display:flex;justify-content:space-between;align-items:center;border-bottom:1.5pt solid #1f3a5f;padding-bottom:2pt;margin-bottom:4pt}
#opsPrint .ttl{font-weight:700;font-size:12pt;color:#1f3a5f}#opsPrint .ttl span{font-size:9.5pt;color:#111;margin-left:12pt}
#opsPrint .cls{font-weight:700;letter-spacing:.12em;font-size:7.5pt;border:1pt solid #000;padding:.5pt 5pt}
#opsPrint .strip{display:grid;grid-template-columns:1.25fr 1fr;gap:5pt;margin-bottom:5pt}
#opsPrint .box{display:block;border:.6pt solid #b8c2cf;border-radius:3pt;padding:2.5pt 4pt;margin:0 0 5pt;background:#fff}
#opsPrint .strip .box{margin:0}
#opsPrint .bt{font-weight:700;font-size:6.6pt;text-transform:uppercase;letter-spacing:.08em;color:#1f3a5f;margin-bottom:1.5pt}
#opsPrint table{width:100%;border-collapse:collapse;font-size:7.4pt}
#opsPrint .kv th{width:1%;white-space:nowrap;color:#5a6472;font-weight:400;padding-right:5pt}
#opsPrint .kv tr+tr>*{border-top:.4pt solid #e3e7ec}
#opsPrint .nums{display:grid;grid-template-columns:repeat(9,auto);justify-content:start;gap:2pt;margin-bottom:2pt}
#opsPrint .nums div{background:#eef2f7;border-radius:2pt;padding:1pt 5pt;text-align:center}
#opsPrint .nums{font-size:6.6pt}#opsPrint .nums b{font-size:9pt;display:block}#opsPrint .nums small{color:#5a6472}
#opsPrint .lnotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:5pt;margin-top:5pt}#opsPrint .lnotes .box{margin:0}#opsPrint .main .l{display:flex;flex-direction:column}#opsPrint .main{display:grid;grid-template-columns:1.62fr 1fr;gap:5pt;align-items:start}
#opsPrint table.g{table-layout:fixed}
#opsPrint table.g thead th{background:#1f3a5f;color:#fff;font-size:.86em;text-transform:uppercase;letter-spacing:.03em;padding:1.8pt 2.6pt;font-weight:700}
#opsPrint table.g thead th small{color:#cfd8e3;display:inline;text-transform:none}
#opsPrint table.sm thead th{background:#55677e}
#opsPrint tbody.fl td{border-top:.4pt solid #e3e7ec}
#opsPrint tbody.fl tr:first-child td{border-top:.8pt solid #9aa7b6}
#opsPrint tbody.fl.alt td{background:#f3f6fa}
#opsPrint tbody.fl{break-inside:avoid}
#opsPrint tbody.wv td{background:#dfe6ef;color:#0f2540;padding:1.8pt 3pt;border-top:1.1pt solid #1f3a5f}
#opsPrint tbody.wv td *{color:#0f2540}#opsPrint tbody.wv td span{margin-left:10pt}#opsPrint tbody.wv td .ws{float:right;margin:0}
#opsPrint tbody.wv tr.wr td{background:#fff4d6;border-top:0;font-size:.92em;padding:1.2pt 3pt}#opsPrint tbody.wv tr.wr td,#opsPrint tbody.wv tr.wr td *{color:#6b4a00}
#opsPrint td.no{color:#7a8492}
#opsPrint td.t{white-space:nowrap;font-variant-numeric:tabular-nums}
#opsPrint td.rm{font-size:.92em;color:#333}
#opsPrint tr.ad td{font-style:italic}#opsPrint tr.ad td,#opsPrint tr.ad td *{color:#4a4a4a}
#opsPrint .oa{font-size:.78em;color:#8a5a00!important;font-style:normal;font-weight:700}
#opsPrint table.sm{font-size:6.9pt}
#opsPrint tr.gh td{background:#eef2f7;font-weight:700;font-size:.86em;text-transform:uppercase;letter-spacing:.03em}#opsPrint tr.gh td{color:#1f3a5f}
#opsPrint table.lt{font-size:7pt}#opsPrint .lt td{border-top:.4pt solid #e3e7ec}#opsPrint .lt tr:first-child td{border-top:0}#opsPrint .lt td:first-child{width:36%}
#opsPrint .pg2{break-before:page;page-break-before:always}#opsPrint .duties{display:flex;flex-wrap:wrap;gap:6pt 10pt;align-items:flex-start;margin-bottom:4pt}
#opsPrint .dt{width:auto;font-size:6.8pt}
#opsPrint .dt thead tr.sub th{background:#eef2f7;color:#5a6472;font-size:.84em}
#opsPrint .dt td{border-top:.4pt solid #e3e7ec;padding:.8pt 2.6pt}
#opsPrint .sign{font-size:7pt;display:flex;gap:16pt;align-items:center;border-top:.8pt solid #9aa7b6;padding-top:2pt;font-size:.95em;color:#444}
#opsPrint .sign span{color:#444}#opsPrint .sign b{color:#000}
#opsPrint .sign .stamp{margin-left:auto;font-size:.85em}
@media print{
  @page{size:A4 landscape;margin:7mm 8mm}
  html,body{background:#fff!important;color:#000!important;margin:0!important;padding:0!important}
  body>*:not(#opsPrint){display:none!important}
  body>#opsPrint{position:static;visibility:visible;-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;
  document.head.appendChild(s);
})();
