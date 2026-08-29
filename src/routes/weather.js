"use strict";

const express = require("express");
const { getForecast } = require("../services/weatherProvider");
const TtlCache = require("../services/ttlCache");
const asyncHandler = require("../middleware/asyncHandler");
const { ApiError } = require("../middleware/errorHandler");

const router = express.Router();
const cache = new TtlCache({
  ttlSeconds: Number(process.env.WEATHER_CACHE_TTL_SECONDS) || 300
});

function parseCoord(value, name, min, max) {
  const num = Number(value);
  if (value === undefined || Number.isNaN(num) || num < min || num > max) {
    throw new ApiError(400, `Query parameter "${name}" must be a number between ${min} and ${max}.`);
  }
  return num;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const lat = parseCoord(req.query.lat, "lat", -90, 90);
    const lon = parseCoord(req.query.lon, "lon", -180, 180);

    // Round to ~1km precision for cache key stability without hurting accuracy.
    const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      res.set("X-Cache", "HIT");
      return res.json(cached);
    }

    const forecast = await getForecast(lat, lon);
    cache.set(cacheKey, forecast);
    res.set("X-Cache", "MISS");
    res.json(forecast);
  })
);

module.exports = router;
