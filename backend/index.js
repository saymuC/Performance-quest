import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

import gamesRouter from "./src/routes/games.js";
import questionsRouter from "./src/routes/questions.js";
import statsRouter from "./src/routes/stats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const app = express();

const PORT = Number(process.env.PORT);
const FRONTEND_URL = process.env.FRONTEND_URL;
const REQUEST_BODY_LIMIT = process.env.REQUEST_BODY_LIMIT;
const RATE_LIMIT_WINDOW_MS = parsePositiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000);
const RATE_LIMIT_MAX_REQUESTS = parsePositiveInteger(process.env.RATE_LIMIT_MAX_REQUESTS, 120);
const requestsByIp = new Map();

if (!FRONTEND_URL) {
    throw new Error("FRONTEND_URL deve ser configurada.");
}

app.use((req, res, next) => {
    const origin = req.get("origin");

    if (origin && origin !== FRONTEND_URL) {
        return res.status(403).json({
            error: "Origem não autorizada."
        });
    }

    return next();
});

app.use(cors({
    origin(origin, callback) {
        if (!origin || origin === FRONTEND_URL) {
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

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});

function parsePositiveInteger(value, fallback) {
    const parsedValue = Number(value);

    return Number.isInteger(parsedValue) && parsedValue > 0
        ? parsedValue
        : fallback;
}
