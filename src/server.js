"use strict";

require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const weatherRoute = require("./routes/weather");
const geocodeRoute = require("./routes/geocode");
const reverseRoute = require("./routes/reverse");
const healthRoute = require("./routes/health");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.set("trust proxy", 1); // required for correct client IPs behind a reverse proxy / load balancer

// ---- Security headers ----
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"]
      }
    }
  })
);

// ---- CORS ----
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin/non-browser requests (no Origin header) and configured origins.
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    }
  })
);

app.use(compression());
app.use(express.json({ limit: "10kb" }));
app.use(morgan(isProd ? "combined" : "dev"));

// ---- Rate limiting on the API surface (protects the upstream weather providers too) ----
const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many requests. Please slow down." } }
});
app.use("/api/", apiLimiter);

// ---- Routes ----
app.use("/api/health", healthRoute);
app.use("/api/weather", weatherRoute);
app.use("/api/geocode", geocodeRoute);
app.use("/api/reverse", reverseRoute);

// ---- Static frontend ----
const publicDir = path.join(__dirname, "..", "public");
app.use(
  express.static(publicDir, {
    maxAge: isProd ? "1d" : 0,
    index: "index.html"
  })
);

// Anything under /api that wasn't matched -> JSON 404. Everything else -> the SPA shell.
app.use("/api", notFound);
app.get("*", (req, res) => res.sendFile(path.join(publicDir, "index.html")));

app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`Weather app listening on port ${PORT} (${process.env.NODE_ENV || "development"})`);
});

// ---- Graceful shutdown ----
function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully…`);
  server.close(() => {
    console.log("Closed remaining connections. Exiting.");
    process.exit(0);
  });
  // Force-exit if connections don't close in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
