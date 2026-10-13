/* =====================================================================
   Daily programme import (Gordon, 13 Oct): ops pick the raw Excel export
   from the planning software (.xlsx, one row per event: M346 sorties, FMS
   sims, OPSRM SXO / OPS O, ERTMS wave windows, airfield items, BRM area
   bookings). The board reads it in the browser (nothing leaves the board),
   merges it with what's already on that day (keeps what ops typed: OPS O,
   config, DL, vehicle, typed brief / step, sim callsigns, remarks, flown
   times), shows what changed, then saves flying, sims and airfield.
   ===================================================================== */

/* ---------- reading the .xlsx (a zip of XML files) ---------- */
async function xlsxRows(file) {
  const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer);
  const u16 = p => dv.getUint16(p, true), u32 = p => dv.getUint32(p, true);
  let eo = -1;
  for (let p = buf.length - 22; p >= Math.max(0, buf.length - 70000); p--) if (u32(p) === 0x06054b50) { eo = p; break; }
  if (eo < 0) throw new Error("This isn't an Excel (.xlsx) file.");
  const ents = {}, td = new TextDecoder();
  for (let i = 0, p = u32(eo + 16), n = u16(eo + 10); i < n && u32(p) === 0x02014b50; i++) {
    const nl = u16(p + 28), name = td.decode(buf.subarray(p + 46, p + 46 + nl));
    ents[name] = { m: u16(p + 10), size: u32(p + 20), off: u32(p + 42) };
    p += 46 + nl + u16(p + 30) + u16(p + 32);
  }
  const read = async name => {
    const e = ents[name]; if (!e) return null;
    const s = e.off + 30 + u16(e.off + 26) + u16(e.off + 28), raw = buf.subarray(s, s + e.size);
    if (e.m === 0) return td.decode(raw);
    if (e.m !== 8 || typeof DecompressionStream === "undefined") throw new Error("This browser can't open the file. Try Chrome, Edge or Safari.");
    return await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  };
  const xml = s => new DOMParser().parseFromString(s, "application/xml"), tags = (n, t) => [...n.getElementsByTagNameNS("*", t)];
  const clean = s => String(s).replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => h.toUpperCase() === "000D" ? "" : String.fromCharCode(parseInt(h, 16)));
  const ssx = await read("xl/sharedStrings.xml");
  const ss = ssx ? tags(xml(ssx), "si").map(si => clean(tags(si, "t").filter(t => !t.closest || !t.parentNode || t.parentNode.localName !== "rPh").map(t => t.textContent).join(""))) : [];
  const sheetName = ents["xl/worksheets/sheet1.xml"] ? "xl/worksheets/sheet1.xml" : Object.keys(ents).filter(k => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error("No sheet found in the file.");
  const col = r => { let n = 0; for (const ch of r.replace(/\d+$/, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  return tags(xml(await read(sheetName)), "row").map(row => {
    const out = [];
    for (const c of tags(row, "c")) {
      const t = c.getAttribute("t"), v = (tags(c, "v")[0] || {}).textContent;
      out[col(c.getAttribute("r") || "A")] = t === "s" ? ss[+v] : t === "inlineStr" ? clean(tags(c, "t").map(x => x.textContent).join("")) : t === "b" ? v === "1" : t === "str" || t === "e" ? clean(v ?? "") : v == null ? null : Number(v);
    }
    return out;
  });
}

/* ---------- reading the planning export ---------- */
const IMP_AREA = /^(31D\w*|BH\w*|B\/H\S*|R\d\w*|D\d\w*|ZRT\w*|CEL\w*)$/i;
const impStr = v => v == null ? "" : String(v).replace(/\s+/g, " ").trim();
// "Lim, W" → LIM W, "M, Lim" → M LIM (the board's spelling)
const impName = s => opsNorm(String(s || "").replace(/,/g, " "));
const IMP_MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const impDayTxt = v => { const m = /^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2,4})$/.exec(String(v).trim()); if (!m || !IMP_MON[m[2].toUpperCase()]) return ""; const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${String(IMP_MON[m[2].toUpperCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`; };
const impDay = v => typeof v === "string" && impDayTxt(v) ? impDayTxt(v) : typeof v === "number" ? new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5).toISOString().slice(0, 10)
  : (/(\d{4})-(\d{2})-(\d{2})/.exec(String(v)) || /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v)) || []).slice(1).join("-").replace(/^(\d{2})-(\d{2})-(\d{4})$/, "$3-$2-$1");
const impMin = v => { if (typeof v === "number") return Math.round((v % 1) * 1440) % 1440; const m = /(\d{1,2}):(\d{2})/.exec(String(v || "")); return m ? +m[1] * 60 + +m[2] : null; };
// French local time → Z for that day (summer / winter time worked out by the browser).
function impOff(day) {
  const h = +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(new Date(day + "T12:00:00Z"));
  return (h - 12) * 60;
}
function impParse(rows, forceOff) {
  const hi = rows.findIndex(r => r && r.some(c => /^start time$/i.test(impStr(c))));
  if (hi < 0) throw new Error("Couldn't find the column headings (Start Date, Start Time, Asset Type, Callsign…). Is this the planning export?");
  const H = rows[hi].map(impStr), ix = n => H.findIndex(h => h.toLowerCase() === n), last = n => H.map(h => h.toLowerCase()).lastIndexOf(n);
  const C = { sd: ix("start date"), st: ix("start time"), ed: ix("end date"), et: ix("end time"), type: ix("asset type"), tail: ix("asset tail"), cs: ix("callsign"), cap: ix("captain"), crew: ix("crew"), task: ix("task"), det: ix("details"), status: ix("status"), why: last("status code") };
  // Times in the export follow whatever clock the planning PC uses (French local one day, Z − 12 h another: Gordon, 13–14 Oct),
  // so the offset is worked out from the sorties' area times, which are always written in Z ("31DS 0715-0815"); else French time.
  const raw = [];
  for (const r of rows.slice(hi + 1)) {
    if (!r || !r.some(c => c != null && c !== "")) continue;
    const g = k => C[k] < 0 ? "" : r[C[k]], day = impDay(g("sd")), s = impMin(g("st")), e = impMin(g("et"));
    if (!day || s == null) continue;
    const d0 = Date.parse(day + "T00:00:00Z") / 6e4, eday = impDay(g("ed")) || day;
    raw.push({ a: d0 + s, b: e == null ? null : Date.parse(eday + "T00:00:00Z") / 6e4 + e, day, type: impStr(g("type")).toUpperCase().replace(/^N\/A$/, ""), tail: impStr(g("tail")), cs: impStr(g("cs")), cap: impStr(g("cap")), crew: impStr(g("crew")), task: impStr(g("task")), det: impStr(g("det")), st: impStr(g("status")).toUpperCase(), why: impStr(g("why")).toUpperCase() });
  }
  if (!raw.length) throw new Error("No events found in the file.");
  const votes = {};
  for (const x of raw) { const m = x.type === "M346" && /\b([0-2]\d)([0-5]\d)\s*-\s*[0-2]\d[0-5]\d\b/.exec(x.det); if (!m) continue;
    let d = (((x.a % 1440) - (+m[1] * 60 + +m[2])) % 1440 + 1440) % 1440; if (d >= 690) d -= 1440; // ±12 h look alike: take −12 h (a PC left on Windows' first time zone, UTC−12)
    const h = Math.round(d / 60) * 60; votes[h] = (votes[h] || 0) + 1; }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const off = forceOff != null ? forceOff : best ? +best[0] : impOff(raw[0].day);
  const offHow = forceOff != null ? "set by you" : best ? `worked out from ${best[1]} area time${best[1] === 1 ? "" : "s"}` : "no area times, so French time assumed";
  // One file = one day's programme (Gordon, 14 Oct). The day is the Z date most sorties fall on; every row from 6 h before
  // that day to 3 h after it is part of it (night flying past 0000Z, early briefs), with times counted from that day's 0000Z.
  const zd = a => new Date((a - off) * 6e4).toISOString().slice(0, 10), cnt = {};
  for (const x of raw.filter(x => x.type === "M346").length ? raw.filter(x => x.type === "M346") : raw) cnt[zd(x.a)] = (cnt[zd(x.a)] || 0) + 1;
  const day = Object.entries(cnt).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0], d0 = Date.parse(day + "T00:00:00Z") / 6e4;
  const ev = raw.map(x => ({ ...x, day, s: x.a - off - d0, e: x.b == null ? null : x.b - off - d0 }));
  const one = ev.filter(x => x.s >= -360 && x.s < 1440 + 180), out = ev.length - one.length;
  const days = [...new Set(ev.filter(x => !one.includes(x)).map(x => zd(x.a)))].sort();
  const P = { day, days, out, off, offHow, waves: [], flights: [], sims: [], af: [], mbr: [], notes: [], areas: 0, skipped: [], unknownSt: {} };
  // Waves from the ERTMS windows ("W1 ERTMS", "NW1 ERTMS"…)
  for (const x of one) { const m = /^(N(?:IGHT)?\s*)?W(?:AVE)?\s*(\d+)\b.*ERTMS/i.exec(x.task); if (m && !x.type) P.waves.push({ no: +m[2], night: !!m[1], s: x.s, e: x.e, sxo: "", opsO: "", notes: [] }); }
  P.waves.sort((a, b) => a.s - b.s);
  for (const x of one) {
    if (x.type === "M346") {
      const m = /^(.*?)(\d+)$/.exec(x.cs.replace(/\s+/g, "")), base = (m ? m[1] : x.cs).toUpperCase(), num = m ? String(+m[2]) : "";
      const d = /^(\S+)?\s*(?:(\d{4})\s*-\s*(\d{3,4})\b)?\s*(.*)$/.exec(x.det) || [];
      const isArea = d[1] && IMP_AREA.test(d[1]), area = isArea ? d[1].toUpperCase() : "", at = isArea && d[2] ? `${d[2]} - ${d[3]}` : "";
      const rmks = isArea ? impStr(d[4]) : x.det;
      const crew = x.crew.split(";").map(impName).filter(Boolean);
      P.flights.push({ base, num, s: x.s, e: x.e, area, at, line: { crew1: impName(x.cap), crew2: crew[0] || "", extra: crew.slice(1), mission: x.task.toUpperCase(), tail: x.tail.toUpperCase(), rmks: rmks.toUpperCase() }, st: x.st, why: x.why });
    } else if (x.type === "MBR") {
      // briefing-room strips: IN TIME, SODB, WX/NTM… (→ day details) and other briefs (→ ground programme)
      const who = [x.cap, ...x.crew.split(";")].map(impName).filter(Boolean);
      if (x.task) P.mbr.push({ s: x.s, e: x.e, task: x.task.toUpperCase(), who, det: x.det.toUpperCase() });
    } else if (x.type === "FMS" && !x.cap && !x.task) {
      // empty sim slot (no crew, no mission): nothing to show
    } else if (x.type === "FMS") {
      const crew = x.crew.split(";").map(impName).filter(Boolean), mis = x.task.toUpperCase();
      P.sims.push({ s: x.s, e: x.e, fms: (/(\d)\s*$/.exec(x.tail) || [])[1] || "", crew1: impName(x.cap), crew2: crew[0] || "", rmks: crew.slice(1).map(n => `${/EPE/.test(mis) ? "SXO" : "SUPP"}: ${n}`).join(" / "), mission: mis });
    } else if (x.type === "OPSRM") {
      const who = [x.cap, ...x.crew.split(";")].map(impName).filter(Boolean).join(" / ");
      if (who && /SXO|OPS\s*O/i.test(x.task)) P.waves.length ? (impWave(P.waves, x.s)[/SXO/i.test(x.task) ? "sxo" : "opsO"] = who) : P.skipped.push(`${x.task} ${who}`);
    } else if (x.type === "BRM") {
      // Area bookings: the plain ones are already on the flying lines; ones with a restriction go to the airfield list.
      const t = x.task.toUpperCase();
      if (/\s/.test(t)) P.af.push({ what: "AREA " + t, time: `${opsZ4(x.s)}Z - ${opsZ4(x.e)}Z`, s: x.s }); else P.areas++;
    } else if (!x.type && !/ERTMS/i.test(x.task) && x.task) {
      const det = x.det.toUpperCase();
      P.af.push({ what: x.task.toUpperCase() + (det ? ` (${det})` : ""), time: `${opsZ4(x.s)}Z - ${opsZ4(x.e)}Z`, s: x.s });
      if (det && P.waves.length) impWave(P.waves, x.s).notes.push(det);
    } else if (!x.type && !x.task && x.det) {
      P.notes.push({ s: x.s, e: x.e, text: x.det.toUpperCase() }); // e.g. "SNG J SIT-IN ENZO BRIEF"
    } else if ((x.type || x.task) && !/ERTMS/i.test(x.task)) P.skipped.push([x.type, x.task].filter(Boolean).join(" "));
  }
  P.af.sort((a, b) => a.s - b.s);
  return P;
}
// The wave an event belongs to: inside its window (from 1 h before the wave start), else the nearest.
function impWave(waves, t) {
  const inside = waves.filter(w => t >= w.s - 60 && t <= w.e);
  if (inside.length) return inside[inside.length - 1];
  return waves.reduce((b, w) => Math.abs(w.s - t) < Math.abs(b.s - t) ? w : b, waves[0]);
}

/* ---------- merging with what's already on the board ---------- */
const IMP_WHY = { M1: "LOGS M1", M2: "LOGS M2", M3: "LOGS M3" };
function impMerge(P, cur) {
  const old = opsNameWaves(opsClone(cur.flying || { waves: [] })), oldSim = cur.sim || { rows: [] }, oldAf = cur.airfield || { rows: [], sunset: "" };
  const notes = { kept: new Set(), warn: [], cx: [], add: [] };
  // Waves: from the file's windows; if it has none, group the sorties by gaps of more than 90 min.
  let W = P.waves.map(w => ({ ...w, fl: [] }));
  const fls = [...P.flights].sort((a, b) => a.s - b.s);
  if (!W.length) for (const f of fls) { const w = W[W.length - 1]; if (!w || f.s - w.e > 90) W.push({ no: W.length + 1, night: false, s: f.s, e: f.e, sxo: "", opsO: "", notes: [], fl: [] }); else w.e = Math.max(w.e, f.e); }
  for (const f of fls) (W.length ? impWave(W, f.s) : null).fl.push(f);
  W = W.filter(w => w.fl.length || w.sxo);
  const oldFlights = []; (old.waves || []).forEach((w, wi) => (w.flights || []).forEach(f => oldFlights.push({ w, wi, f, used: false })));
  const sameCs = (a, b) => opsNorm(a).replace(/\d+$/, "") === opsNorm(b).replace(/\d+$/, "");
  const waves = W.map(w => {
    // the board's wave at the same time (keeps OPS O, remarks, night tick)
    const ow = (old.waves || []).find(o => (o.flights || []).some(f => { const e = opsMin(f.etd); return e != null && e >= w.s - 60 && e <= w.e; }));
    const nw = { name: "", night: ow ? !!ow.night || w.night : w.night, sxo: w.sxo || (ow && ow.sxo) || "", opsO: w.opsO || (ow && ow.opsO) || "", rmks: ow && ow.rmks ? ow.rmks : [...new Set(w.notes)].join(" / "), flights: [] };
    if (ow && !w.opsO && ow.opsO) notes.kept.add("OPS O");
    if (ow && ow.rmks && w.notes.length) notes.kept.add("wave remarks");
    // formations: same callsign + same ETD
    const groups = [];
    for (const f of w.fl) { let g = groups.find(x => x.base === f.base && x.s === f.s); if (!g) groups.push(g = { base: f.base, s: f.s, e: f.e, area: "", at: "", lines: [] }); g.lines.push(f); if (!g.area && f.area) { g.area = f.area; g.at = f.at; } g.e = Math.max(g.e, f.e); }
    for (const g of groups) {
      const etd = opsZ4(g.s), eta = opsZ4(g.e);
      // the board's formation: same callsign (and ETD), else the one with the same front-seaters around the same time (callsign changed)
      const near = o => !o.used && Math.abs((opsMin(o.f.etd) ?? -999) - g.s) <= 90, c1 = new Set(g.lines.map(l => l.line.crew1));
      const m = oldFlights.find(o => !o.used && sameCs(o.f.callsign, g.base) && o.f.etd === etd) || oldFlights.find(o => near(o) && sameCs(o.f.callsign, g.base))
        || oldFlights.filter(near).map(o => [o, (o.f.ac || []).filter(a => c1.has(opsNorm(a.crew1))).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).map(x => x[0])[0];
      if (m) m.used = true;
      const of = m ? m.f : null, nums = g.lines.map(l => l.num), dup = new Set(nums).size < nums.length || (g.lines.length > 1 && nums.some(n => !n));
      const nf = { brief: "", step: "", etd, eta, callsign: g.base, area: g.area || (of && of.area) || "", areaTime: g.at || (of && of.areaTime) || "", opsAdd: false, ac: [] };
      if (of) {
        if (of.dl) { nf.dl = of.dl; notes.kept.add("DL"); }
        if (of.veh) { nf.veh = of.veh; notes.kept.add("vehicle"); }
        // typed brief / step stay if the ETD hasn't moved
        if (of.etd === etd) for (const k of ["brief", "step"]) if (opsIsMan(of, k)) { nf[k] = of[k]; (nf.man ||= {})[k] = true; notes.kept.add("typed brief / step"); }
      }
      const oldLines = of ? [...(of.ac || [])] : [];
      g.lines.forEach((l, i) => {
        const ol = oldLines.find(a => opsNorm(a.crew1) && opsNorm(a.crew1) === l.line.crew1) || null;
        if (ol) oldLines.splice(oldLines.indexOf(ol), 1);
        const a = { n: dup ? String(i + 1) : (g.lines.length > 1 || l.num ? l.num : ""), crew1: l.line.crew1, crew2: l.line.crew2, mission: l.line.mission, tail: l.line.tail, config: ol ? ol.config || "" : "", rmks: l.line.rmks };
        if (l.line.extra.length) a.rmks = [a.rmks, "+ " + l.line.extra.join(" / ")].filter(Boolean).join(" ");
        if (!a.rmks && ol && ol.rmks) { a.rmks = ol.rmks; notes.kept.add("line remarks"); }
        if (ol && ol.config) notes.kept.add("config");
        if (l.st === "A" || (ol && ol.opsAdd)) { a.opsAdd = true; if (l.st === "A") notes.add.push(`${g.base} ${a.crew1}`); }
        if (ol && ol.log && ol.log.st) a.log = ol.log; // flown times stay
        else if (l.st === "C") { const why = IMP_WHY[l.why] || (/^OTH/.test(l.why) ? "OTH" : l.why); a.log = { st: "cx", why, by: S.me && S.me.id, at: new Date().toISOString() }; notes.cx.push(`${g.base} ${a.crew1}${why ? " (" + why + ")" : ""}`); }
        // S (AREA, A/C) and D (BACK = slid back in the programme) are planning notes: ignored (Gordon, 13 Oct).
        nf.ac.push(a);
      });
      // ETA from the file; brief / step worked out from the ETD unless ops had typed them (and the ETD hasn't moved)
      nf.man = { brief: !!(nf.man && nf.man.brief), step: !!(nf.man && nf.man.step), eta: nf.eta !== opsAutoT(nf, "eta") };
      for (const k of ["brief", "step"]) if (!nf.man[k]) nf[k] = opsAutoT(nf, k);
      for (const a of oldLines) if (a.log && a.log.st) notes.warn.push(`${g.base} ${a.crew1 || "?"} had flown times logged but isn't in the file any more; they've been dropped.`);
      nw.flights.push(nf);
    }
    return nw;
  });
  for (const o of oldFlights) if (!o.used && (o.f.ac || []).some(a => a.log && a.log.st)) notes.warn.push(`${o.f.callsign} ${o.f.etd} had flown times logged but isn't in the file any more; they've been dropped.`);
  const flying = opsNameWaves({ waves });
  // Sims: FMS 1 and 2 at the same time are one slot (one row, two lines) when one of them is a single-seat line (tow / instructor /
  // solo); two full crews at the same time are two separate slots, as on the squadron's programme. The board's callsign / config stay.
  const rows = [], byT = {};
  for (const x of [...P.sims].sort((a, b) => a.s - b.s || a.fms.localeCompare(b.fms))) (byT[x.s] ||= []).push(x);
  for (const xs of Object.values(byT)) {
    const line = x => ({ n: "", crew1: x.crew1, crew2: x.crew2, mission: x.mission, fms: x.fms, config: "", rmks: x.rmks });
    const one = xs.some(x => !x.crew2), mk = ls => ({ _s: xs[0].s, etd: opsZ4(xs[0].s), eta: opsZ4(Math.max(...xs.map(x => x.e ?? x.s))), callsign: "", ac: ls });
    if (one) rows.push(mk(xs.map(line))); else xs.forEach(x => rows.push({ ...mk([line(x)]), eta: opsZ4(x.e ?? x.s) }));
  }
  const usedSim = new Set();
  for (const r of rows) {
    if (r.ac.length > 1) r.ac.forEach((a, i) => a.n = String(i + 1));
    const shares = y => (y.ac || []).some(a => r.ac.some(b => b.crew1 && opsNorm(a.crew1) === b.crew1)), free = y => !usedSim.has(y);
    const or = (oldSim.rows || []).find(y => free(y) && y.etd === r.etd && shares(y)) || (oldSim.rows || []).find(y => free(y) && shares(y) && Math.abs((opsMin(y.etd) ?? -999) - r._s) <= 60) || (oldSim.rows || []).find(y => free(y) && y.etd === r.etd);
    if (or) { usedSim.add(or);
      if (or.callsign) { r.callsign = or.callsign; notes.kept.add("sim callsigns"); }
      for (const a of r.ac) { const oa = (or.ac || []).find(b => opsNorm(b.crew1) === a.crew1); if (oa) { if (oa.config) { a.config = oa.config; notes.kept.add("config"); } if (!a.rmks && oa.rmks) { a.rmks = oa.rmks; notes.kept.add("sim remarks"); } } }
    }
    delete r._s;
  }
  const sim = { ...oldSim, rows };
  const airfield = { ...oldAf, rows: P.af.length ? P.af.map(({ what, time }) => ({ what, time })) : oldAf.rows || [] };
  // Day details from the briefing strips: only boxes ops haven't filled in yet.
  const header = { ...opsBlank.header(), ...(cur.header || {}) }, hdr = [];
  const HK = [[/LATE\s*IN/, "lateIn"], [/IN\s*TIME/, "inTime"], [/SODB/, "sodb"], [/MODB/, "modb"], [/NIGHT.*BRIEF/, "nightBrief"], [/OPS\s*BRIEF/, "opsBrief"], [/EOWD/, "eowd"], [/\bWX\b|NTM|NOTAM/, "wxBrief"]];
  const val = {}, other = [];
  for (const b of [...P.mbr].sort((a, b) => a.s - b.s)) {
    const k = (HK.find(([re]) => re.test(b.task)) || [])[1];
    if (!k) { other.push(b); continue; }
    const t = opsZ4(b.s) + "Z", g = (val[k] ||= []), same = g.find(x => x.t === t);
    if (same) b.who.forEach(n => same.who.includes(n) || same.who.push(n)); else g.push({ t, who: [...b.who] });
  }
  for (const [k, g] of Object.entries(val)) {
    const v = g.map(x => x.t + (x.who.length ? ` (${x.who.join(" / ")})` : "")).join(" / "), label = (OPS_HEADER_FIELDS.find(f => f[0] === k) || [k, k])[1];
    if (!String(header[k] || "").trim()) { header[k] = v; hdr.push([label, v, true]); } else if (opsNorm(header[k]) !== opsNorm(v)) hdr.push([label, v, false]);
  }
  // Other briefing-room bookings and free notes → the ground programme (added once; re-imports don't duplicate).
  const ground = opsClone(cur.ground && (cur.ground.groups || []).length ? cur.ground : opsBlank.ground()), gnd = [];
  const gg = ground.groups.find(g => /^GROUND PROGRAM/i.test(g.name || "")) || ground.groups[0];
  const add = (s, e, event, who) => {
    const time = `${opsZ4(s)}${e != null && e !== s ? "-" + opsZ4(e) : ""}Z`;
    if (ground.groups.some(g => (g.rows || []).some(r => opsNorm(r.event) === opsNorm(event) && opsMin(r.time) === s))) return;
    (gg.rows ||= []).push({ time, event, personnel: who.join(", "), venue: "" }); gnd.push(`${time} ${event}${who.length ? " (" + who.join(", ") + ")" : ""}`);
  };
  for (const b of other) add(b.s, b.e, b.task + (b.det ? " " + b.det : ""), b.who);
  for (const n of P.notes) add(n.s, n.e, n.text, []);
  return { flying, sim, airfield, header, ground, notes, hdr, gnd };
}

/* ---------- what changed (for the preview) ---------- */
function impChanges(oldFl, newFl) {
  const lines = fl => { const o = []; for (const w of opsNameWaves(opsClone(fl || { waves: [] })).waves || []) for (const f of w.flights || []) for (const a of f.ac || []) if (opsLineUsed(a)) o.push({ w: w.name, cs: opsNorm(f.callsign), etd: f.etd, a }); return o; };
  const A = lines(oldFl), B = lines(newFl), out = [], used = new Set();
  const lab = x => `${x.w} ${x.cs}${x.a.n ? " #" + x.a.n : ""}`, c1 = x => opsNorm(x.a.crew1);
  // missions compared without - / spaces / leading zeros (ASA 3 = ASA-03)
  const mis = v => opsNorm(v).replace(/\b0+(\d)/g, "$1").replace(/ /g, "");
  for (const b of B) {
    const a = A.find(x => !used.has(x) && x.cs === b.cs && c1(x) === c1(b)) || A.find(x => !used.has(x) && x.w === b.w && c1(x) && c1(x) === c1(b)) || A.find(x => !used.has(x) && x.cs === b.cs && x.a.n === b.a.n && x.w === b.w && !B.some(y => y !== b && c1(y) === c1(x)));
    if (!a) { out.push(["new", lab(b), `${b.etd}Z ${[b.a.crew1, b.a.crew2].filter(Boolean).join(" / ")} · ${b.a.mission} · ${b.a.tail || "no tail"}`]); continue; }
    used.add(a);
    const d = [];
    if (a.etd !== b.etd) d.push(`ETD ${a.etd} → ${b.etd}`);
    if (opsNorm(a.a.tail) !== opsNorm(b.a.tail)) d.push(`tail ${a.a.tail || "-"} → ${b.a.tail || "-"}`);
    if (opsNorm(a.a.crew2) !== opsNorm(b.a.crew2)) d.push(`back seat ${a.a.crew2 || "-"} → ${b.a.crew2 || "-"}`);
    if (a.cs !== b.cs) d.push(`callsign ${a.cs} → ${b.cs}`);
    if (c1(a) !== c1(b)) d.push(`front seat ${a.a.crew1 || "-"} → ${b.a.crew1 || "-"}`);
    if (mis(a.a.mission) !== mis(b.a.mission)) d.push(`mission ${a.a.mission || "-"} → ${b.a.mission || "-"}`);
    if (a.w !== b.w) d.push(`${a.w} → ${b.w}`);
    if (d.length) out.push(["chg", `${lab(b)} ${b.a.crew1}`, d.join(" · ")]);
  }
  for (const a of A) if (!used.has(a)) out.push(["del", lab(a), `${a.etd}Z ${[a.a.crew1, a.a.crew2].filter(Boolean).join(" / ")} · ${a.a.mission}`]);
  return out;
}

/* ---------- the button, the preview and the save ---------- */
const IMP = { res: null };
function opsImportPick() {
  if (OPS.edit) return toast("Save or cancel the section you're editing first.");
  let inp = document.getElementById("impFile");
  if (!inp) { inp = document.createElement("input"); inp.type = "file"; inp.id = "impFile"; inp.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; inp.hidden = true; document.body.appendChild(inp);
    inp.onchange = () => { const f = inp.files[0]; inp.value = ""; if (f) opsImportFile(f); }; }
  inp.click();
}
async function opsImportFile(file, rows, forceOff) {
  let P;
  try { rows = rows || await xlsxRows(file); P = impParse(rows, forceOff); } catch (e) { return ask("Couldn't read the file", e.message || String(e), "OK"); }
  const { data, error } = await S.sb.from("ops_sections").select("section,data,version").eq("day", P.day).in("section", ["flying", "sim", "airfield", "header", "ground"]);
  if (error) return toast("Couldn't load " + P.day + ": " + errMsg(error));
  const cur = {}, ver = {}; for (const r of data || []) { cur[r.section] = r.data && Object.keys(r.data).length ? r.data : null; ver[r.section] = r.version; }
  const M = impMerge(P, cur);
  IMP.res = { P, M, ver, file, rows, changes: cur.flying && (cur.flying.waves || []).length ? impChanges(cur.flying, M.flying) : null };
  opsImportShow();
}
function opsImportShow() {
  const { P, M, changes } = IMP.res, file = IMP.res.file.name, st = opsStats(M.flying), ws = M.flying.waves || [];
  let d = document.getElementById("dlgImp");
  if (!d) { d = document.createElement("dialog"); d.id = "dlgImp"; document.body.appendChild(d);
    d.onchange = e => { if (e.target.id === "impOff") opsImportFile(IMP.res.file, IMP.res.rows, +e.target.value); };
    d.onclick = e => { if (e.target.closest("[data-x=close]") || e.target === d) return d.close(); const s = e.target.closest("[data-x=save]"); if (s) opsImportSave(s); }; }
  // names that don't match a login, the roster or the crew list
  const known = new Set([...S.profiles.flatMap(p => [p.display_name, p.callsign]), ...active().map(t => t.name), ...((typeof OB !== "undefined" && OB.crew) || []).map(c => c.name)].map(opsNorm).filter(Boolean));
  const names = new Set(); for (const w of ws) { [w.sxo, w.opsO].forEach(v => String(v || "").split("/").forEach(n => names.add(opsNorm(n)))); for (const f of w.flights) for (const a of f.ac) [a.crew1, a.crew2].forEach(n => names.add(opsNorm(n))); }
  for (const r of M.sim.rows) for (const a of r.ac) [a.crew1, a.crew2].forEach(n => names.add(opsNorm(n)));
  const unknown = [...names].filter(n => n && !known.has(n)).slice(0, 15);
  const li = a => a.length ? `<ul class="impl">${a.map(x => `<li>${x}</li>`).join("")}</ul>` : "";
  const chg = changes == null ? `<p class="hint">Nothing on the board for this day yet: everything comes from the file.</p>`
    : changes.length ? `<ul class="impl impchg">${changes.map(([k, a, b]) => `<li class="${k}"><b>${k === "new" ? "New" : k === "del" ? "Gone" : "Changed"}</b> ${esc(a)} <span>${esc(b)}</span></li>`).join("")}</ul>` : `<p class="hint">No changes to the flying lines.</p>`;
  const unk = Object.entries(P.unknownSt);
  d.innerHTML = `<div class="dlg"><h2>Import ${esc(opsLongDay(P.day))}</h2>
    <p class="hint" style="margin:-6px 0 10px">${esc(file)} · times in the file read as <select id="impOff" title="If the times come out wrong, pick how far the file's clock is from Zulu">${Array.from({ length: 27 }, (_, i) => (i - 12) * 60).map(o => `<option value="${o}"${o === P.off ? " selected" : ""}>Z ${o < 0 ? "−" : "+"} ${Math.abs(o / 60)} h</option>`).join("")}</select> (${esc(P.offHow)})${P.out ? ` · ${P.out} row${P.out === 1 ? "" : "s"} for another day (${esc(P.days.join(", "))}) left out` : ""}</p>
    <div class="impsum"><div><b>${ws.length}</b><span>wave${ws.length === 1 ? "" : "s"}</span></div><div><b>${ws.reduce((n, w) => n + w.flights.length, 0)}</b><span>formations</span></div><div><b>${st.sorties}</b><span>sorties</span></div><div><b>${M.sim.rows.length}</b><span>sim slots</span></div><div><b>${M.airfield.rows.length}</b><span>airfield items</span></div></div>
    <h3>Flying lines vs the board</h3>${chg}
    ${M.notes.cx.length ? `<h3>Marked CX (cancelled in the file)</h3>${li(M.notes.cx.map(esc))}` : ""}
    ${M.notes.add.length ? `<h3>Ticked Ops add</h3>${li(M.notes.add.map(esc))}` : ""}
    ${M.notes.kept.size ? `<p class="hint"><b>Kept from the board:</b> ${esc([...M.notes.kept].join(", "))}.</p>` : ""}
    <p class="hint"><b>Not in the file, still for ops:</b> ${[ws.some(w => !w.opsO) ? "OPS O" : "", "config / DL on new lines", M.sim.rows.some(r => !r.callsign) ? "sim callsigns" : "", "rest of the ground programme / day details", "duty extras"].filter(Boolean).join(", ")}.</p>
    ${unknown.length ? `<p class="impw">⚠ Not matching any login, trainee or crew-list name: ${esc(unknown.join(", "))}. Check the spelling after importing.</p>` : ""}
    ${unk.length ? `<p class="impw">⚠ Status codes the board doesn't use yet: ${unk.map(([k, v]) => `<b>${esc(k)}</b> (${esc(v.join(", "))})`).join("; ")}.</p>` : ""}
    ${M.notes.warn.length ? li(M.notes.warn.map(w => `<span class="impw">⚠ ${esc(w)}</span>`)) : ""}
    ${P.skipped.length ? `<p class="hint">Skipped: ${esc([...new Set(P.skipped)].join(", "))}.</p>` : ""}
    ${M.hdr.length ? `<h3>Day details (from the briefing strips)</h3>${li(M.hdr.map(([l, v, ok]) => `<b>${esc(l)}</b> ${esc(v)}${ok ? "" : ` <span class="hint">(not used: the box already has ops' entry)</span>`}`))}` : ""}
    ${M.gnd.length ? `<h3>Added to the ground programme</h3>${li(M.gnd.map(esc))}` : ""}
    <p class="hint">Saving replaces this day's flying program, simulator program and airfield restrictions, fills empty Day details boxes and adds new briefing bookings to the ground programme. What ops typed in Day details and the ground programme stays; notes and duties aren't touched.</p>
    <div class="row"><button class="btn" data-x="close">Cancel</button><button class="btn primary" data-x="save">Save to ${esc(opsLongDay(P.day).replace(/ \d{4}$/, ""))}</button></div></div>`;
  if (!d.open) d.showModal();
}
async function opsImportSave(btn) {
  const { P, M, ver } = IMP.res; btn.disabled = true;
  for (const sec of ["flying", "sim", "airfield", ...(M.hdr.some(h => h[2]) ? ["header"] : []), ...(M.gnd.length ? ["ground"] : [])]) {
    const { error } = await S.sb.rpc("ops_save", { p_day: P.day, p_section: sec, p_data: M[sec], p_version: ver[sec] || 0 });
    if (error) { btn.disabled = false; return ask("Not saved", `${OPS_TITLES[sec]}: ${errMsg(error)}${/someone else/i.test(error.message) ? " Import the file again to pick up their change." : ""}`, "OK"); }
  }
  document.getElementById("dlgImp").close();
  toast(`Imported into ${opsLongDay(P.day)}.`);
  OPS.edit = null; OPS.day = P.day; OPS.rowsDay = null; S.tab = "ops"; render();
}
document.head.insertAdjacentHTML("beforeend", `<style>
#dlgImp{width:min(900px,calc(100vw - 16px))}#impOff{width:auto;display:inline-block;margin:0 2px;padding:1px 4px;font-size:.85rem}#dlgImp h3{font-size:.95rem;margin:12px 0 4px}
.impsum{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 6px}.impsum div{border:1px solid var(--line);border-radius:6px;padding:4px 10px;background:var(--field);text-align:center}.impsum b{display:block;font:700 1.2rem var(--cond)}.impsum span{font-size:.75rem;color:var(--muted)}
.impl{margin:0;padding-left:18px;font-size:.88rem}.impl li{margin:1px 0}.impchg li span{color:var(--muted)}.impchg li.new b{color:var(--ok)}.impchg li.del b{color:var(--late)}.impchg li.chg b{color:var(--out)}
.impw{color:var(--late);font-size:.88rem;margin:6px 0}
</style>`);
