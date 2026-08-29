(function () {
  "use strict";

  const WMO = {
    0: ["Clear sky", "☀"], 1: ["Mainly clear", "🌤"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁"],
    45: ["Fog", "🌫"], 48: ["Rime fog", "🌫"],
    51: ["Light drizzle", "🌦"], 53: ["Drizzle", "🌦"], 55: ["Dense drizzle", "🌦"],
    56: ["Freezing drizzle", "🌧"], 57: ["Freezing drizzle", "🌧"],
    61: ["Light rain", "🌧"], 63: ["Rain", "🌧"], 65: ["Heavy rain", "🌧"],
    66: ["Freezing rain", "🌧"], 67: ["Freezing rain", "🌧"],
    71: ["Light snow", "🌨"], 73: ["Snow", "🌨"], 75: ["Heavy snow", "❄"],
    77: ["Snow grains", "🌨"],
    80: ["Light showers", "🌦"], 81: ["Showers", "🌦"], 82: ["Violent showers", "⛈"],
    85: ["Snow showers", "🌨"], 86: ["Snow showers", "🌨"],
    95: ["Thunderstorm", "⛈"], 96: ["Thunderstorm, hail", "⛈"], 99: ["Severe thunderstorm", "⛈"]
  };

  function conditionKey(code, isDay) {
    if ([95, 96, 99].includes(code)) return "storm";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
    if ([45, 48].includes(code)) return "fog";
    if (code === 3) return "overcast";
    if (!isDay) return "clear-night";
    return "clear";
  }
  function wmoText(code) { return (WMO[code] || ["Unknown", ""])[0]; }
  function wmoIcon(code) { return (WMO[code] || ["", "?"])[1]; }

  const el = (id) => document.getElementById(id);
  const cityInput = el("city-input");
  const suggestionsEl = el("suggestions");
  const geoBtn = el("geo-btn");
  const statusEl = el("status");
  const currentEl = el("current");
  const bodyEl = document.body;

  let unit = localStorage.getItem("weather:unit") || "c";
  let lastData = null;
  let searchController = null;
  let searchDebounce = null;
  let activeSuggestionIndex = -1;
  let currentSuggestions = [];

  function setStatus(msg, isError) {
    if (!msg) { statusEl.hidden = true; return; }
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", !!isError);
  }

  async function apiFetch(path, signal) {
    const res = await fetch(path, { signal, headers: { Accept: "application/json" } });
    let body;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) {
      const message = (body && body.error && body.error.message) || `Request failed (${res.status})`;
      throw new Error(message);
    }
    return body;
  }

  function cToF(c) { return c * 9 / 5 + 32; }
  function fmtTemp(c) {
    const v = unit === "f" ? cToF(c) : c;
    return Math.round(v);
  }
  function degToCompass(deg) {
    const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  function updateClock(tz) {
    const now = new Date();
    let timeStr;
    try {
      timeStr = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", weekday: "short", day: "2-digit", month: "short", timeZone: tz || undefined }).format(now);
    } catch (e) {
      timeStr = now.toLocaleString();
    }
    el("clock").textContent = timeStr + (tz ? "  ·  " + tz : "");
  }
  updateClock();
  setInterval(() => updateClock(lastData && lastData.timezone), 30000);

  // ---------- Geocoding search (proxied through our backend: /api/geocode) ----------
  cityInput.addEventListener("input", () => {
    const q = cityInput.value.trim();
    clearTimeout(searchDebounce);
    if (q.length < 2) { closeSuggestions(); return; }
    searchDebounce = setTimeout(() => runSearch(q), 300);
  });

  cityInput.addEventListener("keydown", (e) => {
    if (!currentSuggestions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); }
    else if (e.key === "Enter") {
      if (activeSuggestionIndex >= 0) { e.preventDefault(); selectPlace(currentSuggestions[activeSuggestionIndex]); }
    } else if (e.key === "Escape") { closeSuggestions(); }
  });

  document.addEventListener("click", (e) => {
    if (!suggestionsEl.contains(e.target) && e.target !== cityInput) closeSuggestions();
  });

  function moveSelection(delta) {
    activeSuggestionIndex = Math.max(0, Math.min(currentSuggestions.length - 1, activeSuggestionIndex + delta));
    [...suggestionsEl.children].forEach((li, i) => li.setAttribute("aria-selected", i === activeSuggestionIndex ? "true" : "false"));
    suggestionsEl.children[activeSuggestionIndex]?.scrollIntoView({ block: "nearest" });
  }

  function closeSuggestions() {
    suggestionsEl.innerHTML = "";
    currentSuggestions = [];
    activeSuggestionIndex = -1;
    cityInput.setAttribute("aria-expanded", "false");
  }

  async function runSearch(q) {
    if (searchController) searchController.abort();
    searchController = new AbortController();
    try {
      const data = await apiFetch("/api/geocode?q=" + encodeURIComponent(q), searchController.signal);
      currentSuggestions = data.results || [];
      renderSuggestions();
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
    }
  }

  function renderSuggestions() {
    suggestionsEl.innerHTML = "";
    activeSuggestionIndex = -1;
    if (!currentSuggestions.length) { cityInput.setAttribute("aria-expanded", "false"); return; }
    cityInput.setAttribute("aria-expanded", "true");
    currentSuggestions.forEach((place) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      const sub = [place.admin1, place.country].filter(Boolean).join(", ");
      const nameSpan = document.createElement("span");
      nameSpan.textContent = place.name;
      const subSpan = document.createElement("span");
      subSpan.className = "place-sub";
      subSpan.textContent = sub;
      li.append(nameSpan, subSpan);
      li.addEventListener("click", () => selectPlace(place));
      suggestionsEl.appendChild(li);
    });
  }

  function selectPlace(place) {
    cityInput.value = place.name + (place.country ? ", " + place.country : "");
    closeSuggestions();
    const sub = [place.admin1, place.country].filter(Boolean).join(", ");
    loadWeather(place.latitude, place.longitude, place.name, sub);
    localStorage.setItem("weather:last", JSON.stringify({ lat: place.latitude, lon: place.longitude, name: place.name, sub }));
  }

  el("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (currentSuggestions.length) selectPlace(currentSuggestions[0]);
  });

  // ---------- Geolocation (reverse lookup proxied through /api/reverse) ----------
  geoBtn.addEventListener("click", () => {
    if (!navigator.geolocation) { setStatus("Geolocation isn't supported in this browser.", true); return; }
    geoBtn.disabled = true;
    geoBtn.textContent = "◎ Locating…";
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let name = "Your location", sub = "";
        try {
          const place = await apiFetch(`/api/reverse?lat=${latitude}&lon=${longitude}`);
          name = place.name || name;
          sub = [place.admin1, place.country].filter(Boolean).join(", ");
        } catch (e) { /* fall back to generic label silently */ }
        geoBtn.disabled = false;
        geoBtn.textContent = "◎ Locate";
        cityInput.value = name;
        loadWeather(latitude, longitude, name, sub);
      },
      (err) => {
        geoBtn.disabled = false;
        geoBtn.textContent = "◎ Locate";
        setStatus("Couldn't get your location (" + err.message + ").", true);
      },
      { timeout: 10000 }
    );
  });

  // ---------- Weather fetch (proxied through /api/weather) ----------
  async function loadWeather(lat, lon, name, sub) {
    setStatus("Fetching current conditions…");
    currentEl.classList.remove("show");
    try {
      const data = await apiFetch(`/api/weather?lat=${lat}&lon=${lon}`);
      lastData = data;
      lastData.locName = name; lastData.locSub = sub; lastData.lat = lat; lastData.lon = lon;
      render(data, name, sub, lat, lon);
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Couldn't load weather data. Check your connection and try again.", true);
    }
  }

  function render(data, name, sub, lat, lon) {
    const cur = data.current;
    const key = conditionKey(cur.weatherCode, cur.isDay);
    bodyEl.setAttribute("data-condition", key);

    el("loc-name").textContent = name + (sub ? ", " + sub : "");
    el("loc-coords").textContent = Number(lat).toFixed(2) + "°, " + Number(lon).toFixed(2) + "°";

    renderTemps();
    el("cond-text").textContent = wmoIcon(cur.weatherCode) + "  " + wmoText(cur.weatherCode);

    el("wind-speed").textContent = Math.round(cur.windSpeedKmh) + " km/h";
    el("wind-dir").textContent = degToCompass(cur.windDirectionDeg);
    document.getElementById("wind-needle").setAttribute("transform", "rotate(" + cur.windDirectionDeg + " 50 50)");

    el("stat-humidity").textContent = cur.humidityPct + "%";
    el("stat-pressure").textContent = Math.round(cur.pressureHpa) + " hPa";
    el("stat-precip").textContent = cur.precipitation + " mm";
    const sunsetToday = data.daily[0] && data.daily[0].sunset;
    el("stat-sunset").textContent = sunsetToday ? new Date(sunsetToday).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

    renderHourly(data);
    renderDaily(data);
    currentEl.classList.add("show");
  }

  function renderTemps() {
    if (!lastData) return;
    const cur = lastData.current;
    el("temp-value").textContent = fmtTemp(cur.temperature);
    el("temp-unit").textContent = "°" + unit.toUpperCase();
    el("feels-like").textContent = "Feels like " + fmtTemp(cur.apparentTemperature) + "°" + unit.toUpperCase();
  }

  function renderHourly(data) {
    const wrap = el("hourly-ticker");
    wrap.innerHTML = "";
    const nowISO = data.current.time;
    let startIdx = data.hourly.findIndex((h) => h.time >= nowISO);
    if (startIdx < 0) startIdx = 0;
    for (let i = startIdx; i < Math.min(startIdx + 24, data.hourly.length); i++) {
      const h = data.hourly[i];
      const t = new Date(h.time);
      const cell = document.createElement("div");
      cell.className = "hour-cell" + (i === startIdx ? " now" : "");
      const timeLabel = i === startIdx ? "Now" : t.toLocaleTimeString([], { hour: "numeric" });
      const temp = unit === "f" ? Math.round(cToF(h.temperature)) : Math.round(h.temperature);
      const pop = h.precipProbability;

      const timeDiv = document.createElement("div"); timeDiv.className = "h-time"; timeDiv.textContent = timeLabel;
      const iconDiv = document.createElement("div"); iconDiv.className = "h-icon"; iconDiv.textContent = wmoIcon(h.weatherCode);
      const tempDiv = document.createElement("div"); tempDiv.className = "h-temp"; tempDiv.textContent = temp + "°";
      const precipDiv = document.createElement("div"); precipDiv.className = "h-precip"; precipDiv.textContent = pop >= 20 ? pop + "%" : "";

      cell.append(timeDiv, iconDiv, tempDiv, precipDiv);
      wrap.appendChild(cell);
    }
  }

  function renderDaily(data) {
    const body = el("daily-body");
    body.innerHTML = "";
    const maxes = data.daily.map((d) => d.tempMax);
    const mins = data.daily.map((d) => d.tempMin);
    const weekMax = Math.max(...maxes);
    const weekMin = Math.min(...mins);
    const span = Math.max(1, weekMax - weekMin);

    data.daily.forEach((d, i) => {
      const date = new Date(d.date + "T12:00:00");
      const dayLabel = i === 0 ? "Today" : date.toLocaleDateString([], { weekday: "short" });
      const hiDisp = unit === "f" ? Math.round(cToF(d.tempMax)) : Math.round(d.tempMax);
      const loDisp = unit === "f" ? Math.round(cToF(d.tempMin)) : Math.round(d.tempMin);
      const leftPct = ((d.tempMin - weekMin) / span) * 100;
      const widthPct = ((d.tempMax - d.tempMin) / span) * 100;
      const pop = d.precipProbabilityMax;

      const tr = document.createElement("tr");

      const nameTd = document.createElement("td"); nameTd.className = "day-name"; nameTd.textContent = dayLabel;
      const iconTd = document.createElement("td"); iconTd.className = "day-icon"; iconTd.textContent = wmoIcon(d.weatherCode);
      const precipTd = document.createElement("td"); precipTd.className = "day-precip"; precipTd.textContent = pop >= 20 ? pop + "% ☂" : "";

      const rangeTd = document.createElement("td"); rangeTd.className = "day-range";
      const loSpan = document.createElement("span"); loSpan.className = "lo"; loSpan.textContent = loDisp + "°";
      const track = document.createElement("span"); track.className = "range-track";
      const fill = document.createElement("span"); fill.className = "range-fill";
      fill.style.left = leftPct.toFixed(1) + "%";
      fill.style.width = widthPct.toFixed(1) + "%";
      track.appendChild(fill);
      const hiSpan = document.createElement("span"); hiSpan.className = "hi"; hiSpan.textContent = hiDisp + "°";
      rangeTd.append(loSpan, track, hiSpan);

      tr.append(nameTd, iconTd, precipTd, rangeTd);
      body.appendChild(tr);
    });
  }

  // ---------- Unit toggle ----------
  function setUnit(u) {
    unit = u;
    localStorage.setItem("weather:unit", unit);
    el("unit-c").classList.toggle("active", unit === "c");
    el("unit-f").classList.toggle("active", unit === "f");
    if (lastData) { renderTemps(); renderHourly(lastData); renderDaily(lastData); }
  }
  el("unit-c").addEventListener("click", () => setUnit("c"));
  el("unit-f").addEventListener("click", () => setUnit("f"));
  setUnit(unit);

  // ---------- Boot ----------
  (function init() {
    const savedRaw = localStorage.getItem("weather:last");
    if (savedRaw) {
      try {
        const saved = JSON.parse(savedRaw);
        cityInput.value = saved.name + (saved.sub ? ", " + saved.sub : "");
        loadWeather(saved.lat, saved.lon, saved.name, saved.sub);
        return;
      } catch (e) { /* fall through to default */ }
    }
    loadWeather(28.6139, 77.2090, "New Delhi", "Delhi, India");
  })();
})();
