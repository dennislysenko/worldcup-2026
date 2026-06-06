/* World Cup 2026 calendar app. Vanilla JS, no build step. */
(function () {
  "use strict";

  const LS_KEY = "wc2026.favorites";
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const STAGE_ABBR = {
    "Round of 32": "R32", "Round of 16": "R16", "Quarter-final": "QF",
    "Semi-final": "SF", "Third-place": "3rd", "Final": "F"
  };

  // ---- state ----
  let favorites = loadFavorites();
  let chipsExpanded = false;
  const ui = {
    showElo: false,
    onlyFav: false,
    showBangers: true,
    search: ""
  };

  // ---- helpers ----
  function loadFavorites() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function saveFavorites() {
    localStorage.setItem(LS_KEY, JSON.stringify([...favorites]));
  }
  function isKnown(name) { return !!WC.teamByName[name]; }
  function flag(iso, cls) {
    return `<img class="${cls}" loading="lazy" src="https://flagcdn.com/w40/${iso}.png" srcset="https://flagcdn.com/w80/${iso}.png 2x" alt="">`;
  }
  function teamFlag(name, cls) {
    const t = WC.teamByName[name];
    return t ? flag(t.iso2, cls) : "";
  }
  function isFavMatch(m) { return favorites.has(m.home) || favorites.has(m.away); }

  // marquee "banger" score: high average Elo, penalize blowouts, no minnows
  function bangerInfo(m) {
    if (!isKnown(m.home) || !isKnown(m.away)) return null;
    const a = WC.elo[m.home], b = WC.elo[m.away];
    if (a == null || b == null) return null;
    const avg = (a + b) / 2, gap = Math.abs(a - b);
    const score = avg - gap * 0.25;
    return { a, b, avg, gap, score, banger: a >= 1700 && b >= 1700 && score >= 1860 };
  }
  function isBanger(m) { const i = bangerInfo(m); return !!(i && i.banger); }

  function parseDate(s) { const [y, mo, d] = s.split("-").map(Number); return new Date(y, mo - 1, d); }

  // ---- chips (team picker) ----
  const chipsEl = document.getElementById("chips");
  const expandBtn = document.getElementById("expand-chips");
  const pickerHint = document.getElementById("picker-hint");

  function renderChips() {
    const q = ui.search.trim().toLowerCase();
    // selected first, then alphabetical — so favorites stay visible when collapsed
    const sorted = [...WC.teams].sort((x, y) => {
      const fx = favorites.has(x.name), fy = favorites.has(y.name);
      if (fx !== fy) return fx ? -1 : 1;
      return x.name.localeCompare(y.name);
    });
    chipsEl.innerHTML = sorted.map(t => {
      const sel = favorites.has(t.name);
      const hide = q && !t.name.toLowerCase().includes(q);
      const elo = ui.showElo && WC.elo[t.name] ? `<span class="elo">${WC.elo[t.name]}</span>` : "";
      return `<button type="button" class="chip ${sel ? "selected" : ""} ${hide ? "hidden" : ""}" data-team="${t.name}">
        ${flag(t.iso2, "")}<span>${t.name}</span>${elo}</button>`;
    }).join("");
    chipsEl.classList.toggle("expanded", chipsExpanded || !!q);
    expandBtn.textContent = (chipsExpanded || q) ? "Collapse ▲" : `Show all 48 teams ▼`;
    expandBtn.style.display = q ? "none" : "block";

    const n = favorites.size;
    pickerHint.textContent = n
      ? `${n} team${n > 1 ? "s" : ""} selected — saved to this browser. They're starred above and highlighted in the calendar below.`
      : "Tap a country to follow it. Your picks are remembered on this device and rise to the top.";
  }

  chipsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    const name = btn.dataset.team;
    if (favorites.has(name)) favorites.delete(name); else favorites.add(name);
    saveFavorites();
    renderChips();
    renderHeaderStats();
    renderCalendar();
    renderMyMatches();
  });

  expandBtn.addEventListener("click", () => { chipsExpanded = !chipsExpanded; renderChips(); });

  document.getElementById("team-search").addEventListener("input", (e) => {
    ui.search = e.target.value; renderChips();
  });
  document.getElementById("toggle-elo").addEventListener("change", (e) => {
    ui.showElo = e.target.checked; renderChips();
  });
  document.getElementById("clear-fav").addEventListener("click", () => {
    favorites.clear(); saveFavorites();
    renderChips(); renderHeaderStats(); renderCalendar(); renderMyMatches();
  });

  // ---- header stats ----
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

  // ---- calendar ----
  const byDate = {};
  WC.matches.forEach(m => { (byDate[m.date] = byDate[m.date] || []).push(m); });
  Object.values(byDate).forEach(arr => arr.sort((a, b) => (a.time || "").localeCompare(b.time || "")));

  // months spanned by the tournament
  const allDates = WC.matches.map(m => parseDate(m.date));
  const minD = new Date(Math.min(...allDates)), maxD = new Date(Math.max(...allDates));

  function matchPill(m) {
    const fav = isFavMatch(m);
    const banger = ui.showBangers && isBanger(m);
    const dim = ui.onlyFav && !fav;
    const homeKnown = isKnown(m.home), awayKnown = isKnown(m.away);
    const abbr = STAGE_ABBR[m.stage] || "";

    function side(name, known) {
      return known ? teamFlag(name, "flag")
        : `<span class="ko-badge" title="${name}">${abbr}</span>`;
    }
    const cls = ["match", fav ? "fav" : "", banger ? "banger" : "", dim ? "dimmed" : ""].filter(Boolean).join(" ");
    const flame = banger ? `<span class="flame" title="Banger matchup">🔥</span>` : "";
    const time = m.time ? `<span class="mtime">${m.time}</span>` : "";
    return `<div class="${cls}" data-match="${m.matchNumber}">
      ${side(m.home, homeKnown)}<span class="vs">v</span>${side(m.away, awayKnown)}${time}${flame}</div>`;
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
      cells += `<div class="${cls}">
        <div class="day-num"><span>${d}</span>${favDot}</div>
        ${matches.map(matchPill).join("")}</div>`;
    }

    return `<div class="month">
      <h3 class="month-title">${MONTHS[month]} ${year}</h3>
      <div class="weekdays">${WEEKDAYS.map(w => `<span>${w}</span>`).join("")}</div>
      <div class="grid">${cells}</div>
    </div>`;
  }

  // ---- agenda (mobile) view: vertical, one card per match-day ----
  function agendaRow(m) {
    const fav = isFavMatch(m);
    const banger = ui.showBangers && isBanger(m);
    const dim = ui.onlyFav && !fav;
    const abbr = STAGE_ABBR[m.stage] || "";
    const stageStr = m.stage === "Group" ? `Group ${m.group}` : m.stage;
    function side(name, known) {
      const f = known ? teamFlag(name, "flag") : `<span class="ko-badge" title="${name}">${abbr}</span>`;
      return `<span class="ar-team">${f}<span class="ar-name">${name}</span></span>`;
    }
    const cls = ["agenda-match", fav ? "fav" : "", banger ? "banger" : "", dim ? "dimmed" : ""].filter(Boolean).join(" ");
    const flame = banger ? `<span class="flame" title="Banger matchup">🔥</span>` : "";
    return `<div class="${cls}" data-match="${m.matchNumber}">
      <div class="ar-teams">${side(m.home, isKnown(m.home))}<span class="vs">v</span>${side(m.away, isKnown(m.away))}${flame}</div>
      <div class="ar-meta">${m.time ? m.time + " · " : ""}${stageStr} · ${m.venue}, ${m.city}</div>
    </div>`;
  }

  function renderAgenda() {
    const dates = Object.keys(byDate).sort();
    let html = "", curMonth = "";
    dates.forEach(ds => {
      const dt = parseDate(ds);
      const monthKey = `${dt.getFullYear()}-${dt.getMonth()}`;
      if (monthKey !== curMonth) {
        curMonth = monthKey;
        html += `<h3 class="month-title">${MONTHS[dt.getMonth()]} ${dt.getFullYear()}</h3>`;
      }
      const matches = byDate[ds];
      const hasFav = matches.some(isFavMatch);
      html += `<div class="agenda-day ${hasFav ? "has-fav" : ""}">
        <div class="agenda-date"><span class="ad-wd">${WEEKDAYS[dt.getDay()]}</span><span class="ad-num">${dt.getDate()}</span></div>
        <div class="agenda-matches">${matches.map(agendaRow).join("")}</div>
      </div>`;
    });
    return html;
  }

  const mobileMQ = window.matchMedia("(max-width: 640px)");
  function renderCalendar() {
    const el = document.getElementById("calendar");
    el.classList.toggle("agenda-view", mobileMQ.matches);
    if (mobileMQ.matches) { el.innerHTML = renderAgenda(); return; }
    let html = "";
    let y = minD.getFullYear(), m = minD.getMonth();
    const endY = maxD.getFullYear(), endM = maxD.getMonth();
    while (y < endY || (y === endY && m <= endM)) {
      html += renderMonth(y, m);
      m++; if (m > 11) { m = 0; y++; }
    }
    el.innerHTML = html;
  }
  // re-render when crossing the mobile/desktop breakpoint
  mobileMQ.addEventListener("change", renderCalendar);

  // ---- my matches list ----
  function renderMyMatches() {
    const el = document.getElementById("my-matches");
    if (favorites.size === 0) {
      el.innerHTML = `<p class="mm-empty">Pick some teams above and their fixtures will show up here, in date order.</p>`;
      return;
    }
    const favTeams = [...favorites].sort((a, b) => a.localeCompare(b));
    el.innerHTML = favTeams.map(team => {
      const games = WC.matches
        .filter(m => m.home === team || m.away === team)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
      const t = WC.teamByName[team];
      const rows = games.map(m => {
        const oppName = m.home === team ? m.away : m.home;
        const oppHtml = isKnown(oppName)
          ? `${teamFlag(oppName, "")}<span>${oppName}</span>`
          : `<span>${oppName}</span>`;
        const dt = parseDate(m.date);
        const dateStr = `${WEEKDAYS[dt.getDay()]} ${MONTHS[dt.getMonth()].slice(0,3)} ${dt.getDate()}`;
        const stageStr = m.stage === "Group" ? `Group ${m.group}` : m.stage;
        const flame = (ui.showBangers && isBanger(m)) ? ` <span class="mm-flame" title="Banger">🔥</span>` : "";
        return `<div class="mm-row">
          <span class="mm-date">${dateStr}</span>
          <span class="mm-opp">vs ${oppHtml}${flame}</span>
          <span class="mm-meta">${m.time || ""} · ${stageStr} · ${m.city}</span>
        </div>`;
      }).join("");
      return `<div class="mm-group">
        <div class="mm-team-head">${flag(t.iso2, "")} ${team} <span style="color:var(--muted);font-weight:400;font-size:12px;">(${games.length} guaranteed group games)</span></div>
        ${rows}
      </div>`;
    }).join("");
  }

  // ---- popover (match details) ----
  const pop = document.getElementById("popover");
  function showPopover(m, x, y) {
    const stageStr = m.stage === "Group" ? `Group ${m.group}` : m.stage;
    const dt = parseDate(m.date);
    const dateStr = `${WEEKDAYS[dt.getDay()]}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
    const bi = bangerInfo(m);
    const eloRow = bi
      ? `<div class="pv-row pv-elo">Elo: ${m.home} ${bi.a} · ${m.away} ${bi.b}${bi.banger ? " · 🔥 banger" : ""}</div>`
      : "";
    const teamCell = (name) => isKnown(name)
      ? `${teamFlag(name, "")}<span>${name}</span>` : `<span>${name}</span>`;
    pop.innerHTML = `
      <h4>Match ${m.matchNumber} · ${stageStr}</h4>
      <div class="pv-teams">${teamCell(m.home)}<span class="vs">v</span>${teamCell(m.away)}</div>
      <div class="pv-row">📅 ${dateStr}${m.time ? " · " + m.time + " local" : ""}</div>
      <div class="pv-row">📍 ${m.venue}, ${m.city}</div>
      ${eloRow}`;
    pop.classList.remove("hidden");
    const pw = 280, ph = pop.offsetHeight || 120;
    let left = x + 14, top = y + 14;
    if (left + pw > window.innerWidth) left = x - pw - 14;
    if (top + ph > window.innerHeight) top = y - ph - 14;
    pop.style.left = Math.max(8, left) + "px";
    pop.style.top = Math.max(8, top) + "px";
  }
  function hidePopover() { pop.classList.add("hidden"); }

  document.getElementById("calendar").addEventListener("mouseover", (e) => {
    const el = e.target.closest(".match");
    if (!el) return;
    const m = WC.matches.find(x => x.matchNumber === +el.dataset.match);
    if (m) showPopover(m, e.clientX, e.clientY);
  });
  document.getElementById("calendar").addEventListener("mousemove", (e) => {
    const el = e.target.closest(".match");
    if (el && !pop.classList.contains("hidden")) {
      const m = WC.matches.find(x => x.matchNumber === +el.dataset.match);
      if (m) showPopover(m, e.clientX, e.clientY);
    }
  });
  document.getElementById("calendar").addEventListener("mouseout", (e) => {
    if (!e.relatedTarget || !e.relatedTarget.closest(".match")) hidePopover();
  });

  // ---- view toggles ----
  document.getElementById("toggle-only-fav").addEventListener("change", (e) => {
    ui.onlyFav = e.target.checked; renderCalendar();
  });
  document.getElementById("toggle-bangers").addEventListener("change", (e) => {
    ui.showBangers = e.target.checked; renderCalendar(); renderMyMatches();
  });

  // ---- init ----
  renderChips();
  renderHeaderStats();
  renderCalendar();
  renderMyMatches();
})();
