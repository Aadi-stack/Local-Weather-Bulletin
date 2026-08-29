"use strict";

const express = require("express");
const { reverseGeocode } = require("../services/weatherProvider");
const TtlCache = require("../services/ttlCache");
const asyncHandler = require("../middleware/asyncHandler");
const { ApiError } = require("../middleware/errorHandler");

const router = express.Router();
const cache = new TtlCache({ ttlSeconds: 3600 });

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      throw new ApiError(400, 'Query parameters "lat" and "lon" are required numbers.');
    }

    const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      res.set("X-Cache", "HIT");
      return res.json(cached);
    }

    const place = await reverseGeocode(lat, lon);
    cache.set(cacheKey, place);
    res.set("X-Cache", "MISS");
    res.json(place);
  })
);

module.exports = router;
