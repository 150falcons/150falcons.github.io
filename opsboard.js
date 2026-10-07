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
const OB_GROUPS = ["QFI", "PGF", "TRAINEES", "ATCO", "STEDAS", "OTH"];
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
// Restricted-area list (Excel AD19:AV22). A filled value shows red unless ops picks another colour.
const OB_AREAS = ["R46 A/B", "R166", "R259 (4200FT)", "ZRT 598 (500AGL)", "R148 (SFC – 1650 FT)", "R61 MEDOC", "CEL"];
const obAf = (icao, grp, p, rwy, aids) => ({ icao, grp, p, rwy, fasf: OB_FASF_AUTO.includes(icao) ? "AUTO" : "B", rsaf: "AUTO", wx: "", restr: "", aids });
const obBlank = {
  board: () => ({
    eor: "NORMAL", banner: "", zrt: "", cs2: true, ra2: true, bingo: "AUTO", bingoAuto: "", chartsCleared: {},
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
const obCanEditAc = () => opsCanEdit() || !!(S.me && S.me.eng_editor);
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
  if (["opsboard", "gonogo", "aircraft", "tv", "home", "ops"].includes(S.tab) && !OB.edit && !obTyping()) render();
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
  return { dir, spd, gst, gov: Math.max(spd, gst ?? 0), vrb: m.wdir === "VRB" };
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
  const v = vc.vis >= 10 ? 1 : vc.vis >= 8 ? 2 : vc.vis >= 6 ? 3 : vc.vis >= 3 ? 4 : vc.vis >= 1 ? 5 : 6;
  const c = vc.ceil >= 2500 ? 1 : vc.ceil >= 1500 ? 2 : vc.ceil >= 1000 ? 3 : vc.ceil >= 500 ? 4 : vc.ceil >= 300 ? 5 : 6;
  return ["B", "Y1", "Y2", "A1", "A2", "R"][Math.max(v, c) - 1];
}
function obFasfAuto(vc) {
  if (!vc) return "";
  const v = vc.vis >= 8 ? 1 : vc.vis >= 5 ? 2 : vc.vis >= 3 ? 4 : vc.vis >= 1.6 ? 5 : vc.vis >= 0.8 ? 6 : 7;
  const c = vc.ceil >= 2500 ? 1 : vc.ceil >= 1500 ? 2 : vc.ceil >= 1000 ? 3 : vc.ceil >= 700 ? 4 : vc.ceil >= 300 ? 5 : vc.ceil >= 200 ? 6 : 7;
  return ["B", "W", "G VFR", "G IFR", "Y", "A", "R"][Math.max(v, c) - 1];
}
// The colour state shown for an airfield: the chosen one, or the worked-out one when set to AUTO.
function obState(a, kind) {
  const set = a[kind] || "";
  if (set !== "AUTO") return { v: set, auto: false };
  return { v: (kind === "rsaf" ? obRsafAuto : obFasfAuto)(obVisCeil(a)), auto: true };
}
// Colour of a colour-state value.
const obCsCls = v => ({ B: "cs-b", W: "cs-w", "G VFR": "cs-gv", "G IFR": "cs-gi", Y: "cs-y", Y1: "cs-y1", Y2: "cs-y2", A: "cs-a", A1: "cs-a1", A2: "cs-a2", R: "cs-r", BLACK: "cs-k", CLSD: "cs-c" }[v] || "cs-n");
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
// Everything the Excel worked out for Cazaux.
function obCzx() {
  const b = obGet("board"), m = obWxAll().LFBC && obWxAll().LFBC.data, w = obWind(m);
  const lfbc = (b.airfields || []).find(a => a.icao === "LFBC") || {};
  const rwy = obRwyHdg(lfbc.rwy), c = obComp(w, rwy);
  const t = m ? obN(m.temp) : null, rh = m ? obRH(obN(m.temp), obN(m.dewp)) : null;
  const sea = obN(b.czx && b.czx.seaTemp);
  const auto = st => st === "" || st == null;
  const apu = h => { const k = obComp(w, h); return t == null && !k ? "" : (t != null && t < 1) || (k && k.cross > 14.9) ? "r" : "g"; };
  const canopy = !w ? "" : (w.gov < 50 && (!c || (Math.abs(c.head) < 35 && c.cross < 35))) ? "g" : "r";
  return {
    m, w, rwy, c, t, rh, qnh: m ? obN(m.altim) : null, sun: obSun(todayStr()),
    icing: t == null || rh == null ? "" : t < 6 && rh > 50 ? "YES" : "NO",
    immersion: sea == null ? "" : sea >= 16 ? "NO" : (sea < 15.5 && t != null && t < 22) ? "YES" : "NO",
    canopy: auto(b.equip.canopy) ? canopy : b.equip.canopy,
    apu1: auto(b.equip.apu1) ? apu(280) : b.equip.apu1,
    apu2: auto(b.equip.apu2) ? apu(315) : b.equip.apu2,
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
function obCard(id, title, meta, body, tools) {
  return `<section class="card opscard" id="${id}"><div class="opshead"><h2>${title}</h2><span class="opsmeta">${meta || ""}${tools || ""}</span></div>${body}</section>`;
}
const obNotLoaded = v => { v.innerHTML = `<div class="empty">Loading…</div>`; if (!OB.loading) obLoad(); };

/* ---------- Ops board page ---------- */
function renderOpsBoard(v) {
  if (!OB.loaded) return obNotLoaded(v);
  const editing = OB.edit && OB.edit.key === "board", can = opsCanEdit();
  const nm = obNewMetar();
  const top = `<div class="opsbar"><span class="grow"></span>${can ? `<button class="btn small ${nm ? "obpulse" : ""}" data-ob="metar">${nm ? "New METAR · Refresh" : "Refresh METARs"}</button>` : ""}<button class="btn small primary" data-tab="tv">TV mode</button></div>`;
  v.innerHTML = top + (editing ? obCard("ob-board", "Ops board", "", obEditor("board")) : obBoardView(false) + obChartsCard() + `<p class="opsmeta" style="justify-content:flex-end">${obMeta("board")} ${obEditBtn("board", can, "Edit ops board")}</p>`);
}
// Colours used by the Excel's conditional formats.
const obValS = (val, s, booked) => s || (!String(val || "").trim() ? "" : booked && /BOOKED/i.test(val) ? "y" : "r");
const obHazS = v => ({ A: "y", B: "a", C: "r", D: "r" }[String(v || "").trim().toUpperCase()] || "");
const obSamarS = v => ({ R: "r", Y: "a", G: "g" }[String(v || "").trim().charAt(0).toUpperCase()] || "");
const obParaS = v => String(v ?? "").trim() === "" ? "" : +v > 0 ? "r" : "g";
const obSeaS = v => obN(v) == null ? "" : obN(v) <= 15.5 ? "y" : "g";
// Bingo: worked out from CZX RSAF (Y2 → UPG, A1 → IFR) unless ops picked one; their pick lasts until the CZX RSAF changes.
function obBingo(b, czxR) {
  const auto = czxR === "Y2" ? "UPG BINGO" : czxR === "A1" ? "IFR BINGO" : "";
  return { auto, v: !b.bingo || b.bingo === "AUTO" || (b.bingoAuto || "") !== auto ? auto : b.bingo === "NONE" ? "" : b.bingo };
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
function obBoardView(tv) {
  const b = obGet("board"), z = obCzx();
  const wxAge = obWxAll().LFBC ? obObsZ(obWxAll().LFBC.data) : "";
  const q = !tv && opsCanEdit(); // ops editors change these straight on the board
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
  const bsel = !b.bingo || b.bingo === "AUTO" || (b.bingoAuto || "") !== bg.auto ? "AUTO" : b.bingo;
  const w = z.w, comp = z.c;
  const windTxt = !w ? "-" : w.vrb ? `VRB / ${w.spd} KT` : `${String(w.dir).padStart(3, "0")}° / ${w.spd}${w.gst ? "G" + w.gst : ""} KT`;
  const yn = (v2, bad) => v2 ? obPill(v2 === bad ? "r" : "g", v2) : "-";
  const czx = b.czx || {};
  return `
    <div class="obhead"><span class="obeor">EOR: ${["NORMAL", "IN HSE"].map(e => q ? `<button class="obpill ${b.eor === e ? (e === "NORMAL" ? "obst-g" : "obst-a") : ""} obtap" data-obq="eor" data-v="${e}">${e}</button>` : b.eor === e ? obPill(e === "NORMAL" ? "g" : "a", e) : "").join(" ")}</span>
      ${q ? `<select class="obsel ${bingo ? "obst-y" : ""}" data-obq="bingo" aria-label="Bingo"><option value="AUTO" ${bsel === "AUTO" ? "selected" : ""}>${esc(bg.auto || "—")} (auto)</option>${[["NONE", "— (blank)"], ["BINGO", "BINGO"], ["UPG BINGO", "UPG BINGO"], ["IFR BINGO", "IFR BINGO"]].map(([k2, l]) => `<option value="${k2}" ${bsel === k2 ? "selected" : ""}>${l}</option>`).join("")}</select>` : bingo ? obPill("y", bingo) : ""}
      ${obNewMetar() ? `<span class="obpill obst-a obpulse">New METAR waiting${q ? "" : " for ops"}</span>` : ""}<b>Airfield status${asOf ? " as of " + esc(asOf) : ""}</b>${wxAge ? ` <span class="hint">METAR ${esc(wxAge)}</span>` : ""}</div>
    ${b.banner ? `<div class="obbanner">${esc(b.banner)}</div>` : ""}
    <div class="obgrid ${tv ? "tv" : ""}">
      <section class="card opscard obwide"><div class="tablewrap"><table class="opst obt"><thead><tr><th>Airfield</th><th>P</th><th>RWY</th><th>FASF</th><th>RSAF</th><th>WX / VIS</th><th>Restrictions</th><th>Aids</th></tr></thead><tbody>${main.map(([a, i]) => afRow(a, i)).join("")}</tbody></table></div>
        ${alt.length ? `<div class="tablewrap" style="margin-top:8px"><table class="opst obt"><thead><tr><th>Airfield</th><th>RWY</th><th>FASF</th><th>RSAF</th><th>WX / VIS</th><th>Restrictions</th></tr></thead><tbody>${alt.map(([a, i]) => afRow(a, i)).join("")}</tbody></table></div>` : ""}
        ${b.zrt ? `<p class="obnote">${esc(b.zrt)}</p>` : ""}</section>
      <section class="card opscard"><h2>Cazaux weather</h2><dl class="opsdl">
        <dt>Sunrise / sunset</dt><dd>${czx.sun ? esc(czx.sun) : `${esc(z.sun.rise)} / ${esc(z.sun.set)}`}</dd>
        <dt>Icing band</dt><dd>${esc(czx.icingBand || "-")}</dd>
        <dt>Temperature</dt><dd>${z.t ?? "-"}°C</dd><dt>Humidity</dt><dd>${z.rh ?? "-"}%</dd><dt>QNH</dt><dd>${z.qnh ?? "-"}</dd>
        <dt>Runway surface</dt><dd>${q ? obQSel("rwySurface", czx.rwySurface, ["DRY", "DAMP", "WET", "FLOODED"]) : obPill(/FLOOD/i.test(czx.rwySurface) ? "r" : /WET|DAMP/i.test(czx.rwySurface) ? "a" : czx.rwySurface ? "g" : "", czx.rwySurface || "-")}</dd><dt>Sea surface</dt><dd>${czx.seaTemp ? obPill(obSeaS(czx.seaTemp), czx.seaTemp + "°C") : "-"}</dd>
        <dt>Sea swell</dt><dd>${esc(czx.swell || "-")}</dd><dt>Bird hazard</dt><dd>${q ? obQSel("bird", czx.bird, ["LOW (1)", "LOW (2)", "MED (2)", "HIGH (3)"]) : obPill(/HIGH/i.test(czx.bird) ? "r" : /MED/i.test(czx.bird) ? "a" : czx.bird ? "g" : "", czx.bird || "-")}</dd>
        <dt>Icing conditions</dt><dd>${yn(z.icing, "YES")}</dd></dl>
        ${z.m ? `<p class="obraw">${esc(z.m.rawOb)}</p>` : `<p class="hint">No METAR yet.</p>`}</section>
      <section class="card opscard"><h2>Wind (CZX)</h2><div class="obwind">${obRose(w, z.rwy)}<div><div class="obbig">${esc(windTxt)}</div>
        ${comp ? `<div>${comp.head < 0 ? "Tailwind" : "Headwind"} <b>${Math.abs(comp.head).toFixed(1)}</b> KT</div><div>Crosswind <b>${comp.cross.toFixed(1)}</b> KT</div><div class="hint">RWY ${esc(String(z.rwy / 10).padStart(2, "0"))} · governing wind ${w.gov} KT</div>` : ""}
        <div>Wind hazard ${q ? `<select class="obsel ${obHazS(czx.windHazard) ? "obst-" + obHazS(czx.windHazard) : ""}" data-obq="czx" data-f="windHazard" aria-label="Wind hazard">${["", "A", "B", "C", "D"].map(o => `<option value="${o}" ${o === (czx.windHazard || "") ? "selected" : ""}>${o || "-"}</option>`).join("")}</select>` : czx.windHazard ? obPill(obHazS(czx.windHazard), czx.windHazard) : "-"}</div></div></div></section>
      <section class="card opscard"><h2>Canopy / equipment</h2><div class="obeq">
        <div>Canopy ${obDot(z.canopy)}</div><div>APU (A11–15) ${obDot(z.apu1)}</div><div>APU (A16–23) ${obDot(z.apu2)}</div>
        <div>Parachute ${q ? `<select class="obsel obst-${obParaS(b.equip.parachute) || "n"}" data-obq="eqv" data-f="parachute" aria-label="Parachute">${[...new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", String(b.equip.parachute ?? "")])].filter(x => x !== "").map(o => `<option ${o === String(b.equip.parachute) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>` : obPill(obParaS(b.equip.parachute), b.equip.parachute ?? "-")}</div>
        <div>SAMAR ${q ? `<input class="obval obst-${obSamarS(b.equip.samar) || "n"}" style="width:64px" data-obq="eqv" data-f="samar" value="${esc(b.equip.samar || "")}" aria-label="SAMAR">` : obPill(obSamarS(b.equip.samar), b.equip.samar || "-")}</div></div>
        <p class="hint" style="margin:6px 0 0">Canopy and APU are worked out from the Cazaux wind and temperature unless ops sets them.${q ? " Tap coloured items to change them." : ""}</p></section>
      <section class="card opscard obwide"><h2>Restricted areas</h2>${obAreasView(b, q, z)}</section>
      ${tv ? "" : obCallsignsCard()}
    </div>`;
}
function obAreasView(b, q, z) {
  const r = b.r115 || {}, czx = b.czx || {};
  const f = (k, w) => q ? `<input class="obval" style="width:${w}" data-obq="r115" data-f="${k}" value="${esc(r[k] || "")}" aria-label="R115 ${k}">` : esc(r[k] || "-");
  const wx = q ? `<select class="obcs ${obCsCls(r.wx)}" data-obq="r115" data-f="wx" aria-label="R115 WX colour state">${["", ...OB_FASF].map(v => `<option value="${v}" ${v === (r.wx || "") ? "selected" : ""}>${v || "-"}</option>`).join("")}</select>`
    : `<span class="obcs ${obCsCls(r.wx)}">${esc(r.wx || "-")}</span>`;
  const restr = q ? `<input class="obval" style="width:100%;min-width:140px" data-obq="r115" data-f="restr" value="${esc(r.restr || "")}" placeholder="e.g. G1, G3, RADAR" aria-label="R115 restrictions">` : esc(r.restr || "-");
  const areas = (b.areas || []).map((x, j) => `<div class="obarea"><span>${esc(x.item)}</span>${obValCell(q, "aval", `data-j="${j}"`, x.val, obValS(x.val, x.s), x.s)}</div>`).join("");
  return `<div class="tablewrap"><table class="opst obt"><thead><tr><th>Item</th><th>TGT</th><th>WX</th><th>Before</th><th>After</th><th>Restrictions</th></tr></thead><tbody>
      <tr><td><b>R115 (CAPTIEUX)</b> <button class="btn small" data-ob="chart" data-k="captieux">Map</button></td><td>${f("tgt", "70px")}</td><td>${wx}</td><td>${f("before", "70px")}</td><td>${f("after", "70px")}</td><td>${restr}</td></tr></tbody></table></div>
    <div class="obareas">${areas}
      <div class="obarea"><span>Immersion suit</span>${z.immersion ? obPill(z.immersion === "YES" ? "r" : "g", z.immersion) : `<span class="hint">-</span>`}</div>
      <div class="obarea"><span>Firing sch</span>${obValCell(q, "czxv", `data-f="firing"`, czx.firing, obValS(czx.firing, czx.firingS), czx.firingS)}</div>
      <div class="obarea"><span>CALAMAR</span>${obValCell(q, "czxv", `data-f="calamar"`, czx.calamar, obValS(czx.calamar, czx.calamarS, true), czx.calamarS)}</div></div>
    ${q ? `<p class="hint" style="margin:6px 0 0">Type a value and it shows red (CALAMAR "BOOKED" shows yellow). Tap A to pick another colour. R115 restrictions light up the Captieux map (G1–G7, RADAR).</p>` : ""}`;
}
function obCallsignsCard() {
  const a = obGet("aircraft"), cs = a.callsigns || [];
  if (!cs.length && !a.vehicleCap) return "";
  return obCard("ob-bcs", "Callsign / ETTS / vehicle", "", `${cs.length ? `<table class="opst obt"><thead><tr><th>Callsign</th><th>ETTS</th><th>Vehicle</th></tr></thead><tbody>${cs.map(c => `<tr><td>${esc(c.callsign)}</td><td>${esc(c.etts)}</td><td>${esc(c.vehicle)}</td></tr>`).join("")}</tbody></table>` : ""}${a.vehicleCap ? `<p class="hint">Vehicle cap: ${esc(a.vehicleCap)}</p>` : ""}`);
}
// Colour state letter → pill colour.
const obQSel = (f, v, opts) => `<select class="obsel" data-obq="czx" data-f="${f}">${["", ...opts].map(o => `<option value="${esc(o)}" ${o === (v || "") ? "selected" : ""}>${esc(o || "-")}</option>`).join("")}</select>`;
// Small wind rose: runway line and an arrow from the wind direction.
function obRose(w, rwy) {
  const R = 46, cx = 55, cy = 55, p = (deg, r) => [cx + r * Math.sin(deg * Math.PI / 180), cy - r * Math.cos(deg * Math.PI / 180)];
  const rw = rwy != null ? [p(rwy, 30), p(rwy + 180, 30)] : null;
  const arrow = w && w.dir != null ? (() => { const [x1, y1] = p(w.dir, R), [x2, y2] = p(w.dir, 8); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--out)" stroke-width="4" stroke-linecap="round" marker-end="url(#obArr)"/>`; })() : "";
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
  G7: "M103 194L115 160L136 143L168 138L211 151L257 177L295 204L325 245L290 260L225 267L164 272L122 262L105 233Z",
  G1: "M192 169L317 231L299 248L181 238Z",
  G6: "M205 378L260 383L290 398L268 420L212 431Z",
  G2: [322, 305, 44], G4: [250, 311, 47], G5: [220, 340, 39], G3: [282, 360, 37], RADAR: [342, 359, 36],
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
  const can = opsCanEdit(), today = todayStr();
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
  const can = opsCanEdit(), gm = obGet("gonogo");
  let html = obMyItemsCard();
  // status grid
  const crew = OB.crew.filter(c => c.active);
  const groups = [...new Set([...OB_GROUPS, ...crew.map(c => c.grp)])].filter(g => crew.some(c => c.grp === g));
  const goCount = crew.filter(c => !obOutstanding(c.id).length).length;
  html += obCard("ob-go", "Aircrew status", `${goCount} of ${crew.length} GO${gm.miac ? ` · MIAC 4 effective till ${esc(fmtDay(gm.miac))}` : ""}`,
    crew.length ? `<div class="obgo">${groups.map(g => `<div><h3 class="opssub">${esc(g)}</h3><table class="opst obt"><tbody>${crew.filter(c => c.grp === g).map(c => {
      const out = obOutstanding(c.id);
      return `<tr><td>${opsX(c.name)}</td><td class="hint">${esc(obCodes(out))}</td><td>${obPill(out.length ? "r" : "g", out.length ? "NO-GO" : "GO")}</td></tr>`;
    }).join("")}</tbody></table></div>`).join("")}</div>` : `<p class="hint">${can ? "Add the aircrew under Crew list below." : "No crew list yet."}</p>`);
  if (can) html += obItemsCard() + obCrewCard();
  html += obCard("ob-legend", "Legend", "", `<dl class="opsdl obleg">${(gm.legend || []).map(l => `<dt>${esc(l.code)}</dt><dd>${esc(l.label)}</dd>`).join("")}</dl>`,
    can && !OB.edit ? `<button class="btn small" data-ob="edit" data-k="gonogo">Edit MIAC / legend</button>` : "");
  if (OB.edit && OB.edit.key === "gonogo") html += obCard("ob-gonogo", "MIAC 4 / legend", "", obEditor("gonogo"));
  v.innerHTML = html;
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
    <div class="tools" style="margin-top:8px"><button class="btn primary small" data-ob="newitem">+ New item</button><label class="opschk"><input type="checkbox" data-ob="showclosed" ${OB.showClosed ? "checked" : ""}>Show closed</label></div>
    <p class="hint">Tap an item to see who's done it. Tick people off for them, or they tap Done on their own phone.</p>`);
}
function obCrewCard() {
  const logins = S.profiles.filter(p => !p.trainee_id || active().some(t => t.id === p.trainee_id));
  const opts = sel => `<option value="">No login</option>` + logins.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.display_name || showLogin(p.email))}</option>`).join("");
  const rows = OB.crew.map(c => `<tr class="${c.active ? "" : "opsadd"}"><td><input value="${esc(c.name)}" data-crew="${esc(c.id)}" data-f="name" style="width:130px"></td>
      <td><input value="${esc(c.grp)}" list="obGroups" data-crew="${esc(c.id)}" data-f="grp" style="width:110px"></td>
      <td><select data-crew="${esc(c.id)}" data-f="profile_id" style="width:150px">${opts(c.profile_id)}</select></td>
      <td><label class="opschk"><input type="checkbox" data-crew="${esc(c.id)}" data-f="active" ${c.active ? "checked" : ""}>Active</label></td></tr>`).join("");
  return obCard("ob-crew", "Crew list", "", `<datalist id="obGroups">${OB_GROUPS.map(g => `<option value="${g}">`).join("")}</datalist>
    <div class="tablewrap"><table class="obed"><thead><tr><th>Name (as on the programme)</th><th>Group</th><th>Login</th><th></th></tr></thead><tbody>${rows}
      <tr><td><input id="obNewName" placeholder="e.g. M LIM" style="width:130px"></td><td><input id="obNewGrp" list="obGroups" value="QFI" style="width:110px"></td><td><select id="obNewLogin" style="width:150px">${opts("")}</select></td><td><button class="btn small" data-ob="addcrew">Add</button></td></tr></tbody></table></div>
    <div class="tools"><button class="btn small" data-ob="addtrainees">+ All trainees on roster</button></div>
    <p class="hint">Changes save as you go. Linking a login lets that person sign off their own items and see their own day on the flying program. Untick Active instead of deleting.</p>`);
}

/* ---------- Aircraft page ---------- */
function renderAircraft(v) {
  if (!OB.loaded) return obNotLoaded(v);
  const editing = OB.edit && OB.edit.key === "aircraft";
  v.innerHTML = editing ? obCard("ob-aircraft", "Aircraft status", "", obEditor("aircraft")) : obAircraftView(false) + `<p class="opsmeta" style="justify-content:flex-end">${obMeta("aircraft")} ${obEditBtn("aircraft", obCanEditAc(), "Edit aircraft")}</p>`;
}
const obNoteLine = l => /^\s*(NTS|AMC|NPC|OJT|MAX FLY|CFH|CONTROL HOURS)\b/i.test(l) ? `<span class="obamb">${esc(l)}</span>` : esc(l);
function obAircraftView(tv) { return `<div class="obgrid ${tv ? "tv" : ""}">${obAircraftCards().join("")}</div>`; }
function obAircraftCards() {
  const a = obGet("aircraft"), tails = a.tails || [];
  const sv = tails.filter(t => t.status === "S").length;
  const tailsHtml = tails.length ? `<div class="tablewrap"><table class="opst obt"><thead><tr><th>Tail</th><th>Status</th><th>NPC</th><th>NTS</th><th>OJT</th><th>Significant ADDL / NPC / AMC</th></tr></thead><tbody>${tails.map(t => `<tr>
      <td><b>${esc(t.tail)}</b></td><td>${obPill(t.status === "S" ? "g" : t.status === "US" ? "r" : "a", t.status === "S" ? "S" : t.status === "US" ? "U/S" : "MX")}</td>
      <td>${t.npc ? obPill("a", "NPC") : ""}</td><td>${t.nts ? obPill("a", "NTS") : ""}</td><td>${t.ojt ? obPill("a", "OJT") : ""}</td>
      <td class="obnotes">${String(t.notes || "").split("\n").filter(Boolean).map(obNoteLine).join("<br>")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="hint">No aircraft entered yet.</p>`;
  const cs = a.callsigns || [];
  return [obCard("ob-tails", "Aircraft status", tails.length ? `${sv} of ${tails.length} serviceable` : "", tailsHtml).replace('class="card opscard"', 'class="card opscard obwide"'),
    obCard("ob-cs", "Callsigns", "", cs.length ? `<table class="opst obt"><thead><tr><th>Callsign</th><th>ETTS</th><th>Vehicle</th></tr></thead><tbody>${cs.map(c => `<tr><td>${esc(c.callsign)}</td><td>${esc(c.etts)}</td><td>${esc(c.vehicle)}</td></tr>`).join("")}</tbody></table>${a.vehicleCap ? `<p class="hint">Vehicle cap: ${esc(a.vehicleCap)}</p>` : ""}` : `<p class="hint">None entered.</p>`)];
}

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
  v.innerHTML = `<div class="tvbar"><b>150 Falcon Det · Ops board</b><span class="tvclock">${esc(n.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))}L <small>${esc(n.toISOString().slice(11, 16).replace(":", ""))}Z</small></span>
      <span class="grow"></span>${st ? `<span>Today: ${st.sorties} sorties · first T/O ${esc(opsHM(st.first) || "-")} · last landing ${esc(opsHM(st.last) || "-")}</span>` : ""}<button class="btn small" data-ob="exittv">Exit TV</button></div>
    ${obBoardView(true)}
    <div class="obgrid tv">${obAircraftCards().join("")}
      ${obCard("ob-tvgo", "Aircrew status", `${crew.length - nogo.length} of ${crew.length} GO`, nogo.length ? `<div class="obtvgo">${nogo.map(c => `<span>${obPill("r", c.name)} <span class="hint">${esc(obCodes(obOutstanding(c.id)))}</span></span>`).join("")}</div>` : `<p>${obPill("g", "ALL GO")}</p>`)}</div>`;
}
const obLeaveTv = () => { document.body.classList.remove("tvmode"); if (obWake) { obWake.release().catch(() => {}); obWake = null; } };

/* ---------- editors (board, aircraft, gonogo) ---------- */
const bI = (p, v, w, ph) => `<input data-bp="${p}" value="${esc(v ?? "")}"${w ? ` style="width:${w}"` : ""}${ph ? ` placeholder="${esc(ph)}"` : ""}>`;
const bT = (p, v, rows) => `<textarea data-bp="${p}" rows="${rows || 2}">${esc(v ?? "")}</textarea>`;
const bC = (p, v, label) => `<label class="opschk"><input type="checkbox" data-bp="${p}" ${v ? "checked" : ""}>${label}</label>`;
const bS = (p, v, opts) => `<select data-bp="${p}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(v ?? "") === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const bB = (op, p, i, label, tpl) => `<button type="button" class="btn small" data-bop="${op}" data-p="${p}" data-i="${i ?? ""}" data-tpl="${tpl || ""}">${label}</button>`;
const bTools = (p, i) => `<span class="tools">${bB("up", p, i, "↑")}${bB("down", p, i, "↓")}${bB("del", p, i, "✕")}</span>`;
const OB_ST = [["g", "Available"], ["a", "Limited"], ["r", "U/S"], ["auto", "Auto (CAT 1)"], ["", "-"]];
const OB_AUTO = [["", "Auto"], ["g", "Green"], ["r", "Red"]];
const OB_VALCOL = [["", "Auto (red when filled)"], ["g", "Green"], ["a", "Amber"], ["r", "Red"]];
const obTpl = {
  af: () => obAf("", "alt", false, "", []),
  aid: () => obAid("", "g"),
  ra: () => ({ item: "", val: "", s: "" }),
  tail: () => ({ tail: "", status: "S", npc: false, nts: false, ojt: false, notes: "" }),
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
        <td>${bI("r115.tgt", d.r115.tgt, "70px")}</td><td>${bS("r115.wx", d.r115.wx, ["", ...OB_FASF].map(v => [v, v || "-"]))}</td><td>${bI("r115.before", d.r115.before, "80px")}</td><td>${bI("r115.after", d.r115.after, "80px")}</td><td>${bI("r115.restr", d.r115.restr, "180px")}</td></tr></tbody></table></div>
      <div class="tablewrap"><table><thead><tr><th>Item</th><th>Value</th><th>Colour</th><th></th></tr></thead><tbody>${(d.areas || []).map((r, i) => `<tr>
        <td>${bI(`areas.${i}.item`, r.item, "120px")}</td><td>${bI(`areas.${i}.val`, r.val, "110px")}</td><td>${bS(`areas.${i}.s`, r.s, OB_VALCOL)}</td><td>${bTools("areas", i)}</td></tr>`).join("")}
        <tr><td>Firing sch</td><td>${bI("czx.firing", d.czx.firing, "110px")}</td><td>${bS("czx.firingS", d.czx.firingS, OB_VALCOL)}</td><td></td></tr>
        <tr><td>CALAMAR</td><td>${bI("czx.calamar", d.czx.calamar, "110px")}</td><td>${bS("czx.calamarS", d.czx.calamarS, OB_VALCOL)}</td><td></td></tr></tbody></table></div>${bB("add", "areas", "", "+ Area", "ra")}
      <p class="hint">FASF / RSAF "Auto" works the colour state out from the METAR (or your WX/VIS override) using the Excel's criteria. Aid status "auto" (CAT 1 line) follows CZX FASF. Weather, wind, temperature, QNH and sunrise/sunset come in automatically.</p></div>`;
  } else if (k === "aircraft") {
    body = `<div class="opsed"><div class="tablewrap"><table><thead><tr><th>Tail</th><th>Status</th><th>Flags</th><th>Significant ADDL / NPC / AMC (one per line)</th><th></th></tr></thead><tbody>${(d.tails || []).map((t, i) => `<tr>
        <td>${bI(`tails.${i}.tail`, t.tail, "80px", "e.g. 327#(W)")}</td><td>${bS(`tails.${i}.status`, t.status, [["S", "Serviceable"], ["US", "U/S"], ["MX", "Maintenance"]])}</td>
        <td>${bC(`tails.${i}.npc`, t.npc, "NPC")}${bC(`tails.${i}.nts`, t.nts, "NTS")}${bC(`tails.${i}.ojt`, t.ojt, "OJT")}</td><td>${bT(`tails.${i}.notes`, t.notes, 3)}</td><td>${bTools("tails", i)}</td></tr>`).join("")}</tbody></table></div>${bB("add", "tails", "", "+ Aircraft", "tail")}
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
  else if (k === "equip") obQuick(d => { d.equip[el.dataset.f] = OB_CYCLE[d.equip[el.dataset.f] || ""]; });
});
document.addEventListener("change", e => {
  const el = e.target; if (!/^(SELECT|INPUT)$/.test(el.tagName) || !el.dataset.obq || OB.edit) return;
  const i = +el.dataset.af, k = el.dataset.obq, v = el.value;
  el.disabled = true;
  if (k === "fasf" || k === "rsaf" || k === "rwy") obQuick(d => { d.airfields[i][k] = v; });
  else if (k === "czx" || k === "czxv") obQuick(d => { d.czx[el.dataset.f] = v.trim(); });
  else if (k === "eqv") obQuick(d => { d.equip[el.dataset.f] = v.trim().toUpperCase(); });
  else if (k === "r115") obQuick(d => { d.r115 = { ...(d.r115 || {}), [el.dataset.f]: v.trim().toUpperCase() }; });
  else if (k === "aval") obQuick(d => { d.areas[+el.dataset.j].val = v.trim(); });
  else if (k === "bingo") obQuick(d => { d.bingo = v; d.bingoAuto = obBingo({}, obState(d.airfields.find(a => a.icao === "LFBC") || {}, "rsaf").v).auto; });
});
document.addEventListener("input", e => {
  const el = e.target; if (!OB.edit || !el.dataset || !el.dataset.bp || !el.closest("#obEdit")) return;
  opsSetPath(OB.edit.data, el.dataset.bp, el.type === "checkbox" ? el.checked : el.value);
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
    if (ed.key === "board") ed.data.bingoAuto = obBingo({}, obState((ed.data.airfields || []).find(x => x.icao === "LFBC") || {}, "rsaf").v).auto;
    const { data, error } = await S.sb.rpc("ops_state_save", { p_key: ed.key, p_data: ed.data, p_version: ed.version });
    el.disabled = false;
    if (error) {
      if (/someone else/i.test(error.message)) { await ask("Not saved", error.message, "OK"); OB.edit = null; return obLoad(); }
      const er = $("#obErr"); if (er) er.textContent = errMsg(error); return;
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
      d.wxSnap = OB.wxLive; d.bingo = "AUTO";
      (d.airfields || []).forEach(x => { x.rsaf = "AUTO"; if (OB_FASF_AUTO.includes(x.icao)) x.fasf = "AUTO"; x.wx = ""; });
    });
    if (!error) toast("Board updated with the latest METARs.");
  }
  else if (a === "done") {
    if (!await ask("Done?", "Confirm you've read and understood this item.", "Done")) return;
    const { error } = await S.sb.rpc("rs_done", { p_item: el.dataset.item, p_crew: el.dataset.crew, p_done: true });
    if (error) return toast(errMsg(error));
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
  else if (a === "addtrainees") {
    const have = new Set(OB.crew.map(c => opsNorm(c.name))); let n = 0;
    for (const t of active()) {
      if (have.has(opsNorm(t.name))) continue;
      const p = S.profiles.find(x => x.trainee_id === t.id);
      const { error } = await S.sb.rpc("crew_save", { p_id: null, p_name: t.name, p_grp: "TRAINEES", p_profile: p ? p.id : null, p_active: true, p_sort: 500 + n });
      if (error) return toast(errMsg(error)); n++;
    }
    toast(n ? `${n} trainee${n > 1 ? "s" : ""} added.` : "All trainees are already on the list."); obLoad();
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
.obchartview iframe{width:100%;height:75vh;border:0;background:#fff}
.obchartimg{position:relative;line-height:0}
.obchartimg img{width:100%;height:auto;display:block;border-radius:4px}
.obchartimg svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.obhot{fill:rgba(255,40,40,.32);stroke:#ff2d2d;stroke-width:3;animation:obpulse 1.6s ease-in-out infinite}
.obhot.radar{fill:rgba(255,255,255,.25);stroke:#fff}
@keyframes obpulse{50%{fill-opacity:.12}}
@media (prefers-reduced-motion:reduce){.obhot{animation:none}}
table.obt{min-width:0}
.obnote{margin:8px 0 0;font-weight:600}
.obraw{font:500 .78rem ui-monospace,Menlo,Consolas,monospace;color:var(--muted);margin:8px 0 0;word-break:break-word}
.obwind{display:flex;gap:14px;align-items:center}
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
.obgo{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:4px 16px}
.obgo td{padding:3px 6px}
.obitem{border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin-bottom:8px;background:var(--field)}
.obitem.closed{opacity:.6}
.obitemhead{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.obbody{margin:6px 0;font-size:.9rem}
.obacks{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:2px 10px;margin-top:6px}
.obleg{grid-template-columns:max-content 1fr}
.obamb{color:var(--out);font-weight:600}
.obnotes{font-size:.82rem}
table.obed input,table.obed select{padding:4px 6px;font-size:.85rem;margin:0}
table.obed{min-width:0} table.obed td,table.obed th{border:0;padding:2px 4px;background:none}
.obtvgo{display:flex;flex-wrap:wrap;gap:6px 14px}
body.tvmode .topbar,body.tvmode #subtabs,body.tvmode #tally{display:none!important}
body.tvmode .wrap{max-width:none;padding:10px 16px}
body.tvmode{font-size:17px}
.tvbar{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;margin-bottom:10px}
.tvbar b{font:700 1.5rem var(--cond)} .tvclock{font:700 1.5rem var(--cond)} .tvbar .grow{flex:1}
@media (min-width:1400px){body.tvmode .obgrid.tv{grid-template-columns:2fr 1fr 1fr}body.tvmode .obgrid.tv .obwide{grid-column:auto}}`;
  document.head.appendChild(s);
})();
