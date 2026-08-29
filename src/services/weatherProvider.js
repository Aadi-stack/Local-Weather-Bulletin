"use strict";

/**
 * Provider abstraction so the rest of the app (routes, frontend) never has
 * to know which upstream weather API is in use, and so any paid-provider
 * API key stays server-side and is never shipped to the browser.
 *
 * Every function here returns the SAME normalized shape regardless of
 * provider. To add a new provider: implement fetchForecast(lat, lon) and
 * register it in `providers` below.
 */

const PROVIDER = (process.env.WEATHER_PROVIDER || "open-meteo").toLowerCase();

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`Upstream request failed (${res.status})`);
      err.status = res.status >= 400 && res.status < 500 ? 502 : 502;
      err.upstreamBody = body.slice(0, 500);
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// open-meteo: no API key required. Default provider.
// ---------------------------------------------------------------------------
async function openMeteoForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure",
    hourly: "temperature_2m,weather_code,precipitation_probability",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    timezone: "auto",
    forecast_days: "8"
  });
  const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);

  // Already close to our normalized shape; pass through with light renaming.
  return {
    timezone: data.timezone,
    current: {
      time: data.current.time,
      temperature: data.current.temperature_2m,
      apparentTemperature: data.current.apparent_temperature,
      isDay: data.current.is_day === 1,
      precipitation: data.current.precipitation,
      weatherCode: data.current.weather_code,
      windSpeedKmh: data.current.wind_speed_10m,
      windDirectionDeg: data.current.wind_direction_10m,
      pressureHpa: data.current.surface_pressure,
      humidityPct: data.current.relative_humidity_2m
    },
    hourly: data.hourly.time.map((t, i) => ({
      time: t,
      temperature: data.hourly.temperature_2m[i],
      weatherCode: data.hourly.weather_code[i],
      precipProbability: data.hourly.precipitation_probability[i]
    })),
    daily: data.daily.time.map((t, i) => ({
      date: t,
      weatherCode: data.daily.weather_code[i],
      tempMax: data.daily.temperature_2m_max[i],
      tempMin: data.daily.temperature_2m_min[i],
      precipProbabilityMax: data.daily.precipitation_probability_max[i],
      sunrise: data.daily.sunrise[i],
      sunset: data.daily.sunset[i]
    }))
  };
}

// ---------------------------------------------------------------------------
// OpenWeather One Call 3.0: requires OPENWEATHER_API_KEY, kept server-side.
// WMO weather codes don't exist in OpenWeather, so we map their condition
// codes down to the same small WMO set the frontend already understands.
// ---------------------------------------------------------------------------
function owmToWmo(owmCode, isDay) {
  const map = {
    800: isDay ? 0 : 0, // clear
    801: 1, 802: 2, 803: 3, 804: 3, // clouds
    701: 45, 711: 45, 721: 45, 731: 45, 741: 45, 751: 45, 761: 45, 762: 45, // fog/haze/dust
    771: 95, 781: 99, // squall/tornado -> storm bucket
    200: 95, 201: 95, 202: 96, 210: 95, 211: 95, 212: 96, 221: 95, 230: 95, 231: 95, 232: 96,
    300: 51, 301: 53, 302: 55, 310: 56, 311: 57, 312: 57, 313: 80, 314: 81, 321: 53,
    500: 61, 501: 63, 502: 65, 503: 65, 504: 65, 511: 66, 520: 80, 521: 81, 522: 82, 531: 82,
    600: 71, 601: 73, 602: 75, 611: 66, 612: 67, 613: 67, 615: 71, 616: 71, 620: 85, 621: 86, 622: 86
  };
  return map[owmCode] ?? 3;
}

async function openWeatherForecast(lat, lon) {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) {
    const err = new Error("WEATHER_PROVIDER is set to openweather but OPENWEATHER_API_KEY is missing");
    err.status = 500;
    throw err;
  }
  const params = new URLSearchParams({
    lat, lon, appid: key, units: "metric", exclude: "minutely,alerts"
  });
  const data = await fetchJson(`https://api.openweathermap.org/data/3.0/onecall?${params.toString()}`);

  const isDayNow = data.current.dt > data.current.sunrise && data.current.dt < data.current.sunset;

  return {
    timezone: data.timezone,
    current: {
      time: new Date(data.current.dt * 1000).toISOString(),
      temperature: data.current.temp,
      apparentTemperature: data.current.feels_like,
      isDay: isDayNow,
      precipitation: (data.current.rain?.["1h"] || 0) + (data.current.snow?.["1h"] || 0),
      weatherCode: owmToWmo(data.current.weather[0].id, isDayNow),
      windSpeedKmh: data.current.wind_speed * 3.6,
      windDirectionDeg: data.current.wind_deg,
      pressureHpa: data.current.pressure,
      humidityPct: data.current.humidity
    },
    hourly: data.hourly.slice(0, 24).map((h) => ({
      time: new Date(h.dt * 1000).toISOString(),
      temperature: h.temp,
      weatherCode: owmToWmo(h.weather[0].id, true),
      precipProbability: Math.round((h.pop || 0) * 100)
    })),
    daily: data.daily.slice(0, 8).map((d) => ({
      date: new Date(d.dt * 1000).toISOString().slice(0, 10),
      weatherCode: owmToWmo(d.weather[0].id, true),
      tempMax: d.temp.max,
      tempMin: d.temp.min,
      precipProbabilityMax: Math.round((d.pop || 0) * 100),
      sunrise: new Date(d.sunrise * 1000).toISOString(),
      sunset: new Date(d.sunset * 1000).toISOString()
    }))
  };
}

const providers = {
  "open-meteo": openMeteoForecast,
  "openweather": openWeatherForecast
};

async function getForecast(lat, lon) {
  const impl = providers[PROVIDER];
  if (!impl) {
    const err = new Error(`Unknown WEATHER_PROVIDER "${PROVIDER}"`);
    err.status = 500;
    throw err;
  }
  return impl(lat, lon);
}

async function geocodeSearch(query, count = 6) {
  const params = new URLSearchParams({ name: query, count: String(count), language: "en", format: "json" });
  const data = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`);
  return (data.results || []).map((r) => ({
    name: r.name,
    admin1: r.admin1 || null,
    country: r.country || null,
    countryCode: r.country_code || null,
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone || null
  }));
}

async function reverseGeocode(lat, lon) {
  const params = new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: "en" });
  const data = await fetchJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params.toString()}`);
  return {
    name: data.city || data.locality || "Your location",
    admin1: data.principalSubdivision || null,
    country: data.countryName || null
  };
}

module.exports = { getForecast, geocodeSearch, reverseGeocode, activeProvider: PROVIDER };
