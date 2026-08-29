"use strict";

const express = require("express");
const { activeProvider } = require("../services/weatherProvider");

const router = express.Router();
const startedAt = Date.now();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    provider: activeProvider,
    env: process.env.NODE_ENV || "development"
  });
});

module.exports = router;
