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
  "EP sims: last EP sim + 90 days.",
  "ST Tow: FCF sims prof check and TOW qual prof check valid 12 months; FCF flight currency = last flown on type + 15 days.",
  "Trainee solo currency: last solo + 2 days (MOD 1–3), + 3 (MOD 4–6), + 4 (MOD 7+).",
  "Non-syllabus flying days (since last syllabus / DCO sortie): 8–13 optional flex, 14–30 flex, 31–59 2 × flex, 60+ flex package.",
  "Medical: blank = GO; anything typed (e.g. MC till 20 Oct) = NO GO.",
  "Last flown, night and FCF dates are the later of the typed date and the latest logged sortie (front seat for trainees, back seat for WSO trainees).",
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
  const o = {};
  for (const e of hrsEntries(OPS.hrs.days)) {
    const p = o[e.name] || (o[e.name] = {});
    p.any = cuMax(p.any, e.day);
    if (e.seat === "Front") p.front = cuMax(p.front, e.day); else p.back = cuMax(p.back, e.day);
    if (e.night) p.night = cuMax(p.night, e.day);
    if (/FCF/i.test(e.mission || "")) p.fcf = cuMax(p.fcf, e.day);
  }
  return o;
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
  for (const [k, r] of Object.entries(doc)) {
    if (r.grp && !names.has(opsNorm(k))) add(r.grp, k, { nologin: true });
    if (r.fic) add("FIC", k, {});
  }
  return out;
}
// One cell: date with its state. kind "exp" = valid until this date (red after), "expx" = first day out (red from), "info" = plain.
function curCell(date, kind, amber) {
  if (date === "NA") return { t: "NA", c: "na" };
  if (!date) return { t: "–", c: "na" };
  const today = todayStr(), left = cuDays(today, date);
  let c = "ok";
  if (kind === "exp" ? left < 0 : kind === "expx" ? left <= 0 : false) c = "bad";
  else if (kind !== "info" && left <= amber) c = "warn";
  return { t: cuFmt(date), c, left, date };
}
const curGo = ok => ({ t: ok ? "GO" : "NO GO", c: ok ? "ok" : "bad" });
function curFlex(days) {
  if (days == null) return { t: "–", c: "na" };
  return days > 59 ? { t: "FLEX package", c: "bad" } : days > 30 ? { t: "2 × FLEX", c: "bad" } : days > 13 ? { t: "FLEX", c: "warn" } : days > 7 ? { t: "Optional flex", c: "warn" } : { t: "NIL", c: "ok" };
}
// The columns of each group's table: [header, (person, flown) → cell, summary label for Expired / Expiring].
function curCols(grp) {
  const am = cfgN("cur.amber"), amD = cfgN("cur.amberDay"), today = todayStr();
  const med = { h: "Medical", f: x => curGo(!String(x.rec.med || "").trim()), lab: "MED" };
  const lastF = x => cuMax(x.rec.last, (x.fl || {}).any);
  const irt = { h: "IRT expires", f: x => curCell(x.rec.irt ? cuEom(x.rec.irt, 12) : "", "exp", am), lab: "IRT" };
  const days = d => d ? cuDays(d, today) : null;
  if (grp === "QFI") return [med, { h: "IRT rating", f: x => ({ t: x.rec.rating || "G", c: "na" }) }, { h: "Ops CAT", f: x => ({ t: x.rec.opsCat || "-", c: "na" }) }, { h: "QFI CAT", f: x => ({ t: (x.prof && x.prof.qfi_cat) || x.rec.qfiCat || "-", c: "na" }) },
    { h: "Last flown", f: x => curCell(lastF(x), "info") }, { h: "Day expires", f: x => curCell(lastF(x) ? cuAdd(lastF(x), 31) : "", "expx", amD), lab: "DAY CURR" }, irt,
    { h: "Night expires", f: x => x.rec.noNight ? { t: "NA", c: "na" } : curCell(cuMax(x.rec.night, (x.fl || {}).night) ? cuAdd(cuMax(x.rec.night, (x.fl || {}).night), 91) : "", "exp", am), lab: "NIGHT" },
    { h: "Day > Night", f: x => x.rec.noNight ? { t: "NA", c: "na" } : lastF(x) ? curGo(days(lastF(x)) <= 14) : { t: "–", c: "na" }, lab: "DAY>NIGHT" },
    { h: "EP sims", f: x => curCell(x.rec.ep ? cuAdd(x.rec.ep, 90) : "", "exp", am), lab: "EP SIMS" },
    { h: "IPC done", f: x => curCell(x.rec.ipc, "info") },
    { h: "IPC expires", f: x => { const cat = (x.prof && x.prof.qfi_cat) || x.rec.qfiCat, d = x.rec.ipc; if (!d) return { t: "–", c: "na" };
      return curCell(cat === "A" ? cuEom(d, 12) : cat === "B1" ? cuEom(d, 6) : cat === "B2" ? cuEom(d, 2) : cuEdate(d, 1), "exp", am); }, lab: "IPC" }];
  if (grp === "ST") return [med, { h: "Last flown", f: x => curCell(lastF(x), "info") }, { h: "Day expires", f: x => curCell(lastF(x) ? cuAdd(lastF(x), 31) : "", "expx", amD), lab: "DAY CURR" }, irt,
    { h: "FCF sims prof chk", f: x => curCell(x.rec.fcfSim ? cuEdate(x.rec.fcfSim, 12) : "", "exp", am), lab: "FCF SIMS" },
    { h: "TOW prof chk", f: x => curCell(x.rec.tow ? cuEdate(x.rec.tow, 12) : "", "exp", am), lab: "TOW CHK" },
    { h: "Last FCF flight", f: x => curCell(cuMax(x.rec.fcf, (x.fl || {}).fcf), "info") },
    { h: "FCF flight currency", f: x => curCell(lastF(x) ? cuAdd(lastF(x), 15) : "", "exp", Math.min(amD, 5)), lab: "FCF CURR" }];
  if (grp === "FIC") return [med, { h: "Last flown", f: x => curCell(cuMax((x.rec.fic || {}).last, (x.rec.fic || {}).lastBack, (x.fl || {}).any), "info") },
    { h: "Day expires", f: x => { const d = cuMax((x.rec.fic || {}).last, (x.fl || {}).front); return curCell(d ? cuAdd(d, 31) : "", "expx", amD); }, lab: "DAY CURR" },
    { h: "Non-syllabus days", f: x => { const d = days((x.rec.fic || {}).lastSyl); return d == null ? { t: "–", c: "na" } : { t: String(d), c: d > 7 ? "warn" : "ok" }; } }, irt];
  if (grp === "PGF") return [med, { h: "Last flown", f: x => curCell(lastF(x), "info") }, { h: "Day expires (7 days)", f: x => curCell(lastF(x) ? cuAdd(lastF(x), 7) : "", "expx", 2), lab: "DAY CURR" },
    { h: "Non-syllabus days", f: x => { const d = days(x.rec.lastSyl); return d == null ? { t: "–", c: "na" } : { t: String(d), c: "na" }; } }, irt,
    { h: "Days w/o IF app", f: x => { const d = days(x.rec.ifApp); return d == null ? { t: "–", c: "na" } : { t: String(d), c: "na" }; } }];
  if (grp === "TR") return [med, { h: "IRT rating", f: x => ({ t: x.rec.rating || "W", c: "na" }) }, { h: "MOD", f: x => ({ t: x.rec.mod || "-", c: "na" }) },
    { h: "Solo expires", f: x => { const m = Number(x.rec.mod) || 0, s = x.rec.solo; return s && m ? curCell(cuAdd(s, m >= 7 ? 4 : m >= 4 ? 3 : 2), "exp", 1) : { t: "–", c: "na" }; } },
    { h: "Last flown (front)", f: x => curCell(cuMax(x.rec.last, (x.fl || {}).front), "info") }, { h: "Last DCO sortie", f: x => curCell(x.rec.lastSyl, "info") },
    { h: "Non-syllabus days", f: x => { const d = days(x.rec.lastSyl); return d == null ? { t: "–", c: "na" } : { t: String(d), c: "na" }; } },
    { h: "Flex", f: x => curFlex(days(x.rec.lastSyl)), lab: "FLEX" }, irt,
    { h: "Days w/o IF app", f: x => { const d = days(x.rec.ifApp); return d == null ? { t: "–", c: "na" } : { t: String(d), c: "na" }; } }];
  if (grp === "WSO") return [med, { h: "MOD", f: x => ({ t: x.rec.mod || "-", c: "na" }) }, { h: "Last flown (back)", f: x => curCell(cuMax(x.rec.last, (x.fl || {}).back), "info") },
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
  const bar = `<div class="opsbar"><span class="seg"><button class="btn small${CUR.view === "board" ? " primary" : ""}" data-cur="view" data-k="board">Currency board</button><button class="btn small${CUR.view === "records" ? " primary" : ""}" data-cur="view" data-k="records">Records</button><button class="btn small${CUR.view === "rules" ? " primary" : ""}" data-cur="view" data-k="rules">How it's worked out</button></span><span class="grow"></span><span class="opsmeta">${esc(meta)}</span></div>`;
  const people = curPeople().map(x => ({ ...x, fl: flown[x.name] || {} }));
  if (CUR.view === "rules") { v.innerHTML = bar + `<section class="card opscard"><div class="opshead"><h2>How it's worked out</h2></div><ul class="cfgrules">${CUR_RULES.map(r => `<li>${esc(r)}</li>`).join("")}<li>${esc(`Amber = expiring within ${cfgN("cur.amber")} days (day currency: ${cfgN("cur.amberDay")} days; change under Operations → Settings). Red = expired or NO GO.`)}</li></ul></section>`; return; }
  if (CUR.view === "records") { v.innerHTML = bar + curRecords(people, can); return; }
  // Board: one card per group, then the Expired / Expiring summary at the top.
  const expired = {}, expiring = {};
  const cards = CUR_GROUPS.map(([g, title]) => {
    const ps = people.filter(x => x.grp === g); if (!ps.length) return "";
    const cols = curCols(g);
    const rows = ps.map(x => `<tr><td class="cuname"><b>${esc(x.name)}</b>${x.nologin ? ` <span class="hint" title="No login on the board with this name">no login</span>` : ""}${x.prof && x.prof.callsign ? ` <span class="hint">${esc(x.prof.callsign)}</span>` : ""}</td>${cols.map(c => {
      const r = c.f(x);
      if (c.lab && r.c === "bad") (expired[c.lab] ||= []).push(x.name); else if (c.lab && r.c === "warn") (expiring[c.lab] ||= []).push(x.name);
      return `<td class="cu ${r.c}"${r.left != null ? ` title="${r.left < 0 ? -r.left + " days ago" : r.left + " days left"}"` : ""}>${esc(r.t)}</td>`; }).join("")}</tr>`).join("");
    return `<section class="card opscard"><div class="opshead"><h2>${esc(title)}</h2><span class="opsmeta">${ps.length}</span></div><div class="tablewrap"><table class="opst cut"><thead><tr><th>Name</th>${cols.map(c => `<th>${esc(c.h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }).join("");
  const sum = (o, cls) => Object.keys(o).length ? Object.entries(o).map(([k, ns]) => `<div><b>${esc(k)}</b> – ${esc([...new Set(ns)].join(", "))}</div>`).join("") : `<div class="hint">Nil</div>`;
  v.innerHTML = bar + `<div class="cusum"><section class="card opscard"><div class="opshead"><h2>Items expired</h2></div><div class="cul bad">${sum(expired)}</div></section>
    <section class="card opscard"><div class="opshead"><h2>Items expiring</h2><span class="opsmeta">within ${cfgN("cur.amber")} days</span></div><div class="cul warn">${sum(expiring)}</div></section></div>${cards}
    <p class="hint">Last flown, night and FCF dates use the latest of what's typed under Records and the sorties logged in Log flown times. Hover a date to see days left.</p>`;
}
// Records: the dates behind the board, per group (like the Excel's DATA ENTRY). Editors type, everyone else views.
const CUR_FIELDS = {
  QFI: [["last", "Last flown", "d"], ["irt", "IRT achieved", "d"], ["night", "Last night sortie", "d"], ["noNight", "Not night qual", "c"], ["ipc", "Most recent IPC (FTI)", "d"], ["ep", "Last EP sim", "d"], ["rating", "IRT rating", "t"], ["opsCat", "Ops CAT", "t"], ["qfiCat", "QFI CAT (if no login)", "t"], ["med", "Medical (blank = GO)", "t"]],
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
      const v = curGet(r, k);
      if (!ed) return `<td>${t === "c" ? (v ? "✓" : "") : t === "d" ? esc(cuFmt(v)) : esc(v || "")}</td>`;
      const at = `data-cuf="${esc(x.name)}|${g}|${k}"`;
      return `<td>${t === "c" ? `<input type="checkbox" ${at} ${v ? "checked" : ""} style="width:auto">` : t === "d" ? `<input type="date" ${at} value="${esc(v || "")}">` : `<input ${at} value="${esc(v || "")}" style="width:${k === "med" ? "150px" : "60px"}">`}</td>`; }).join("")}</tr>`; }).join("");
    return `<section class="card opscard"><div class="opshead"><h2>${esc(title)}</h2></div><div class="tablewrap"><table class="opst cut cuedit"><thead><tr><th>Name</th>${fs.map(f => `<th>${esc(f[1])}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }).join("");
  const btns = can ? (ed ? `<button class="btn small" data-cur="cancel">Cancel</button><button class="btn small primary" data-cur="save">Save</button>` : `<button class="btn small primary" data-cur="edit">Edit records</button>`) : "";
  return `<div class="opsbar"><span class="hint">${can ? "Key in the date each item was achieved; the board works out the expiry." : "Only currency editors can change these (Admin → Edit → Can edit currencies)."}</span><span class="grow"></span>${btns}</div>${cards}
    ${ed ? `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn" data-cur="cancel">Cancel</button><button class="btn primary" data-cur="save">Save</button></div>` : ""}`;
}
document.addEventListener("input", e => {
  const k = e.target.dataset && e.target.dataset.cuf; if (!k || !CUR.edit) return;
  const [name, grp, field] = k.split("|"), r = CUR.edit[name] || (CUR.edit[name] = { grp }), val = e.target.type === "checkbox" ? e.target.checked : e.target.value.trim();
  const path = field.split("."); let o = r; for (const p of path.slice(0, -1)) o = o[p] || (o[p] = {});
  if (val === "" || val === false) delete o[path[path.length - 1]]; else o[path[path.length - 1]] = val;
});
document.addEventListener("change", e => { if (e.target.dataset && e.target.dataset.cuf && e.target.type === "checkbox") e.target.dispatchEvent(new Event("input", { bubbles: true })); });
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-cur]"); if (!b) return;
  const a = b.dataset.cur;
  if (a === "view") { CUR.view = b.dataset.k; return render(); }
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
.cut td.cu.ok{color:var(--ok,#1F8A4C)}.cut td.cu.warn{background:color-mix(in srgb,var(--out) 22%,transparent);font-weight:600}.cut td.cu.bad{background:color-mix(in srgb,var(--late) 25%,transparent);color:var(--late);font-weight:700}.cut td.cu.na{color:var(--muted)}
.cuedit input{padding:3px 6px;margin:0}.cuedit input[type=date]{width:140px}
.seg .btn+.btn{margin-left:4px}
</style>`);
