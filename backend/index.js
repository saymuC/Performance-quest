import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "./src/config/environment.js";
import gamesRouter from "./src/routes/games.js";
import questionsRouter from "./src/routes/questions.js";
import statsRouter from "./src/routes/stats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

const PORT = parsePort(process.env.PORT, 8080);
const HOST = process.env.HOST || "0.0.0.0";
const FRONTEND_URLS = parseAllowedOrigins(process.env.FRONTEND_URL);
const REQUEST_BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || "30kb";
const RATE_LIMIT_WINDOW_MS = parsePositiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000);
const RATE_LIMIT_MAX_REQUESTS = parsePositiveInteger(process.env.RATE_LIMIT_MAX_REQUESTS, 300);
const requestsByIp = new Map();

if (FRONTEND_URLS.length === 0) {
    throw new Error("FRONTEND_URL deve ser configurada.");
}

app.set("trust proxy", 1);

app.use((req, res, next) => {
    const origin = req.get("origin");

    if (origin && !FRONTEND_URLS.includes(origin)) {
        return res.status(403).json({
            error: "Origem não autorizada."
        });
    }

    return next();
});

app.use(cors({
    origin(origin, callback) {
        if (!origin || FRONTEND_URLS.includes(origin)) {
            return callback(null, true);
        }

        return callback(null, false);
    }
}));

app.use(express.json({
    limit: REQUEST_BODY_LIMIT
}));

app.use((req, res, next) => {
    const now = Date.now();
    const ip = req.ip;
    const requestLog = requestsByIp.get(ip);

    if (!requestLog || now >= requestLog.resetAt) {
        requestsByIp.set(ip, {
            count: 1,
            resetAt: now + RATE_LIMIT_WINDOW_MS
        });
        return next();
    }

    if (requestLog.count >= RATE_LIMIT_MAX_REQUESTS) {
        res.set("Retry-After", String(Math.ceil((requestLog.resetAt - now) / 1000)));
        return res.status(429).json({
            error: "Muitas requisições. Tente novamente em instantes."
        });
    }

    requestLog.count += 1;
    return next();
});

app.get("/api/health", (req, res) => {
    res.status(200).json({
        status: "online"
    });
});

app.use("/api/questions", questionsRouter);
app.use("/api/games", gamesRouter);
app.use("/api/stats", statsRouter);

app.get("/", (req, res) => {
    res.json({
        name: "Performance Quest API",
        status: "online"
    });
});

app.use((error, req, res, next) => {
    console.error(error);

    if (error.type === "entity.too.large") {
        return res.status(413).json({
            error: "O corpo da requisição excede o limite permitido."
        });
    }

    if (error.type === "entity.parse.failed") {
        return res.status(400).json({
            error: "JSON inválido."
        });
    }

    res.status(500).json({
        error: "Ocorreu um erro interno."
    });
});

export { app, startServer };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    startServer();
}

function startServer() {
    return app.listen(PORT, HOST, () => {
        console.log(`Servidor rodando em http://${HOST}:${PORT}`);
    });
}

function parsePositiveInteger(value, fallback) {
    const parsedValue = Number(value);

    return Number.isInteger(parsedValue) && parsedValue > 0
        ? parsedValue
        : fallback;
}

function parsePort(value, fallback) {
    const port = Number(value);

    return Number.isInteger(port) && port >= 1 && port <= 65_535
        ? port
        : fallback;
}

function parseAllowedOrigins(value) {
    return (value || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
}
