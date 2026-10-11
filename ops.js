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
  header: () => ({ inTime: "", lateIn: "", wxBrief: "", modb: "", nightBrief: "", sqnSii: "", emer: "", dailyReq: "", tower: "", di: "", sdo: "", tdo: "", gym: "", plannedBy: "", vettedBy: "", currencyBy: "" }),
  flying: () => ({ waves: [] }),
  sim: () => ({ rows: [] }),
  ground: () => ({ groups: ["GROUND PROGRAM", "QFI GROUND PROGRAM"].map(opsTpl.group) }),
  airfield: () => ({ rows: [], sunset: "" }),
  notes: () => ({ currencies: [], aircraft: [] }),
  duties: () => ({ groups: [opsTpl.dgroup("QFI", true), opsTpl.dgroup("ST TOW"), opsTpl.dgroup("TRAINEES"), opsTpl.dgroup("ATCO / AOSX")] }),
};
const OPS_HEADER_FIELDS = [
  ["inTime", "In time", 3], ["lateIn", "Late in", 2], ["wxBrief", "WX/NTM brief"], ["modb", "MODB"], ["nightBrief", "Night ops brief"],
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
  for (const s of sim.rows || []) if ((s.ac || []).some(a => opsCrewHas(a, n))) {
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
const OPS_OUT = { fly: 120, sim: 120, sxo: 0, opsO: 30 };
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
  for (const r of get("sim").rows || []) for (const a of r.ac || []) if (opsCrewHas(a, n)) { s0(r.etd); e0(r.eta, OPS_OUT.sim); }
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
  const fl = opsGet("flying"), st = opsStats(fl), n = new Date(), tw = opsFlyTvWaves(fl);
  const pane = (cls, key, title, body) => `<section class="card opscard flypane ${cls}">${title ? `<div class="opshead"><h2>${title}</h2></div>` : ""}<div class="tvpane" data-pane="${key}">${body || `<p class="hint" style="display:block;margin:0">Nothing entered.</p>`}</div></section>`;
  v.innerHTML = `<div class="tvstage"><div class="tvbar"><b>150 Falcon Det · Flying program</b><span>${esc(opsLongDay(OPS.day))}</span>
      <span class="tvclock">${esc(n.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}L <small>${esc(n.toISOString().slice(11, 19).replace(/:/g, ""))}Z</small></span>
      <span class="grow"></span><span>${st.sorties} sorties · ${st.hours} h · first T/O ${esc(opsHM(st.first) || "-")} · last landing ${esc(opsHM(st.last) || "-")}</span>
      <label class="tvspd">Auto-scroll <select data-flyspd aria-label="Auto-scroll speed">${Object.keys(OPS_TV_SPEEDS).map(k => `<option value="${k}" ${k === opsTvSpeed() ? "selected" : ""}>${k[0].toUpperCase() + k.slice(1)}</option>`).join("")}</select></label>
      <button class="btn small" data-tab="ops">Exit TV</button></div>
    ${OPS_ORDER.some(opsData) ? `<div class="flytv"><div class="flytvl">${pane("fly", "fly", "", "")}</div>
      <div class="flytvr">${pane("sim", "sim", OPS_TITLES.sim, opsView.sim(opsGet("sim")))}${pane("gnd", "gnd", OPS_TITLES.ground, opsFlyTvGround(opsGet("ground")))}</div></div>`
      : `<div class="empty"><strong>No programme for today yet</strong></div>`}</div>`;
  // Text size is set by the ~3 waves (tw.fl); the flying window then holds every wave and scrolls within itself (Gordon, 10 Oct).
  OPS.tvLeft = { part: opsView.flying(tw.fl, tw.n0) || `<p class="hint" style="display:block;margin:0">No flights.</p>`, all: tw.more ? opsView.flying(tw.all) : "" };
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
const OPS_TV_WAVES = 3;
function opsFlyTvWaves(fl) {
  const all = opsNameWaves(JSON.parse(JSON.stringify(fl))).waves || [];
  const used = all.filter(w => (w.flights || []).some(f => (f.ac || []).some(opsLineUsed)));
  const wins = opsWindows({ waves: used }), d = new Date(), now = d.getUTCHours() * 60 + d.getUTCMinutes();
  let i = wins.findIndex(x => x.e == null || x.e >= now); if (i < 0) i = used.length;
  i = Math.max(0, Math.min(i, used.length - OPS_TV_WAVES));
  const shown = used.slice(i, i + OPS_TV_WAVES);
  let n0 = 0; for (const w of used.slice(0, i)) for (const f of w.flights || []) for (const a of f.ac || []) if (!opsIsAdd(f, a) && opsLineUsed(a)) n0++;
  const before = used.slice(0, i).map(w => w.name), after = used.slice(i + OPS_TV_WAVES).map(w => w.name);
  const note = [before.length ? `Done: ${before.join(", ")}` : "", after.length ? `Later: ${after.join(", ")}` : ""].filter(Boolean).join(" · ");
  return { fl: { ...fl, waves: shown }, n0, note, more: used.length > shown.length, all: { ...fl, waves: used } };
}
// Size the text so ~3 waves fill the flying window (capped so a quiet day isn't huge), then fix the windows to the screen.
function opsFlyTvFit() {
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
window.addEventListener("resize", () => { if (S.tab !== "flytv") return; clearTimeout(opsFlyTvFit.t); opsFlyTvFit.t = setTimeout(opsFlyTvFit, 300); });
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
const opsLogMins = L => { if (!L || L.st !== "flown") return null; const a = opsMin(L.to), b = opsMin(L.ldg); return a == null || b == null ? null : (b - a + 1440) % 1440; };
const opsHrs = m => m == null ? "" : (m / 60).toFixed(1);
const opsT4 = v => { const m = opsMin(String(v || "").replace(/[^0-9:]/g, "").replace(/^(\d{3})$/, "0$1")); return m == null ? "" : opsZ4(m); };
const opsLogLine = k => { const [w, f, a] = k.split(".").map(Number); return (((((OPS.rows.flying || {}).data || {}).waves || [])[w] || {}).flights || [])[f]?.ac?.[a] || {}; };
function opsLogCard() {
  const fl = opsGet("flying"); let rows = "", logged = 0, lines = 0, mins = 0;
  (fl.waves || []).forEach((w, wi) => {
    let wr = "";
    (w.flights || []).forEach((f, fi) => {
      const ls = (f.ac || []).map((a, ai) => [a, ai]).filter(([a]) => opsLineUsed(a)); if (!ls.length) return;
      ls.forEach(([a, ai], k) => {
        const L = a.log || {}, key = `${wi}.${fi}.${ai}`, m = opsLogMins(L); lines++; if (L.st) logged++; if (m != null) mins += m;
        wr += `<tr class="${L.st === "flown" ? "lgok" : L.st === "cx" ? "lgcx" : ""}${k === 0 ? " lgf" : ""}">
          ${k === 0 ? `<td rowspan="${ls.length}" class="lgcs"><b>${esc(f.callsign || "-")}</b><small>${esc(f.etd || "?")}–${esc(f.eta || "?")}Z${opsIsAdd(f, {}) ? " · ops add" : ""}</small><button class="btn small" data-ops="logplan" data-k="${wi}.${fi}">✓ As planned</button></td>` : ""}
          <td class="lgcrew">${esc(a.n || "")} <b>${opsX(a.crew1)}</b>${a.crew2 ? ` / ${opsX(a.crew2)}` : ""}<small>${esc([a.mission, opsTail(a.tail, OPS.day)].filter(Boolean).join(" · "))}${opsIsAdd(f, a) ? " · ops add" : ""}</small></td>
          <td><input data-log="to" data-k="${key}" value="${esc(L.to || "")}" placeholder="${esc(f.etd || "T/O")}" inputmode="numeric" maxlength="5" aria-label="Take-off"></td>
          <td><input data-log="ldg" data-k="${key}" value="${esc(L.ldg || "")}" placeholder="${esc(f.eta || "LDG")}" inputmode="numeric" maxlength="5" aria-label="Landing"></td>
          <td class="lghrs" data-hrs="${key}">${m != null ? opsHrs(m) : ""}</td>
          <td class="lgbtn"><button class="btn small${L.st === "cx" ? " danger" : ""}" data-ops="logcx" data-k="${key}" title="Cancelled: no hours">CX</button>${L.st ? `<button class="btn small" data-ops="logclr" data-k="${key}" title="Clear">✕</button>` : ""}</td></tr>`;
      });
    });
    if (wr) rows += `<tr class="lgwv"><td colspan="6">${esc(w.name)}</td></tr>` + wr;
  });
  return `<section class="card opscard" id="ops-log"><div class="opshead"><h2>Flown times</h2><span class="opsmeta">${logged} of ${lines} lines logged · ${opsHrs(mins) || "0.0"} h flown <button class="btn small primary" data-ops="log">Done logging</button></span></div>
    <div class="tablewrap"><table class="opst opslog"><thead><tr><th>Flight</th><th>Aircrew</th><th>T/O (Z)</th><th>LDG (Z)</th><th>Hrs</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint" style="margin:6px 0 0">After landing, key in the actual take-off and landing times (Z, e.g. 0718). <b>✓ As planned</b> fills in the planned ETD / ETA for the whole flight; type over any that differ. <b>CX</b> = cancelled (no hours). Both crew on a line get the hours; they add up on the <b>Hours</b> tab.</p>
    <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn primary" data-ops="log">Done logging</button></div></section>`;
}
async function opsLogSave(k, to, ldg, st, rerender) {
  const [w, f, a] = k.split(".").map(Number), line = opsLogLine(k);
  const { data, error } = await S.sb.rpc("ops_log_flight", { p_day: OPS.day, p_w: w, p_f: f, p_a: a, p_crew1: line.crew1 || "", p_to: to || null, p_ldg: ldg || null, p_status: st });
  if (error) { toast(errMsg(error)); if (/changed|no longer/i.test(error.message)) opsLoad(OPS.day); return false; }
  if (!st && !to && !ldg) delete line.log; else line.log = { to: to || null, ldg: ldg || null, st };
  OPS.rows.flying.version = data; OPS.hrs = null;
  if (rerender) { const y = scrollY; renderOps($("#view")); scrollTo(0, y); }
  else { // update the row in place so typing carries on
    const m = opsLogMins(line.log), cell = document.querySelector(`[data-hrs="${k}"]`); if (cell) cell.textContent = m != null ? opsHrs(m) : "";
    const tr = cell && cell.closest("tr"); if (tr) { tr.classList.toggle("lgok", st === "flown"); tr.classList.toggle("lgcx", st === "cx"); }
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
  opsLogSave(el.dataset.k, to, ldg, to || ldg ? "flown" : "", false);
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
// Every flown line on every day → one entry per crew member.
function hrsEntries(days) {
  const out = [];
  for (const r of days) {
    const fl = opsNameWaves(opsClone(r.data || {}));
    for (const w of fl.waves || []) for (const f of w.flights || []) for (const a of f.ac || []) {
      const m = opsLogMins(a.log); if (m == null) continue;
      [[a.crew1, a.crew2], [a.crew2, a.crew1]].forEach(([who, mate], seat) => {
        const n = opsNorm(who); if (!n) return;
        out.push({ name: n, day: r.day, wave: w.name, night: !!w.night, callsign: f.callsign, ac: a.n, tail: opsTail(a.tail, r.day), mission: a.mission, mate: mate || "", seat: seat ? "Back" : "Front", to: a.log.to, ldg: a.log.ldg, mins: m });
      });
    }
  }
  return out;
}
function renderHours(v) {
  if (!OPS.hrs) {
    v.innerHTML = `<div class="empty">Loading hours…</div>`;
    if (!OPS.hrsLoading) { OPS.hrsLoading = true; S.sb.from("ops_sections").select("day,data").eq("section", "flying").order("day").then(({ data, error }) => { OPS.hrsLoading = false; if (error) return toast(errMsg(error)); OPS.hrs = { days: data || [] }; if (S.tab === "hours") render(); }); }
    return;
  }
  const per = OPS.hrsPer || "month", [from, to] = hrsRange(per), sort = OPS.hrsSort || "group";
  const ents = hrsEntries(OPS.hrs.days).filter(e => e.day >= from && e.day <= to);
  const crewOf = n => (typeof OB !== "undefined" ? OB.crew : []).find(c => opsNorm(c.name) === n);
  const people = {};
  const blank = n => ({ name: n, sorties: 0, day: 0, night: 0, last: "", list: [] });
  // Every active aircrew on the Go / No-Go crew list shows, even with no hours yet (Gordon, 10 Oct); plus anyone else who flew.
  for (const c of (typeof OB !== "undefined" ? OB.crew : []).filter(c => c.active)) { const n = opsNorm(c.name); if (n && !people[n]) people[n] = blank(n); }
  for (const e of ents) { const p = people[e.name] || (people[e.name] = blank(e.name)); p.sorties++; p[e.night ? "night" : "day"] += e.mins; if (e.day > p.last) p.last = e.day; p.list.push(e); }
  const groups = typeof OB_GROUPS !== "undefined" ? OB_GROUPS : [];
  const gi = n => { const c = crewOf(n), i = c ? groups.indexOf(c.grp) : -1; return i < 0 ? 99 : i; };
  const list = Object.values(people).sort(sort === "hours" ? (a, b) => (b.day + b.night) - (a.day + a.night) || a.name.localeCompare(b.name) : (a, b) => gi(a.name) - gi(b.name) || (crewOf(a.name)?.sort ?? 999) - (crewOf(b.name)?.sort ?? 999) || a.name.localeCompare(b.name));
  const mine = new Set(opsMyNames()), tot = list.reduce((s, p) => s + p.day + p.night, 0);
  const grpOf = n => { const c = crewOf(n); return c ? (typeof obGrpLabel === "function" ? obGrpLabel(c.grp) : c.grp) : ""; };
  const fd = d => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const rows = list.map(p => {
    const open = OPS.hrsOpen && OPS.hrsOpen[p.name];
    if (!p.sorties) return `<tr class="hrrow none${mine.has(p.name) ? " me" : ""}"><td><b>${esc(p.name)}</b></td><td class="hint">${esc(grpOf(p.name) || "Not on crew list")}</td><td class="n">0</td><td class="n">0.0</td><td class="n">0.0</td><td class="n"><b>0.0</b></td><td class="hint">–</td></tr>`;
    return `<tr class="hrrow${mine.has(p.name) ? " me" : ""}" data-hrs-p="${esc(p.name)}"><td><b>${esc(p.name)}</b> <span class="hint">${open ? "▲" : "▼"}</span></td><td class="hint">${esc(grpOf(p.name) || "Not on crew list")}</td><td class="n">${p.sorties}</td><td class="n">${opsHrs(p.day)}</td><td class="n">${opsHrs(p.night)}</td><td class="n"><b>${opsHrs(p.day + p.night)}</b></td><td class="hint">${fd(p.last)}</td></tr>`
      + (open ? `<tr class="hrdet"><td colspan="7"><table class="opst"><thead><tr><th>Date</th><th>Wave</th><th>Callsign</th><th>Seat</th><th>With</th><th>Mission</th><th>A/C</th><th>T/O–LDG (Z)</th><th>Hrs</th></tr></thead><tbody>${p.list.slice().sort((a, b) => b.day.localeCompare(a.day)).map(e => `<tr><td>${fd(e.day)}</td><td>${esc(e.wave)}</td><td>${esc([e.callsign, e.ac].filter(Boolean).join(" "))}</td><td>${e.seat}</td><td>${esc(e.mate)}</td><td>${esc(e.mission)}</td><td>${esc(e.tail)}</td><td>${esc(e.to)}–${esc(e.ldg)}</td><td class="n">${opsHrs(e.mins)}</td></tr>`).join("")}</tbody></table></td></tr>` : "");
  }).join("");
  v.innerHTML = `<div class="opsbar"><label class="hrsper">Period <select data-hrs="per">${HRS_PERIODS.map(([k, l]) => `<option value="${k}" ${k === per ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <span class="hint">${per === "all" ? "" : `${fd(from)} – ${fd(to > todayStr() ? todayStr() : to)}`}</span><span class="grow"></span>
      <button class="btn small${sort === "group" ? " primary" : ""}" data-hrs="sort" data-v="group">By group</button><button class="btn small${sort === "hours" ? " primary" : ""}" data-hrs="sort" data-v="hours">Most hours</button></div>
    <section class="card opscard"><div class="opshead"><h2>Hours flown</h2><span class="opsmeta">${list.length} aircrew · ${ents.length} crew-sorties · ${opsHrs(tot) || "0.0"} h in total</span></div>
    ${list.length ? `<div class="tablewrap"><table class="opst hrst"><thead><tr><th>Name</th><th>Group</th><th class="n">Sorties</th><th class="n">Day</th><th class="n">Night</th><th class="n">Total h</th><th>Last flown</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="hint">No flown times logged in this period yet. Ops log them on the Flying program with <b>Log flown times</b> after the aircrew land.</p>`}
    <p class="hint" style="margin:8px 0 0">From the take-off / landing times logged on each day's flying program. Both crew on a line get the hours (front and back seat). Night waves count as night. Tap a name for their sorties.</p></section>`;
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
  const print = `<button class="btn small" data-ops="pdf" title="Daily programme to send out">Daily PDF</button>${fly ? `<button class="btn small" data-ops="pdfeod" title="End-of-day copy with flown times, for filing">End of day PDF</button>` : ""}`;
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
    const n = names.find(n => opsCrewHas(a, n)); if (!n) continue;
    const mate = opsNorm(a.crew1) === n ? a.crew2 : a.crew1;
    items.push(`${li(opsMin(s.eta))}<b>SIM</b> ${esc(s.etd)}–${esc(s.eta)}Z · ${esc([s.callsign, a.n].filter(Boolean).join(" "))} · ${esc(a.mission)}${mate ? " with " + esc(mate) : ""}</li>`);
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
// brief / step / take-off for their flights, sim start, ground events, and the start of a wave they are SXO / OPS O for.
function opsMyEvents(get) {
  const names = opsMyNames(); if (!names.length) return [];
  const fl = opsNameWaves(get("flying")), out = [], add = (t, label) => { const m = opsMin(t); if (m != null) out.push({ t: m, label }); };
  for (const w of fl.waves || []) {
    for (const f of w.flights || []) for (const a of f.ac || []) {
      if (!names.some(n => opsCrewHas(a, n))) continue;
      const cs = esc([f.callsign, a.n].filter(Boolean).join(" ")), wn = esc(w.name);
      if (f.brief && f.brief !== "NA") add(f.brief, `Brief · <b>${wn}</b> ${cs}`);
      if (f.step && f.step !== "NA") add(f.step, `Step · <b>${wn}</b> ${cs}`);
      add(f.etd, `Take-off · <b>${wn}</b> ${cs}${a.tail ? " · " + esc(opsTail(a.tail)) : ""}`);
    }
    const duty = [names.some(n => opsHas(w.sxo, n)) && "SXO", names.some(n => opsHas(w.opsO, n)) && "OPS O"].filter(Boolean);
    if (duty.length) {
      const ts = (w.flights || []).flatMap(f => [f.brief, f.step, f.etd].map(opsMin)).filter(x => x != null);
      if (ts.length) out.push({ t: Math.min(...ts), label: `${duty.join(" + ")} · <b>${esc(w.name)}</b>` });
    }
  }
  for (const s of get("sim").rows || []) for (const a of s.ac || []) if (names.some(n => opsCrewHas(a, n))) add(s.etd, `Sim · ${esc([s.callsign, a.n].filter(Boolean).join(" "))} ${esc(a.mission || "")}`);
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
  flying(fl, n0) {
    let n = n0 || 0, out = "";
    const z4 = m => String(Math.floor(m / 60) % 24).padStart(2, "0") + String(m % 60).padStart(2, "0");
    // Planned ETD / ETA as their own columns (brief / step underneath); once any line is logged, ATD / ATA / Hrs columns too (Gordon, 10 Oct).
    const logged = (fl.waves || []).some(w => (w.flights || []).some(f => (f.ac || []).some(a => a.log && a.log.st)));
    const cols = `<colgroup>${(logged ? [5, 6, 6, 8, 3, 14, 9, 10, 5, 5, 5, 5, 4, 15] : [5, 7, 7, 8, 3, 15, 9, 11, 6, 5, 24]).map(p => `<col style="width:${p}%">`).join("")}</colgroup>`;
    for (const w of fl.waves || []) {
      const fs = w.flights || [], ws = opsStats({ waves: [w] });
      out += `<div class="opswave${w.night ? " night" : ""}"><b>${esc(w.name)}</b>${w.sxo ? `<span>SXO <strong>${opsX(w.sxo)}</strong></span>` : ""}${w.opsO ? `<span>OPS O <strong>${opsX(w.opsO)}</strong></span>` : ""}
        <span class="opswavest">${ws.sorties} sortie${ws.sorties === 1 ? "" : "s"}${ws.first != null ? ` · ${z4(ws.first)}–${z4(ws.last)}Z` : ""}</span></div>`;
      if (w.rmks) out += `<div class="opsrmk">⚠ ${opsNl(w.rmks)}</div>`;
      if (!fs.length) { out += `<p class="hint">No flights.</p>`; continue; }
      out += `<div class="tablewrap"><table class="opst opsfly${logged ? " logged" : ""}">${cols}<thead><tr><th>No</th><th>ETD (Z)</th><th>ETA (Z)</th><th>Callsign</th><th>#</th><th>Aircrew</th><th>Mission</th><th>Area</th><th>A/C</th><th>Cfg</th>${logged ? `<th class="act">ATD</th><th class="act">ATA</th><th class="act">Hrs</th>` : ""}<th>Remarks</th></tr></thead>`;
      for (const f of fs) {
        const ac = (f.ac || []).length ? f.ac : [opsTpl.ac("")], span = ac.length;
        out += `<tbody class="fl${f.opsAdd ? " opsadd" : ""}">`;
        ac.forEach((a, i) => {
          const add = opsIsAdd(f, a), no = add ? `<span class="opsaddtag">OPS ADD</span>` : opsLineUsed(a) ? String(++n).padStart(2, "0") : "";
          const bs = [f.brief && f.brief !== "NA" ? "Brief " + f.brief : "", f.step && f.step !== "NA" ? "Step " + f.step : ""].filter(Boolean).join(" · ");
          const L = a.log || {}, m = opsLogMins(L);
          const act = !logged ? "" : L.st === "cx" ? `<td colspan="3" class="act"><span class="opscx">CX</span></td>`
            : `<td class="act">${esc(L.st ? L.to || "" : "")}</td><td class="act">${esc(L.st ? L.ldg || "" : "")}</td><td class="act hrs">${m != null ? opsHrs(m) : ""}</td>`;
          out += `<tr class="${add ? "opsadd" : ""}"><td class="no">${no}</td>
            ${i === 0 ? `<td rowspan="${span}" class="tm rs"><b>${esc(f.etd)}</b>${bs ? `<small class="bs">${esc(bs)}</small>` : ""}</td><td rowspan="${span}" class="tm rs"><b>${esc(f.eta)}</b></td><td rowspan="${span}" class="cs rs">${esc(f.callsign)}</td>` : ""}
            <td class="n">${esc(a.n)}</td><td class="fcrew">${opsX(a.crew1)}${a.crew2 ? `<span class="c2"> / ${opsX(a.crew2)}</span>` : ""}</td><td class="nw">${esc(a.mission)}</td>
            ${i === 0 ? `<td rowspan="${span}" class="area rs">${esc(f.area)}${f.areaTime ? `<small>${esc(f.areaTime)}</small>` : ""}</td>` : ""}<td class="nw">${esc(opsTail(a.tail, OPS.day))}</td><td class="nw">${esc(a.config)}</td>${act}<td class="rm">${opsNl(a.rmks)}</td></tr>`;
        });
        out += `</tbody>`;
      }
      out += `</table></div>`;
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
    return gs.map(x => `<h3 class="opssub">${esc(x.name)}</h3><div class="tablewrap"><table class="opst opsnarrow"><thead><tr><th>Time</th><th>Event</th><th>Personnel</th><th>Venue</th></tr></thead><tbody>${x.rows.map(r =>
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
    return `<div class="opsduty">${gs.map(g => `<div class="opsdutyg${g.hours ? " hrs" : ""}"><h3 class="opssub">${esc(g.name)} <span class="hint">${g.rows.length}</span></h3><div class="tablewrap"><table class="opst opsdt"><thead><tr><th></th><th>Name</th>${waves.map(w => `<th title="${esc(w.name)}">${short(w)}</th>`).join("")}${g.hours ? `<th title="Previous day's out time">Prev</th><th>In</th><th>Rest</th><th>Out</th><th>Duty</th>` : ""}</tr></thead><tbody>${g.rows.map((r, i) => {
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
    return (fl.waves || []).map((w, wi) => `<div class="blk">
      <div class="tools" style="margin-bottom:4px"><b class="opswavename">${esc(w.name)}</b>${oC(`waves.${wi}.night`, w.night, "Night wave")}<span class="grow"></span>${oTools("waves", wi)}</div>
      <div class="grid"><label>SXO${oP(`waves.${wi}.sxo`, w.sxo)}</label><label>OPS O${oI(`waves.${wi}.opsO`, w.opsO, "", "e.g. LIM Y / LEE L (TKOVER @ 1100Z)")}</label></div>
      <label>Wave remarks (airfield notes for this wave)${oT(`waves.${wi}.rmks`, w.rmks)}</label>
      ${(w.flights || []).map((f, fi) => { const p = `waves.${wi}.flights.${fi}`; return `<div class="blk flt">
        <div class="tablewrap"><table><thead><tr><th>Brief</th><th>Step</th><th class="opsetdh">ETD (key in first)</th><th>ETA</th><th>Callsign</th><th>Area</th><th>Area time</th><th></th><th></th></tr></thead><tbody><tr>
          <td>${opsAutoIn(p, f, "brief")}</td><td>${opsAutoIn(p, f, "step")}</td><td>${oI(p + ".etd", f.etd, "80px", "e.g. 0715").replace("<input", '<input class="opsetd"')}</td><td>${opsAutoIn(p, f, "eta")}</td>
          <td>${oI(p + ".callsign", f.callsign, "120px")}</td><td>${oI(p + ".area", f.area, "120px")}</td><td>${oI(p + ".areaTime", f.areaTime, "110px")}</td>
          <td>${oC(p + ".opsAdd", f.opsAdd, "Ops add")}</td><td>${oTools(`waves.${wi}.flights`, fi)}</td></tr></tbody></table>
        <table><thead><tr><th>#</th><th>Aircrew</th><th>Aircrew</th><th>Mission</th><th>A/C</th><th>Config</th><th>Rmks</th><th></th><th></th></tr></thead><tbody>
          ${(f.ac || []).map((a, ai) => { const q = `${p}.ac.${ai}`; return `<tr><td>${oI(q + ".n", a.n, "40px")}</td><td>${oP(q + ".crew1", a.crew1, "120px")}</td><td>${oP(q + ".crew2", a.crew2, "120px")}</td><td>${oI(q + ".mission", a.mission, "110px")}</td><td>${oI(q + ".tail", a.tail, "60px")}</td><td>${oI(q + ".config", a.config, "60px")}</td><td>${oI(q + ".rmks", a.rmks, "200px")}</td><td>${oC(q + ".opsAdd", a.opsAdd, "Ops add")}</td><td>${oB("del", p + ".ac", ai, "✕", "", "Remove aircraft")}</td></tr>`; }).join("")}
        </tbody></table></div>${oB("add", p + ".ac", "", "+ Aircraft", "ac")}</div>`; }).join("")}
      <div class="tools">${oB("add", `waves.${wi}.flights`, "", "+ Flight", "flight")}</div></div>`).join("")
      + `<div class="tools">${oB("add", "waves", "", "+ Wave", "wave")}${oB("add", "waves", "", "+ Night wave", "nwave")}</div>` + `<p class="hint"><b>Key in the ETD first:</b> ETA (ETD + 1 h), step (ETD − 1 h) and brief (step − 45 min) fill in by themselves (shown in grey). Type over any of them to match the ops or WX / NOTAM brief; clear a box to go back to the worked-out time. Times as 0725 (Zulu). Tick "Ops add" on the flight (whole flight) or on one aircraft line (e.g. #1 ops add): they show as * and don't count in planned sorties or hours.</p>`;
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
const OPS_AUTO_T = ["eta", "step", "brief"], OPS_AUTO_OFF = { eta: 60, step: -60, brief: -105 };
const opsZ4 = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + String(m % 60).padStart(2, "0"); };
const opsAutoT = (f, k) => { const e = opsMin(f.etd); return e == null ? "" : opsZ4(e + OPS_AUTO_OFF[k]); };
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
function opsRerenderEdit() {
  if (!OPS.edit) return;
  const sec = OPS.edit.section, card = $("#ops-" + sec);
  if (!card) return renderOps($("#view"));
  const y = window.scrollY; card.outerHTML = opsSection(sec, true); window.scrollTo(0, y);
}
document.addEventListener("input", e => {
  const el = e.target; if (!OPS.edit || !el.dataset || !el.dataset.p || !el.closest("#opsEdit")) return;
  opsSetPath(OPS.edit.data, el.dataset.p, el.type === "checkbox" ? el.checked : el.value);
  if (OPS.edit.section === "flying") opsAutoTimes(el);
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
    renderOps($("#view")); const c = $("#ops-" + sec); if (c) c.scrollIntoView({ block: "start" });
  } else if (a === "names") { e.preventDefault(); OPS.namesOpen = !OPS.namesOpen; opsRerenderEdit(); }
  else if (a === "cancel") { OPS.edit = null; renderOps($("#view")); }
  else if (a === "save") opsSave(el);
  else if (a === "copy") opsCopy();
  else if (a === "clear") opsClearDay(el);
  else if (a === "pdf") opsPrint(false);
  else if (a === "pdfeod") opsPrint(true);
  else if (a === "log") { OPS.logOpen = !OPS.logOpen; renderOps($("#view")); if (OPS.logOpen) { const c = $("#ops-log"); if (c) c.scrollIntoView({ block: "start" }); } }
  else if (a === "logplan") opsLogPlanned(el);
  else if (a === "logcx") { const L = opsLogLine(el.dataset.k).log || {}; opsLogSave(el.dataset.k, null, null, L.st === "cx" ? "" : "cx", true); }
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
function opsPrint(eod) {
  if (OPS.rowsDay !== OPS.day) return toast("Still loading.");
  const h = opsGet("header"), fl = opsGet("flying"), sim = opsGet("sim"), st = opsStats(fl), e = v => esc(v ?? "");
  const nl = v => e(v).replace(/\n/g, "<br>");
  const waves = fl.waves || [];
  let n = 0;
  const flying = waves.map(w => {
    let rows = `<tr class="wv"><td colspan="${eod ? 15 : 12}">${e(w.name)}${w.rmks ? ` <span class="r">${nl(w.rmks)}</span>` : ""}</td></tr>`;
    for (const f of w.flights || []) {
      const ac = (f.ac || []).length ? f.ac : [opsTpl.ac("")];
      ac.forEach((a, i) => {
        const no = opsIsAdd(f, a) ? "*" : opsLineUsed(a) ? String(++n).padStart(2, "0") : "";
        rows += `<tr${i === 0 ? ' class="f"' : ""}><td>${no}</td>${i === 0 ? `<td rowspan="${ac.length}">${e(f.brief)} ${e(f.step)}</td><td rowspan="${ac.length}">${e(f.etd)}</td><td rowspan="${ac.length}">${e(f.eta)}</td>` : ""}<td>${e([i === 0 ? f.callsign : "", a.n].filter(Boolean).join(" "))}</td><td>${e(a.crew1)}</td><td>${e(a.crew2)}</td><td>${e(a.mission)}</td>${i === 0 ? `<td rowspan="${ac.length}">${e(f.area)}<br>${e(f.areaTime)}</td>` : ""}<td>${e(opsTail(a.tail, OPS.day))}</td><td>${e(a.config)}</td>${eod ? opsPrintAct(a.log) : ""}<td>${nl(a.rmks)}</td></tr>`;
      });
    }
    return rows;
  }).join("");
  let sn = 0;
  const sims = (sim.rows || []).filter(opsSimUsed).map(s => (s.ac || []).map((a, i) => `<tr${i === 0 ? ' class="f"' : ""}><td>${opsLineUsed(a) ? String(++sn).padStart(2, "0") : ""}</td><td>${i === 0 ? e(s.etd) : ""}</td><td>${i === 0 ? e(s.eta) : ""}</td><td>${e([i === 0 ? s.callsign : "", a.n].filter(Boolean).join(" "))}</td><td>${e(a.crew1)}</td><td>${e(a.crew2)}</td><td>${e(a.mission)}</td><td>${e(a.fms)}</td><td>${e(a.config)}</td><td>${nl(a.rmks)}</td></tr>`).join("")).join("");
  const ground = (opsGet("ground").groups || []).filter(g => (g.rows || []).length).map(g => `<tr class="wv"><td colspan="4">${e(g.name)}</td></tr>${g.rows.map(r => `<tr><td>${e(r.time)}</td><td>${e(r.event)}</td><td>${e(r.personnel)}</td><td>${e(r.venue)}</td></tr>`).join("")}`).join("");
  const af = opsGet("airfield"), nt = opsGet("notes");
  const duties = (opsGet("duties").groups || []).filter(g => (g.rows || []).length).map(g => `<table><tr class="wv"><td colspan="${waves.length + 2 + (g.hours ? 5 : 0)}">${e(g.name)}</td></tr><tr><th></th><th>Name</th>${waves.map(w => `<th>${e(w.name)}</th>`).join("")}${g.hours ? "<th>Prev day out</th><th>In time</th><th>Rest</th><th>Out time</th><th>Duty</th>" : ""}</tr>${g.rows.map((r, i) => {
    const auto = opsAuto(r.name, fl, sim);
    let hrs = "";
    if (g.hours) { const io = opsInOut(r), prev = opsPrevOut(g.name, r.name), pi = opsMin(prev), ii = opsMin(io.in), oo = opsMin(io.out); hrs = `<td>${e(prev)}</td><td>${e(io.in)}</td><td>${pi != null && ii != null ? opsHM(ii + 1440 - pi) : ""}</td><td>${e(io.out)}</td><td>${ii != null && oo != null ? opsHM(opsSpan(ii, oo)) : ""}</td>`; }
    return `<tr><td>${i + 1}</td><td>${e(r.name)}</td>${waves.map((w, j) => `<td>${e(opsCell(auto[j] || [], (r.cells || [])[j]))}</td>`).join("")}${hrs}</tr>`;
  }).join("")}</table>`).join("");
  const kv = (k, v) => v ? `<tr><th>${k}</th><td>${nl(v)}</td></tr>` : "";
  let el = document.getElementById("opsPrint");
  if (!el) { el = document.createElement("div"); el.id = "opsPrint"; document.body.appendChild(el); }
  el.innerHTML = `<div class="cls">RESTRICTED</div>
    <h1>150 SQUADRON FLYING PROGRAM${eod ? " · END OF DAY" : ""}</h1><div class="sub">${e(opsLongDay(OPS.day))}${eod ? " · with flown times" : ""}</div>
    <div class="cols">
      <div><table>${kv("IN TIME", h.inTime)}${kv("LATE IN", h.lateIn)}${kv("WX/NTM BRIEF", h.wxBrief)}${kv("MODB", h.modb)}${kv("NIGHT OPS BRIEF", h.nightBrief)}${kv("SQN SII OF THE QTR", h.sqnSii)}${kv("EMER OF THE DAY", h.emer)}</table></div>
      <div><table>${waves.map(w => kv(e(w.name) + " SXO", w.sxo)).join("")}</table>
        <table><tr><th>DAILY REQ</th><th>PLANNED SORTIES</th><th>PLANNED HOURS</th></tr><tr><td>${e(h.dailyReq)}</td><td>${st.sorties}</td><td>${st.hours}</td></tr>
        <tr><th>FIRST TAKEOFF</th><th>LAST LANDING</th><th>HH:MM</th></tr><tr><td>${opsHM(st.first)}</td><td>${opsHM(st.last)}</td><td>${opsHM(st.span)}</td></tr>
        ${eod ? (() => { const fs = opsFlownStats(fl); return `<tr><th>FLOWN SORTIES</th><th>FLOWN HOURS</th><th>CX / NOT LOGGED</th></tr><tr><td>${fs.sorties}</td><td>${opsHrs(fs.mins) || "0.0"}</td><td>${fs.cx} / ${fs.open}</td></tr>`; })() : ""}</table></div>
      <div><table>${waves.map(w => kv(e(w.name) + " OPS O", w.opsO)).join("")}${kv("TOWER", h.tower)}${kv("DI", h.di)}</table></div>
    </div>
    <table><tr><th>NO</th><th>FLT / STEP BRIEF</th><th>ETD (Z)</th><th>ETA (Z)</th><th>CALLSIGN</th><th colspan="2">AIRCREW</th><th>MISSION</th><th>AREA</th><th>A/C</th><th>CONFIG</th>${eod ? "<th>ATD (Z)</th><th>ATA (Z)</th><th>HRS</th>" : ""}<th>RMKS</th></tr>${flying}</table>
    ${sims ? `<h2>150 SQUADRON SIMULATOR PROGRAM</h2><table><tr><th>NO</th><th>ETD (Z)</th><th>ETA (Z)</th><th>CALLSIGN</th><th>AIRCREW</th><th>CONSOLE</th><th>MISSION</th><th>FMS</th><th>CONFIG</th><th>RMKS</th></tr>${sims}</table>` : ""}
    <div class="cols">
      <div style="flex:1.4">${ground ? `<table><tr><th>TIME</th><th>EVENT</th><th>PERSONNEL</th><th>VENUE</th></tr>${ground}</table>` : ""}</div>
      <div>
        ${(af.rows || []).length || af.sunset ? `<table><tr class="wv"><td colspan="2">AIRFIELD RESTRICTIONS</td></tr>${(af.rows || []).map(r => `<tr><td>${e(r.what)}</td><td>${e(r.time)}</td></tr>`).join("")}${af.sunset ? `<tr><td>SUNSET</td><td>${e(af.sunset)}</td></tr>` : ""}</table>` : ""}
        <table><tr><th>SQUADRON DUTY OFFICER</th><th>TRAINEE DUTY OFFICER</th></tr><tr><td>${e(h.sdo)}</td><td>${e(h.tdo)}</td></tr>${h.gym ? `<tr><th colspan="2">GYM TRAINING / SFT</th></tr><tr><td colspan="2">${nl(h.gym)}</td></tr>` : ""}</table>
        ${(nt.currencies || []).length ? `<table><tr class="wv"><td colspan="2">CURRENCIES</td></tr>${nt.currencies.map(r => `<tr><td>${e(r.who)}</td><td>${e(r.note)}</td></tr>`).join("")}</table>` : ""}
        ${(nt.aircraft || []).length ? `<table><tr class="wv"><td colspan="2">AIRCRAFT RESTRICTIONS</td></tr>${nt.aircraft.map(r => `<tr><td>${e(r.ac)}</td><td>${e(r.note)}</td></tr>`).join("")}</table>` : ""}
      </div>
    </div>
    <table><tr><th>PLANNED BY</th><td>${e(h.plannedBy)}</td><th>VETTED &amp; APPROVED BY</th><td>${e(h.vettedBy)}</td><th>CURRENCY CHECKED BY</th><td>${e(h.currencyBy)}</td></tr></table>
    ${duties}
    <div class="stamp">Printed ${e(new Date().toLocaleString("en-GB"))}</div>
    <div class="cls">RESTRICTED</div>`;
  window.print();
}

const opsPrintAct = L => !L || !L.st ? "<td></td><td></td><td></td>" : L.st === "cx" ? `<td colspan="3"><b>CX</b></td>` : `<td>${esc(L.to || "")}</td><td>${esc(L.ldg || "")}</td><td>${opsLogMins(L) != null ? opsHrs(opsLogMins(L)) : ""}</td>`;
// Flown totals for the end-of-day sheet: every flown line counts (ops adds too), CX and lines not yet logged are counted separately.
function opsFlownStats(fl) {
  let sorties = 0, mins = 0, cx = 0, open = 0;
  for (const w of fl.waves || []) for (const f of w.flights || []) for (const a of f.ac || []) {
    if (!opsLineUsed(a)) continue;
    const L = a.log || {}, m = opsLogMins(L);
    if (L.st === "flown" && m != null) { sorties++; mins += m; } else if (L.st === "cx") cx++; else if (!opsIsAdd(f, a)) open++;
  }
  return { sorties, mins, cx, open };
}

/* ---------- styles ---------- */
(() => {
  const s = document.createElement("style");
  s.textContent = `
.opsautot{color:var(--muted)}
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
.opslog td{vertical-align:middle;padding:4px 6px}
.opslog td small{display:block;color:var(--muted);font-size:.75rem}
.opslog td.lgcs{white-space:nowrap}.opslog td.lgcs .btn{margin-top:4px}
.opslog input{width:72px;margin:0;padding:4px 6px;font-variant-numeric:tabular-nums}
.opslog td.lghrs{font-weight:700;font-variant-numeric:tabular-nums;min-width:40px}
.opslog td.lgbtn{white-space:nowrap}.opslog td.lgbtn .btn{margin-left:4px}
.opslog tr.lgf td{border-top:2px solid var(--line)}
.opslog tr.lgwv td{font:700 .95rem var(--cond);text-transform:uppercase;background:color-mix(in srgb,var(--in) 10%,transparent);padding:4px 8px}
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
#opsPrint{display:none}
@media print{
  @page{size:A4 portrait;margin:7mm}
  html,body{background:#fff!important;color:#000!important}
  body>*:not(#opsPrint){display:none!important}
  body>#opsPrint{display:block!important;font:7pt/1.2 Arial,Helvetica,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  #opsPrint h1{font-size:10pt;text-align:center;margin:0}
  #opsPrint h2{font-size:8pt;text-align:center;margin:4pt 0 2pt}
  #opsPrint .sub{text-align:center;margin-bottom:3pt;font-weight:700;color:#000}
  #opsPrint .cls{text-align:center;font-weight:700;margin:2pt 0}
  #opsPrint .cols{display:flex;gap:4pt;align-items:flex-start}
  #opsPrint .cols>div{flex:1;min-width:0}
  #opsPrint table{width:100%;min-width:0;border-collapse:collapse;margin:0 0 3pt;font-size:6.6pt}
  #opsPrint th,#opsPrint td{font:6.6pt/1.2 Arial,Helvetica,sans-serif;border:.4pt solid #000;padding:1pt 2.5pt;color:#000;background:#fff;text-align:left;vertical-align:top}
  #opsPrint th{font-weight:700;background:#e6e6e6}
  #opsPrint tr.wv td{background:#d9d9d9;font-weight:700}
  #opsPrint tr.wv .r{font-weight:400;float:right}
  #opsPrint tr.f td{border-top:.9pt solid #000}
  #opsPrint tr{break-inside:avoid}
  #opsPrint .stamp{text-align:right;font-size:6pt;margin-top:2pt}
}`;
  document.head.appendChild(s);
})();
