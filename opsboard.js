/* =====================================================================
   Operations: Ops board (airfield status + Cazaux weather), Go / No-Go
   (read & sign), Aircraft status, and a TV mode for the crew-room screen.
   Data: ops_state ('board', 'aircraft', 'gonogo' documents), ops_wx (METARs,
   refreshed every 15 min by the metar edge function), crew, rs_items, rs_acks.
   Loaded before the main script; uses its helpers at call time
   ($, esc, S, toast, ask, errMsg, who, active, todayStr) and ops.js (OPS, opsGet...).
   ===================================================================== */
const OB = { files: {}, loaded: false, loading: false, state: {}, wx: {}, crew: [], items: [], acks: [], edit: null, showClosed: false, open: {} };
const OB_STATUS = { g: "Available", a: "Limited", r: "U/S", "": "-" };
const OB_GROUPS = ["QFI", "FIC", "ST", "PGF", "TRAINEES", "ATCO", "STEDAS", "OTH"];
const OB_LEGEND = [
  ["BF", "Boldface"], ["OL", "Ops limit"], ["OB", "Ops brief"], ["ED", "EODD"], ["RS", "Read & sign"], ["SAM", "Safety alert message"],
  ["UP", "Up chit"], ["IFG", "In-flight guide"], ["TS", "Take & sign"], ["MIAC 4", "MIAC 4"], ["HTC", "GFET"], ["ST", "Standardisation"],
  ["MED", "Medical"], ["SMM", "Safety meeting minutes"], ["MM", "Monthly minutes"], ["CRC", "Aircrew currencies"], ["LSS", "LSS currencies"],
  ["QN", "Quality notice"], ["OTH", "Other"],
];
const CZX = { lat: 44.533, lng: -1.125 };

/* ---------- defaults (first use) ---------- */
const obAid = (name, s) => ({ name, s: s || "g" });
// Runway choices per airfield (from the Excel dropdowns) and where FASF is worked out automatically.
const OB_RWYS = { LFBC: ["06", "24"], LFBM: ["09", "27"], LFBD: ["05", "23", "11", "29"], LFBZ: ["09", "27"], LFBG: ["05", "23", "08", "26"], LFSL: ["11", "29"], LFBE: ["09", "27"] };
const OB_FASF_AUTO = ["LFBZ", "LFSL", "LFBE"];
const OB_FASF = ["B", "W", "G VFR", "G IFR", "Y", "A", "R", "BLACK", "CLSD"];
const OB_RSAF = ["B", "Y1", "Y2", "A1", "A2", "R", "BLACK", "CLSD"];
// R115 range weather (Gordon's range table, 10 Oct): BLUE (good), WHITE n (vis 8 km+), GREEN n (vis 5 km+), YELLOW, RED,
// where n is the cloud base in thousands of ft (0 = 1000 ft, 1 = 1500 ft, 2 = 2000 ft, 3 = 3000 ft …).
// Picked as two short dropdowns (Gordon: "red yellow green white with the numbers following"): colour, then number.
// Every colour but blue can carry a number. Stored as one string, e.g. "W5", "Y2", "R", "B".
const OB_RANGE_N = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const OB_RANGE_C = [["B", "Blue"], ["W", "White"], ["G", "Green"], ["Y", "Yellow"], ["R", "Red"]];
const obRwxSplit = v => { const m = /^([BWGYR])(\d*)$/.exec(v || ""); return m ? [m[1], m[2]] : [v || "", ""]; };
const obRwxJoin = (c, n) => !c ? "" : c === "B" ? "B" : OB_RANGE_C.some(x => x[0] === c) ? c + (n || "") : c;
// attr marks the pair: data-obq="r115wx" on the board, data-rwx="ed" in the full editor.
function obRwxSel(v, attr) {
  const [c, n] = obRwxSplit(v), known = !c || OB_RANGE_C.some(x => x[0] === c);
  return `<span class="obrwx"><select class="obcs ${obCsCls(v)}" ${attr} data-p="c" aria-label="R115 WX colour">${[["", "-"], ...OB_RANGE_C, ...(known ? [] : [[c, c]])].map(([k, l]) => `<option value="${esc(k)}" ${k === c ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`
    + `<select class="obsel obrwxn" ${attr} data-p="n" aria-label="R115 WX number" ${!c || c === "B" || !known ? "hidden" : ""}>${["", ...OB_RANGE_N.map(String)].map(k => `<option value="${k}" ${k === n ? "selected" : ""}>${k || "-"}</option>`).join("")}</select></span>`;
}
const obRwxVal = el => { const w = el.closest(".obrwx"); return obRwxJoin(w.querySelector('[data-p="c"]').value, w.querySelector('[data-p="n"]').value); };
// Restricted-area list (Excel AD19:AV22). A filled value shows red unless ops picks another colour.
const OB_AREAS = ["R46 A/B", "R166", "R259 (4200FT)", "ZRT 598 (500AGL)", "R148 (SFC – 1650 FT)", "R61 MEDOC", "CEL"];
const obAf = (icao, grp, p, rwy, aids) => ({ icao, grp, p, rwy, fasf: OB_FASF_AUTO.includes(icao) ? "AUTO" : "B", rsaf: "AUTO", wx: "", restr: "", aids });
const obBlank = {
  board: () => ({
    eor: "NORMAL", banner: "", zrt: "", cs2: true, ra2: true, bingo: "AUTO", chartsCleared: {},
    airfields: [
      obAf("LFBC", "main", false, "24", [obAid("ILS (24)"), obAid("PAR"), obAid("TACAN"), obAid("CENTAURE"), obAid("CAT 1 LINE", "auto")]),
      obAf("LFBM", "main", true, "09", [obAid("ILS (27)"), obAid("PAR"), obAid("TACAN"), obAid("ALADIN"), obAid("VOR/DME")]),
      obAf("LFBD", "main", false, "11", [obAid("ILS (23)"), obAid("VOR/DME")]),
      obAf("LFBZ", "main", false, "09", [obAid("ILS (27)"), obAid("VOR/DME")]),
      obAf("LFBG", "alt", false, "05", []),
      obAf("LFSL", "alt", false, "11", []),
      obAf("LFBE", "alt", false, "09", []),
    ],
    czx: { sun: "", icingBand: "", rwySurface: "DRY", seaTemp: "", swell: "", bird: "", windHazard: "", firing: "", calamar: "", firingS: "", calamarS: "" },
    equip: { parachute: "0", samar: "G3", canopy: "", apu1: "", apu2: "" },
    r115: { tgt: "", wx: "", before: "", after: "", restr: "" },
    areas: OB_AREAS.map(item => ({ item, val: "", s: "" })),
  }),
  aircraft: () => ({ tails: [], callsigns: [], vehicleCap: "" }),
  gonogo: () => ({ miac: "", legend: OB_LEGEND.map(([code, label]) => ({ code, label })) }),
};
const obDoc = k => {
  const r = OB.state[k], b = obBlank[k]();
  if (!(r && r.data && Object.keys(r.data).length)) return b;
  const d = { ...b, ...r.data, ...(k === "board" ? { czx: { ...b.czx, ...(r.data.czx || {}) }, equip: { ...b.equip, ...(r.data.equip || {}) } } : {}) };
  if (k === "board" && !r.data.cs2) { // older board: switch colour states to automatic like the Excel
    d.airfields = (d.airfields || []).map(a => ({ ...a, rsaf: "AUTO", fasf: OB_FASF_AUTO.includes(a.icao) ? "AUTO" : a.fasf,
      aids: (a.aids || []).map(x => a.icao === "LFBC" && /CAT\s*1/i.test(x.name) ? { ...x, s: "auto" } : x) }));
    if (d.eor !== "IN HSE") d.eor = "NORMAL";
    d.cs2 = true;
  }
  if (k === "board" && !r.data.ra2) { // older board: restricted areas laid out like the Excel, parachute as a number
    const old = d.restricted || [], cap = old.find(x => /R\s*115|CAPTIEUX/i.test(x.item || ""));
    if (cap) d.r115 = { tgt: cap.tgt || "", wx: cap.wx || "", before: cap.before || "", after: cap.after || "", restr: cap.restr || "" };
    d.areas = [...b.areas, ...old.filter(x => x !== cap).map(x => ({ item: x.item || "", val: x.restr || (x.hot ? "ACTIVE" : ""), s: "" }))];
    d.equip = { ...d.equip, parachute: d.equip.parachute === "g" || !d.equip.parachute ? "0" : /^[ar]$/.test(d.equip.parachute) ? "1" : d.equip.parachute };
    delete d.restricted; d.ra2 = true;
  }
  return d;
};
const obGet = k => (OB.edit && OB.edit.key === k) ? OB.edit.data : obDoc(k);
const obCanEditAc = () => obCanBoard() || !!(S.me && S.me.eng_editor);
const obMyCrew = () => OB.crew.filter(c => c.active && S.me && c.profile_id === S.me.id);

/* ---------- data ---------- */
async function obLoad() {
  if (OB.loading) return; OB.loading = true;
  const sb = S.sb;
  const res = await Promise.all([
    sb.from("ops_state").select("*"), sb.from("ops_wx").select("*"), sb.from("crew").select("*").order("sort").order("name"),
    sb.from("rs_items").select("*").order("created_at", { ascending: false }).limit(200), sb.from("rs_acks").select("*"),
    sb.storage.from("ops-files").list("charts", { limit: 50 }),
  ]);
  OB.loading = false;
  const bad = res.slice(0, 5).find(r => r.error); // the chart list (res[5]) is optional
  if (bad) { toast("Couldn't load operations: " + errMsg(bad.error)); return; }
  OB.state = {}; for (const r of res[0].data) OB.state[r.key] = r;
  OB.wxLive = {}; for (const r of res[1].data) OB.wxLive[r.station] = r;
  [OB.crew, OB.items, OB.acks] = [res[2].data, res[3].data, res[4].data];
  OB.files = {}; for (const f of res[5].data || []) OB.files[f.name] = f;
  OB.loaded = true;
  if (obCanBoard()) obSyncCrewNames(); // keep the crew list in step with the logins
  if (["opsboard", "gonogo", "aircraft", "tv", "flytv", "home", "ops"].includes(S.tab) && !OB.edit && !obTyping()) render();
}
const obTyping = () => { const a = document.activeElement; return !!(a && a.tagName === "INPUT" && a.dataset && a.dataset.obq); };
// The board shows the METARs ops last accepted with Refresh (like the Excel); new ones wait in ops_wx until then.
const obWxSnap = () => { const r = OB.state.board, s = r && r.data && r.data.wxSnap; return s && Object.keys(s).length ? s : null; };
const obWxAll = () => obWxSnap() || OB.wxLive || {};
function obNewMetar() {
  const snap = obWxSnap(); if (!snap) return false;
  return Object.values(OB.wxLive || {}).some(r => { const o = snap[r.station]; return !o || ((r.data && r.data.obsTime) || 0) > ((o.data && o.data.obsTime) || 0); });
}
let obTimer;
const obRealtime = () => { clearTimeout(obTimer); obTimer = setTimeout(obLoad, 400); };

/* ---------- weather maths (same rules as the Excel board) ---------- */
const obN = v => (v === null || v === undefined || v === "" || isNaN(+v)) ? null : +v;
function obWind(m) {
  if (!m) return null;
  const dir = m.wdir === "VRB" ? null : obN(m.wdir), spd = obN(m.wspd) ?? 0, gst = obN(m.wgst);
  return { dir, spd, gst, gov: Math.max(spd, gst ?? 0), vrb: m.wdir === "VRB", calm: !spd && !gst }; // 00000KT = calm (no direction)
}
// Components of the governing wind relative to a heading: head (+) / tail (-) and cross.
function obComp(w, hdg) {
  if (!w || w.dir == null || hdg == null) return null;
  const a = (w.dir - hdg) * Math.PI / 180;
  return { head: w.gov * Math.cos(a), cross: Math.abs(w.gov * Math.sin(a)) };
}
const obRH = (t, td) => (t == null || td == null) ? null : Math.round(100 * Math.exp(17.625 * td / (243.04 + td)) / Math.exp(17.625 * t / (243.04 + t)));
const obRwyHdg = rwy => { const n = parseInt(String(rwy || ""), 10); return n >= 1 && n <= 36 ? n * 10 : null; };
// Main part of the METAR (before TEMPO/BECMG): vis, weather, lowest BKN/OVC.
function obWxText(m) {
  if (!m) return "";
  const raw = String(m.rawOb || "").split(/\s+(?:TEMPO|BECMG|NOSIG)\b/)[0];
  if (/\bCAVOK\b/.test(raw)) return "CAVOK";
  const v = raw.split(/\s+/).slice(3).find(t => /^\d{4}$/.test(t));
  const vis = v ? (v === "9999" ? "10KM+" : +v >= 5000 ? (+v / 1000) + "KM" : v + "M") : "";
  const ceil = (m.clouds || []).filter(c => /BKN|OVC|OVX|VV/.test(c.cover)).sort((a, b) => a.base - b.base)[0];
  const cl = ceil ? `${ceil.cover}${String(Math.round(ceil.base / 100)).padStart(3, "0")}` : /\bNSC\b/.test(raw) ? "NSC" : /\bNCD\b/.test(raw) ? "NCD" : "";
  return [vis, m.wxString || "", cl].filter(Boolean).join(" ");
}
const obObsZ = m => m && m.obsTime ? new Date(m.obsTime * 1000).toISOString().slice(11, 16).replace(":", "") + "Z" : "";
// Visibility (km) and governing cloud base (ft): lowest BKN / OVC / VV. Same rules as the Excel macros.
function obVisCeil(a) {
  const m = obWxAll()[a.icao] && obWxAll()[a.icao].data;
  if (a.wx) { // manual WX/VIS override: read it like the Excel does
    const t = a.wx.toUpperCase().replace(/\s+/g, " ").trim();
    if (t === "CAVOK") return { vis: 10, ceil: 99999 };
    let vis = 10, ceil = 99999;
    for (const k of t.split(" ")) {
      if (/KM/.test(k)) vis = /^10KM\+?$/.test(k) ? 10 : (+k.replace(/KM|\+/g, "") || vis);
      else if (/^\d+(\.\d+)?M$/.test(k)) vis = +k.slice(0, -1) / 1000;
      else if (/^\d+$/.test(k)) vis = +k / 1000;
      const c = /^(BKN|OVC)(\d{3})/.exec(k) || /^VV(\d{3})/.exec(k);
      if (c) ceil = Math.min(ceil, +(c[2] ?? c[1]) * 100);
    }
    return { vis, ceil };
  }
  if (!m) return null;
  const raw = String(m.rawOb || "").split(/\s+(?:TEMPO|BECMG|NOSIG)\b/)[0];
  if (/\bCAVOK\b/.test(raw)) return { vis: 10, ceil: 99999 };
  const v = raw.split(/\s+/).slice(3).find(t => /^\d{4}$/.test(t));
  const vis = v ? (v === "9999" ? 10 : +v / 1000) : 10;
  const bases = (m.clouds || []).filter(c => /BKN|OVC|OVX|VV/.test(c.cover) && c.base != null).map(c => +c.base);
  return { vis, ceil: bases.length ? Math.min(...bases) : 99999 };
}
function obRsafAuto(vc) {
  if (!vc) return "";
  // Cut-offs from Settings: rsaf.vis (km) and rsaf.base (ft) for B / Y1 / Y2 / A1 / A2, else R.
  const S6 = ["B", "Y1", "Y2", "A1", "A2", "R"], step = (x, l) => { const i = l.findIndex(c => x >= c); return i < 0 ? l.length : i; };
  return S6[Math.min(5, Math.max(step(vc.vis, cfgList("rsaf.vis")), step(vc.ceil, cfgList("rsaf.base"))))];
}
function obFasfAuto(vc) {
  if (!vc) return "";
  // Cut-offs from Settings: fasf.vis (km) for B / W / G IFR / Y / A, fasf.base (ft) for B / W / G VFR / G IFR / Y / A; else R.
  const S7 = ["B", "W", "G VFR", "G IFR", "Y", "A", "R"], VI = [0, 1, 3, 4, 5]; // visibility has no G VFR step
  const vl = cfgList("fasf.vis"), bl = cfgList("fasf.base");
  const vi = vl.findIndex(c => vc.vis >= c), bi = bl.findIndex(c => vc.ceil >= c);
  const v = vi < 0 ? 6 : VI[vi] ?? 6, c = bi < 0 ? 6 : Math.min(bi, 6);
  return S7[Math.max(v, c)];
}
// The colour state shown for an airfield: the chosen one, or the worked-out one when set to AUTO.
function obState(a, kind) {
  const set = a[kind] || "";
  if (set !== "AUTO") return { v: set, auto: false };
  return { v: (kind === "rsaf" ? obRsafAuto : obFasfAuto)(obVisCeil(a)), auto: true };
}
// Colour of a colour-state value.
const obCsCls = v => ({ B: "cs-b", W: "cs-w", "G VFR": "cs-gv", "G IFR": "cs-gi", Y: "cs-y", Y1: "cs-y1", Y2: "cs-y2", A: "cs-a", A1: "cs-a1", A2: "cs-a2", R: "cs-r", BLACK: "cs-k", CLSD: "cs-c" }[v] || (/^W\d+$/.test(v) ? "cs-w" : /^G\d+$/.test(v) ? "cs-gv" : /^Y\d+$/.test(v) ? "cs-y" : /^R\d+$/.test(v) ? "cs-r" : "cs-n"));
// Aid status, with the LFBC CAT 1 line following CZX FASF when set to auto (B/W green, else yellow).
function obAidS(a, x) {
  if (x.s !== "auto") return x.s;
  const f = obState(a, "fasf").v;
  return !f ? "" : ["B", "W"].includes(f) ? "g" : "a";
}
// Extra restrictions the Excel adds by itself.
const obRestr = a => [a.restr, a.icao === "LFBD" && /^0?5$/.test(String(a.rwy || "").trim()) && !/ZONE TAMPON ACTIVE/i.test(a.restr || "") ? "ZONE TAMPON ACTIVE" : ""].filter(Boolean).join(" / ");
// Sunrise / sunset (UTC minutes) for a date at Cazaux (NOAA approximation, ±1 min).
function obSun(day) {
  const r = Math.PI / 180, d = new Date(day + "T12:00:00Z"), n = Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5);
  const g = 2 * Math.PI / 365 * (n - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * r) / (Math.cos(CZX.lat * r) * Math.cos(dec)) - Math.tan(CZX.lat * r) * Math.tan(dec)) / r;
  const z = m => { m = Math.round(m); return String(Math.floor(m / 60)).padStart(2, "0") + String(m % 60).padStart(2, "0") + "Z"; };
  return { rise: z(720 - 4 * (CZX.lng + ha) - eq), set: z(720 - 4 * (CZX.lng - ha) - eq) };
}
// "How is this worked out?" (Gordon, 10 Oct): hover a dotted label for the criteria, or tap it on a phone.
// Texts follow the numbers in Settings, so the explanation always matches what the board does.
function obHelp() {
  const n = cfgN, L = k => cfgList(k).join(" / ");
  return {
  sun: "Worked out for Cazaux from today's date (NOAA sun formula, about ±1 min): the moment the top of the sun crosses the horizon. Type a value under Edit board to override it.",
  rh: "Relative humidity from the METAR temperature and dewpoint (Magnus formula).",
  icing: `Auto: YES when the temperature is below ${n("icing.t")}°C AND the humidity is above ${n("icing.rh")}%. Otherwise NO. Ops can set YES or NO by hand; Refresh METARs puts it back to auto.`,
  sea: `Typed by ops from the FASF forecast. Yellow at ${n("sea.y")}°C or colder, green above. It also drives the immersion suit.`,
  wind: "Governing wind = the higher of the mean wind and the gust. Headwind (or tailwind) and crosswind are the parts of the governing wind along and across the runway in use.",
  windHazard: "Picked by ops. A = yellow, B = amber, C and D = red.",
  canopy: `Available when the governing wind is below ${n("canopy.wind")} kt AND both the headwind / tailwind and the crosswind are below ${n("canopy.comp")} kt. Otherwise Not available. Ops can tap it to mark Not available; Refresh METARs puts it back to auto.`,
  apu1: `APU (A11–15): Not available when the temperature is below ${n("apu.temp")}°C OR the crosswind against heading ${n("apu.h1")}° is more than ${n("apu.xw")} kt. Otherwise Available. Ops can tap it to override; Refresh METARs puts it back to auto.`,
  apu2: `APU (A16–23): Not available when the temperature is below ${n("apu.temp")}°C OR the crosswind against heading ${n("apu.h2")}° is more than ${n("apu.xw")} kt. Otherwise Available. Ops can tap it to override; Refresh METARs puts it back to auto.`,
  parachute: "Number typed by ops. 0 = green, anything above 0 = red.",
  samar: "Typed by ops. Colour follows the first letter: G = green, Y = amber, R = red.",
  immersion: `From the sea surface and air temperature: sea ${n("imm.no")}°C or warmer → NO. Sea below ${n("imm.sea")}°C AND air below ${n("imm.air")}°C → YES. Anything else → NO. Shows - until the sea surface is filled in.`,
  bingo: `Auto from the Cazaux RSAF: ${cfg("bingo.upg")} → UPG BINGO, ${cfg("bingo.ifr")} → IFR BINGO, otherwise BINGO. Ops can pick one; the next Refresh METARs puts it back to auto.`,
  fasf: `FASF on Auto (default for LFBZ, LFSL, LFBE): the worse of visibility and cloud base. Visibility (km) for B / W / G IFR / Y / A: ${L("fasf.vis")}, below that R. Cloud base (ft; lowest BKN / OVC / VV, TEMPO and BECMG ignored) for B / W / G VFR / G IFR / Y / A: ${L("fasf.base")}, below that R. CAVOK = B. Elsewhere ops set it.`,
  rsaf: `RSAF on Auto: the worse of visibility and cloud base. Visibility (km) for B / Y1 / Y2 / A1 / A2: ${L("rsaf.vis")}, below that R. Cloud base (ft; lowest BKN / OVC / VV, TEMPO and BECMG ignored) for B / Y1 / Y2 / A1 / A2: ${L("rsaf.base")}, below that R. CAVOK = B. Refresh METARs sets every RSAF back to Auto.`,
  wxvis: "From the latest METAR accepted at the last Refresh, unless ops typed an override. LFBD on RWY 05 adds ZONE TAMPON ACTIVE to its restrictions.",
  aids: "Tap an aid to cycle green → yellow → red. The LFBC CAT 1 LINE on auto is green when the Cazaux FASF is B or W, otherwise yellow.",
  rangewx: "Range weather as declared for R115. BLUE = good. WHITE n = visibility 8 km+. GREEN n = visibility 5–8 km. The number is the cloud base: 0 = 1000 ft, 1 = 1500 ft, 2 = 2000 ft, 3 = 3000 ft, 4 = 4000 ft and so on. YELLOW = visibility 1.5–5 km or base 200–1000 ft. RED = visibility below 1.5 km or base below 200 ft.",
  };
}
const obH = (k, label) => `<span class="obhelp" data-obhelp="${k}" title="${esc(obHelp()[k])}" tabindex="0">${label}</span>`;
document.addEventListener("click", e => {
  const pop = document.getElementById("obHelpPop"), h = e.target.closest(".obhelp");
  if (!h) { if (pop) pop.remove(); return; }
  e.preventDefault();
  if (pop) { const same = pop.dataset.k === h.dataset.obhelp; pop.remove(); if (same) return; }
  const r = h.getBoundingClientRect(), d = document.createElement("div");
  d.id = "obHelpPop"; d.className = "obhelpop"; d.dataset.k = h.dataset.obhelp;
  d.innerHTML = `<b>${esc(h.textContent.trim())}</b><br>${esc(obHelp()[h.dataset.obhelp] || "")}<br><span class="hint">Numbers set on Operations → Settings.</span>`;
  document.body.appendChild(d);
  const w = d.offsetWidth, x = Math.max(8, Math.min(r.left, innerWidth - w - 8));
  d.style.left = x + "px"; d.style.top = (r.bottom + 6 + d.offsetHeight > innerHeight ? Math.max(8, r.top - d.offsetHeight - 6) : r.bottom + 6) + "px";
});
addEventListener("scroll", () => { const p = document.getElementById("obHelpPop"); if (p) p.remove(); }, true);
// Everything the Excel worked out for Cazaux.
function obCzx() {
  const b = obGet("board"), m = obWxAll().LFBC && obWxAll().LFBC.data, w = obWind(m);
  const lfbc = (b.airfields || []).find(a => a.icao === "LFBC") || {};
  const rwy = obRwyHdg(lfbc.rwy), c = obComp(w, rwy);
  const t = m ? obN(m.temp) : null, rh = m ? obRH(obN(m.temp), obN(m.dewp)) : null;
  const sea = obN(b.czx && b.czx.seaTemp);
  const auto = st => st === "" || st == null;
  // Thresholds come from Settings (Operations → Settings).
  const apu = h => { const k = obComp(w, h); return t == null && !k ? "" : (t != null && t < cfgN("apu.temp")) || (k && k.cross > cfgN("apu.xw")) ? "r" : "g"; };
  const cw = cfgN("canopy.wind"), cc = cfgN("canopy.comp");
  const canopy = !w ? "" : (w.gov < cw && (!c || (Math.abs(c.head) < cc && c.cross < cc))) ? "g" : "r";
  const icingA = t == null || rh == null ? "" : t < cfgN("icing.t") && rh > cfgN("icing.rh") ? "YES" : "NO";
  return {
    m, w, rwy, c, t, rh, qnh: m ? obN(m.altim) : null, sun: obSun(todayStr()),
    icingAuto: icingA,
    icing: (b.czx && b.czx.icing) || icingA, // ops can override (Gordon, 10 Oct)
    immersion: sea == null ? "" : sea >= cfgN("imm.no") ? "NO" : (sea < cfgN("imm.sea") && t != null && t < cfgN("imm.air")) ? "YES" : "NO",
    canopy: auto(b.equip.canopy) ? canopy : b.equip.canopy,
    apu1: auto(b.equip.apu1) ? apu(cfgN("apu.h1")) : b.equip.apu1,
    apu2: auto(b.equip.apu2) ? apu(cfgN("apu.h2")) : b.equip.apu2,
  };
}

/* ---------- Go / No-Go ---------- */
const obOpenItems = () => OB.items.filter(i => !i.closed);
function obOutstanding(crewId) {
  const open = new Set(obOpenItems().map(i => i.id));
  return OB.acks.filter(a => a.crew_id === crewId && !a.done_at && open.has(a.item_id)).map(a => OB.items.find(i => i.id === a.item_id));
}
// "BF, OB(2), SMM"
function obCodes(items) {
  const n = {}; for (const i of items) n[i.code] = (n[i.code] || 0) + 1;
  return Object.entries(n).map(([c, k]) => k > 1 ? `${c}(${k})` : c).join(", ");
}
function obMyPending() {
  const mine = obMyCrew(); if (!mine.length) return [];
  const out = [];
  for (const c of mine) for (const i of obOutstanding(c.id)) out.push({ item: i, crew: c });
  return out;
}

/* ---------- shared bits ---------- */
const obDot = s => `<span class="obst obst-${s || "n"}">${esc(OB_STATUS[s] ?? s ?? "-")}</span>`;
const obPill = (s, label) => `<span class="obpill obst-${s || "n"}">${esc(label)}</span>`;
const obMeta = k => { const r = OB.state[k]; return r && r.updated_at ? `Updated ${new Date(r.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${r.updated_by ? " by " + esc(who(r.updated_by)) : ""}` : ""; };
const obEditBtn = (k, can, label) => can && !OB.edit ? `<button class="btn small" data-ob="edit" data-k="${k}">${label || "Edit"}</button>` : "";
// Save / Cancel at the top of the card being edited too, not only at the bottom (Gordon, 11 Oct).
const OB_ED_TOP = ` <button class="btn small" data-ob="cancel">Cancel</button><button class="btn small primary" data-ob="save">Save</button>`;
function obCard(id, title, meta, body, tools) {
  return `<section class="card opscard" id="${id}"><div class="opshead"><h2>${title}</h2><span class="opsmeta">${meta || ""}${tools || ""}</span></div>${body}</section>`;
}
const obNotLoaded = v => { v.innerHTML = `<div class="empty">Loading…</div>`; if (!OB.loading) obLoad(); };

// One-line ops snapshot for the home dashboard: EOR, bingo, Cazaux colour states and wind.
function obHomeLine() {
  if (!OB.loaded) return "";
  const bd = obGet("board"), lfbc = (bd.airfields || []).find(a => a.icao === "LFBC");
  const f = lfbc ? obState(lfbc, "fasf").v : "", r = lfbc ? obState(lfbc, "rsaf").v : "", bg = obBingo(bd, r).v, w = obCzx().w;
  const wind = !w ? "" : w.calm ? "CALM" : w.vrb ? `VRB/${w.spd}KT` : `${String(w.dir).padStart(3, "0")}°/${w.spd}${w.gst ? "G" + w.gst : ""}KT`;
  return `<span class="obpill ${bd.eor === "IN HSE" ? "obst-a" : "obst-g"}">EOR ${esc(bd.eor || "NORMAL")}</span>
    ${f ? `<span>CZX FASF <span class="obcs ${obCsCls(f)}">${esc(f)}</span></span>` : ""}${r ? `<span>RSAF <span class="obcs ${obCsCls(r)}">${esc(r)}</span></span>` : ""}
    ${bg ? `<span class="obpill ${/UPG|IFR/.test(bg) ? "obst-y" : ""}">${esc(bg)}</span>` : ""}${wind ? `<span>Wind <b>${esc(wind)}</b></span>` : ""}`;
}

/* ---------- Ops board page ---------- */
function renderOpsBoard(v) {
  if (!OB.loaded) return obNotLoaded(v);
  const editing = OB.edit && OB.edit.key === "board", can = obCanBoard();
  const nm = obNewMetar();
  const top = `<div class="opsbar"><span class="grow"></span>${can ? `<button class="btn small ${nm ? "obpulse" : ""}" data-ob="metar">${nm ? "New METAR · Refresh" : "Refresh METARs"}</button>` : ""}<button class="btn small primary" data-tab="tv">TV mode</button></div>`;
  v.innerHTML = top + (editing ? obCard("ob-board", "Ops board", "", obEditor("board"), OB_ED_TOP) : obBoardView(false) + obChartsCard() + `<p class="opsmeta" style="justify-content:flex-end">${obMeta("board")} ${obEditBtn("board", can, "Edit ops board")}</p>`);
  if (!editing) obPageColumns(v);
}
// Wide screens: airfields across the top, then one full-width panel with weather | wind | canopy & equipment
// side by side (canopy and APU come from the wind anyway), then the restricted areas, then charts with the
// callsigns beside them. Nothing is left half empty.
function obPageColumns(v) {
  const grid = v.querySelector(".obgrid:not(.tv)"); if (!grid || innerWidth < 1200) return;
  const wx = grid.querySelector(".obwx"), eq = grid.querySelector("#ob-eq");
  if (wx && eq) {
    const col = document.createElement("div"); col.className = "obwxeq";
    col.innerHTML = `<h3 class="opssub" style="margin-top:0">Canopy / equipment</h3>`;
    [...eq.children].filter(c => c.tagName !== "H2").forEach(c => col.appendChild(c));
    wx.querySelector(".obwxin").appendChild(col); wx.classList.add("three"); eq.remove();
    wx.querySelector("h2").textContent = "Cazaux weather, wind & equipment";
  }
  const cs = grid.querySelector("#ob-bcs"), charts = v.querySelector("#ob-charts");
  if (cs && charts) { const pair = document.createElement("div"); pair.className = "obpair"; charts.before(pair); pair.append(charts, cs); }
}
let obResizeT; window.addEventListener("resize", () => { if (S.tab !== "opsboard") return; clearTimeout(obResizeT); obResizeT = setTimeout(() => { if (!obTyping()) obRerender(); }, 200); });
// Colours used by the Excel's conditional formats.
const obValS = (val, s, booked) => s || (!String(val || "").trim() ? "" : booked && /BOOKED/i.test(val) ? "y" : "r");
const obHazS = v => ({ A: "y", B: "a", C: "r", D: "r" }[String(v || "").trim().toUpperCase()] || "");
const obSamarS = v => ({ R: "r", Y: "a", G: "g" }[String(v || "").trim().charAt(0).toUpperCase()] || "");
const obParaS = v => String(v ?? "").trim() === "" ? "" : +v > 0 ? "r" : "g";
const obSeaS = v => obN(v) == null ? "" : obN(v) <= cfgN("sea.y") ? "y" : "g";
// Bingo: worked out from CZX RSAF (Y2 → UPG BINGO, A1 → IFR BINGO, otherwise BINGO) unless ops picked one;
// their pick stays until they change it or the next METAR Refresh puts it back to auto.
function obBingo(b, czxR) {
  const up = String(cfg("bingo.upg")).toUpperCase().trim(), ifr = String(cfg("bingo.ifr")).toUpperCase().trim();
  const auto = czxR && czxR === up ? "UPG BINGO" : czxR && czxR === ifr ? "IFR BINGO" : "BINGO";
  return { auto, v: !b.bingo || b.bingo === "AUTO" ? auto : b.bingo === "NONE" ? "" : b.bingo };
}
// "AIRFIELD STATUS AS OF hhmm Z": the later of the last board change and the last METAR refresh.
function obAsOf() {
  const t = [OB.state.board && OB.state.board.updated_at || (obWxAll().LFBC && obWxAll().LFBC.fetched_at)].filter(Boolean).map(x => new Date(x)).sort((a, c) => c - a)[0];
  return t ? t.toISOString().slice(11, 16).replace(":", "") + " Z" : "";
}
const OB_COLCYCLE = { "": "g", g: "a", a: "r", r: "" };
// A value cell the ops team can type in and recolour (restricted areas, firing, CALAMAR).
function obValCell(q, key, attrs, val, st, setS, ph) {
  if (!q) return st || String(val || "").trim() ? obPill(st, val || "-") : `<span class="hint">-</span>`;
  return `<span class="obvc"><input class="obval obst-${st || "n"}" data-obq="${key}" ${attrs} value="${esc(val || "")}" placeholder="${esc(ph || "")}" aria-label="Value">
    <button class="obcol obst-${setS || "n"} obtap" data-obq="${key}c" ${attrs} title="Colour: ${setS ? "set by ops" : "auto (red when filled)"}. Tap to change.">${setS ? "✎" : "A"}</button></span>`;
}
function obBoardView(tv, extra) {
  const b = obGet("board"), z = obCzx();
  const wxAge = obWxAll().LFBC ? obObsZ(obWxAll().LFBC.data) : "";
  const q = !tv && obCanBoard(); // ops editors change these straight on the board
  const csCell = (a, i, kind) => {
    const st = obState(a, kind), list = kind === "fasf" ? OB_FASF : OB_RSAF;
    if (!q) return `<span class="obcs ${obCsCls(st.v)}" title="${st.auto ? "Worked out from the METAR" : "Set by ops"}">${esc(st.v || "-")}${st.auto ? "" : " ✎"}</span>`;
    const autoV = (kind === "rsaf" ? obRsafAuto : obFasfAuto)(obVisCeil(a));
    return `<select class="obcs ${obCsCls(st.v)}" data-obq="${kind}" data-af="${i}" aria-label="${kind.toUpperCase()} colour state ${esc(a.icao)}">
      <option value="AUTO" ${a[kind] === "AUTO" ? "selected" : ""}>${esc(autoV || "-")} (auto)</option>${list.map(v => `<option ${a[kind] === v ? "selected" : ""}>${v}</option>`).join("")}</select>`;
  };
  const afRow = (a, i) => {
    const m = obWxAll()[a.icao] && obWxAll()[a.icao].data;
    const wx = a.wx || obWxText(m), opts = OB_RWYS[a.icao] || [];
    const rwy = q && opts.length ? `<select class="obsel" data-obq="rwy" data-af="${i}" aria-label="Runway ${esc(a.icao)}">${[...new Set([...opts, a.rwy].filter(Boolean))].map(r => `<option ${r === a.rwy ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>` : esc(a.rwy);
    const p = a.grp === "main" ? `<td>${q ? `<button class="obpbtn ${a.p ? "on" : ""}" data-obq="p" data-af="${i}" aria-label="Make ${esc(a.icao)} the primary divert">${a.p ? "P" : ""}</button>` : a.p ? obPill("g", "P") : ""}</td>` : "";
    const aids = (a.aids || []).map((x, j) => q ? `<button class="obpill obst-${obAidS(a, x) || "n"} obtap" data-obq="aid" data-af="${i}" data-j="${j}" title="Tap to change">${esc(x.name)}${x.s === "auto" ? " ·A" : ""}</button>` : obPill(obAidS(a, x), x.name)).join(" ");
    return `<tr><td><b>${esc(a.icao)}</b></td>${p}<td>${rwy}</td><td>${csCell(a, i, "fasf")}</td><td>${csCell(a, i, "rsaf")}</td>
      <td>${esc(wx)}${a.wx && m ? ` <span class="hint">(override)</span>` : ""}</td><td>${esc(obRestr(a))}</td>${a.grp === "main" ? `<td class="obaids">${aids}</td>` : ""}</tr>`;
  };
  const all = (b.airfields || []).map((a, i) => [a, i]), main = all.filter(([a]) => a.grp === "main"), alt = all.filter(([a]) => a.grp !== "main");
  const lfbc = (b.airfields || []).find(a => a.icao === "LFBC"), czxR = lfbc ? obState(lfbc, "rsaf").v : "";
  const bg = obBingo(b, czxR), bingo = bg.v, asOf = obAsOf();
  const bsel = !b.bingo || b.bingo === "AUTO" ? "AUTO" : b.bingo;
  const w = z.w, comp = z.c;
  const windTxt = !w ? "-" : w.calm ? "CALM" : w.vrb ? `VRB / ${w.spd} KT` : `${String(w.dir).padStart(3, "0")}° / ${w.spd}${w.gst ? "G" + w.gst : ""} KT`;
  const yn = (v2, bad) => v2 ? obPill(v2 === bad ? "r" : "g", v2) : "-";
  const czx = b.czx || {};
  return `
    <div class="obhead"><span class="obeor">EOR: ${["NORMAL", "IN HSE"].map(e => q ? `<button class="obpill ${b.eor === e ? (e === "NORMAL" ? "obst-g" : "obst-a") : ""} obtap" data-obq="eor" data-v="${e}">${e}</button>` : b.eor === e ? obPill(e === "NORMAL" ? "g" : "a", e) : "").join(" ")}</span>
      ${q ? `${obH("bingo", "Bingo")} <select class="obsel ${/UPG|IFR/.test(bingo) ? "obst-y" : ""}" data-obq="bingo" aria-label="Bingo"><option value="AUTO" ${bsel === "AUTO" ? "selected" : ""}>${esc(bg.auto)} (auto)</option>${[["NONE", "— (blank)"], ["BINGO", "BINGO"], ["UPG BINGO", "UPG BINGO"], ["IFR BINGO", "IFR BINGO"]].map(([k2, l]) => `<option value="${k2}" ${bsel === k2 ? "selected" : ""}>${l}</option>`).join("")}</select>` : bingo ? obPill(/UPG|IFR/.test(bingo) ? "y" : "", bingo) : ""}
      ${obNewMetar() ? `<span class="obpill obst-a obpulse">New METAR waiting${q ? "" : " for ops"}</span>` : ""}<b>Airfield status${asOf ? " as of " + esc(asOf) : ""}</b>${wxAge ? ` <span class="hint">METAR ${esc(wxAge)}</span>` : ""}</div>
    ${b.banner ? `<div class="obbanner">${esc(b.banner)}</div>` : ""}
    <div class="obgrid ${tv ? "tv" : ""}">
      <section class="card opscard obwide obafcard"><div class="tablewrap"><table class="opst obt"><thead><tr><th>Airfield</th><th>P</th><th>RWY</th><th>${obH("fasf", "FASF")}</th><th>${obH("rsaf", "RSAF")}</th><th>${obH("wxvis", "WX / VIS")}</th><th>Restrictions</th><th>${obH("aids", "Aids")}</th></tr></thead><tbody>${main.map(([a, i]) => afRow(a, i)).join("")}</tbody></table></div>
        ${alt.length ? `<div class="tablewrap" style="margin-top:8px"><table class="opst obt"><thead><tr><th>Airfield</th><th>RWY</th><th>${obH("fasf", "FASF")}</th><th>${obH("rsaf", "RSAF")}</th><th>${obH("wxvis", "WX / VIS")}</th><th>Restrictions</th></tr></thead><tbody>${alt.map(([a, i]) => afRow(a, i)).join("")}</tbody></table></div>` : ""}
        ${b.zrt ? `<p class="obnote">${esc(b.zrt)}</p>` : ""}</section>
      ${tv ? `<section class="card opscard obtvwx"><h2>Cazaux weather &amp; wind</h2><div class="obwind">${obRose(w, z.rwy)}<div><div class="obbig">${esc(windTxt)}</div>
        ${comp ? `<div>${obH("wind", comp.head < 0 ? "Tailwind" : "Headwind")} <b>${Math.abs(comp.head).toFixed(1)}</b> KT</div><div>${obH("wind", "Crosswind")} <b>${comp.cross.toFixed(1)}</b> KT</div><div class="hint">RWY ${esc(String(z.rwy / 10).padStart(2, "0"))} · ${obH("wind", "governing wind")} ${w.gov} KT</div>` : ""}
        <div>${obH("windHazard", "Wind hazard")} ${q ? `<select class="obsel ${obHazS(czx.windHazard) ? "obst-" + obHazS(czx.windHazard) : ""}" data-obq="czx" data-f="windHazard" aria-label="Wind hazard">${["", "A", "B", "C", "D"].map(o => `<option value="${o}" ${o === (czx.windHazard || "") ? "selected" : ""}>${o || "-"}</option>`).join("")}</select>` : czx.windHazard ? obPill(obHazS(czx.windHazard), czx.windHazard) : "-"}</div></div></div><dl class="opsdl">
        <dt>${obH("sun", "Sunrise / sunset")}</dt><dd>${czx.sun ? esc(czx.sun) : `${esc(z.sun.rise)} / ${esc(z.sun.set)}`}</dd>
        <dt>Icing band</dt><dd>${q ? obQIn("icingBand", czx.icingBand, "e.g. FL120 - FL170", "130px") : esc(czx.icingBand || "-")}</dd>
        <dt>Temperature</dt><dd>${z.t ?? "-"}°C</dd><dt>${obH("rh", "Humidity")}</dt><dd>${z.rh ?? "-"}%</dd><dt>QNH</dt><dd>${z.qnh ?? "-"}</dd>
        <dt>Runway surface</dt><dd>${q ? obQSel("rwySurface", czx.rwySurface, ["DRY", "DAMP", "WET", "FLOODED"]) : obPill(/FLOOD/i.test(czx.rwySurface) ? "r" : /WET|DAMP/i.test(czx.rwySurface) ? "a" : czx.rwySurface ? "g" : "", czx.rwySurface || "-")}</dd><dt>${obH("sea", "Sea surface")}</dt><dd>${q ? obQIn("seaTemp", czx.seaTemp, "°C", "64px", obSeaS(czx.seaTemp)) + " °C" : czx.seaTemp ? obPill(obSeaS(czx.seaTemp), czx.seaTemp + "°C") : "-"}</dd>
        <dt>Sea swell</dt><dd>${q ? obQIn("swell", czx.swell, "e.g. 1.6-1.9M", "110px") : esc(czx.swell || "-")}</dd><dt>Bird hazard</dt><dd>${q ? obQSel("bird", czx.bird, ["LOW (1)", "LOW (2)", "MED (2)", "HIGH (3)"]) : obPill(/HIGH/i.test(czx.bird) ? "r" : /MED/i.test(czx.bird) ? "a" : czx.bird ? "g" : "", czx.bird || "-")}</dd>
        <dt>${obH("icing", "Icing conditions")}</dt><dd>${q ? `<select class="obsel ${z.icing ? "obst-" + (z.icing === "YES" ? "r" : "g") : ""}" data-obq="czx" data-f="icing" aria-label="Icing conditions"><option value="">${esc(z.icingAuto || "-")} (auto)</option>${["YES", "NO"].map(o => `<option ${o === czx.icing ? "selected" : ""}>${o}</option>`).join("")}</select>` : yn(z.icing, "YES") + (czx.icing ? " ✎" : "")}</dd></dl>
        ${z.m ? `<p class="obraw">${esc(z.m.rawOb)}</p>` : `<p class="hint">No METAR yet.</p>`}</section>` : `<section class="card opscard obwx"><h2>Cazaux weather &amp; wind</h2><div class="obwxin"><div><dl class="opsdl">
        <dt>${obH("sun", "Sunrise / sunset")}</dt><dd>${czx.sun ? esc(czx.sun) : `${esc(z.sun.rise)} / ${esc(z.sun.set)}`}</dd>
        <dt>Icing band</dt><dd>${q ? obQIn("icingBand", czx.icingBand, "e.g. FL120 - FL170", "130px") : esc(czx.icingBand || "-")}</dd>
        <dt>Temperature</dt><dd>${z.t ?? "-"}°C</dd><dt>${obH("rh", "Humidity")}</dt><dd>${z.rh ?? "-"}%</dd><dt>QNH</dt><dd>${z.qnh ?? "-"}</dd>
        <dt>Runway surface</dt><dd>${q ? obQSel("rwySurface", czx.rwySurface, ["DRY", "DAMP", "WET", "FLOODED"]) : obPill(/FLOOD/i.test(czx.rwySurface) ? "r" : /WET|DAMP/i.test(czx.rwySurface) ? "a" : czx.rwySurface ? "g" : "", czx.rwySurface || "-")}</dd><dt>${obH("sea", "Sea surface")}</dt><dd>${q ? obQIn("seaTemp", czx.seaTemp, "°C", "64px", obSeaS(czx.seaTemp)) + " °C" : czx.seaTemp ? obPill(obSeaS(czx.seaTemp), czx.seaTemp + "°C") : "-"}</dd>
        <dt>Sea swell</dt><dd>${q ? obQIn("swell", czx.swell, "e.g. 1.6-1.9M", "110px") : esc(czx.swell || "-")}</dd><dt>Bird hazard</dt><dd>${q ? obQSel("bird", czx.bird, ["LOW (1)", "LOW (2)", "MED (2)", "HIGH (3)"]) : obPill(/HIGH/i.test(czx.bird) ? "r" : /MED/i.test(czx.bird) ? "a" : czx.bird ? "g" : "", czx.bird || "-")}</dd>
        <dt>${obH("icing", "Icing conditions")}</dt><dd>${q ? `<select class="obsel ${z.icing ? "obst-" + (z.icing === "YES" ? "r" : "g") : ""}" data-obq="czx" data-f="icing" aria-label="Icing conditions"><option value="">${esc(z.icingAuto || "-")} (auto)</option>${["YES", "NO"].map(o => `<option ${o === czx.icing ? "selected" : ""}>${o}</option>`).join("")}</select>` : yn(z.icing, "YES") + (czx.icing ? " ✎" : "")}</dd></dl></div><div class="obwxwind"><div class="obwind">${obRose(w, z.rwy)}<div><div class="obbig">${esc(windTxt)}</div>
        ${comp ? `<div>${obH("wind", comp.head < 0 ? "Tailwind" : "Headwind")} <b>${Math.abs(comp.head).toFixed(1)}</b> KT</div><div>${obH("wind", "Crosswind")} <b>${comp.cross.toFixed(1)}</b> KT</div><div class="hint">RWY ${esc(String(z.rwy / 10).padStart(2, "0"))} · ${obH("wind", "governing wind")} ${w.gov} KT</div>` : ""}
        <div>${obH("windHazard", "Wind hazard")} ${q ? `<select class="obsel ${obHazS(czx.windHazard) ? "obst-" + obHazS(czx.windHazard) : ""}" data-obq="czx" data-f="windHazard" aria-label="Wind hazard">${["", "A", "B", "C", "D"].map(o => `<option value="${o}" ${o === (czx.windHazard || "") ? "selected" : ""}>${o || "-"}</option>`).join("")}</select>` : czx.windHazard ? obPill(obHazS(czx.windHazard), czx.windHazard) : "-"}</div></div></div></div></div>
        ${z.m ? `<p class="obraw">${esc(z.m.rawOb)}</p>` : `<p class="hint">No METAR yet.</p>`}</section>`}
      <section class="card opscard" id="ob-eq"><h2>Canopy / equipment</h2><div class="obeq">
        ${[["canopy", "Canopy"], ["apu1", "APU (A11–15)"], ["apu2", "APU (A16–23)"]].map(([f, l]) => obEqCell(b, z, f, l, q)).join("")}
        <div>${obH("parachute", "Parachute")} ${q ? `<select class="obsel obst-${obParaS(b.equip.parachute) || "n"}" data-obq="eqv" data-f="parachute" aria-label="Parachute">${[...new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", String(b.equip.parachute ?? "")])].filter(x => x !== "").map(o => `<option ${o === String(b.equip.parachute) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>` : obPill(obParaS(b.equip.parachute), b.equip.parachute ?? "-")}</div>
        <div>${obH("samar", "SAMAR")} ${q ? `<input class="obval obst-${obSamarS(b.equip.samar) || "n"}" style="width:64px" data-obq="eqv" data-f="samar" value="${esc(b.equip.samar || "")}" aria-label="SAMAR">` : obPill(obSamarS(b.equip.samar), b.equip.samar || "-")}</div></div>
        <p class="hint" style="margin:6px 0 0">Canopy and APU are worked out from the Cazaux wind and temperature.${q ? " Tap one to mark it Not available; Refresh METARs puts them back to auto." : ""}</p></section>
      <section class="card opscard obwide" id="ob-ra"><h2>Restricted areas</h2>${obAreasView(b, q, z, tv)}</section>
      ${tv ? "" : obCallsignsCard()}${extra || ""}
    </div>`;
}
function obAreasView(b, q, z, tv) {
  const r = b.r115 || {}, czx = b.czx || {};
  const f = (k, w) => q ? `<input class="obval" style="width:${w}" data-obq="r115" data-f="${k}" value="${esc(r[k] || "")}" aria-label="R115 ${k}">` : esc(r[k] || "-");
  const wx = q ? obRwxSel(r.wx, 'data-obq="r115wx"')
    : `<span class="obcs ${obCsCls(r.wx)}">${esc(r.wx || "-")}</span>`;
  const restr = q ? `<input class="obval" style="width:${tv ? "220px" : "170px"}" data-obq="r115" data-f="restr" value="${esc(r.restr || "")}" placeholder="e.g. G1, G3, RADAR" aria-label="R115 restrictions">` : esc(r.restr || "-");
  // On the page, board editors can add or remove areas (Gordon, 10 Oct): ✕ on each, "+ Area" at the bottom.
  const rm = j => q && !tv ? `<button class="obrm" data-obarea="rm" data-j="${j}" title="Remove this area" aria-label="Remove">✕</button>` : "";
  const areas = (b.areas || []).map((x, j) => `<div class="obarea"><span>${esc(x.item)}</span><span class="obvc2">${obValCell(q, "aval", `data-j="${j}"`, x.val, obValS(x.val, x.s), x.s)}${rm(j)}</span></div>`).join("")
    + (q && !tv ? `<div class="obaddarea"><button class="btn small" data-obarea="add">+ Area</button></div>` : "");
  const r115 = tv ? `<div class="obr115"><b>R115 (CAPTIEUX)</b><span>TGT <b>${esc(r.tgt || "-")}</b></span><span>${obH("rangewx", "WX")} ${wx}</span><span>Before <b>${esc(r.before || "-")}</b></span><span>After <b>${esc(r.after || "-")}</b></span><span>Restr <b>${esc(r.restr || "-")}</b></span></div>`
    : "";
  const other = `<div class="obarea"><span>${obH("immersion", "Immersion suit")}</span>${z.immersion ? obPill(z.immersion === "YES" ? "r" : "g", z.immersion) : `<span class="hint">-</span>`}</div>
      <div class="obarea"><span>Firing sch</span>${obValCell(q, "czxv", `data-f="firing"`, czx.firing, obValS(czx.firing, czx.firingS), czx.firingS)}</div>
      <div class="obarea"><span>CALAMAR</span>${obValCell(q, "czxv", `data-f="calamar"`, czx.calamar, obValS(czx.calamar, czx.calamarS, true), czx.calamarS)}</div>`;
  if (tv) return `${r115}<div class="obareas">${areas}${other}</div>`;
  // Page: three lists straight down with dividers, like the weather card (Gordon, 10 Oct): R115 | restricted areas | other
  const row = (l, v) => `<div class="obarea"><span>${l}</span>${v}</div>`;
  return `<div class="obra3">
      <div class="obracol"><h3 class="opssub">R115 (CAPTIEUX) <button class="btn small" data-ob="chart" data-k="captieux">Map</button></h3>
        ${row("TGT", q ? f("tgt", "90px") : `<b>${esc(r.tgt || "-")}</b>`)}${row(obH("rangewx", "WX"), wx)}${row("Before", q ? f("before", "90px") : `<b>${esc(r.before || "-")}</b>`)}${row("After", q ? f("after", "90px") : `<b>${esc(r.after || "-")}</b>`)}${row("Restr", q ? restr : `<b>${restr}</b>`)}</div>
      <div class="obracol"><h3 class="opssub">Areas</h3>${areas}</div>
      <div class="obracol"><h3 class="opssub">Other</h3>${other}</div></div>
    ${q ? `<p class="hint" style="margin:6px 0 0">Type a value and it shows red (CALAMAR "BOOKED" shows yellow). Tap A to pick another colour. R115 restrictions light up the Captieux map (G1–G7, RADAR).</p>` : ""}`;
}
function obCallsignsCard() {
  const a = obGet("aircraft"), cs = a.callsigns || [];
  if (!cs.length && !a.vehicleCap) return "";
  return obCard("ob-bcs", "Callsign / ETTS / vehicle", "", `${cs.length ? `<table class="opst obt"><thead><tr><th>Callsign</th><th>ETTS</th><th>Vehicle</th></tr></thead><tbody>${cs.map(c => `<tr><td>${esc(c.callsign)}</td><td>${esc(c.etts)}</td><td>${esc(c.vehicle)}</td></tr>`).join("")}</tbody></table>` : ""}${a.vehicleCap ? `<p class="hint">Vehicle cap: ${esc(a.vehicleCap)}</p>` : ""}`);
}
// A Cazaux field ops types straight onto the board (from the FASF forecast); saved when they leave the box.
const obQIn = (f, v, ph, w, st) => `<input class="obval ${st ? "obst-" + st : ""}" style="width:${w}" data-obq="czxu" data-f="${f}" value="${esc(v || "")}" placeholder="${esc(ph)}" aria-label="${esc(f)}">`;
// Canopy / APU: worked out from the Cazaux METAR (Excel colour rules); ops can tap to mark Not available until the next Refresh.
function obEqCell(b, z, f, label, q) {
  const set = !!b.equip[f], st = z[f], txt = !st ? "-" : st === "g" ? "Available" : "Not available";
  const tag = q ? `<button class="obst obst-${st || "n"} obtap" data-obq="eqna" data-f="${f}" title="${set ? "Set by ops. Tap to go back to auto" : "Worked out from the METAR. Tap to mark Not available"}">${txt}${set ? " ✎" : ""}</button>`
    : `<span class="obst obst-${st || "n"}" title="${set ? "Set by ops" : "Worked out from the METAR"}">${txt}${set ? " ✎" : ""}</span>`;
  return `<div>${obH(f, label)} ${tag}</div>`;
}
// Colour state letter → pill colour.
const obQSel = (f, v, opts) => `<select class="obsel" data-obq="czx" data-f="${f}">${["", ...opts].map(o => `<option value="${esc(o)}" ${o === (v || "") ? "selected" : ""}>${esc(o || "-")}</option>`).join("")}</select>`;
// Small wind rose: runway line and an arrow from the wind direction.
function obRose(w, rwy) {
  const R = 46, cx = 55, cy = 55, p = (deg, r) => [cx + r * Math.sin(deg * Math.PI / 180), cy - r * Math.cos(deg * Math.PI / 180)];
  const rw = rwy != null ? [p(rwy, 30), p(rwy + 180, 30)] : null;
  const arrow = w && w.dir != null && !w.calm ? (() => { const [x1, y1] = p(w.dir, R), [x2, y2] = p(w.dir, 8); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--out)" stroke-width="4" stroke-linecap="round" marker-end="url(#obArr)"/>`; })() : "";
  return `<svg class="obrose" viewBox="0 0 110 110" role="img" aria-label="Wind"><defs><marker id="obArr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="var(--out)"/></marker></defs>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--line)" stroke-width="2"/>
    ${["N", "E", "S", "W"].map((t, i) => { const [x, y] = p(i * 90, R - 9); return `<text x="${x}" y="${y + 3}" text-anchor="middle" font-size="9" fill="var(--muted)">${t}</text>`; }).join("")}
    ${rw ? `<line x1="${rw[0][0]}" y1="${rw[0][1]}" x2="${rw[1][0]}" y2="${rw[1][1]}" stroke="var(--muted)" stroke-width="7" stroke-linecap="square" opacity=".55"/>` : ""}${arrow}</svg>`;
}

/* ---------- Charts (private storage, bucket ops-files/charts/<key>) ---------- */
const OB_CHARTS = [
  { key: "captieux", label: "Captieux (R115)" },
  { key: "xsection", label: "Cross-section", daily: true },
  { key: "special", label: "Special areas / activities", daily: true },
  { key: "diane", label: "DIANE", daily: true },
];
// Captieux target areas, in pixels of the 468 × 486 range map. Lit up when named in the R115 restrictions (e.g. "G1, G3, RADAR").
const OB_CAPTIEUX = { w: 468, h: 486, areas: {
  G7: "M315 215L323 234L324 253L302 265L273 267L253 268L237 268L226 268L216 268L207 269L200 269L192 270L184 270L176 271L167 272L157 272L147 270L137 266L127 261L118 253L110 244L105 233L102 221L102 209L104 197L108 185L114 175L121 165L130 157L139 150L150 145L160 142L172 141L182 143L192 148L201 153L209 157L216 161L223 166L231 170L238 174L248 179L258 185L271 192L286 201Z",
  G1: "M182 237L197 169L298 213L308 221L315 231L310 238L296 250Z",
  G6: "M206 379L265 382L290 398L265 410L209 431Z",
  G2: [318, 308, 45], G4: [250, 315, 46], G5: [231, 333, 47], G3: [280, 360, 37], RADAR: [341, 365, 37],
} };
function obCaptieuxActive() {
  const r = obGet("board").r115;
  const t = " " + String(r ? r.restr || "" : "").toUpperCase().replace(/[,/;]/g, " ").replace(/\s+/g, " ") + " ";
  const on = Object.keys(OB_CAPTIEUX.areas).filter(k => k === "RADAR" ? / (RADAR|SATAN) /.test(t) : t.includes(" " + k + " "));
  return on;
}
// A chart is hidden once ops clears it (✕), until a newer one is uploaded.
const obFile = key => { const f = OB.files[key], cl = (obGet("board").chartsCleared || {})[key], at = f && obChartAge(f); return f && !(cl && at && at <= new Date(cl)) ? f : null; };
const obChartAge = f => f && (f.updated_at || f.created_at) ? new Date(f.updated_at || f.created_at) : null;
function obChartsCard() {
  const can = obCanBoard(), today = todayStr();
  const rows = OB_CHARTS.map(c => {
    const f = obFile(c.key), at = obChartAge(f);
    const stale = c.daily && at && at.toISOString().slice(0, 10) !== today && at.toLocaleDateString("en-CA") !== today;
    return `<div class="obchart"><button class="btn" data-ob="chart" data-k="${c.key}" ${f ? "" : "disabled"}>${esc(c.label)}</button>
      <span class="hint">${at ? `${stale ? obPill("a", "not today") + " " : ""}${esc(at.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}` : "Not uploaded"}</span>
      ${can ? `<label class="btn small obup">Upload<input type="file" accept="image/*,application/pdf" data-ob="upload" data-k="${c.key}" hidden></label>${f ? `<button class="btn small" data-ob="chartclr" data-k="${c.key}" aria-label="Remove ${esc(c.label)}">✕</button>` : ""}` : ""}</div>`;
  }).join("");
  const on = obCaptieuxActive();
  return obCard("ob-charts", "Charts", on.length ? `Captieux active: ${esc(on.map(k => k === "RADAR" ? "RADAR SATAN" : k).join(", "))}` : "", `<div class="obcharts">${rows}</div>
    ${can ? `<p class="hint" style="margin:6px 0 0">Uploading replaces the old one. Only signed-in users can open these.</p>` : ""}`);
}
// TV bar: one button per uploaded chart, opens it full screen (Gordon, 10 Oct). Stale daily charts are marked.
function obTvCharts() {
  const have = OB_CHARTS.filter(c => obFile(c.key)); if (!have.length) return "";
  const today = todayStr();
  return `<span class="tvcharts">Charts ${have.map(c => { const f = obFile(c.key), at = f && (f.updated_at || f.created_at), stale = c.daily && at && new Date(at).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }) !== today;
    return `<button class="btn small${stale ? " stale" : ""}" data-ob="chart" data-k="${c.key}" title="${stale ? "Not uploaded today" : ""}">${esc(c.label.replace(/ \(R115\)| areas \/ activities/g, ""))}</button>`; }).join("")}</span>`;
}
const obUrlCache = {};
async function obChartUrl(key) {
  const f = OB.files[key], stamp = f ? (f.updated_at || f.id) : "";
  if (obUrlCache[key] && obUrlCache[key].stamp === stamp) return obUrlCache[key];
  const { data, error } = await S.sb.storage.from("ops-files").download("charts/" + key);
  if (error) throw error;
  if (obUrlCache[key]) URL.revokeObjectURL(obUrlCache[key].url);
  return (obUrlCache[key] = { stamp, url: URL.createObjectURL(data), type: data.type });
}
async function obShowChart(key) {
  const c = OB_CHARTS.find(x => x.key === key); if (!c) return;
  if (!obFile(key)) return ask(c.label, obCanBoard() ? `No ${c.label} map has been uploaded yet. Use Upload next to it in the Charts card at the bottom of the Ops board.` : `No ${c.label} map has been uploaded yet. Ask ops to upload it.`, "OK");
  let d = document.getElementById("dlgChart");
  if (!d) { d = document.createElement("dialog"); d.id = "dlgChart"; document.body.appendChild(d); }
  d.innerHTML = `<div class="dlg"><div class="opshead"><h2 tabindex="-1" autofocus>${esc(c.label)}</h2><button class="btn small" data-x="close">Close</button></div><div class="obchartview"><p class="hint">Loading…</p></div></div>`;
  d.onclick = e => { if (e.target.closest("[data-x=close]") || e.target === d) d.close(); };
  d.showModal();
  try {
    const u = await obChartUrl(key), box = d.querySelector(".obchartview");
    if (/pdf/.test(u.type)) { box.innerHTML = `<iframe src="${u.url}" title="${esc(c.label)}"></iframe><p><a href="${u.url}" target="_blank" rel="noopener">Open full screen</a></p>`; return; }
    let svg = "";
    if (key === "captieux") {
      const on = obCaptieuxActive(), A = OB_CAPTIEUX.areas;
      svg = `<svg viewBox="0 0 ${OB_CAPTIEUX.w} ${OB_CAPTIEUX.h}" preserveAspectRatio="none">${on.map(k => {
        const v = A[k], cls = k === "RADAR" ? "obhot radar" : "obhot";
        return Array.isArray(v) ? `<circle class="${cls}" cx="${v[0]}" cy="${v[1]}" r="${v[2]}"/>` : `<path class="${cls}" d="${v}"/>`;
      }).join("")}</svg>`;
      box.insertAdjacentHTML("beforebegin", `<p class="hint" style="margin:0 0 6px">${on.length ? "Lit up from the R115 restrictions: <b>" + esc(on.map(k => k === "RADAR" ? "RADAR SATAN" : k).join(", ")) + "</b>" : "Nothing listed in the R115 restrictions."}</p>`);
    }
    box.innerHTML = `<div class="obchartimg"><img src="${u.url}" alt="${esc(c.label)}">${svg}</div>`;
  } catch (e) { d.querySelector(".obchartview").innerHTML = `<p class="err">Couldn't open it: ${esc(errMsg(e))}</p>`; }
}
async function obUpload(input) {
  const file = input.files && input.files[0], key = input.dataset.k; if (!file) return;
  if (file.size > 15 * 1024 * 1024) return toast("That file is over 15 MB.");
  toast("Uploading…");
  const { error } = await S.sb.storage.from("ops-files").upload("charts/" + key, file, { upsert: true, contentType: file.type || "application/octet-stream", cacheControl: "60" });
  input.value = "";
  if (error) return toast("Upload failed: " + errMsg(error));
  delete obUrlCache[key];
  toast("Uploaded."); obLoad();
}
document.addEventListener("change", e => { if (e.target.dataset && e.target.dataset.ob === "upload") obUpload(e.target); });

/* ---------- Go / No-Go page ---------- */
function renderGoNoGo(v) {
  if (!OB.loaded) return obNotLoaded(v);
  const can = obCanBoard(), gm = obGet("gonogo");
  let html = obMyItemsCard();
  // status: one compact block per group, side by side; big groups spread over columns
  const crew = OB.crew.filter(c => c.active), tg = obTodayGet();
  const goCount = crew.filter(c => !obOutstanding(c.id).length).length;
  const watch = obWatchWaves(tg), soonNg = crew.filter(c => obOutstanding(c.id).length && obSoon(c.name, tg, watch)).length;
  html += obCard("ob-go", "Aircrew status", `${soonNg ? `<b class="obsoonhd">${soonNg} NO-GO in ${esc(watch.map(x => x.name).join(" / "))}</b> · ` : ""}${goCount} of ${crew.length} GO${gm.miac ? ` · MIAC 4 effective till ${esc(fmtDay(gm.miac))}` : ""}`,
    crew.length ? `<div class="obgo">${obCrewGroups(crew).map(([g, list]) => {
      const ng = list.filter(c => obOutstanding(c.id).length).length;
      return `<div class="obgg" style="--r:${Math.ceil(list.length / Math.ceil(list.length / 8))}"><h3 class="opssub">${esc(obGrpLabel(g))} <span class="hint">${ng ? `${ng} NO-GO` : "all GO"}</span></h3><div class="obgl">${list.map(c => {
        const out = obOutstanding(c.id);
        const so = out.length && obSoon(c.name, tg, watch);
        return `<div class="obgp${out.length ? " ng" : ""}${so ? " soon" : ""}"><span class="n">${opsX(c.name)}</span>${so ? obSoonTag(so) : ""}${out.length ? `<span class="hint">${esc(obCodes(out))}</span>` : ""}${obPill(out.length ? "r" : "g", out.length ? "NO-GO" : "GO")}</div>`;
      }).join("")}</div></div>`;
    }).join("")}</div>` : `<p class="hint">${can ? "Add the aircrew under Crew list below." : "No crew list yet."}</p>`);
  if (can) { obSyncCrewNames(); html += obItemsCard() + obCrewCard(); }
  html += obCard("ob-legend", "Legend", "", `<div class="obleg">${(gm.legend || []).map(l => `<div><b>${esc(l.code)}</b><span>${esc(l.label)}</span></div>`).join("")}</div>`,
    can && !OB.edit ? `<button class="btn small" data-ob="edit" data-k="gonogo">Edit MIAC / legend</button>` : "");
  if (OB.edit && OB.edit.key === "gonogo") html += obCard("ob-gonogo", "MIAC 4 / legend", "", obEditor("gonogo"), OB_ED_TOP);
  v.innerHTML = `<div class="obgng">${html}</div>`;
}
// Keep linked crew names in step with the account name (renamed under Admin).
const obSyncing = new Set();
function obSyncCrewNames() {
  // New flying logins (QFI, ST Tow, trainees) join the crew list by themselves (Gordon, 11 Oct: "always reference the accounts").
  for (const f of obFlyers()) {
    if (!f.profile || OB.crew.some(c => c.profile_id === f.profile || opsNorm(c.name) === opsNorm(f.name)) || obSyncing.has("add:" + f.profile)) continue;
    obSyncing.add("add:" + f.profile);
    S.sb.rpc("crew_save", { p_id: null, p_name: String(f.name).toUpperCase().trim(), p_grp: f.grp, p_profile: f.profile, p_active: true, p_sort: f.sort })
      .then(({ error }) => { if (!error) obLoad(); });
  }
  for (const c of OB.crew) {
    const p = c.profile_id && S.profiles.find(x => x.id === c.profile_id), want = p && String(p.display_name || "").trim().toUpperCase();
    // QFI ↔ FIC follows the login's appointment
    const grp = p && p.role === "admin" && (c.grp === "QFI" || c.grp === "FIC") ? (p.appointment === "FIC" ? "FIC" : "QFI") : c.grp;
    if (!want || (want === c.name && grp === c.grp) || obSyncing.has(c.id)) continue;
    obSyncing.add(c.id);
    S.sb.rpc("crew_save", { p_id: c.id, p_name: want, p_grp: grp, p_profile: c.profile_id, p_active: c.active, p_sort: c.sort })
      .then(({ error }) => { obSyncing.delete(c.id); if (!error) { c.name = want; c.grp = grp; obRerender(); } });
  }
}
// Today's programme sections (from the flying program if it's on today, else the home dashboard's copy; fetched once if neither).
let obTodayFetch = null;
function obTodayGet() {
  const day = todayStr();
  if (OPS.rowsDay === day) return opsGet;
  if (S.homeOps && S.homeOps.day === day) return sec => S.homeOps.rows[sec] || {};
  if (obTodayFetch !== day) {
    obTodayFetch = day;
    S.sb.from("ops_sections").select("section,data").eq("day", day).then(({ data }) => {
      const rows = {}; for (const r of data || []) rows[r.section] = r.data;
      const fl = rows.flying;
      S.homeOps = { day, rows, any: (data || []).some(r => r.data && Object.keys(r.data).length), st: opsStats(fl || { waves: [] }) };
      if (["gonogo", "tv"].includes(S.tab)) obRerender();
    });
  }
  return null;
}
// The waves the ops officer checks (Gordon, 10 Oct): the wave(s) under way now and the next wave to start.
// Each wave runs from its earliest brief / step / ETD to its last ETA (Z). Returns [{ name, s, e }] or [] when today's flying is done.
function obWatchWaves(get) {
  if (!get) return [];
  const fl = opsNameWaves(JSON.parse(JSON.stringify(get("flying") || {}))), wins = opsWindows(fl);
  const d = new Date(), now = d.getUTCHours() * 60 + d.getUTCMinutes();
  const ws = (fl.waves || []).map((w, i) => ({ w, i, s: wins[i].s, e: wins[i].e })).filter(x => x.s != null);
  const on = ws.filter(x => x.s <= now && now <= x.e), next = ws.filter(x => x.s > now).sort((a, b) => a.s - b.s)[0];
  return [...on, ...(next ? [next] : [])].map(x => ({ ...x, name: x.w.name }));
}
// Is this person in one of the watched waves (flying, SXO / OPS O, or a sim in that wave's time window)? Returns { t, at, what } or null.
function obSoon(name, get, watch) {
  watch = watch || obWatchWaves(get);
  const n = opsNorm(name); if (!n || !watch.length) return null;
  const z4 = m => String(Math.floor(m / 60) % 24).padStart(2, "0") + String(m % 60).padStart(2, "0") + "Z";
  const sim = (get("sim") || {}).rows || [], list = [];
  for (const x of watch) {
    for (const f of x.w.flights || []) if ((f.ac || []).some(a => opsCrewHas(a, n))) {
      const st = [f.brief, f.step, f.etd].map(opsMin).filter(m => m != null);
      list.push({ t: st.length ? Math.min(...st) : x.s, what: `${x.name} · ${f.callsign || ""} ${f.etd || ""}`.trim() });
    }
    if (opsHas(x.w.sxo, n)) list.push({ t: x.s, what: `${x.name} · SXO` });
    if (opsHas(x.w.opsO, n)) list.push({ t: x.s, what: `${x.name} · OPS O` });
    for (const r of sim) { const t = opsMin(r.etd); if (t != null && t >= x.s && t <= x.e && (r.ac || []).some(a => opsCrewHas(a, n))) list.push({ t, what: `${x.name} · SIM ${r.etd}` }); }
  }
  if (!list.length) return null;
  list.sort((a, b) => a.t - b.t);
  return { ...list[0], at: z4(list[0].t) };
}
const obWatchLabel = watch => watch.map(x => `${x.name.replace("WAVE", "W").replace("NIGHT W", "NW")}`).join(" + ");
// The watched waves move with the clock: refresh the TV and the Go / No-Go page every 5 minutes.
setInterval(() => { if ((S.tab === "tv" || S.tab === "gonogo") && !/^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName) && !document.querySelector("dialog[open]")) S.tab === "tv" ? render() : obRerender(); }, 5 * 60 * 1000);
const obSoonTag = so => so ? `<span class="obsoon" title="${esc(so.what)}">${esc(so.what.split(" · ")[0].replace("NIGHT WAVE ", "NW").replace("WAVE ", "W"))} ⏱ ${esc(so.at)}</span>` : "";
const obGrpLabel = g => g === "ST" ? "ST TOW" : g;
// [[group, crew…]] in the standard group order (QFI, ST, PGF, TRAINEES, …), then any other groups.
function obCrewGroups(crew) {
  const groups = [...new Set([...OB_GROUPS, ...crew.map(c => c.grp)])].filter(g => crew.some(c => c.grp === g));
  // QFIs follow the seniority order set on Admin; other groups keep the crew list order.
  return groups.map(g => [g, g === "QFI" ? crew.filter(c => c.grp === g).slice().sort((a, b) => instrRank(a.name) - instrRank(b.name) || (a.sort ?? 999) - (b.sort ?? 999)) : crew.filter(c => c.grp === g)]);
}
// Everyone who flies: QFIs (instructor logins except the Command Chief), ST Tow, then trainees (PGF first, FWC, WSO).
function obFlyers() {
  const out = [], ao = { CO: 0, DYCO: 1, "OC A": 2, "OC B": 3, QFI: 4 };
  S.profiles.filter(p => p.role === "admin" && p.appointment !== "CC" && p.display_name)
    .sort(instrSort)
    .forEach((p, i) => out.push({ name: p.display_name, grp: p.appointment === "FIC" ? "FIC" : "QFI", profile: p.id, sort: 100 + i }));
  S.profiles.filter(p => p.staff_role === "ST" && p.display_name).forEach((p, i) => out.push({ name: p.display_name, grp: "ST", profile: p.id, sort: 300 + i }));
  const rank = c => /PGF/i.test(c) ? 0 : /FWC/i.test(c) ? 1 : /WSO/i.test(c) ? 2 : 3;
  active().slice().sort((a, b) => rank(a.course || "") - rank(b.course || "") || String(a.course || "").localeCompare(String(b.course || ""), undefined, { numeric: true }) || a.name.localeCompare(b.name))
    .forEach((t, i) => { const p = S.profiles.find(x => x.trainee_id === t.id); out.push({ name: t.name, grp: "TRAINEES", profile: p ? p.id : null, sort: 500 + i }); });
  return out;
}
function obMyItemsCard() {
  const mine = obMyCrew();
  if (!mine.length) return "";
  const pend = obMyPending();
  const body = pend.length ? pend.map(({ item: i, crew: c }) => `<div class="obitem"><div class="obitemhead">${obPill("r", i.code)} <b>${esc(i.title)}</b>${mine.length > 1 ? ` <span class="hint">(${esc(c.name)})</span>` : ""}</div>
      ${i.body ? `<div class="obbody">${esc(i.body).replace(/\n/g, "<br>")}</div>` : ""}${i.link ? `<p><a href="${esc(obSafeUrl(i.link))}" target="_blank" rel="noopener">Open document</a></p>` : ""}
      <div style="display:flex;justify-content:flex-end"><button class="btn primary small" data-ob="done" data-item="${esc(i.id)}" data-crew="${esc(c.id)}">I've read it: Done</button></div></div>`).join("")
    : `<p style="margin:0">${obPill("g", "GO")} Nothing outstanding.</p>`;
  return obCard("ob-mine", "Your read &amp; sign", pend.length ? `${pend.length} outstanding` : "", body);
}
const obSafeUrl = u => /^https?:\/\//i.test(u || "") ? u : "#";
function obItemsCard() {
  const items = OB.items.filter(i => OB.showClosed || !i.closed);
  const crewName = id => (OB.crew.find(c => c.id === id) || {}).name || "?";
  const list = items.map(i => {
    const acks = OB.acks.filter(a => a.item_id === i.id), done = acks.filter(a => a.done_at).length, open = OB.open[i.id];
    return `<div class="obitem${i.closed ? " closed" : ""}"><div class="obitemhead" data-ob="toggle" data-item="${esc(i.id)}" style="cursor:pointer">${obPill(i.closed ? "" : done === acks.length ? "g" : "a", i.code)} <b>${esc(i.title)}</b>
        <span class="hint">${done}/${acks.length} done · ${esc(new Date(i.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }))}${i.closed ? " · closed" : ""}</span> <span class="hint">${open ? "▲" : "▼"}</span></div>
      ${open ? `${i.body ? `<div class="obbody">${esc(i.body).replace(/\n/g, "<br>")}</div>` : ""}${i.link ? `<p><a href="${esc(obSafeUrl(i.link))}" target="_blank" rel="noopener">Open document</a></p>` : ""}
        <div class="obacks">${acks.sort((a, b) => crewName(a.crew_id).localeCompare(crewName(b.crew_id))).map(a => `<label class="opschk"><input type="checkbox" data-ob="ack" data-item="${esc(i.id)}" data-crew="${esc(a.crew_id)}" ${a.done_at ? "checked" : ""}>${esc(crewName(a.crew_id))}</label>`).join("")}</div>
        <div class="tools" style="margin-top:6px"><button class="btn small" data-ob="assign" data-item="${esc(i.id)}">+ Add people</button><button class="btn small" data-ob="close" data-item="${esc(i.id)}" data-closed="${i.closed ? "0" : "1"}">${i.closed ? "Reopen" : "Close item"}</button></div>` : ""}</div>`;
  }).join("");
  return obCard("ob-items", "Read &amp; sign items", "", `${list || `<p class="hint">No items.</p>`}
    <div class="obbar"><button class="btn primary small" data-ob="newitem">+ New item</button><label class="opschk"><input type="checkbox" data-ob="showclosed" ${OB.showClosed ? "checked" : ""}>Show closed items</label></div>
    <p class="hint" style="margin:6px 0 0">Tap an item to see who's done it. Tick people off for them, or they tap Done on their own phone.</p>`);
}
// Split a long list into roughly equal blocks of at most n (so a big group sits side by side on wide screens).
const obChunks = (a, n) => { const k = Math.ceil(a.length / n) || 1, sz = Math.ceil(a.length / k); return Array.from({ length: k }, (_, i) => a.slice(i * sz, i * sz + sz)); };
function obCrewCard() {
  const logins = S.profiles.filter(p => !p.trainee_id || active().some(t => t.id === p.trainee_id));
  const linked = new Set(OB.crew.map(c => c.profile_id).filter(Boolean));
  const lbl = p => pLabel(p) + (p.callsign && p.display_name && p.display_name !== p.callsign ? " – " + p.display_name : "");
  const opts = sel => `<option value="">No login</option>` + logins.filter(p => p.id === sel || !linked.has(p.id)).map(p => `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(lbl(p))}</option>`).join("");
  const gopts = sel => [...new Set([...OB_GROUPS, sel].filter(Boolean))].map(g => `<option value="${esc(g)}" ${g === sel ? "selected" : ""}>${esc(obGrpLabel(g))}</option>`).join("");
  // People with a login: name, group and login come from their account, so only Active can change here.
  // Entries without a login (e.g. visitors) stay editable.
  const row = c => { const p = c.profile_id && S.profiles.find(x => x.id === c.profile_id);
    return p ? `<tr class="${c.active ? "" : "off"}"><td class="fix">${esc(c.name)}</td><td class="fix">${esc(obGrpLabel(c.grp))}</td><td class="fix hint">${esc(lbl(p))}</td>
      <td class="c"><input type="checkbox" data-crew="${esc(c.id)}" data-f="active" ${c.active ? "checked" : ""} aria-label="Active"></td></tr>`
    : `<tr class="${c.active ? "" : "off"}"><td><input class="obcn" value="${esc(c.name)}" data-crew="${esc(c.id)}" data-f="name" aria-label="Name"></td>
      <td><select class="obcg" data-crew="${esc(c.id)}" data-f="grp" aria-label="Group">${gopts(c.grp)}</select></td>
      <td><select class="obcl" data-crew="${esc(c.id)}" data-f="profile_id" aria-label="Login">${opts(c.profile_id)}</select></td>
      <td class="c"><input type="checkbox" data-crew="${esc(c.id)}" data-f="active" ${c.active ? "checked" : ""} aria-label="Active"></td></tr>`; };
  const head = `<thead><tr><th>Name (as on the programme)</th><th>Group</th><th>Login</th><th class="c">Active</th></tr></thead>`;
  const missing = obFlyers().filter(f => !OB.crew.some(c => opsNorm(c.name) === opsNorm(f.name) || (f.profile && c.profile_id === f.profile))).length;
  return obCard("ob-crew", "Crew list", `${OB.crew.filter(c => c.active).length} active`, `<div class="obcrew">${obCrewGroups(OB.crew).map(([g, list]) =>
      obChunks(list, 8).map((part, k) => `<div class="obct"><h3 class="opssub">${k ? "&nbsp;" : esc(obGrpLabel(g))}</h3><table class="obed">${head}<tbody>${part.map(row).join("")}</tbody></table></div>`).join("")).join("")}</div>
    <div class="obadd"><b>Add someone</b><input class="obcn" id="obNewName" placeholder="e.g. M LIM" aria-label="Name"><select class="obcg" id="obNewGrp" aria-label="Group">${gopts("QFI")}</select><select class="obcl" id="obNewLogin" aria-label="Login">${opts("")}</select><button class="btn small" data-ob="addcrew">Add</button></div>
    <div class="obbar"><button class="btn small${missing ? " primary" : ""}" data-ob="addflyers">+ Add all flyers${missing ? ` (${missing} missing)` : ""}</button><span class="hint">QFIs, ST Tow and trainees on the roster who aren't on the list yet.</span></div>
    <p class="hint" style="margin:6px 0 0">People with a login are listed as on their account (rename them under Admin). Add someone without a login (e.g. an auditor) above; linking a login lets them sign off their own items and see their own day. Untick Active instead of deleting.</p>`);
}

/* ---------- Aircraft page ---------- */
function renderAircraft(v) {
  if (!OB.loaded) return obNotLoaded(v);
  const editing = OB.edit && OB.edit.key === "aircraft";
  v.innerHTML = editing ? obCard("ob-aircraft", "Aircraft status", "", obEditor("aircraft"), OB_ED_TOP) : obAircraftView(false) + `<p class="opsmeta" style="justify-content:flex-end">${obMeta("aircraft")} ${obEditBtn("aircraft", obCanEditAc(), "Edit aircraft")}</p>`;
}
// Colour tags typed (or added with the colour buttons) in notes: [r]red[/r], [y]amber[/y], [g]green[/g], [b]bold[/b].
const obFmt = t => esc(t).replace(/\[(r|y|g|b)\]([\s\S]*?)\[\/\1\]/gi, (m, c, x) => `<span class="fx-${c.toLowerCase()}">${x}</span>`).replace(/\[\/?[rygb]\]/gi, "");
const obNoteLine = l => /^\s*(NTS|AMC|NPC|OJT|MAX FLY|CFH|CONTROL HOURS)\b/i.test(l.replace(/\[\/?[rygb]\]/gi, "")) ? `<span class="obamb">${obFmt(l)}</span>` : obFmt(l);
function obAircraftView(tv) { return `<div class="obgrid ${tv ? "tv" : ""}">${obAircraftCards().join("")}</div>`; }
// Tail with its CFH mark (Gordon, 10 Oct): CFH 3 → "#", CFH 2 → "@" (not doubled if already typed into the tail).
const obTailMark = t => { const tl = String(t.tail || "").trim(), mk = t.cfh3 ? "#" : t.cfh2 ? "@" : ""; return mk && !tl.includes(mk) ? tl + mk : tl; };
function obAircraftCards() {
  const a = obGet("aircraft"), tails = a.tails || [];
  const sv = tails.filter(t => t.status === "S").length;
  const tailsHtml = tails.length ? `<div class="tablewrap"><table class="opst obt"><thead><tr><th>Tail</th><th>Status</th><th>NPC</th><th>NTS</th><th>OJT</th><th>Significant ADDL / NPC / AMC</th></tr></thead><tbody>${tails.map(t => `<tr>
      <td><b>${esc(obTailMark(t))}</b></td><td>${obPill(t.status === "S" ? "g" : t.status === "US" ? "r" : "a", t.status === "S" ? "S" : t.status === "US" ? "U/S" : "MX")}</td>
      <td>${t.npc ? obPill("a", "NPC") : ""}</td><td>${t.nts ? obPill("a", "NTS") : ""}</td><td>${t.ojt ? obPill("a", "OJT") : ""}</td>
      <td class="obnotes">${String(t.notes || "").split("\n").filter(Boolean).map(obNoteLine).join("<br>")}</td></tr>`).join("")}</tbody></table></div>${tails.some(t => t.cfh2 || t.cfh3) ? `<p class="hint" style="margin:6px 0 0"># CFH 3 · @ CFH 2</p>` : ""}` : `<p class="hint">No aircraft entered yet.</p>`;
  const cs = a.callsigns || [];
  return [obCard("ob-tails", "Aircraft status", tails.length ? `${sv} of ${tails.length} serviceable` : "", tailsHtml).replace('class="card opscard"', 'class="card opscard obwide"'),
    obCard("ob-cs", "Callsigns", "", cs.length ? `<table class="opst obt"><thead><tr><th>Callsign</th><th>ETTS</th><th>Vehicle</th></tr></thead><tbody>${cs.map(c => `<tr><td>${esc(c.callsign)}</td><td>${esc(c.etts)}</td><td>${esc(c.vehicle)}</td></tr>`).join("")}</tbody></table>${a.vehicleCap ? `<p class="hint">Vehicle cap: ${esc(a.vehicleCap)}</p>` : ""}` : `<p class="hint">None entered.</p>`)];
}

const obPrev = v => String(v || "").trim() ? String(v).split("\n").filter(Boolean).map(obNoteLine).join("<br>") : `<span class="hint">Preview shows here.</span>`;
// Colour buttons in the aircraft editor: wrap the selected words (each line separately) in a colour tag, or strip tags.
document.addEventListener("mousedown", e => { if (e.target.closest("[data-fx]")) e.preventDefault(); }); // keep the selection
document.addEventListener("click", e => {
  const b = e.target.closest("[data-fx]"); if (!b || !OB.edit) return;
  const ta = document.querySelector(`#obEdit textarea[data-bp="${b.dataset.ta}"]`); if (!ta) return;
  const v = ta.value, s0 = ta.selectionStart, s1 = ta.selectionEnd, c = b.dataset.fx;
  let out, a = s0, z = s1;
  if (c === "x") {
    if (s0 === s1) { a = 0; z = v.length; }
    out = v.slice(a, z).replace(/\[\/?[rygb]\]/gi, "");
  } else {
    if (s0 === s1) return toast("Select the words to colour first.");
    out = v.slice(a, z).split("\n").map(l => l.trim() ? `[${c}]${l}[/${c}]` : l).join("\n");
  }
  ta.value = v.slice(0, a) + out + v.slice(z);
  ta.focus(); ta.setSelectionRange(a, a + out.length);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
});
document.addEventListener("input", e => {
  const ta = e.target; if (!ta.classList || !ta.classList.contains("obnotesin")) return;
  const pv = document.querySelector(`.obprev[data-prev="${ta.dataset.bp}"]`); if (pv) pv.innerHTML = obPrev(ta.value);
});

/* ---------- TV mode ---------- */
let obWake = null;
function renderTv(v) {
  document.body.classList.add("tvmode");
  if (!OB.loaded) return obNotLoaded(v);
  if ("wakeLock" in navigator && !obWake) navigator.wakeLock.request("screen").then(l => { obWake = l; l.addEventListener("release", () => obWake = null); }).catch(() => {});
  const crew = OB.crew.filter(c => c.active), nogo = crew.filter(c => obOutstanding(c.id).length);
  const fl = OPS.rowsDay === todayStr() ? opsGet("flying") : null, st = fl ? opsStats(fl) : null;
  if (OPS.rowsDay !== todayStr() && !OPS.loading) { OPS.day = todayStr(); opsLoad(OPS.day); }
  const n = new Date();
  v.innerHTML = `<div class="tvbar"><b>150 Falcon Det · Ops board</b><span class="tvclock">${esc(n.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}L <small>${esc(n.toISOString().slice(11, 19).replace(/:/g, ""))}Z</small></span>
      <span class="grow"></span>${obTvCharts()}${st ? `<span>Today: ${st.sorties} sorties · first T/O ${esc(opsHM(st.first) || "-")} · last landing ${esc(opsHM(st.last) || "-")}</span>` : ""}<button class="btn small" data-ob="exittv">Exit TV</button></div>
    ${obBoardView(true, ((obGet("aircraft").callsigns || []).length || obGet("aircraft").vehicleCap ? obAircraftCards()[1] : "") + // TV: no aircraft status table (Gordon, 10 Oct); callsigns only when there are some // TV: no aircraft status table (Gordon, 10 Oct), callsigns only
      obTvGoCard(crew, nogo))}`;
  v.innerHTML = `<div class="tvstage">${v.innerHTML}</div>`;
  obTvLayout(v);
  requestAnimationFrame(() => obTvLayout(v)); setTimeout(() => obTvLayout(v), 1200);
}
// TV aircrew status: NO-GO people in the wave under way / the next wave first and loud (with their time); other NO-GO toned down.
function obTvGoCard(crew, nogo) {
  if (!nogo.length) return obCard("ob-tvgo", "Aircrew status", `${crew.length} of ${crew.length} GO`, `<p>${obPill("g", "ALL GO")}</p>`);
  const tg = obTodayGet(), watch = obWatchWaves(tg), soon = [], later = [];
  for (const c of nogo) { const so = obSoon(c.name, tg, watch); (so ? soon : later).push([c, so]); }
  const wl = watch.map(x => x.name).join(" / ");
  soon.sort((a, b) => a[1].t - b[1].t);
  const chip = ([c, so]) => `<span class="${so ? "obtvsoon" : "obtvlater"}">${obPill(so ? "r" : "", c.name)}${so ? ` <b>${esc(so.at)}</b>` : ""} <span class="hint">${esc(obCodes(obOutstanding(c.id)))}</span></span>`;
  return obCard("ob-tvgo", "Aircrew status", `${crew.length - nogo.length} of ${crew.length} GO`,
    `<div class="obtvgo">${soon.length ? `<div class="obtvhd soon">NO-GO · ${esc(wl)}</div>${soon.map(chip).join("")}` : `<div class="obtvhd">${obPill(watch.length ? "g" : "", watch.length ? `${wl}: all crew GO` : "No more waves today")}</div>`}
      ${later.length ? `<div class="obtvhd">Other NO-GO (${later.length})</div>${later.map(chip).join("")}` : ""}</div>`);
}
// Spread the TV cards over balanced columns: each card goes to the currently shortest column.
// Landscape: try 3 and 4 columns and keep whichever lets the board be shown biggest (Gordon, 10 Oct: no big empty cards).
function obTvLayout(v) {
  if (!v.querySelector(".obgrid.tv")) return;
  if (innerWidth / innerHeight < 1) { obTvColumns(v, 2); return obTvFit(); }
  let best = null;
  for (const n of [3, 4]) { obTvColumns(v, n); obTvFit(); const z = parseFloat((document.querySelector(".tvstage") || {}).style?.zoom) || 1; if (!best || z > best.z + 0.01) best = { n, z }; }
  if (best.n !== 4) { obTvColumns(v, best.n); obTvFit(); }
}
function obTvColumns(v, n) {
  const grid = v.querySelector(".obgrid.tv"); if (!grid) return;
  const old = grid.querySelector(".tvcols");
  if (old) { (grid._tvOrder || []).forEach(c => grid.insertBefore(c, old)); old.remove(); }
  const wrap = document.createElement("div"); wrap.className = "tvcols"; wrap.style.gridTemplateColumns = `repeat(${n},minmax(0,1fr))`;
  const cols = Array.from({ length: n }, () => { const c = document.createElement("div"); c.className = "tvcol"; wrap.appendChild(c); return c; });
  const cards = grid._tvOrder = [...grid.children].filter(c => !c.classList.contains("obafcard"));
  wrap.classList.add("measuring"); grid.appendChild(wrap);
  const used = col => [...col.children].reduce((h, x) => h + x.offsetHeight, 0); // columns stretch, so add up the cards
  for (const c of cards) cols.reduce((a, b) => (used(b) < used(a) ? b : a)).appendChild(c);
  wrap.classList.remove("measuring");
}
// Fit the whole TV dashboard on one screen: find the largest zoom at which it fits the window height (the layout reflows at each zoom).
function obTvFit() {
  const st = document.querySelector(".tvstage"); if (!st || !document.body.classList.contains("tvmode") || st.classList.contains("noautofit")) return;
  const cols = st.querySelector(".tvcols"); if (cols) cols.style.minHeight = "";
  st.style.zoom = 1;
  const avail = window.innerHeight - st.getBoundingClientRect().top - 4;
  const fits = z => { st.style.zoom = z; return st.getBoundingClientRect().height <= avail && document.documentElement.scrollWidth <= window.innerWidth; };
  let lo = 0.3, hi = 3;
  if (!fits(hi)) { for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; } st.style.zoom = lo; } else lo = hi;
  // Stretch the columns down to the bottom of the screen so there's no empty band (cards grow to fill it).
  if (cols) {
    const left = avail - st.getBoundingClientRect().height;
    if (left > 1) { const r = cols.getBoundingClientRect(), k = r.height / cols.offsetHeight || lo; cols.style.minHeight = (r.height + left - 3) / k + "px"; }
  }
}
// Web fonts change text sizes after they load: fit again then.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => obTvFit());
window.addEventListener("resize", () => { clearTimeout(obTvFit.t); obTvFit.t = setTimeout(obTvFit, 150); });
const obLeaveTv = () => { document.body.classList.remove("tvmode", "tvscroll"); if (obWake) { obWake.release().catch(() => {}); obWake = null; } };

/* ---------- editors (board, aircraft, gonogo) ---------- */
const bI = (p, v, w, ph) => `<input data-bp="${p}" value="${esc(v ?? "")}"${w ? ` style="width:${w}"` : ""}${ph ? ` placeholder="${esc(ph)}"` : ""}>`;
const bT = (p, v, rows) => `<textarea data-bp="${p}" rows="${rows || 2}">${esc(v ?? "")}</textarea>`;
const bC = (p, v, label) => `<label class="opschk"><input type="checkbox" data-bp="${p}" ${v ? "checked" : ""}>${label}</label>`;
const bS = (p, v, opts) => `<select data-bp="${p}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(v ?? "") === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const bB = (op, p, i, label, tpl) => `<button type="button" class="btn small" data-bop="${op}" data-p="${p}" data-i="${i ?? ""}" data-tpl="${tpl || ""}">${label}</button>`;
const bTools = (p, i) => `<span class="tools">${bB("up", p, i, "↑")}${bB("down", p, i, "↓")}${bB("del", p, i, "✕")}</span>`;
const OB_ST = [["g", "Available"], ["a", "Limited"], ["r", "U/S"], ["auto", "Auto (CAT 1)"], ["", "-"]];
const OB_AUTO = [["", "Auto (from METAR)"], ["g", "Available"], ["r", "Not available"]];
const OB_VALCOL = [["", "Auto (red when filled)"], ["g", "Green"], ["a", "Amber"], ["r", "Red"]];
const obTpl = {
  af: () => obAf("", "alt", false, "", []),
  aid: () => obAid("", "g"),
  ra: () => ({ item: "", val: "", s: "" }),
  tail: () => ({ tail: "", status: "S", npc: false, nts: false, ojt: false, cfh2: false, cfh3: false, notes: "" }),
  cs: () => ({ callsign: "", etts: "", vehicle: "" }),
  leg: () => ({ code: "", label: "" }),
};
function obEditor(k) {
  const d = OB.edit.data;
  let body = "";
  if (k === "board") {
    body = `<div class="opsed"><div class="grid"><label>EOR${bS("eor", d.eor, [["NORMAL", "NORMAL"], ["IN HSE", "IN HSE"]])}</label>
        <label>Banner${bI("banner", d.banner, "", "e.g. BIRD MIGRATORY SEASON (OCT - NOV)")}</label><label>Airspace note${bI("zrt", d.zrt, "", "e.g. ZRT ARCACHON SFC - FL130")}</label></div>
      <h3 class="opssub">Airfields</h3>${(d.airfields || []).map((a, i) => `<div class="blk"><div class="tablewrap"><table><thead><tr><th>ICAO</th><th>Table</th><th>P</th><th>RWY</th><th>FASF</th><th>RSAF</th><th>WX / VIS override</th><th>Restrictions</th><th></th></tr></thead><tbody><tr>
          <td>${bI(`airfields.${i}.icao`, a.icao, "60px")}</td><td>${bS(`airfields.${i}.grp`, a.grp, [["main", "Main"], ["alt", "Other"]])}</td><td>${bC(`airfields.${i}.p`, a.p, "")}</td><td>${bI(`airfields.${i}.rwy`, a.rwy, "46px")}</td>
          <td>${bS(`airfields.${i}.fasf`, a.fasf, [["AUTO", "Auto"], ...OB_FASF.map(v => [v, v])])}</td><td>${bS(`airfields.${i}.rsaf`, a.rsaf, [["AUTO", "Auto"], ...OB_RSAF.map(v => [v, v])])}</td><td>${bI(`airfields.${i}.wx`, a.wx, "130px", "blank = from METAR")}</td><td>${bI(`airfields.${i}.restr`, a.restr, "200px")}</td><td>${bTools("airfields", i)}</td></tr></tbody></table>
        ${a.grp === "main" ? `<table><tbody><tr><td class="hint">Aids</td>${(a.aids || []).map((x, j) => `<td>${bI(`airfields.${i}.aids.${j}.name`, x.name, "90px")}${bS(`airfields.${i}.aids.${j}.s`, x.s, OB_ST)}${bB("del", `airfields.${i}.aids`, j, "✕")}</td>`).join("")}<td>${bB("add", `airfields.${i}.aids`, "", "+ Aid", "aid")}</td></tr></tbody></table>` : ""}</div></div>`).join("")}
      ${bB("add", "airfields", "", "+ Airfield", "af")}
      <h3 class="opssub">Cazaux</h3><div class="grid">${[["sun", "Sunrise / sunset (blank = auto)"], ["icingBand", "Icing band"], ["seaTemp", "Sea surface (°C)"], ["swell", "Sea swell"]].map(([f, l]) => `<label>${l}${bI("czx." + f, d.czx[f])}</label>`).join("")}
        <label>Runway surface${bS("czx.rwySurface", d.czx.rwySurface, ["", "DRY", "DAMP", "WET", "FLOODED"].map(v => [v, v || "-"]))}</label>
        <label>Bird hazard state${bS("czx.bird", d.czx.bird, ["", "LOW (1)", "LOW (2)", "MED (2)", "HIGH (3)"].map(v => [v, v || "-"]))}</label>
        <label>Wind hazard${bS("czx.windHazard", d.czx.windHazard, ["", "A", "B", "C", "D"].map(v => [v, v || "-"]))}</label>
        <label>Bingo${bS("bingo", d.bingo, [["AUTO", "Auto (from CZX RSAF)"], ["NONE", "— (blank)"], ["BINGO", "BINGO"], ["UPG BINGO", "UPG BINGO"], ["IFR BINGO", "IFR BINGO"]])}</label></div>
      <h3 class="opssub">Canopy / equipment</h3><div class="grid"><label>Canopy${bS("equip.canopy", d.equip.canopy, OB_AUTO)}</label><label>APU (A11–15)${bS("equip.apu1", d.equip.apu1, OB_AUTO)}</label><label>APU (A16–23)${bS("equip.apu2", d.equip.apu2, OB_AUTO)}</label>
        <label>Parachute (0 = green)${bI("equip.parachute", d.equip.parachute)}</label><label>SAMAR (G… / Y… / R…)${bI("equip.samar", d.equip.samar)}</label></div>
      <h3 class="opssub">Restricted areas</h3><div class="tablewrap"><table><thead><tr><th>R115 (CAPTIEUX)</th><th>TGT</th><th>WX</th><th>Before</th><th>After</th><th>Restrictions (G1–G7, RADAR)</th></tr></thead><tbody><tr><td></td>
        <td>${bI("r115.tgt", d.r115.tgt, "70px")}</td><td>${obRwxSel(d.r115.wx, 'data-rwx="ed"')}</td><td>${bI("r115.before", d.r115.before, "80px")}</td><td>${bI("r115.after", d.r115.after, "80px")}</td><td>${bI("r115.restr", d.r115.restr, "180px")}</td></tr></tbody></table></div>
      <div class="tablewrap"><table><thead><tr><th>Item</th><th>Value</th><th>Colour</th><th></th></tr></thead><tbody>${(d.areas || []).map((r, i) => `<tr>
        <td>${bI(`areas.${i}.item`, r.item, "120px")}</td><td>${bI(`areas.${i}.val`, r.val, "110px")}</td><td>${bS(`areas.${i}.s`, r.s, OB_VALCOL)}</td><td>${bTools("areas", i)}</td></tr>`).join("")}
        <tr><td>Firing sch</td><td>${bI("czx.firing", d.czx.firing, "110px")}</td><td>${bS("czx.firingS", d.czx.firingS, OB_VALCOL)}</td><td></td></tr>
        <tr><td>CALAMAR</td><td>${bI("czx.calamar", d.czx.calamar, "110px")}</td><td>${bS("czx.calamarS", d.czx.calamarS, OB_VALCOL)}</td><td></td></tr></tbody></table></div>${bB("add", "areas", "", "+ Area", "ra")}
      <p class="hint">FASF / RSAF "Auto" works the colour state out from the METAR (or your WX/VIS override) using the Excel's criteria. Aid status "auto" (CAT 1 line) follows CZX FASF. Weather, wind, temperature, QNH and sunrise/sunset come in automatically.</p></div>`;
  } else if (k === "aircraft") {
    body = `<div class="opsed">${(d.tails || []).map((t, i) => `<div class="obtail">
        <div class="obtailhead"><label>Tail${bI(`tails.${i}.tail`, t.tail, "90px", "e.g. 327#(W)")}</label><label>Status${bS(`tails.${i}.status`, t.status, [["S", "Serviceable"], ["US", "U/S"], ["MX", "Maintenance"]])}</label>
          <span class="obflags">${bC(`tails.${i}.npc`, t.npc, "NPC")}${bC(`tails.${i}.nts`, t.nts, "NTS")}${bC(`tails.${i}.ojt`, t.ojt, "OJT")}${bC(`tails.${i}.cfh2`, t.cfh2, "CFH 2 (@)")}${bC(`tails.${i}.cfh3`, t.cfh3, "CFH 3 (#)")}</span><span class="grow"></span>${bTools("tails", i)}</div>
        <div class="obfxbar"><span class="hint">Significant ADDL / NPC / AMC (one per line) · select words, then:</span>${[["r", "Red"], ["y", "Amber"], ["g", "Green"], ["b", "Bold"]].map(([c, l]) => `<button type="button" class="btn small fxbtn fx-${c}" data-fx="${c}" data-ta="tails.${i}.notes">${l}</button>`).join("")}<button type="button" class="btn small" data-fx="x" data-ta="tails.${i}.notes">Clear colour</button></div>
        <textarea class="obnotesin" data-bp="tails.${i}.notes" rows="6">${esc(t.notes ?? "")}</textarea>
        <div class="obprev obnotes" data-prev="tails.${i}.notes">${obPrev(t.notes)}</div></div>`).join("")}${bB("add", "tails", "", "+ Aircraft", "tail")}
      <h3 class="opssub">Callsigns</h3><div class="tablewrap"><table><thead><tr><th>Callsign</th><th>ETTS</th><th>Vehicle</th><th></th></tr></thead><tbody>${(d.callsigns || []).map((c, i) => `<tr>
        <td>${bI(`callsigns.${i}.callsign`, c.callsign, "120px")}</td><td>${bI(`callsigns.${i}.etts`, c.etts, "50px")}</td><td>${bI(`callsigns.${i}.vehicle`, c.vehicle, "100px")}</td><td>${bTools("callsigns", i)}</td></tr>`).join("")}</tbody></table></div>${bB("add", "callsigns", "", "+ Callsign", "cs")}
      <label style="max-width:300px;margin-top:8px">Vehicle cap${bI("vehicleCap", d.vehicleCap, "", "e.g. VAN - 8, ZOE - 4")}</label>
      <p class="hint">Lines starting with NTS, AMC, NPC, OJT, CFH, Max fly or Control hours are highlighted.</p></div>`;
  } else if (k === "gonogo") {
    body = `<div class="opsed"><label style="max-width:240px">MIAC 4 effective till<input type="date" data-bp="miac" value="${esc(d.miac || "")}"></label>
      <div class="tablewrap"><table><thead><tr><th>Code</th><th>Meaning</th><th></th></tr></thead><tbody>${(d.legend || []).map((l, i) => `<tr><td>${bI(`legend.${i}.code`, l.code, "80px")}</td><td>${bI(`legend.${i}.label`, l.label, "220px")}</td><td>${bTools("legend", i)}</td></tr>`).join("")}</tbody></table></div>${bB("add", "legend", "", "+ Code", "leg")}</div>`;
  }
  return `<div id="obEdit">${body}<div class="err" id="obErr"></div><div class="row" style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px"><button class="btn" data-ob="cancel">Cancel</button><button class="btn primary" data-ob="save">Save</button></div></div>`;
}
const obRerender = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
// Change one thing on the board and save straight away (retries once if someone else saved in between).
async function obQuick(mutate) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = OB.state.board, d = opsClone(obDoc("board"));
    mutate(d);
    const { data, error } = await S.sb.rpc("ops_state_save", { p_key: "board", p_data: d, p_version: r ? r.version : 0 });
    if (!error) { OB.state.board = { key: "board", data: d, version: data, updated_at: new Date().toISOString(), updated_by: S.me.id }; return obRerender(); }
    if (!/someone else/i.test(error.message) || attempt) { toast(errMsg(error)); return obRerender(); }
    const { data: fresh } = await S.sb.from("ops_state").select("*").eq("key", "board").maybeSingle();
    if (fresh) OB.state.board = fresh;
  }
}
const OB_CYCLE = { g: "a", a: "r", r: "g", "": "g" };
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-obarea]"); if (!el || OB.edit) return;
  if (el.dataset.obarea === "add") {
    const name = await ask("Add an area", "Name as it should show on the board, e.g. R31 (SFC – 3000 FT).", "Add", { placeholder: "Area name" });
    if (!name) return;
    obQuick(d => { d.areas = d.areas || []; d.areas.push({ item: name.toUpperCase().slice(0, 40), val: "", s: "" }); });
  } else {
    const j = +el.dataset.j, a = (obGet("board").areas || [])[j]; if (!a) return;
    if (!await ask("Remove area?", `Take ${a.item} off the board?`, "Remove")) return;
    obQuick(d => { if (d.areas[j] && d.areas[j].item === a.item) d.areas.splice(j, 1); });
  }
});
document.addEventListener("click", e => {
  const el = e.target.closest("button[data-obq]"); if (!el || OB.edit) return;
  const i = +el.dataset.af, j = +el.dataset.j, k = el.dataset.obq;
  el.disabled = true;
  if (k === "p") obQuick(d => d.airfields.forEach((a, n) => { if (a.grp === "main") a.p = n === i ? !a.p : false; }));
  else if (k === "aid") obQuick(d => { const a = d.airfields[i], x = a.aids[j], cur = obAidS(a, x);
    x.s = x.s === "auto" ? OB_CYCLE[cur] || "g" : (a.icao === "LFBC" && /CAT\s*1/i.test(x.name) && x.s === "r") ? "auto" : OB_CYCLE[x.s] || "g"; });
  else if (k === "eor") obQuick(d => { d.eor = el.dataset.v; });
  else if (k === "avalc") obQuick(d => { d.areas[j].s = OB_COLCYCLE[d.areas[j].s || ""]; });
  else if (k === "czxvc") obQuick(d => { const f = el.dataset.f + "S"; d.czx[f] = OB_COLCYCLE[d.czx[f] || ""]; });
  else if (k === "eqna") obQuick(d => { const f = el.dataset.f; d.equip[f] = d.equip[f] ? "" : "r"; });
  else if (k === "equip") obQuick(d => { d.equip[el.dataset.f] = OB_CYCLE[d.equip[el.dataset.f] || ""]; });
});
document.addEventListener("change", e => {
  const el = e.target; if (!/^(SELECT|INPUT)$/.test(el.tagName) || !el.dataset.obq || OB.edit) return;
  const i = +el.dataset.af, k = el.dataset.obq, v = el.value;
  el.disabled = true;
  if (k === "fasf" || k === "rsaf" || k === "rwy") obQuick(d => { d.airfields[i][k] = v; });
  else if (k === "czx" || k === "czxv") obQuick(d => { d.czx[el.dataset.f] = v.trim(); });
  else if (k === "czxu") obQuick(d => { d.czx[el.dataset.f] = v.trim().toUpperCase().replace(/\s*°C$/, ""); });
  else if (k === "eqv") obQuick(d => { d.equip[el.dataset.f] = v.trim().toUpperCase(); });
  else if (k === "r115wx") { const val = obRwxVal(el); obQuick(d => { d.r115 = { ...(d.r115 || {}), wx: val }; }); }
  else if (k === "r115") obQuick(d => { d.r115 = { ...(d.r115 || {}), [el.dataset.f]: v.trim().toUpperCase() }; });
  else if (k === "aval") obQuick(d => { d.areas[+el.dataset.j].val = v.trim(); });
  else if (k === "bingo") obQuick(d => { d.bingo = v; });
});
document.addEventListener("input", e => {
  const el = e.target;
  if (OB.edit && el.dataset && el.dataset.rwx && el.closest("#obEdit")) { // R115 WX pair in the full editor
    const val = obRwxVal(el), [c] = obRwxSplit(val), w = el.closest(".obrwx");
    opsSetPath(OB.edit.data, "r115.wx", val);
    w.querySelector('[data-p="c"]').className = "obcs " + obCsCls(val);
    w.querySelector('[data-p="n"]').hidden = !c || c === "B";
    return;
  }
  if (!OB.edit || !el.dataset || !el.dataset.bp || !el.closest("#obEdit")) return;
  opsSetPath(OB.edit.data, el.dataset.bp, el.type === "checkbox" ? el.checked : el.value);
  // CFH 2 and CFH 3 can't both be ticked.
  const m = /^(tails\.\d+)\.cfh([23])$/.exec(el.dataset.bp);
  if (m && el.checked) { const o = m[1] + ".cfh" + (m[2] === "2" ? "3" : "2"); opsSetPath(OB.edit.data, o, false); const ob = document.querySelector(`#obEdit [data-bp="${o}"]`); if (ob) ob.checked = false; }
});
document.addEventListener("change", async e => {
  const el = e.target;
  if (OB.edit && el.dataset && el.dataset.bp && el.closest("#obEdit")) {
    opsSetPath(OB.edit.data, el.dataset.bp, el.type === "checkbox" ? el.checked : el.value);
    if (el.tagName === "SELECT" || el.type === "checkbox") obRerender();
    return;
  }
  // Crew list edits save straight away.
  if (el.dataset && el.dataset.crew && el.dataset.f) {
    const c = OB.crew.find(x => x.id === el.dataset.crew); if (!c) return;
    const nc = { ...c, [el.dataset.f]: el.type === "checkbox" ? el.checked : el.value || null };
    const { error } = await S.sb.rpc("crew_save", { p_id: c.id, p_name: nc.name, p_grp: nc.grp, p_profile: nc.profile_id || null, p_active: nc.active, p_sort: nc.sort });
    if (error) { toast(errMsg(error)); return obRerender(); }
    Object.assign(c, nc, { name: String(nc.name).toUpperCase().trim(), grp: String(nc.grp || c.grp).toUpperCase().trim() }); toast("Saved.");
    if (el.dataset.f === "grp" || el.dataset.f === "active") obRerender(); // move the row to its new group / status
    return;
  }
  if (el.dataset && el.dataset.ob === "ack") {
    el.disabled = true;
    const { error } = await S.sb.rpc("rs_done", { p_item: el.dataset.item, p_crew: el.dataset.crew, p_done: el.checked });
    el.disabled = false;
    if (error) { el.checked = !el.checked; return toast(errMsg(error)); }
    const a = OB.acks.find(x => x.item_id === el.dataset.item && x.crew_id === el.dataset.crew); if (a) a.done_at = el.checked ? new Date().toISOString() : null;
    return obRerender();
  }
  if (el.dataset && el.dataset.ob === "showclosed") { OB.showClosed = el.checked; obRerender(); }
});
document.addEventListener("click", async e => {
  const op = e.target.closest("#obEdit [data-bop]");
  if (op && OB.edit) {
    const p = op.dataset.p, i = +op.dataset.i;
    let arr = opsPath(OB.edit.data, p); if (!arr) { opsSetPath(OB.edit.data, p, []); arr = opsPath(OB.edit.data, p); }
    if (op.dataset.bop === "add") arr.push(obTpl[op.dataset.tpl]());
    else if (op.dataset.bop === "del") arr.splice(i, 1);
    else if (op.dataset.bop === "up" && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    else if (op.dataset.bop === "down" && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    return obRerender();
  }
  const el = e.target.closest("[data-ob]"); if (!el || el.tagName === "INPUT") return;
  const a = el.dataset.ob;
  if (a === "edit") { const k = el.dataset.k; OB.edit = { key: k, data: opsClone(obDoc(k)), version: OB.state[k] ? OB.state[k].version : 0 }; render(); }
  else if (a === "cancel") { OB.edit = null; render(); }
  else if (a === "save") {
    const ed = OB.edit; el.disabled = true;
    const { data, error } = await S.sb.rpc("ops_state_save", { p_key: ed.key, p_data: ed.data, p_version: ed.version });
    el.disabled = false;
    if (error) {
      if (/someone else/i.test(error.message)) { await ask("Not saved", error.message, "OK"); OB.edit = null; return obLoad(); }
      const er = $("#obErr"); if (er) er.textContent = errMsg(error); toast(errMsg(error)); return;
    }
    OB.state[ed.key] = { key: ed.key, data: ed.data, version: data, updated_at: new Date().toISOString(), updated_by: S.me.id };
    OB.edit = null; toast("Saved."); render();
  }
  else if (a === "metar") {
    // Like the Excel refresh: take the latest METARs onto the board and put colour states, WX/VIS and bingo back to auto.
    el.disabled = true; el.textContent = "Refreshing…";
    const { error } = await S.sb.functions.invoke("metar", { body: {} });
    if (error) toast("Couldn't fetch new METARs (" + errMsg(error) + "), using the latest saved ones.");
    const { data: rows, error: e2 } = await S.sb.from("ops_wx").select("*");
    if (e2) { el.disabled = false; el.textContent = "Refresh METARs"; return toast(errMsg(e2)); }
    OB.wxLive = {}; for (const r of rows) OB.wxLive[r.station] = r;
    await obQuick(d => {
      d.wxSnap = OB.wxLive; d.bingo = "AUTO"; d.equip = { ...d.equip, canopy: "", apu1: "", apu2: "" }; d.czx = { ...(d.czx || {}), icing: "" };
      (d.airfields || []).forEach(x => { x.rsaf = "AUTO"; if (OB_FASF_AUTO.includes(x.icao)) x.fasf = "AUTO"; x.wx = ""; });
    });
    if (!error) toast("Board updated with the latest METARs.");
  }
  else if (a === "done") {
    el.disabled = true; // one tap signs it off, no confirm step (Gordon, 10 Oct)
    const { error } = await S.sb.rpc("rs_done", { p_item: el.dataset.item, p_crew: el.dataset.crew, p_done: true });
    if (error) { el.disabled = false; return toast(errMsg(error)); }
    toast("Signed off."); obLoad();
  }
  else if (a === "toggle") { OB.open[el.dataset.item] = !OB.open[el.dataset.item]; obRerender(); }
  else if (a === "close") {
    const { error } = await S.sb.rpc("rs_close", { p_item: el.dataset.item, p_closed: el.dataset.closed === "1" });
    if (error) return toast(errMsg(error)); obLoad();
  }
  else if (a === "chartclr") {
    const c = OB_CHARTS.find(x => x.key === el.dataset.k); if (!c) return;
    if (!await ask("Remove chart?", `Remove the current ${c.label} from the board? Upload a new one any time.`, "Remove")) return;
    obQuick(d => { d.chartsCleared = { ...(d.chartsCleared || {}), [c.key]: new Date().toISOString() }; });
  }
  else if (a === "newitem") obNewItem();
  else if (a === "assign") obAssign(el.dataset.item);
  else if (a === "addcrew") {
    const name = $("#obNewName").value.trim(); if (!name) return toast("Enter a name.");
    const { error } = await S.sb.rpc("crew_save", { p_id: null, p_name: name, p_grp: $("#obNewGrp").value, p_profile: $("#obNewLogin").value || null, p_active: true, p_sort: OB.crew.length });
    if (error) return toast(errMsg(error)); toast(`${name.toUpperCase()} added.`); obLoad();
  }
  else if (a === "addflyers") {
    let n = 0;
    for (const f of obFlyers()) {
      if (OB.crew.some(c => opsNorm(c.name) === opsNorm(f.name) || (f.profile && c.profile_id === f.profile))) continue;
      const { error } = await S.sb.rpc("crew_save", { p_id: null, p_name: f.name, p_grp: f.grp, p_profile: f.profile, p_active: true, p_sort: f.sort });
      if (error) return toast(errMsg(error)); n++;
    }
    toast(n ? `${n} added.` : "Everyone who flies is already on the list."); obLoad();
  }
  else if (a === "exittv") { obLeaveTv(); S.tab = "opsboard"; render(); }
  else if (a === "chart") obShowChart(el.dataset.k);
});

// Pick crew dialog: group buttons + one checkbox per person. onOk(ids, dialog) returns an error
// message to show (dialog stays open, nothing typed is lost) or "" to close.
function obPickCrew(title, intro, okLabel, extraHtml, preset, onOk) {
  let d = document.getElementById("dlgOb");
  if (!d) { d = document.createElement("dialog"); d.id = "dlgOb"; document.body.appendChild(d); }
  const crew = OB.crew.filter(c => c.active), groups = [...new Set(crew.map(c => c.grp))];
  d.innerHTML = `<div class="dlg"><h2 tabindex="-1" autofocus>${esc(title)}</h2>${intro ? `<p class="hint">${esc(intro)}</p>` : ""}${extraHtml || ""}
    <label style="margin-bottom:4px">Who needs to do it</label>
    <div class="tools" style="margin-bottom:6px"><button type="button" class="btn small" data-g="*">Everyone</button>${groups.map(g => `<button type="button" class="btn small" data-g="${esc(g)}">${esc(g)}</button>`).join("")}<button type="button" class="btn small" data-g="">Clear</button></div>
    <div class="pax" style="max-height:220px">${crew.map(c => `<label><input type="checkbox" value="${esc(c.id)}" data-grp="${esc(c.grp)}" ${preset && preset.has(c.id) ? "checked disabled" : ""}>${esc(c.name)}</label>`).join("") || `<span class="hint">Add people to the crew list first.</span>`}</div>
    <div class="err" id="obPickErr"></div><div class="row"><button class="btn" data-x="cancel">Cancel</button><button class="btn primary" data-x="ok">${esc(okLabel)}</button></div></div>`;
  d.onclick = async e => {
    const g = e.target.closest("[data-g]");
    if (g) {
      const k = g.dataset.g;
      d.querySelectorAll(".pax input:not(:disabled)").forEach(i => { if (k === "*") i.checked = true; else if (k === "") i.checked = false; else if (i.dataset.grp === k) i.checked = true; });
      return;
    }
    const x = e.target.closest("[data-x]"); if (!x) return;
    if (x.dataset.x === "cancel") return d.close();
    const ids = [...d.querySelectorAll(".pax input:checked:not(:disabled)")].map(i => i.value);
    x.disabled = true;
    const err = await onOk(ids, d);
    x.disabled = false;
    if (err) d.querySelector("#obPickErr").textContent = err; else d.close();
  };
  d.oncancel = e => { e.preventDefault(); d.close(); };
  d.showModal();
}
function obNewItem() {
  const legend = obGet("gonogo").legend || [];
  obPickCrew("New read & sign item", "", "Send", `<div class="grid2"><label>Code<input id="obiCode" list="obCodes" value="RS" maxlength="10"></label><label>Title<input id="obiTitle" maxlength="200" placeholder="e.g. SAM 12: bird strike advisory"></label></div>
      <datalist id="obCodes">${legend.map(l => `<option value="${esc(l.code)}">${esc(l.label)}</option>`).join("")}</datalist>
      <label>What to read (optional)<textarea id="obiBody" rows="4" placeholder="Paste the notice or key points"></textarea></label>
      <label>Link to document (optional)<input id="obiLink" type="url" placeholder="https://…"></label>`, null, async (ids, d) => {
    const title = d.querySelector("#obiTitle").value.trim();
    if (!title) return "Enter a title.";
    if (!ids.length) return "Pick who needs to do it.";
    const { error } = await S.sb.rpc("rs_create", { p_code: d.querySelector("#obiCode").value, p_title: title, p_body: d.querySelector("#obiBody").value, p_link: d.querySelector("#obiLink").value.trim(), p_crew: ids });
    if (error) return errMsg(error);
    toast(`Sent to ${ids.length} ${ids.length === 1 ? "person" : "people"}.`); obLoad(); return "";
  });
}
function obAssign(itemId) {
  const have = new Set(OB.acks.filter(a => a.item_id === itemId).map(a => a.crew_id));
  obPickCrew("Add people", "People already on this item are ticked and greyed out.", "Add", "", have, async ids => {
    if (!ids.length) return "";
    const { error } = await S.sb.rpc("rs_assign", { p_item: itemId, p_crew: ids });
    if (error) return errMsg(error);
    toast("Added."); obLoad(); return "";
  });
}

/* ---------- styles ---------- */
(() => {
  const s = document.createElement("style");
  s.textContent = `
.obhead{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;margin-bottom:8px;font-size:.9rem}
.obhead b{font:700 1.2rem var(--cond);text-transform:uppercase}
.obbanner{background:var(--out);color:#1a1200;text-align:center;font:700 .95rem var(--cond);border-radius:4px;padding:3px 8px;margin-bottom:10px;letter-spacing:.03em}
.obgrid{display:grid;grid-template-columns:minmax(0,1fr);gap:0 14px}.obgrid>*{min-width:0}
@media (min-width:900px){.obgrid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.obgrid .obwide{grid-column:1/-1}}
.obpill{display:inline-block;padding:1px 7px;border-radius:3px;font:600 .8rem var(--body);white-space:nowrap;background:color-mix(in srgb,var(--muted) 18%,transparent);color:var(--ink)}
.obst{display:inline-block;padding:1px 7px;border-radius:3px;font-size:.8rem;font-weight:600;background:color-mix(in srgb,var(--muted) 18%,transparent)}
.obst-g{background:#1f9d55;color:#fff}.obst-a{background:#e0a800;color:#1a1200}.obst-r{background:#d63c3c;color:#fff}.obst-b{background:#2563eb;color:#fff}.obst-y{background:#facc15;color:#000}.obst-n{opacity:.7}
.obaids{display:flex;flex-wrap:wrap;gap:3px}
.obtap{border:0;cursor:pointer;font:600 .8rem var(--body)}
.obcs{display:inline-block;min-width:44px;text-align:center;padding:2px 6px;border-radius:3px;font:700 .82rem var(--body);border:1px solid transparent}
select.obcs{width:auto;padding:3px 4px;margin:0;cursor:pointer}
select.obsel{width:auto;padding:3px 6px;margin:0;font-size:.85rem}
.cs-b{background:#2563eb;color:#fff}.cs-w{background:#fff;color:#000;border-color:#999}.cs-gv{background:#22c55e;color:#000}.cs-gi{background:#15803d;color:#fff}
.cs-y{background:#facc15;color:#000}.cs-y1{background:#fde047;color:#000}.cs-y2{background:#eab308;color:#000}.cs-a{background:#f59e0b;color:#000}.cs-a1{background:#f59e0b;color:#000}.cs-a2{background:#c2410c;color:#fff}
.cs-r{background:#dc2626;color:#fff}.cs-k{background:#000;color:#fff;border-color:#666}.cs-c{background:#6b7280;color:#fff}.cs-n{background:color-mix(in srgb,var(--muted) 18%,transparent);color:var(--ink)}
select.obcs option{background:var(--paper);color:var(--ink)}
.obpbtn{width:28px;height:24px;border:1px dashed var(--line);border-radius:3px;background:none;cursor:pointer;font:700 .85rem var(--body);color:var(--muted)}
.obpbtn.on{background:#1f9d55;border:0;color:#fff}
.obeor{display:inline-flex;gap:4px;align-items:center}
.obcharts{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}
.obchart{display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1px solid var(--line);border-radius:6px;padding:8px;background:var(--field)}
.obchart>.btn:first-child{flex:1 1 100%;text-align:left}.obchart .btn.small{flex:0 0 auto;width:auto}
.obup{cursor:pointer;margin-left:auto}
#dlgChart{width:min(1100px,calc(100vw - 16px))}
/* TV: the chart window hugs the chart (Gordon, 10 Oct), on a dimmed TV */
body.tvmode #dlgChart{width:fit-content;max-width:calc(100vw - 40px);height:auto;max-height:calc(100vh - 24px);padding:0;overflow:hidden}
body.tvmode #dlgChart::backdrop{background:rgba(0,0,0,.72)}
body.tvmode #dlgChart .dlg{padding:10px 12px 12px}
body.tvmode #dlgChart .opshead{margin:0 0 6px;gap:12px}
body.tvmode #dlgChart .opshead h2{margin:0;font-size:1.1rem}
body.tvmode #dlgChart .dlg>p.hint{margin:0 0 6px!important;font-size:.8rem}
body.tvmode #dlgChart .obchartview{text-align:center;line-height:0}
body.tvmode #dlgChart .obchartview iframe{width:min(1400px,calc(100vw - 70px));height:calc(100vh - 110px)}
body.tvmode #dlgChart .obchartimg{display:inline-block;max-width:100%}
body.tvmode #dlgChart .obchartimg img{height:calc(100vh - 140px);width:auto;max-width:calc(100vw - 70px);object-fit:contain;border-radius:6px}
.tvcharts{display:inline-flex;gap:6px;align-items:center;font-size:.85rem;color:var(--muted)}
.tvcharts .btn.stale{opacity:.55}
.obchartview iframe{width:100%;height:75vh;border:0;background:#fff}
.obchartimg{position:relative;line-height:0}
.obchartimg img{width:100%;height:auto;display:block;border-radius:4px}
.obchartimg svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.obhelp{border-bottom:1px dotted currentColor;cursor:help}
.obhelpop{position:fixed;z-index:1000;max-width:340px;padding:10px 12px;border-radius:8px;background:var(--paper);color:var(--ink);border:1px solid var(--line);box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:13px;line-height:1.45;font-weight:400;text-transform:none;letter-spacing:0}
.obrwx{display:inline-flex;gap:4px;align-items:center}.obrwxn{width:auto;min-width:48px}
.obhot{fill:rgba(255,40,40,.32);stroke:#ff2d2d;stroke-width:2;animation:obpulse 1.6s ease-in-out infinite}
.obhot.radar{fill:rgba(255,255,255,.25);stroke:#fff}
@keyframes obpulse{50%{fill-opacity:.12}}
@media (prefers-reduced-motion:reduce){.obhot{animation:none}}
table.obt{min-width:0}
.obnote{margin:8px 0 0;font-weight:600}
.obraw{font:500 .78rem ui-monospace,Menlo,Consolas,monospace;color:var(--muted);margin:8px 0 0;word-break:break-word}
.obwind{display:flex;gap:14px;align-items:center}
/* TV: wind sits at the top of the Cazaux weather card instead of its own big card (Gordon, 10 Oct) */
.obtvwx .obwind{margin:0 0 8px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.obtvwx .obrose{width:96px;height:96px}
.obrose{width:110px;height:110px;flex:none}
.obbig{font:700 1.6rem var(--cond)}
.obareas{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:6px 14px;margin-top:10px}
.obarea{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:.88rem;border-bottom:1px solid var(--line);padding:3px 0}
.obarea>span:first-child{font-weight:600}
.obvc{display:inline-flex;gap:4px;align-items:center}
.obval{font:600 .85rem var(--body);padding:3px 6px;border-radius:3px;border:1px solid var(--line);width:120px;margin:0}
.obval.obst-n,.obval:not([class*=obst-]){background:var(--field);color:var(--ink);opacity:1}
.obpulse{background:var(--out)!important;color:#1a1200!important;font-weight:700;animation:obpulse 1.6s ease-in-out infinite}
@keyframes obpulse{0%,100%{box-shadow:0 0 0 0 rgba(240,180,41,.75)}50%{box-shadow:0 0 0 9px rgba(240,180,41,0)}}
@media (prefers-reduced-motion:reduce){.obpulse{animation:none}}
.obcol{min-width:26px;padding:3px 0;border-radius:3px;border:1px solid var(--line);font:700 .75rem var(--body);cursor:pointer}
.obcol.obst-n{background:var(--field);color:var(--muted);opacity:1}
.obeq{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;font-size:.9rem}
.obgo{display:flex;flex-wrap:wrap;gap:10px 28px;align-items:flex-start}
.obgg{flex:0 1 auto;min-width:200px}
.obgg h3{margin:0 0 4px;display:flex;gap:8px;align-items:baseline}
@media (min-width:700px){.obgl{display:grid;grid-auto-flow:column;grid-template-rows:repeat(var(--r),auto);grid-auto-columns:210px;column-gap:22px}}
.obgp{display:flex;align-items:center;gap:8px;break-inside:avoid;padding:3px 2px;border-bottom:1px solid var(--line);font-size:.92rem}
.obgp .n{flex:1;font-weight:600;white-space:nowrap}.obgp.ng .n{color:var(--late)}
.obgng .opschk{display:inline-flex;align-items:center;gap:6px;margin:0;color:var(--ink);white-space:nowrap;font-size:.9rem}
.obgng .opschk input{width:auto;margin:0}
.obbar{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin-top:10px}
.obcrew{display:flex;flex-wrap:wrap;gap:6px 24px;align-items:flex-start}
.obcrew h3{margin:6px 0 2px}
.obgng .obcn{width:120px}.obgng .obcg{width:116px}.obgng .obcl{width:170px}
.obgng .obct{max-width:100%;overflow-x:auto}
.obgng table.obed input:not([type=checkbox]),.obgng table.obed select{height:30px;padding:2px 6px}
@media (max-width:600px){.obgng .obcn{width:96px}.obgng .obcg{width:84px}.obgng .obcl{width:120px}}
.obgng table.obed td.fix{padding:5px 10px 5px 4px;white-space:nowrap;border-bottom:1px solid var(--line)}
.obgng table.obed td.fix:first-child{font-weight:600;min-width:90px}
.obgng table.obed th{font-size:.75rem;color:var(--muted);font-weight:600;text-align:left}
.obgng table.obed .c{text-align:center}.obgng table.obed td.c input{width:auto;margin:0}
.obgng table.obed tr.off input:not([type=checkbox]),.obgng table.obed tr.off select{opacity:.5}
.obadd{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid var(--line)}
.obadd b{font-size:.85rem;margin-right:4px}
.obadd input,.obadd select{padding:4px 6px;font-size:.85rem;margin:0}
.obitem{border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin-bottom:8px;background:var(--field)}
.obitem.closed{opacity:.6}
.obitemhead{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.obbody{margin:6px 0;font-size:.9rem}
.obacks{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:2px 10px;margin-top:6px}
.obleg{columns:260px 4;column-gap:24px;font-size:.88rem}
.obleg>div{display:flex;gap:10px;break-inside:avoid;padding:2px 0}.obleg b{min-width:48px}
.obamb{color:var(--out);font-weight:600}
.obnotes{font-size:.82rem}
.fx-r{color:var(--late);font-weight:700}.fx-y{color:var(--out);font-weight:700}.fx-g{color:var(--ok,#1F8A4C);font-weight:700}.fx-b{font-weight:700}
.obtail{border:1px solid var(--line);border-radius:6px;padding:10px;margin-bottom:10px;background:var(--field)}
.obtailhead{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-end}
.obtailhead>label{display:flex;flex-direction:column;font-size:.8rem;color:var(--muted)}
.obflags{display:flex;flex-wrap:wrap;gap:6px 10px}
.obfxbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:10px 0 6px}
.obfxbar .hint{flex:1 1 100%;font-size:.8rem}
.fxbtn{min-width:56px}
.opsed textarea.obnotesin{width:100%;min-height:130px;font-size:.92rem;line-height:1.45;padding:8px 10px}
.obprev{margin-top:6px;padding:6px 8px;border:1px dashed var(--line);border-radius:4px;background:var(--paper)}
table.obed input,table.obed select{padding:4px 6px;font-size:.85rem;margin:0}
table.obed{min-width:0} table.obed td,table.obed th{border:0;padding:2px 4px;background:none}
.obtvgo{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.obtvhd{flex:1 1 100%;font:700 .8rem var(--body);letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-top:4px}
.obtvhd.soon{color:var(--late)}
.obtvsoon .obpill{font-size:1.05em;animation:obsoonp 1.6s ease-in-out infinite}
.obtvsoon b{color:var(--late)}
.obtvlater{opacity:.55}.obtvlater .obpill{background:transparent;border:1px solid var(--late);color:var(--late)}
@keyframes obsoonp{0%,100%{box-shadow:0 0 0 0 rgba(220,60,60,.7)}50%{box-shadow:0 0 0 6px rgba(220,60,60,0)}}
@media (prefers-reduced-motion:reduce){.obtvsoon .obpill{animation:none}}
.obsoon{font:700 .78rem var(--body);color:#fff;background:var(--late);border-radius:3px;padding:1px 5px;white-space:nowrap}
.obgp.soon{background:rgba(220,60,60,.12)}
.obsoonhd{color:var(--late)}
body.tvmode .topbar,body.tvmode #subtabs,body.tvmode #tally{display:none!important}
body.tvmode .wrap{max-width:none;padding:10px 16px}
body.tvmode{font-size:17px}
.tvbar{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;margin-bottom:10px}
.tvbar b{font:700 1.5rem var(--cond)} .tvclock{font:700 1.5rem var(--cond);font-variant-numeric:tabular-nums;min-width:12ch} .tvbar .grow{flex:1}
/* Ops board page on wide screens (obPageColumns) */
@media (min-width:1200px){#ob-charts .obcharts{grid-template-columns:repeat(4,minmax(0,1fr))}}
.obwxin{display:grid;grid-template-columns:minmax(0,1fr);gap:8px 24px}
@media (min-width:700px){.obwxin{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:start}.obwxwind{border-left:1px solid var(--line);padding-left:20px}}
@media (min-width:1200px){.obwx .obrose{width:150px;height:150px}.obwx .obbig{font-size:2rem}
  .obwx.three .obwxin{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr) minmax(0,1fr)}.obwxeq{border-left:1px solid var(--line);padding-left:20px}
  /* equipment listed straight down like the weather list (Gordon, 10 Oct) */
  .obwxeq .obeq{grid-template-columns:minmax(0,1fr);gap:6px;font-size:.9rem}
  .obwxeq .obeq>div{display:grid;grid-template-columns:minmax(120px,max-content) auto;gap:12px;align-items:center;justify-items:start;color:var(--muted)}
  .obwxeq .obeq>div>*{color:var(--ink)}
  .obpair{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:0 14px;align-items:stretch}.obpair>.card{margin-bottom:14px}}
@media (min-width:1200px){.obgrid:not(.tv){grid-template-columns:minmax(0,1fr)}.obgrid:not(.tv) .obwide{grid-column:1/-1}}
@media (min-width:1500px){.obgrid:not(.tv) .obafcard{display:grid;grid-template-columns:3fr 2fr;gap:0 12px;align-items:start}.obgrid:not(.tv) .obafcard>.tablewrap{margin-top:0!important}.obgrid:not(.tv) .obafcard>.obnote{grid-column:1/-1}}
/* TV: everything on one screen. Airfields across the top (main and other side by side), the rest flows in columns; obTvFit zooms to fit. */
body.tvmode{overflow:hidden}
body.tvmode .wrap{padding:6px 12px}
.tvstage{width:100%}
body.tvmode .obgrid.tv{display:block}
.tvcols{display:grid;gap:12px;align-items:stretch}
.tvcol{display:flex;flex-direction:column;gap:12px;min-width:0}
/* cards fill their column; their content spreads out evenly instead of leaving a gap at the bottom */
.tvcol>.card{display:flex;flex-direction:column;flex:1 1 auto}
.tvcols.measuring{align-items:start}.tvcols.measuring .card{flex:none}
.tvcol>.card>.opsdl,.tvcol>.card>.obareas,.tvcol>.card>.obeq,.tvcol>.card>.obwind,.tvcol>.card>.obtvgo{flex:1 1 auto;align-content:space-evenly}
body.tvmode .tvcol .opst{width:100%}
body.tvmode .tvcol .opst td,body.tvmode .tvcol .opst th{white-space:normal}
.obr115{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;padding:6px 8px;border:1px solid var(--line);border-radius:4px}
.obr115>b{flex:1 1 100%}
.obr115 span{color:var(--muted)}.obr115 span b{color:var(--ink)}
.obr115.ed>b{flex:0 0 auto}
.obr115.ed label{display:inline-flex;align-items:center;gap:6px;margin:0;color:var(--muted);font-size:.85rem}
.obr115.ed label b{color:var(--ink)}
.obr115.ed label input,.obr115.ed label select{margin:0}
/* page: restricted areas as three straight-down lists with dividers */
.obra3{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
@media (min-width:900px){.obra3{grid-template-columns:repeat(3,minmax(0,1fr));gap:0}.obra3>.obracol+.obracol{border-left:1px solid var(--line);padding-left:20px}.obra3>.obracol{padding-right:20px}}
.obracol{display:grid;grid-template-columns:max-content auto;gap:6px 14px;align-content:start;align-items:center;justify-items:start}
.obracol h3{grid-column:1/-1;margin:0;display:flex;align-items:center;gap:8px}
.obracol .obarea{display:contents}
.obvc2{display:inline-flex;align-items:center;gap:6px}
.obrm{background:none;border:0;color:var(--muted);cursor:pointer;font-size:.85rem;padding:2px 4px;opacity:.6}.obrm:hover{opacity:1;color:var(--late)}
.obaddarea{grid-column:1/-1;margin-top:4px}
.obracol .obarea>span:first-child{color:var(--muted);font-weight:500}
.tvcol>.card .obwind{align-items:center}
body.tvmode .obareas{grid-template-columns:1fr 1fr;gap:4px 14px}
body.tvmode .obarea{flex-wrap:wrap}
body.tvmode .obgrid.tv .card{margin:0;padding:10px 12px}
body.tvmode .obgrid.tv>.obafcard{display:grid;grid-template-columns:3fr 2fr;gap:0 12px;align-items:start;margin-bottom:12px}
body.tvmode .obafcard>.tablewrap{margin-top:0!important}
body.tvmode .obafcard>.obnote{grid-column:1/-1}
body.tvmode .opscard p.hint{display:none}
body.tvmode .opscard h2{font-size:1.15rem;margin:0 0 6px}
body.tvmode .obhead{margin-bottom:6px}
body.tvmode .tablewrap{overflow:visible}
body.tvmode .opst th,body.tvmode .opst td{padding:3px 6px}
@media (max-aspect-ratio:1/1){body.tvmode .obgrid.tv>.obafcard{grid-template-columns:1fr}}`;
  document.head.appendChild(s);
})();
