/* World Cup 2026 — calendar, my teams, planner. Vanilla JS, no build step. */
(function () {
  "use strict";

  const LS_KEY = "wc2026.favorites";
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const STAGE_ABBR = {
    "Round of 32": "R32", "Round of 16": "R16", "Quarter-final": "QF",
    "Semi-final": "SF", "Third-place": "3rd", "Final": "F"
  };
  // timezone → a World Cup nation, for the "based on your location" default chip
  const TZ_TEAM = {
    "America/New_York":"United States","America/Detroit":"United States","America/Chicago":"United States",
    "America/Denver":"United States","America/Phoenix":"United States","America/Los_Angeles":"United States",
    "America/Anchorage":"United States","Pacific/Honolulu":"United States",
    "America/Toronto":"Canada","America/Vancouver":"Canada","America/Edmonton":"Canada","America/Winnipeg":"Canada","America/Halifax":"Canada",
    "America/Mexico_City":"Mexico","America/Monterrey":"Mexico","America/Tijuana":"Mexico","America/Merida":"Mexico",
    "America/Sao_Paulo":"Brazil","America/Bahia":"Brazil","America/Fortaleza":"Brazil",
    "America/Argentina/Buenos_Aires":"Argentina","America/Bogota":"Colombia","America/Guayaquil":"Ecuador",
    "America/Montevideo":"Uruguay","America/Asuncion":"Paraguay","America/Panama":"Panama","America/Port-au-Prince":"Haiti",
    "Europe/London":"England","Europe/Madrid":"Spain","Europe/Paris":"France","Europe/Berlin":"Germany",
    "Europe/Amsterdam":"Netherlands","Europe/Brussels":"Belgium","Europe/Lisbon":"Portugal","Europe/Zurich":"Switzerland",
    "Europe/Vienna":"Austria","Europe/Stockholm":"Sweden","Europe/Oslo":"Norway","Europe/Prague":"Czechia",
    "Europe/Zagreb":"Croatia","Europe/Sarajevo":"Bosnia and Herzegovina","Europe/Istanbul":"Türkiye",
    "Africa/Casablanca":"Morocco","Africa/Tunis":"Tunisia","Africa/Algiers":"Algeria","Africa/Cairo":"Egypt",
    "Africa/Abidjan":"Ivory Coast","Africa/Accra":"Ghana","Africa/Dakar":"Senegal","Africa/Johannesburg":"South Africa",
    "Africa/Kinshasa":"DR Congo","Atlantic/Cape_Verde":"Cape Verde",
    "Asia/Tokyo":"Japan","Asia/Seoul":"South Korea","Asia/Tehran":"Iran","Asia/Qatar":"Qatar",
    "Asia/Riyadh":"Saudi Arabia","Asia/Baghdad":"Iraq","Asia/Amman":"Jordan","Asia/Tashkent":"Uzbekistan",
    "Australia/Sydney":"Australia","Australia/Melbourne":"Australia","Australia/Perth":"Australia","Pacific/Auckland":"New Zealand"
  };

  // ---- state ----
  let favorites = loadFavorites();
  let currentView = "calendar";
  let plannerSel = { start: null, end: null };
  const ui = { showElo: false, onlyFav: false, showBangers: true, search: "" };

  // ======================================================================
  // LIVE SCORES — baked scores.json + ESPN live poll (CORS-open public API).
  // Match logic mirrors scores-espn.mjs (the Node baker); keep them in sync.
  // ======================================================================
  const SCORE_ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world";
  const scores = {};            // matchNumber -> { homeScore, awayScore, state, statusText, minute }
  const liveLoading = new Set(); // matchNumbers believed live but not yet fetched
  const SCORE_ALIASES = { "ivory coast": "cote ivoire ivory coast", "cote d’ivoire": "cote ivoire ivory coast" };
  function scoreTokens(name) {
    const n = (name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return new Set((SCORE_ALIASES[n] || n).split(/[^a-z]+/).filter(t => t.length >= 4));
  }
  function scoreOverlap(a, b) { const ta = scoreTokens(a), tb = scoreTokens(b); let n = 0; for (const t of ta) if (tb.has(t)) n++; return n; }
  function espnEventToScore(e) {
    const c = (e.competitions || [])[0] || {}, comp = c.competitors || [];
    const h = comp.find(x => x.homeAway === "home") || {}, a = comp.find(x => x.homeAway === "away") || {};
    const st = e.status || c.status || {};
    return {
      utc: e.date,
      home: (h.team || {}).displayName || "", away: (a.team || {}).displayName || "",
      homeScore: h.score != null && h.score !== "" ? Number(h.score) : null,
      awayScore: a.score != null && a.score !== "" ? Number(a.score) : null,
      state: (st.type || {}).state || "pre",
      statusText: (st.type || {}).shortDetail || (st.type || {}).description || "",
      minute: st.displayClock || "",
    };
  }
  function indexEspnScores(events) {
    const byInstant = new Map();
    WC.matches.forEach(m => { const t = new Date(m.utc).getTime(); if (!byInstant.has(t)) byInstant.set(t, []); byInstant.get(t).push(m); });
    const out = {};
    for (const e of events) {
      const sc = espnEventToScore(e);
      if (sc.state === "pre") continue;
      const cands = byInstant.get(new Date(e.date).getTime()) || [];
      let best = null, bestScore = -1;
      for (const m of cands) { const s = scoreOverlap(m.home, sc.home) + scoreOverlap(m.away, sc.away); if (s > bestScore) { bestScore = s; best = m; } }
      if (best) out[best.matchNumber] = sc;
    }
    return out;
  }
  // markup: live score (pulsing) / final score / loading shimmer / null
  function scoreHTML(m) {
    const s = scores[m.matchNumber];
    if (s && s.homeScore != null && (s.state === "in" || s.state === "post")) {
      const live = s.state === "in";
      const tail = live
        ? `<span class="sc-dot"></span>${s.minute ? `<span class="sc-min">${s.minute}</span>` : ""}`
        : `<span class="sc-ft">FT</span>`;
      return `<span class="mscore${live ? " live" : ""}">${s.homeScore}<span class="sc-dash">–</span>${s.awayScore}${tail}</span>`;
    }
    if (liveLoading.has(m.matchNumber)) return `<span class="mscore loading"><span class="sc-dot"></span><span class="sc-load">···</span></span>`;
    return null;
  }
  const nyDate = d => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d).replace(/-/g, "");
  let liveTimer = null;
  async function pollScores() {
    const days = [...new Set([nyDate(new Date(Date.now() - 864e5)), nyDate(new Date())])];
    for (const d of days) {
      try {
        const sb = await (await fetch(`${SCORE_ESPN}/scoreboard?dates=${d}`)).json();
        const idx = indexEspnScores(sb.events || []);
        for (const mn in idx) { scores[mn] = idx[mn]; liveLoading.delete(+mn); }
      } catch (e) { /* offline / rate-limited: keep what we have */ }
    }
    // drop loading flags for matches that are well past with no data
    const now = Date.now();
    WC.matches.forEach(m => { if (liveLoading.has(m.matchNumber) && now > new Date(m.utc).getTime() + 3.5 * 3600e3 && !scores[m.matchNumber]) liveLoading.delete(m.matchNumber); });
    rerenderAll();
    const anyLive = Object.values(scores).some(s => s.state === "in") || liveLoading.size > 0;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(pollScores, anyLive ? 60000 : 300000);
  }
  async function initScores() {
    try { const j = await (await fetch("scores.json")).json(); Object.assign(scores, j.scores || {}); } catch (e) { /* no bake yet */ }
    const now = Date.now();
    WC.matches.forEach(m => {
      const k = new Date(m.utc).getTime(), s = scores[m.matchNumber];
      if (now >= k && now <= k + 2.75 * 3600e3 && (!s || s.state !== "post")) liveLoading.add(m.matchNumber);
    });
    rerenderAll();
    pollScores();
  }

  // ---- helpers ----
  function loadFavorites() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function saveFavorites() { localStorage.setItem(LS_KEY, JSON.stringify([...favorites])); }
  function isKnown(name) { return !!WC.teamByName[name]; }
  function flag(iso, cls) {
    return `<img class="${cls}" loading="lazy" src="https://flagcdn.com/w40/${iso}.png" srcset="https://flagcdn.com/w80/${iso}.png 2x" alt="">`;
  }
  function teamFlag(name, cls) { const t = WC.teamByName[name]; return t ? flag(t.iso2, cls) : ""; }
  function isFavMatch(m) { return favorites.has(m.home) || favorites.has(m.away); }
  function parseDate(s) { const [y, mo, d] = s.split("-").map(Number); return new Date(y, mo - 1, d); }

  function bangerInfo(m) {
    if (!isKnown(m.home) || !isKnown(m.away)) return null;
    const a = WC.elo[m.home], b = WC.elo[m.away];
    if (a == null || b == null) return null;
    const avg = (a + b) / 2, gap = Math.abs(a - b);
    const score = avg - gap * 0.25;
    return { a, b, avg, gap, score, banger: a >= 1700 && b >= 1700 && score >= 1860 };
  }
  function isBanger(m) { const i = bangerInfo(m); return !!(i && i.banger); }

  // ---- projections / split-flag icon family ----
  function iso(name) { const t = WC.teamByName[name]; return t ? t.iso2 : ""; }
  function shortLabel(str) {
    return str
      .replace("Runner-up Group ", "Runner-up ")
      .replace("Winner Group ", "Winner ")
      .replace("Third-place qualifier", "3rd-place")
      .replace("Winner Match ", "Winner M")
      .replace("Loser Match ", "Loser M");
  }
  function projDist(matchNumber, side) {
    return (WC.proj && WC.proj[matchNumber]) ? WC.proj[matchNumber][side] : null;
  }
  function groupOf(team) {
    const m = WC.matches.find(x => x.stage === "Group" && (x.home === team || x.away === team));
    return m ? m.group : null;
  }
  // Single flag ONLY for a genuine favourite (#1 ≥ 60%). Otherwise show the leaders
  // that cover the bulk of outcomes (cumulative ≥ 60%), and keep extending while the
  // next contender stays within 70% of the one above (a tight pack). Clamped 2–4.
  function pickIcon(dist) {
    const p = i => (dist[i] ? dist[i].p : 0);
    if (p(0) >= 0.60) return { n: 1, style: "single", teams: dist.slice(0, 1) };
    let n = 2;
    while (n < 4 && p(n) > 0) {
      let cum = 0; for (let i = 0; i < n; i++) cum += p(i);
      if (cum < 0.60 || p(n) >= 0.7 * p(n - 1)) n++;
      else break;
    }
    const style = n === 2 ? ((p(0) - p(1) <= 0.06) ? "even2" : "b2") : n === 3 ? "b3" : "g4";
    return { n, style, teams: dist.slice(0, n) };
  }
  function projIconHTML(dist, cap) {
    if (!dist || !dist.length) return "";
    let { n, style, teams } = pickIcon(dist);
    if (cap && n > cap) { // compact contexts (dense month grid): cap the flag count
      n = cap; teams = dist.slice(0, cap);
      style = n === 1 ? "single" : n === 2 ? ((teams[0].p - teams[1].p <= 0.06) ? "even2" : "b2") : n === 3 ? "b3" : "g4";
    }
    const im = (t, c) => `<img class="${c || ""}" loading="lazy" src="https://flagcdn.com/w80/${iso(t.team)}.png" alt="">`;
    if (style === "single") return `<span class="pic single">${im(teams[0])}</span>`;
    if (style === "even2") return `<span class="pic even2">${im(teams[0])}${im(teams[1])}</span>`;
    if (style === "b2") return `<span class="pic b2">${im(teams[0], "f1")}${im(teams[1], "f2")}</span>`;
    if (style === "b3") return `<span class="pic b3">${im(teams[0], "f1")}${im(teams[1], "f2")}${im(teams[2], "f3")}</span>`;
    return `<span class="pic g4">${teams.slice(0, 4).map(t => im(t)).join("")}</span>`;
  }

  const TOP10 = [...WC.teams].filter(t => WC.elo[t.name])
    .sort((a, b) => WC.elo[b.name] - WC.elo[a.name]).slice(0, 10).map(t => t.name);
  function locationTeam() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const name = TZ_TEAM[tz];
      return name && WC.teamByName[name] ? name : "United States";
    } catch (e) { return "United States"; }
  }

  // ---- kickoff times ----
  // data.js stores venue-local date/time plus the verified UTC instant (`utc`);
  // display everything in the viewer's timezone straight from that instant.
  const fmtKickoff = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  WC.matches.forEach(m => {
    if (!m.utc) return;
    const dt = new Date(m.utc);
    m.venueDate = m.date; m.venueTime = m.time;
    m.date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    m.time = fmtKickoff.format(dt);
    m.mins = dt.getHours() * 60 + dt.getMinutes(); // sort key — AM/PM strings don't sort lexically
  });

  // matches grouped by date (used everywhere)
  const byDate = {};
  WC.matches.forEach(m => { (byDate[m.date] = byDate[m.date] || []).push(m); });
  Object.values(byDate).forEach(arr => arr.sort((a, b) => (a.mins ?? 1e9) - (b.mins ?? 1e9)));
  const allDates = WC.matches.map(m => parseDate(m.date));
  const minD = new Date(Math.min(...allDates)), maxD = new Date(Math.max(...allDates));

  // ======================================================================
  // NAV / ROUTER
  // ======================================================================
  // single scrolling page: tabs jump to a section; active tab follows scroll
  function setActiveNav(v) {
    currentView = v;
    document.querySelectorAll(".nav-link").forEach(a => a.classList.toggle("active", a.dataset.view === v));
  }
  function scrollToView(v) {
    const el = document.getElementById("view-" + v);
    if (!el) return;
    setActiveNav(v);
    if (location.hash !== "#" + v) history.replaceState(null, "", "#" + v);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  document.getElementById("main-nav").addEventListener("click", e => {
    const b = e.target.closest(".nav-link"); if (b) scrollToView(b.dataset.view);
  });

  function setupScrollSpy() {
    const ids = ["calendar", "my-teams", "planner", "projections"];
    const obs = new IntersectionObserver(entries => {
      const vis = entries.filter(en => en.isIntersecting);
      if (!vis.length) return;
      vis.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const id = vis[0].target.id.replace("view-", "");
      setActiveNav(id);
      if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    ids.forEach(id => obs.observe(document.getElementById("view-" + id)));
  }

  // ======================================================================
  // TEAM PICKER
  // ======================================================================
  const suggestedRow = document.getElementById("suggested-row");
  const searchResults = document.getElementById("search-results");
  const pickerHint = document.getElementById("picker-hint");

  function chipHTML(t, isLoc) {
    const sel = favorites.has(t.name);
    const elo = ui.showElo && WC.elo[t.name] ? `<span class="elo">${WC.elo[t.name]}</span>` : "";
    const pin = isLoc ? `<span class="loc-pin" title="Based on your location">📍</span>` : "";
    return `<button type="button" class="chip ${sel ? "selected" : ""}" data-team="${t.name}">${pin}${flag(t.iso2, "")}<span>${t.name}</span>${elo}</button>`;
  }

  function renderPicker() {
    const q = ui.search.trim().toLowerCase();
    if (q) {
      suggestedRow.classList.add("hidden");
      searchResults.classList.remove("hidden");
      const hits = WC.teams.filter(t => t.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
      searchResults.innerHTML = hits.length
        ? hits.map(t => chipHTML(t, false)).join("")
        : `<p class="hint">No country matches “${ui.search}”.</p>`;
    } else {
      searchResults.classList.add("hidden");
      suggestedRow.classList.remove("hidden");
      const loc = locationTeam();
      // stable order: location + top 10 stay put; followed-but-not-listed append at the end.
      const order = [loc, ...TOP10, ...favorites];
      const seen = new Set(), list = [];
      order.forEach(n => { if (!seen.has(n) && WC.teamByName[n]) { seen.add(n); list.push(n); } });
      suggestedRow.innerHTML = list.map(n => chipHTML(WC.teamByName[n], n === loc && !favorites.has(n))).join("")
        + `<button type="button" class="chip chip-more" data-action="more">🔍 <span>Search all 48…</span></button>`;
    }
    const n = favorites.size;
    pickerHint.textContent = n
      ? `${n} team${n > 1 ? "s" : ""} followed — saved on this device, highlighted across the calendar.`
      : "Tap your teams below.";
    renderPickerPreview();
  }

  // ---- collapsible picker (Done / one-line preview / Edit) ----
  const PICKER_KEY = "wc2026.pickerCollapsed";
  const pickerPanel = document.getElementById("picker-panel");
  function renderPickerPreview() {
    const fav = [...favorites];
    const flags = fav.slice(0, 10).map(name => teamFlag(name, "pp-flag")).join("");
    const txt = fav.length
      ? `<span class="pp-label">Following</span>${flags}<span class="pp-count">${fav.length} team${fav.length > 1 ? "s" : ""}</span>`
      : `<span class="pp-label">No teams followed yet</span>`;
    document.getElementById("pp-text").innerHTML = txt;
  }
  function setPickerCollapsed(c) {
    pickerPanel.classList.toggle("collapsed", c);
    localStorage.setItem(PICKER_KEY, c ? "1" : "0");
  }
  document.getElementById("picker-done").addEventListener("click", () => setPickerCollapsed(true));
  document.getElementById("picker-edit").addEventListener("click", () => {
    setPickerCollapsed(false); document.getElementById("team-search").focus();
  });

  function rerenderAll() { renderCalendar(); renderUpcomingBangers(); renderMyMatches(); renderPlanner(); }

  function toggleTeam(name) {
    if (favorites.has(name)) favorites.delete(name); else favorites.add(name);
    saveFavorites();
    renderPicker();
    rerenderAll();
  }

  document.getElementById("picker-panel").addEventListener("click", e => {
    const btn = e.target.closest(".chip"); if (!btn) return;
    if (btn.dataset.action === "more") { document.getElementById("team-search").focus(); return; }
    toggleTeam(btn.dataset.team);
  });
  document.getElementById("team-search").addEventListener("input", e => { ui.search = e.target.value; renderPicker(); });
  document.getElementById("toggle-elo").addEventListener("change", e => { ui.showElo = e.target.checked; renderPicker(); });
  document.getElementById("clear-fav").addEventListener("click", () => {
    favorites.clear(); saveFavorites(); renderPicker(); rerenderAll();
  });

  // ======================================================================
  // INTRO CARD (dismissible, remembered on this device)
  // ======================================================================
  const INTRO_KEY = "wc2026.introDismissed";
  const introCard = document.getElementById("intro-card");
  if (localStorage.getItem(INTRO_KEY) !== "1") introCard.hidden = false;
  document.getElementById("intro-close").addEventListener("click", () => {
    introCard.hidden = true;
    localStorage.setItem(INTRO_KEY, "1");
  });

  // ======================================================================
  // CALENDAR (grid on desktop, agenda on mobile)
  // ======================================================================
  function matchPill(m) {
    const fav = isFavMatch(m), banger = ui.showBangers && isBanger(m), dim = ui.onlyFav && !fav;
    const abbr = STAGE_ABBR[m.stage] || "";
    const side = (name, which) => isKnown(name) ? teamFlag(name, "flag")
      : (projIconHTML(projDist(m.matchNumber, which), 2) || `<span class="ko-badge" title="${name}">${abbr}</span>`);
    const cls = ["match", fav ? "fav" : "", banger ? "banger" : "", dim ? "dimmed" : ""].filter(Boolean).join(" ");
    const flame = banger ? `<span class="flame" title="Banger matchup">🔥</span>` : "";
    const sc = scoreHTML(m);
    const meta = sc || (m.time ? `<span class="mtime">${m.time}</span>` : "");
    return `<div class="${cls}" data-match="${m.matchNumber}">${side(m.home, "home")}<span class="vs">v</span>${side(m.away, "away")}${meta}${flame}</div>`;
  }

  function renderMonth(year, month) {
    const first = new Date(year, month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = "2026-06-06";
    let cells = "";
    for (let i = 0; i < startPad; i++) cells += `<div class="day empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const all = byDate[ds] || [];
      const hasFav = all.some(isFavMatch);
      const matches = ui.onlyFav ? all.filter(isFavMatch) : all;
      const favDot = hasFav ? `<span class="dot-fav">★</span>` : "";
      const cls = ["day", hasFav ? "has-fav" : "", ds === todayStr ? "today" : ""].filter(Boolean).join(" ");
      cells += `<div class="${cls}"><div class="day-num"><span>${d}</span>${favDot}</div>${matches.map(matchPill).join("")}</div>`;
    }
    return `<div class="month"><h3 class="month-title">${MONTHS[month]} ${year}</h3>
      <div class="weekdays">${WEEKDAYS.map(w => `<span>${w}</span>`).join("")}</div>
      <div class="grid">${cells}</div></div>`;
  }

  function agendaRow(m) {
    const fav = isFavMatch(m), banger = ui.showBangers && isBanger(m), dim = ui.onlyFav && !fav;
    const abbr = STAGE_ABBR[m.stage] || "";
    const stageStr = m.stage === "Group" ? `Group ${m.group}` : m.stage;
    const side = (name, which) => {
      const known = isKnown(name);
      const f = known ? teamFlag(name, "flag")
        : (projIconHTML(projDist(m.matchNumber, which)) || `<span class="ko-badge" title="${name}">${abbr}</span>`);
      return `<span class="ar-team">${f}<span class="ar-name">${known ? name : shortLabel(name)}</span></span>`;
    };
    const cls = ["agenda-match", fav ? "fav" : "", banger ? "banger" : "", dim ? "dimmed" : ""].filter(Boolean).join(" ");
    const flame = banger ? `<span class="flame" title="Banger matchup">🔥</span>` : "";
    const sc = scoreHTML(m);
    const metaLead = sc ? `${sc} · ` : (m.time ? m.time + " · " : "");
    return `<div class="${cls}" data-match="${m.matchNumber}">
      <div class="ar-teams">${side(m.home, "home")}<span class="vs">v</span>${side(m.away, "away")}${flame}</div>
      <div class="ar-meta">${metaLead}${stageStr} · ${m.venue}, ${m.city}</div></div>`;
  }

  function renderAgenda() {
    const dates = Object.keys(byDate).sort();
    let html = "", curMonth = "";
    dates.forEach(ds => {
      const dt = parseDate(ds);
      const monthKey = `${dt.getFullYear()}-${dt.getMonth()}`;
      const all = byDate[ds];
      const matches = ui.onlyFav ? all.filter(isFavMatch) : all;
      if (!matches.length) return;
      if (monthKey !== curMonth) { curMonth = monthKey; html += `<h3 class="month-title">${MONTHS[dt.getMonth()]} ${dt.getFullYear()}</h3>`; }
      const hasFav = matches.some(isFavMatch);
      html += `<div class="agenda-day ${hasFav ? "has-fav" : ""}">
        <div class="agenda-date"><span class="ad-wd">${WEEKDAYS[dt.getDay()]}</span><span class="ad-num">${dt.getDate()}</span></div>
        <div class="agenda-matches">${matches.map(agendaRow).join("")}</div></div>`;
    });
    return html;
  }

  const mobileMQ = window.matchMedia("(max-width: 640px)");
  function renderCalendar() {
    const el = document.getElementById("calendar");
    el.classList.toggle("agenda-view", mobileMQ.matches);
    if (mobileMQ.matches) { el.innerHTML = renderAgenda(); return; }
    let html = "", y = minD.getFullYear(), m = minD.getMonth();
    const endY = maxD.getFullYear(), endM = maxD.getMonth();
    while (y < endY || (y === endY && m <= endM)) { html += renderMonth(y, m); m++; if (m > 11) { m = 0; y++; } }
    el.innerHTML = html;
  }
  mobileMQ.addEventListener("change", renderCalendar);

  // ======================================================================
  // UPCOMING BANGERS (compact strip on the Calendar view)
  // ======================================================================
  const TODAY = "2026-06-06";
  function renderUpcomingBangers() {
    const el = document.getElementById("upcoming-bangers");
    const row = document.getElementById("upcoming-row");
    const we = parseDate(TODAY); we.setDate(we.getDate() + 10);
    const windowEnd = `${we.getFullYear()}-${String(we.getMonth() + 1).padStart(2, "0")}-${String(we.getDate()).padStart(2, "0")}`;
    const all = WC.matches.filter(m => isBanger(m) && m.date >= TODAY)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.mins ?? 1e9) - (b.mins ?? 1e9));
    const win = all.filter(m => m.date <= windowEnd);
    const show = (win.length >= 4 ? win : all.slice(0, 8)).slice(0, 12);
    if (!show.length) { el.hidden = true; return; }
    el.hidden = false;
    row.innerHTML = show.map(m => {
      const dt = parseDate(m.date);
      const dateStr = `${WEEKDAYS[dt.getDay()]} ${MONTHS[dt.getMonth()].slice(0, 3)} ${dt.getDate()}`;
      return `<div class="ub-card ${isFavMatch(m) ? "fav" : ""}" data-match="${m.matchNumber}">
        <div class="ub-date">${dateStr}${m.time ? " · " + m.time : ""}</div>
        <div class="ub-teams">${teamFlag(m.home, "")}<span>${m.home}</span><span class="vs">v</span>${teamFlag(m.away, "")}<span>${m.away}</span></div>
        <div class="ub-meta">${m.stage === "Group" ? "Group " + m.group : m.stage} · ${m.city}</div>
      </div>`;
    }).join("");
  }

  // ======================================================================
  // MY TEAMS
  // ======================================================================
  function renderMyMatches() {
    const el = document.getElementById("my-matches");
    if (favorites.size === 0) {
      el.innerHTML = `<div class="empty-state">
        <div class="es-emoji">⚽</div>
        <h3>No teams followed yet</h3>
        <p>Follow a few nations and every one of their fixtures shows up here, in date order — so you always know when they're next on.</p>
        <button class="cta-btn" id="es-pick">Pick your teams →</button>
      </div>`;
      const b = document.getElementById("es-pick");
      if (b) b.addEventListener("click", () => { scrollToView("calendar"); document.getElementById("team-search").focus(); });
      return;
    }
    const favTeams = [...favorites].sort((a, b) => a.localeCompare(b));
    el.innerHTML = favTeams.map(team => {
      const games = WC.matches.filter(m => m.home === team || m.away === team)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.mins ?? 1e9) - (b.mins ?? 1e9));
      const t = WC.teamByName[team];
      const rows = games.map(m => {
        const oppName = m.home === team ? m.away : m.home;
        const oppHtml = isKnown(oppName) ? `${teamFlag(oppName, "")}<span>${oppName}</span>` : `<span>${oppName}</span>`;
        const dt = parseDate(m.date);
        const dateStr = `${WEEKDAYS[dt.getDay()]} ${MONTHS[dt.getMonth()].slice(0, 3)} ${dt.getDate()}`;
        const stageStr = m.stage === "Group" ? `Group ${m.group}` : m.stage;
        const flame = (ui.showBangers && isBanger(m)) ? ` <span class="mm-flame" title="Banger">🔥</span>` : "";
        const sc = scoreHTML(m);
        return `<div class="mm-row"><span class="mm-date">${dateStr}</span>
          <span class="mm-opp">vs ${oppHtml}${flame}</span>
          <span class="mm-meta">${sc ? sc + " · " : (m.time ? m.time + " · " : "")}${stageStr} · ${m.city}</span></div>`;
      }).join("");
      return `<div class="mm-group">
        <div class="mm-team-head">${flag(t.iso2, "")} ${team}
          <span style="color:var(--muted);font-weight:400;font-size:12px;">(${games.length} guaranteed group games)</span></div>
        ${rows}</div>`;
    }).join("");
  }

  // ======================================================================
  // PLANNER
  // ======================================================================
  function plannerRange() {
    if (!plannerSel.start) return null;
    const s = plannerSel.start, e = plannerSel.end || plannerSel.start;
    return s <= e ? [s, e] : [e, s];
  }
  function plannerPick(ds) {
    if (!plannerSel.start || plannerSel.end) plannerSel = { start: ds, end: null };
    else plannerSel.end = ds;
    renderPlanner();
    // on phones the queue starts below the fold — nudge it into view on selection
    if (window.matchMedia("(max-width: 640px)").matches) {
      const s = document.getElementById("planner-summary");
      if (s && s.firstElementChild) s.firstElementChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  let plannerPage = 0; // which month page the mobile pager is on (0 = June, 1 = July)
  function syncPlannerSeg() {
    document.querySelectorAll(".pseg-btn").forEach(b =>
      b.classList.toggle("active", Number(b.dataset.page) === plannerPage));
  }
  function plannerGoTo(page) {
    plannerPage = page;
    syncPlannerSeg();
    const t = document.querySelector("#planner-cal .pmonths");
    if (t) t.scrollTo({ left: page * t.clientWidth, behavior: "smooth" });
  }

  function plannerMonth(year, month) {
    const first = new Date(year, month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const range = plannerRange();
    let cells = "";
    for (let i = 0; i < startPad; i++) cells += `<div class="pd empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const has = !!byDate[ds];
      const inRange = range && ds >= range[0] && ds <= range[1];
      const isEnd = ds === plannerSel.start || ds === plannerSel.end;
      const cls = ["pd", has ? "" : "nomatch", inRange ? "in-range" : "", isEnd ? "sel-end" : ""].filter(Boolean).join(" ");
      cells += `<button class="${cls}" data-date="${ds}" ${has ? "" : "disabled"}>${d}${has ? `<span class="pd-dot"></span>` : ""}</button>`;
    }
    return `<div class="pmonth"><div class="pmonth-title">${MONTHS[month]} ${year}</div>
      <div class="pweekdays">${WEEKDAYS.map(w => `<span>${w[0]}</span>`).join("")}</div>
      <div class="pgrid">${cells}</div></div>`;
  }

  function plannerRow(m, idx) {
    const fav = isFavMatch(m), banger = isBanger(m), abbr = STAGE_ABBR[m.stage] || "";
    const stageStr = m.stage === "Group" ? `Group ${m.group}` : m.stage;
    const dt = parseDate(m.date);
    const dateStr = `${WEEKDAYS[dt.getDay()]} ${MONTHS[dt.getMonth()].slice(0, 3)} ${dt.getDate()}`;
    const side = (name, which) => {
      const known = isKnown(name);
      const f = known ? teamFlag(name, "flag")
        : (projIconHTML(projDist(m.matchNumber, which)) || `<span class="ko-badge" title="${name}">${abbr}</span>`);
      return `<span class="ar-team">${f}<span class="ar-name">${known ? name : shortLabel(name)}</span></span>`;
    };
    const badges = [
      fav ? `<span class="q-badge q-fav">★ your team</span>` : "",
      banger ? `<span class="q-badge q-banger">🔥 banger</span>` : ""
    ].filter(Boolean).join("");
    const cls = ["q-row", fav ? "fav" : "", banger ? "banger" : ""].filter(Boolean).join(" ");
    return `<div class="${cls}" data-match="${m.matchNumber}">
      <div class="q-date">${dateStr}<span class="q-time">${m.time || ""}</span></div>
      <div class="q-main">
        <div class="ar-teams">${side(m.home, "home")}<span class="vs">v</span>${side(m.away, "away")}</div>
        <div class="ar-meta">${stageStr} · ${m.venue}, ${m.city}</div>
      </div>
      <div class="q-badges">${badges}</div></div>`;
  }

  function renderPlanner() {
    const cal = document.getElementById("planner-cal");
    cal.innerHTML = `
      <div class="pseg" role="tablist">
        <button type="button" class="pseg-btn" data-page="0" role="tab">June</button>
        <button type="button" class="pseg-btn" data-page="1" role="tab">July</button>
      </div>
      <div class="pmonths">${plannerMonth(2026, 5)}${plannerMonth(2026, 6)}</div>
      <div class="pclear-row"><button type="button" class="ghost-btn" id="planner-clear" ${plannerSel.start ? "" : "hidden"}>Clear selection</button></div>`;
    const track = cal.querySelector(".pmonths");
    track.addEventListener("scroll", () => {
      const p = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (p !== plannerPage) { plannerPage = p; syncPlannerSeg(); }
    }, { passive: true });
    syncPlannerSeg();
    if (plannerPage) track.scrollLeft = plannerPage * track.clientWidth;
    const range = plannerRange();
    const summaryEl = document.getElementById("planner-summary");
    const queueEl = document.getElementById("planner-queue");
    if (!range) {
      summaryEl.innerHTML = "";
      queueEl.innerHTML = `<div class="empty-state small"><p>Pick a day above to build your watch queue.</p></div>`;
      return;
    }
    const [s, e] = range;
    const games = WC.matches.filter(m => m.date >= s && m.date <= e);
    const prio = m => (isFavMatch(m) ? 2 : 0) + (isBanger(m) ? 1 : 0);
    games.sort((a, b) => prio(b) - prio(a) || a.date.localeCompare(b.date) || (a.mins ?? 1e9) - (b.mins ?? 1e9));
    const favCount = games.filter(isFavMatch).length, bangerCount = games.filter(isBanger).length;
    const ds = parseDate(s), de = parseDate(e);
    const span = s === e
      ? `${WEEKDAYS[ds.getDay()]} ${MONTHS[ds.getMonth()].slice(0, 3)} ${ds.getDate()}`
      : `${MONTHS[ds.getMonth()].slice(0, 3)} ${ds.getDate()} – ${MONTHS[de.getMonth()].slice(0, 3)} ${de.getDate()}`;
    summaryEl.innerHTML = `<div class="planner-summary-bar">
      <b>${span}</b> · ${games.length} game${games.length !== 1 ? "s" : ""}
      ${favCount ? ` · <span class="ss-fav">★ ${favCount} with your teams</span>` : ""}
      ${bangerCount ? ` · <span class="ss-banger">🔥 ${bangerCount} banger${bangerCount !== 1 ? "s" : ""}</span>` : ""}</div>`;

    // insert a divider between prioritized games and the rest
    let html = "", dividerDone = false;
    games.forEach((m, i) => {
      if (!dividerDone && prio(m) === 0 && i > 0) { html += `<div class="q-divider">Everything else in this window</div>`; dividerDone = true; }
      html += plannerRow(m, i);
    });
    if (games.length && prio(games[0]) === 0) html = `<div class="q-divider">Games in this window</div>` + html;
    queueEl.innerHTML = html || `<div class="empty-state small"><p>No matches in that span.</p></div>`;
  }

  document.getElementById("planner-cal").addEventListener("click", e => {
    const seg = e.target.closest(".pseg-btn");
    if (seg) { plannerGoTo(Number(seg.dataset.page)); return; }
    if (e.target.closest("#planner-clear")) { plannerSel = { start: null, end: null }; renderPlanner(); return; }
    const b = e.target.closest(".pd"); if (b && !b.disabled && b.dataset.date) plannerPick(b.dataset.date);
  });

  // ======================================================================
  // PROJECTIONS
  // ======================================================================
  function projCard(m) {
    const dt = parseDate(m.date);
    const when = `${WEEKDAYS[dt.getDay()]} ${MONTHS[dt.getMonth()].slice(0, 3)} ${dt.getDate()}${m.time ? " · " + m.time : ""}`;
    const sideHTML = (which, name) => {
      const known = isKnown(name);
      const dist = projDist(m.matchNumber, which);
      const icon = known ? teamFlag(name, "flag") : projIconHTML(dist);
      const pills = (!known && dist) ? dist.slice(0, 8).map((d, i) =>
        `<span class="ppill ${i === 0 ? "lead" : ""}" data-team="${d.team}" title="Click for ${d.team}'s path"><img loading="lazy" src="https://flagcdn.com/w80/${iso(d.team)}.png" alt=""><span class="pct">${Math.round(d.p * 100)}%</span></span>`).join("") : "";
      return `<div class="pside">
        <div class="pside-main">${icon}<span>${known ? name : shortLabel(name)}</span></div>
        ${pills ? `<div class="pside-prob">${pills}</div>` : ""}
      </div>`;
    };
    return `<div class="pcard" data-match="${m.matchNumber}">
      <div class="phead"><span class="pwhen">${when}</span><span class="pwhere">${m.stage} · ${m.venue}, ${m.city}</span></div>
      ${sideHTML("home", m.home)}
      <div class="pvs">vs</div>
      ${sideHTML("away", m.away)}
    </div>`;
  }

  let projectionsRendered = false;
  function renderProjections() {
    if (projectionsRendered) return; // static — independent of favorites
    const meta = WC.projMeta || {};
    document.getElementById("proj-intro").innerHTML = `
      <p style="margin-top:0">Group fixtures are set; the knockout bracket isn't. We simulate the whole tournament ${meta.sims ? meta.sims.toLocaleString() : ""} times from current Elo ratings — group games as Poisson-goal matches, knockout ties as single games — and tally how often each nation reaches each slot.</p>
      <p class="proj-rule"><b>Reading the icons:</b> a single flag means a genuine favourite (≥<code>60%</code>). Otherwise the icon shows the leaders that cover the likely outcomes, expanding to 3–4 flags when the field is tightly packed — so an open slot looks open.
      <span style="color:var(--muted)">Winner/runner-up slots are exact; the eight best third-placed teams' allocation is approximated (FIFA uses a fixed table).</span></p>`;
    const ko = WC.matches.filter(m => m.stage !== "Group").sort((a, b) => a.matchNumber - b.matchNumber);
    const stages = ["Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Third-place", "Final"];
    let html = "";
    stages.forEach(stage => {
      const ms = ko.filter(m => m.stage === stage);
      if (!ms.length) return;
      html += `<div class="proj-stage-head">${stage}</div>` + ms.map(projCard).join("");
    });
    document.getElementById("proj-list").innerHTML = html;
    projectionsRendered = true;
  }

  // ======================================================================
  // DRILL-DOWN (per-team survival funnel)
  // ======================================================================
  const drillOverlay = document.createElement("div");
  drillOverlay.className = "drill-overlay hidden";
  drillOverlay.innerHTML = `<div class="drill" role="dialog" aria-modal="true"></div>`;
  document.body.appendChild(drillOverlay);

  function fmtPct(p) { const v = p * 100; return v < 9.5 ? v.toFixed(1) + "%" : Math.round(v) + "%"; }
  function openDrill(team) {
    const path = WC.teamPath && WC.teamPath[team];
    if (!path) return;
    const grp = groupOf(team);
    const rows = [
      ["Qualify from the group", path.r32, null],
      ["Reach Round of 16", path.r16, path.r32],
      ["Reach Quarter-finals", path.qf, path.r16],
      ["Reach Semi-finals", path.sf, path.qf],
      ["Reach the Final", path.final, path.sf],
      ["Win the tournament", path.champion, path.final]
    ];
    const body = rows.map(([label, p, prev]) => {
      const cond = (prev != null && prev > 0) ? `<span class="dl-cond">${Math.round(p / prev * 100)}% of the times it gets there</span>` : "";
      return `<div class="dl-row"><div class="dl-label">${label}${cond}</div>
        <div class="dl-bar"><span style="width:${Math.max(1.5, p * 100)}%"></span></div>
        <div class="dl-pct">${fmtPct(p)}</div></div>`;
    }).join("");
    drillOverlay.querySelector(".drill").innerHTML = `
      <div class="drill-head">${teamFlag(team, "")}<h3>${team}</h3><button class="drill-close" aria-label="Close">×</button></div>
      <p class="drill-sub">Elo ${WC.elo[team] || "—"}${grp ? " · Group " + grp : ""} · ${(WC.projMeta.sims || 0).toLocaleString()} simulated tournaments</p>
      <p class="drill-group">Finishes the group <b>1st ${fmtPct(path.groupWin)}</b> · <b>2nd ${fmtPct(path.groupRunner)}</b> — the group result sets up the whole bracket path below.</p>
      ${body}
      <p class="drill-note">Each bar is the share of simulations in which ${team} is still alive at that stage — "Reach Round of 32" means surviving the group. Reaching the final means winning four straight knockout ties, so a strong group win (and the easier bracket path it earns) compounds round over round.</p>`;
    drillOverlay.classList.remove("hidden");
  }
  function closeDrill() { drillOverlay.classList.add("hidden"); }
  drillOverlay.addEventListener("click", e => { if (e.target === drillOverlay || e.target.closest(".drill-close")) closeDrill(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrill(); });
  document.getElementById("proj-list").addEventListener("click", e => {
    const pill = e.target.closest(".ppill[data-team]"); if (pill) openDrill(pill.dataset.team);
  });

  // ======================================================================
  // POPOVER (desktop match details, calendar + planner)
  // ======================================================================
  const pop = document.getElementById("popover");
  function showPopover(m, x, y) {
    const stageStr = m.stage === "Group" ? `Group ${m.group}` : m.stage;
    const dt = parseDate(m.date);
    const dateStr = `${WEEKDAYS[dt.getDay()]}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}${m.time ? " · " + m.time : ""}`;
    const isKO = !isKnown(m.home) || !isKnown(m.away);
    let body;
    if (isKO) {
      const side = (which, name) => {
        const dist = projDist(m.matchNumber, which);
        const odds = dist ? dist.slice(0, 5).map((d, i) =>
          `<div class="pv-odd${i === 0 ? " lead" : ""}">${teamFlag(d.team, "")}<span class="pv-nm">${d.team}</span><span class="pv-pct">${Math.round(d.p * 100)}%</span></div>`).join("") : "";
        return `<div class="pv-side"><div class="pv-slot">${projIconHTML(dist)}<span>${shortLabel(name)}</span></div><div class="pv-odds">${odds}</div></div>`;
      };
      body = `<div class="pv-ko">${side("home", m.home)}<div class="pv-mid">vs</div>${side("away", m.away)}</div>`;
    } else {
      const bi = bangerInfo(m);
      const eloRow = bi ? `<div class="pv-row pv-elo">Elo: ${m.home} ${bi.a} · ${m.away} ${bi.b}${bi.banger ? " · 🔥 banger" : ""}</div>` : "";
      body = `<div class="pv-teams">${teamFlag(m.home, "")}<span>${m.home}</span><span class="vs">v</span>${teamFlag(m.away, "")}<span>${m.away}</span></div>${eloRow}`;
    }
    pop.classList.toggle("ko", isKO);
    pop.innerHTML = `<h4>Match ${m.matchNumber} · ${stageStr}</h4>${body}
      <div class="pv-row">📅 ${dateStr}</div>
      <div class="pv-row">📍 ${m.venue}, ${m.city}</div>`;
    pop.classList.remove("hidden");
    const pw = isKO ? 348 : 280, ph = pop.offsetHeight || 120;
    let left = x + 14, top = y + 14;
    if (left + pw > window.innerWidth) left = x - pw - 14;
    if (top + ph > window.innerHeight) top = y - ph - 14;
    pop.style.left = Math.max(8, left) + "px";
    pop.style.top = Math.max(8, top) + "px";
  }
  function hidePopover() { pop.classList.add("hidden"); }
  function matchFromEl(el) { return WC.matches.find(x => x.matchNumber === +el.dataset.match); }
  document.body.addEventListener("mouseover", e => {
    const el = e.target.closest("[data-match]"); if (!el) return;
    const m = matchFromEl(el); if (m) showPopover(m, e.clientX, e.clientY);
  });
  document.body.addEventListener("mousemove", e => {
    const el = e.target.closest("[data-match]");
    if (el && !pop.classList.contains("hidden")) { const m = matchFromEl(el); if (m) showPopover(m, e.clientX, e.clientY); }
  });
  document.body.addEventListener("mouseout", e => {
    if (!e.relatedTarget || !e.relatedTarget.closest("[data-match]")) hidePopover();
  });

  // ---- calendar view toggles ----
  document.getElementById("toggle-only-fav").addEventListener("change", e => { ui.onlyFav = e.target.checked; renderCalendar(); });
  document.getElementById("toggle-bangers").addEventListener("change", e => { ui.showBangers = e.target.checked; renderCalendar(); });

  // ======================================================================
  // INIT
  // ======================================================================
  renderPicker();
  setPickerCollapsed(localStorage.getItem(PICKER_KEY) === "1");
  renderCalendar();
  renderUpcomingBangers();
  renderMyMatches();
  renderPlanner();
  renderProjections();
  setupScrollSpy();
  setActiveNav("calendar");
  initScores();
  const initial = (location.hash || "").replace("#", "");
  if (["my-teams", "planner", "projections"].includes(initial)) {
    // jump to the deep-linked section once layout settles
    requestAnimationFrame(() => document.getElementById("view-" + initial).scrollIntoView({ block: "start" }));
    setActiveNav(initial);
  }
})();
