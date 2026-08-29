"use strict";

const express = require("express");
const { geocodeSearch } = require("../services/weatherProvider");
const TtlCache = require("../services/ttlCache");
const asyncHandler = require("../middleware/asyncHandler");
const { ApiError } = require("../middleware/errorHandler");

const router = express.Router();
const cache = new TtlCache({
  ttlSeconds: Number(process.env.GEOCODE_CACHE_TTL_SECONDS) || 3600
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = (req.query.q || "").toString().trim();
    if (q.length < 2) {
      throw new ApiError(400, 'Query parameter "q" must be at least 2 characters.');
    }
    if (q.length > 100) {
      throw new ApiError(400, 'Query parameter "q" is too long.');
    }

    const cacheKey = q.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached) {
      res.set("X-Cache", "HIT");
      return res.json({ results: cached });
    }

    const results = await geocodeSearch(q);
    cache.set(cacheKey, results);
    res.set("X-Cache", "MISS");
    res.json({ results });
  })
);

module.exports = router;
