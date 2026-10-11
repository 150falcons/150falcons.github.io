/* Settings (Gordon, 11 Oct): every automatic rule and default in one place, so people can see how the board works out
   its numbers. Everyone signed in can view; only account admins can change the numbers. Saved as ops_state key
   'settings' (ops_state_save allows it for is_user_admin() only). cfg(key) = saved value, else the default below. */
const CFG_GROUPS = [
  { name: "Flying program times", rows: [
    ["fly.eta", "ETA = ETD +", "min", 60],
    ["fly.step", "Step = ETD −", "min", 60],
    ["fly.brief", "Brief = step −", "min", 45],
  ], rules: [
    "Key in the ETD first; ETA, step and brief fill in from it. Typing over one keeps your time (amber border); clearing it goes back to the worked-out time.",
    "Planned sorties and hours count every aircraft line that isn't an ops add, from ETD to ETA. First take-off, last landing and HH:MM come from the same times.",
    "Duties table cells (#, (#), SIMS, SXO, OPS O and ground events such as MTG, IN BRIEF, ACAD) fill in from the programme; editors only type extras.",
  ] },
  { name: "Duty In / Out (Duties table)", rows: [
    ["duty.fly", "Out after a flight lands +", "min", 120],
    ["duty.sim", "Out after a sim ends +", "min", 120],
    ["duty.sxo", "SXO: out after the wave's last landing +", "min", 0],
    ["duty.opso", "OPS O: out after the wave's last landing +", "min", 30],
  ], rules: [
    "In = the person's first brief, step, take-off, sim, ground event, or the start of a wave they are SXO / OPS O for.",
    "Out = the latest of the times above. A ground event ends at its end time (type it as a range, e.g. 0900-1000Z); a single time counts as its start.",
    "Typed In / Out times always win. Prev = yesterday's Out (typed, else worked out from yesterday's programme). Rest = In − Prev; Duty = Out − In.",
  ] },
  { name: "Cazaux canopy and APU", rows: [
    ["canopy.wind", "Canopy available: governing wind below", "kt", 50],
    ["canopy.comp", "…and headwind / tailwind and crosswind below", "kt", 35],
    ["apu.temp", "APU not available: temperature below", "°C", 1],
    ["apu.xw", "…or crosswind more than", "kt", 14.9],
    ["apu.h1", "APU (A11–15) crosswind measured against heading", "°", 280],
    ["apu.h2", "APU (A16–23) crosswind measured against heading", "°", 315],
  ], rules: [
    "Governing wind = the higher of the mean wind and the gust. Headwind / crosswind are its parts along and across the LFBC runway in use.",
    "Ops can tap Canopy or an APU to mark it Not available; Refresh METARs puts all three back to auto.",
  ] },
  { name: "Icing, sea and immersion suit", rows: [
    ["icing.t", "Icing YES: temperature below", "°C", 6],
    ["icing.rh", "…and humidity above", "%", 50],
    ["imm.no", "Immersion suit NO: sea surface at or above", "°C", 16],
    ["imm.sea", "Immersion suit YES: sea surface below", "°C", 15.5],
    ["imm.air", "…and air temperature below", "°C", 22],
    ["sea.y", "Sea surface shows yellow at or below", "°C", 15.5],
  ], rules: [
    "Humidity comes from the METAR temperature and dewpoint. Ops can set Icing YES / NO by hand; Refresh METARs puts it back to auto.",
    "Immersion suit: anything that isn't YES by the rule above is NO. It shows - until the sea surface is filled in.",
  ] },
  { name: "Colour states (FASF / RSAF on Auto)", rows: [
    ["rsaf.vis", "RSAF visibility for B / Y1 / Y2 / A1 / A2 (else R)", "km", "10, 8, 6, 3, 1", "list"],
    ["rsaf.base", "RSAF cloud base for B / Y1 / Y2 / A1 / A2 (else R)", "ft", "2500, 1500, 1000, 500, 300", "list"],
    ["fasf.vis", "FASF visibility for B / W / G IFR / Y / A (else R)", "km", "8, 5, 3, 1.6, 0.8", "list"],
    ["fasf.base", "FASF cloud base for B / W / G VFR / G IFR / Y / A (else R)", "ft", "2500, 1500, 1000, 700, 300, 200", "list"],
    ["bingo.upg", "Cazaux RSAF that gives UPG BINGO", "", "Y2", "text"],
    ["bingo.ifr", "Cazaux RSAF that gives IFR BINGO", "", "A1", "text"],
  ], rules: [
    "Each state is the worse of visibility and cloud base. Cloud base = lowest BKN / OVC / VV layer; TEMPO / BECMG are ignored; CAVOK = B. A typed WX / VIS override is read instead of the METAR.",
    "FASF is on Auto by default only for LFBZ, LFSL and LFBE. Refresh METARs sets every RSAF, those FASFs and bingo back to Auto and clears WX / VIS overrides.",
    "The LFBC CAT 1 line (auto) is green when the Cazaux FASF is B or W, otherwise yellow. LFBD on RWY 05 adds ZONE TAMPON ACTIVE.",
    "Other colours: parachute 0 green / more red; SAMAR by first letter (G / Y / R); wind hazard A yellow, B amber, C–D red; a filled restricted area red unless ops pick a colour; CALAMAR BOOKED yellow.",
  ] },
  { name: "Datalink and flight-line vehicles", rows: [
    ["dl.max", "Flag a datalink channel with more than", "aircraft at once", 4],
    ["veh.van", "VAN seats (aircrew)", "seats", 8],
    ["veh.zoe", "ZOE seats", "seats", 4],
    ["veh.zoeMax", "ZOE seats when squeezed (warning above this)", "seats", 5],
    ["veh.share", "Formations stepping within this of each other share a van run", "min", 5],
    ["veh.turn", "Van round trip (next run can leave after)", "min", 15],
    ["veh.zoeBack", "ZOE free again after the formation lands +", "min", 15],
  ], rules: [
    "Datalink channel (A, B, C or D) and vehicle are set per formation in the flying program editor. Several formations can share a channel; more aircraft than the limit above airborne together on one channel is flagged, never blocked.",
    "Vehicle on Auto: formations stepping close together share a van run while seats last. Each run is numbered per wave (VAN 1, VAN 2 …). If the van is still out on its last run, the formation gets the ZOE, which the crew drive themselves and park at the flight line until they land.",
    "If the ZOE is out too, the formation still gets the next van run, with a warning. Ops can pick VAN or ZOE by hand; warnings then show for full vans, a busy ZOE or too many people.",
  ] },
  { name: "Screens and home", rows: [
    ["tv.waves", "Flying program TV shows this many waves at a time", "waves", 3],
    ["home.amber", "Home \"Next up\" turns amber within", "min", 30],
  ], rules: [
    "The flying program TV starts at the first wave not yet finished; windows that hold more than fits pan slowly up and down (speed on the TV bar).",
    "Go / No-Go on the TV watches the wave under way and the next one to start; NO-GO people in those waves are listed first.",
    "Hours: both crew on a logged line get its minutes; night waves count as night.",
  ] },
  { name: "Fixed (ask Brut / an account admin to change)", rows: [], rules: [
    "Location: the board only opens inside metropolitan France (lat 41.3–51.15, lng −5.2 to 9.6), unless an account is ticked No location check.",
    "Nightly movement check to Telegram: 2140L Sun–Thu, 2340L Fri–Sat.",
    "Travel requests are approved by CO, DYCO, OC A or OC B. Cars need a driver who can drive and a VCOM, except trips to Cazaux.",
    "METARs are fetched every 15 min; the ops board only takes them when an ops editor taps Refresh METARs.",
  ] },
];
const CFG_DEF = {}; CFG_GROUPS.forEach(g => g.rows.forEach(r => { CFG_DEF[r[0]] = r[3]; }));
const cfgSaved = () => (typeof OB !== "undefined" && OB.state && OB.state.settings && OB.state.settings.data) || {};
function cfg(k) { const v = cfgSaved()[k]; return v === undefined || v === null || v === "" ? CFG_DEF[k] : v; }
const cfgN = k => { const n = parseFloat(cfg(k)); return isNaN(n) ? parseFloat(CFG_DEF[k]) : n; };
const cfgList = k => String(cfg(k)).split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
const cfgCanEdit = () => typeof isUserAdmin === "function" && isUserAdmin();
let CFG_EDIT = null; // working copy while an account admin edits

function renderSettings(v) {
  if (typeof OB === "undefined" || !OB.loaded) { v.innerHTML = `<div class="empty">Loading…</div>`; if (typeof obLoad === "function" && !OB.loading) obLoad(); return; }
  const can = cfgCanEdit(), ed = CFG_EDIT, saved = cfgSaved();
  const val = k => ed ? (ed[k] ?? "") : cfg(k);
  const body = CFG_GROUPS.map(g => `<section class="card opscard cfgcard"><div class="opshead"><h2>${esc(g.name)}</h2></div>
    ${g.rows.length ? `<table class="opst cfgt"><tbody>${g.rows.map(([k, label, unit, def, type]) => {
      const changed = saved[k] !== undefined && saved[k] !== "" && String(saved[k]) !== String(def);
      const box = ed ? `<input data-cfg="${k}" value="${esc(val(k))}" placeholder="${esc(def)}" ${type ? "" : `inputmode="decimal"`} style="width:${type === "list" ? "200px" : "90px"}">` : `<b>${esc(cfg(k))}</b>`;
      return `<tr><td>${esc(label)}</td><td class="cfgv">${box} <span class="hint">${esc(unit)}</span></td><td class="hint">${changed ? `default ${esc(def)}` : ""}</td></tr>`;
    }).join("")}</tbody></table>` : ""}
    ${g.rules.length ? `<ul class="cfgrules">${g.rules.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}</section>`).join("");
  const meta = typeof obMeta === "function" ? obMeta("settings") : "";
  v.innerHTML = `<div class="opsbar"><span class="hint">Every automatic rule the board uses. ${can ? "As an account admin you can change the numbers; blank = default." : "Only account admins can change these."}</span><span class="grow"></span>
    <span class="opsmeta">${esc(meta)}</span>${can ? (ed ? `<button class="btn small" data-cfgact="reset">All to defaults</button><button class="btn small" data-cfgact="cancel">Cancel</button><button class="btn small primary" data-cfgact="save">Save</button>` : `<button class="btn small primary" data-cfgact="edit">Edit settings</button>`) : ""}</div>
    <div class="cfggrid">${body}</div>
    ${ed ? `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn" data-cfgact="cancel">Cancel</button><button class="btn primary" data-cfgact="save">Save</button></div>` : ""}`;
}
document.addEventListener("input", e => { const k = e.target.dataset && e.target.dataset.cfg; if (k && CFG_EDIT) CFG_EDIT[k] = e.target.value.trim(); });
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-cfgact]"); if (!b) return;
  const a = b.dataset.cfgact;
  if (a === "edit") { CFG_EDIT = { ...cfgSaved() }; return render(); }
  if (a === "cancel") { CFG_EDIT = null; return render(); }
  if (a === "reset") { CFG_EDIT = {}; return render(); }
  if (a === "save") {
    const bad = [];
    for (const g of CFG_GROUPS) for (const [k, label, , , type] of g.rows) {
      const x = CFG_EDIT[k]; if (x === undefined || x === "") { delete CFG_EDIT[k]; continue; }
      if (!type && isNaN(parseFloat(x))) bad.push(label);
      if (type === "list" && String(x).split(/[,\s]+/).some(n => isNaN(Number(n)))) bad.push(label);
    }
    if (bad.length) return toast("Not a number: " + bad.join("; "));
    const r = OB.state.settings;
    b.disabled = true;
    const { data, error } = await S.sb.rpc("ops_state_save", { p_key: "settings", p_data: CFG_EDIT, p_version: r ? r.version : 0 });
    b.disabled = false;
    if (error) return toast(errMsg(error));
    OB.state.settings = { key: "settings", data: CFG_EDIT, version: data, updated_at: new Date().toISOString(), updated_by: S.me.id };
    CFG_EDIT = null; toast("Settings saved."); render();
  }
});
document.head.insertAdjacentHTML("beforeend", `<style>
.cfggrid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}@media (min-width:1100px){.cfggrid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
.cfgcard{min-width:0}table.cfgt{width:100%;min-width:0;table-layout:auto}.cfgt td{padding:6px 8px;vertical-align:middle;white-space:normal}.cfgt td.cfgv{white-space:nowrap;width:1%}.cfgt td.hint{width:1%;white-space:nowrap}
.cfgt input{padding:4px 8px;max-width:100%}@media (max-width:600px){.cfgt td{padding:5px 4px}.cfgt td.hint{display:none}}
.cfgrules{margin:8px 0 0;padding-left:18px;color:var(--muted);font-size:.9rem}.cfgrules li{margin:3px 0}
</style>`);
