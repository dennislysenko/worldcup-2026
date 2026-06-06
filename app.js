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

  const TOP10 = [...WC.teams].filter(t => WC.elo[t.name])
    .sort((a, b) => WC.elo[b.name] - WC.elo[a.name]).slice(0, 10).map(t => t.name);
  function locationTeam() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const name = TZ_TEAM[tz];
      return name && WC.teamByName[name] ? name : "United States";
    } catch (e) { return "United States"; }
  }

  // matches grouped by date (used everywhere)
  const byDate = {};
  WC.matches.forEach(m => { (byDate[m.date] = byDate[m.date] || []).push(m); });
  Object.values(byDate).forEach(arr => arr.sort((a, b) => (a.time || "").localeCompare(b.time || "")));
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
    const ids = ["calendar", "my-teams", "planner"];
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
      const order = [...favorites, loc, ...TOP10];
      const seen = new Set(), list = [];
      order.forEach(n => { if (!seen.has(n) && WC.teamByName[n]) { seen.add(n); list.push(n); } });
      suggestedRow.innerHTML = list.map(n => chipHTML(WC.teamByName[n], n === loc && !favorites.has(n))).join("")
        + `<button type="button" class="chip chip-more" data-action="more">🔍 <span>Search all 48…</span></button>`;
    }
    const n = favorites.size;
    pickerHint.textContent = n
      ? `${n} team${n > 1 ? "s" : ""} followed — saved on this device, highlighted across the calendar.`
      : "Tap your team to follow it — your location and the top 10 are below, or search any of the 48.";
  }

  function rerenderAll() { renderCalendar(); renderMyMatches(); renderPlanner(); }

  function toggleTeam(name) {
    if (favorites.has(name)) favorites.delete(name); else favorites.add(name);
    saveFavorites();
    renderPicker();
    renderHeaderStats();
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
    favorites.clear(); saveFavorites(); renderPicker(); renderHeaderStats(); rerenderAll();
  });

  // ======================================================================
  // HEADER STATS
  // ======================================================================
  function renderHeaderStats() {
    const venues = new Set(WC.matches.map(m => m.venue)).size;
    const stats = [
      { n: WC.teams.length, l: "Teams" },
      { n: WC.matches.length, l: "Matches" },
      { n: venues, l: "Venues" },
      { n: favorites.size, l: "My teams" }
    ];
    document.getElementById("header-stats").innerHTML = stats.map(s =>
      `<div class="stat"><b>${s.n}</b><span>${s.l}</span></div>`).join("");
  }

  // ======================================================================
  // CALENDAR (grid on desktop, agenda on mobile)
  // ======================================================================
  function matchPill(m) {
    const fav = isFavMatch(m), banger = ui.showBangers && isBanger(m), dim = ui.onlyFav && !fav;
    const abbr = STAGE_ABBR[m.stage] || "";
    const side = (name, known) => known ? teamFlag(name, "flag") : `<span class="ko-badge" title="${name}">${abbr}</span>`;
    const cls = ["match", fav ? "fav" : "", banger ? "banger" : "", dim ? "dimmed" : ""].filter(Boolean).join(" ");
    const flame = banger ? `<span class="flame" title="Banger matchup">🔥</span>` : "";
    const time = m.time ? `<span class="mtime">${m.time}</span>` : "";
    return `<div class="${cls}" data-match="${m.matchNumber}">${side(m.home, isKnown(m.home))}<span class="vs">v</span>${side(m.away, isKnown(m.away))}${time}${flame}</div>`;
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
      const matches = byDate[ds] || [];
      const hasFav = matches.some(isFavMatch);
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
    const side = (name, known) => {
      const f = known ? teamFlag(name, "flag") : `<span class="ko-badge" title="${name}">${abbr}</span>`;
      return `<span class="ar-team">${f}<span class="ar-name">${name}</span></span>`;
    };
    const cls = ["agenda-match", fav ? "fav" : "", banger ? "banger" : "", dim ? "dimmed" : ""].filter(Boolean).join(" ");
    const flame = banger ? `<span class="flame" title="Banger matchup">🔥</span>` : "";
    return `<div class="${cls}" data-match="${m.matchNumber}">
      <div class="ar-teams">${side(m.home, isKnown(m.home))}<span class="vs">v</span>${side(m.away, isKnown(m.away))}${flame}</div>
      <div class="ar-meta">${m.time ? m.time + " · " : ""}${stageStr} · ${m.venue}, ${m.city}</div></div>`;
  }

  function renderAgenda() {
    const dates = Object.keys(byDate).sort();
    let html = "", curMonth = "";
    dates.forEach(ds => {
      const dt = parseDate(ds);
      const monthKey = `${dt.getFullYear()}-${dt.getMonth()}`;
      if (monthKey !== curMonth) { curMonth = monthKey; html += `<h3 class="month-title">${MONTHS[dt.getMonth()]} ${dt.getFullYear()}</h3>`; }
      const matches = byDate[ds], hasFav = matches.some(isFavMatch);
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
        .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
      const t = WC.teamByName[team];
      const rows = games.map(m => {
        const oppName = m.home === team ? m.away : m.home;
        const oppHtml = isKnown(oppName) ? `${teamFlag(oppName, "")}<span>${oppName}</span>` : `<span>${oppName}</span>`;
        const dt = parseDate(m.date);
        const dateStr = `${WEEKDAYS[dt.getDay()]} ${MONTHS[dt.getMonth()].slice(0, 3)} ${dt.getDate()}`;
        const stageStr = m.stage === "Group" ? `Group ${m.group}` : m.stage;
        const flame = (ui.showBangers && isBanger(m)) ? ` <span class="mm-flame" title="Banger">🔥</span>` : "";
        return `<div class="mm-row"><span class="mm-date">${dateStr}</span>
          <span class="mm-opp">vs ${oppHtml}${flame}</span>
          <span class="mm-meta">${m.time || ""} · ${stageStr} · ${m.city}</span></div>`;
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
    const side = (name, known) => {
      const f = known ? teamFlag(name, "flag") : `<span class="ko-badge" title="${name}">${abbr}</span>`;
      return `<span class="ar-team">${f}<span class="ar-name">${name}</span></span>`;
    };
    const badges = [
      fav ? `<span class="q-badge q-fav">★ your team</span>` : "",
      banger ? `<span class="q-badge q-banger">🔥 banger</span>` : ""
    ].filter(Boolean).join("");
    const cls = ["q-row", fav ? "fav" : "", banger ? "banger" : ""].filter(Boolean).join(" ");
    return `<div class="${cls}" data-match="${m.matchNumber}">
      <div class="q-date">${dateStr}<span class="q-time">${m.time || ""}</span></div>
      <div class="q-main">
        <div class="ar-teams">${side(m.home, isKnown(m.home))}<span class="vs">v</span>${side(m.away, isKnown(m.away))}</div>
        <div class="ar-meta">${stageStr} · ${m.venue}, ${m.city}</div>
      </div>
      <div class="q-badges">${badges}</div></div>`;
  }

  function renderPlanner() {
    document.getElementById("planner-cal").innerHTML = plannerMonth(2026, 5) + plannerMonth(2026, 6);
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
    games.sort((a, b) => prio(b) - prio(a) || a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
    const favCount = games.filter(isFavMatch).length, bangerCount = games.filter(isBanger).length;
    const ds = parseDate(s), de = parseDate(e);
    const span = s === e
      ? `${WEEKDAYS[ds.getDay()]} ${MONTHS[ds.getMonth()].slice(0, 3)} ${ds.getDate()}`
      : `${MONTHS[ds.getMonth()].slice(0, 3)} ${ds.getDate()} – ${MONTHS[de.getMonth()].slice(0, 3)} ${de.getDate()}`;
    summaryEl.innerHTML = `<div class="planner-summary-bar">
      <b>${span}</b> · ${games.length} game${games.length !== 1 ? "s" : ""}
      ${favCount ? ` · <span class="ss-fav">★ ${favCount} with your teams</span>` : ""}
      ${bangerCount ? ` · <span class="ss-banger">🔥 ${bangerCount} banger${bangerCount !== 1 ? "s" : ""}</span>` : ""}
      <button class="ghost-btn pl-clear" id="planner-clear">Clear</button></div>`;
    document.getElementById("planner-clear").addEventListener("click", () => { plannerSel = { start: null, end: null }; renderPlanner(); });

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
    const b = e.target.closest(".pd"); if (b && !b.disabled && b.dataset.date) plannerPick(b.dataset.date);
  });

  // ======================================================================
  // POPOVER (desktop match details, calendar + planner)
  // ======================================================================
  const pop = document.getElementById("popover");
  function showPopover(m, x, y) {
    const stageStr = m.stage === "Group" ? `Group ${m.group}` : m.stage;
    const dt = parseDate(m.date);
    const dateStr = `${WEEKDAYS[dt.getDay()]}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
    const bi = bangerInfo(m);
    const eloRow = bi ? `<div class="pv-row pv-elo">Elo: ${m.home} ${bi.a} · ${m.away} ${bi.b}${bi.banger ? " · 🔥 banger" : ""}</div>` : "";
    const cell = name => isKnown(name) ? `${teamFlag(name, "")}<span>${name}</span>` : `<span>${name}</span>`;
    pop.innerHTML = `<h4>Match ${m.matchNumber} · ${stageStr}</h4>
      <div class="pv-teams">${cell(m.home)}<span class="vs">v</span>${cell(m.away)}</div>
      <div class="pv-row">📅 ${dateStr}${m.time ? " · " + m.time + " local" : ""}</div>
      <div class="pv-row">📍 ${m.venue}, ${m.city}</div>${eloRow}`;
    pop.classList.remove("hidden");
    const pw = 280, ph = pop.offsetHeight || 120;
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
  renderHeaderStats();
  renderCalendar();
  renderMyMatches();
  renderPlanner();
  setupScrollSpy();
  setActiveNav("calendar");
  const initial = (location.hash || "").replace("#", "");
  if (["my-teams", "planner"].includes(initial)) {
    // jump to the deep-linked section once layout settles
    requestAnimationFrame(() => document.getElementById("view-" + initial).scrollIntoView({ block: "start" }));
    setActiveNav(initial);
  }
})();
