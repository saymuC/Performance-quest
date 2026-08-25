import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

import gamesRouter from "./src/routes/games.js";
import questionsRouter from "./src/routes/questions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const app = express();

const PORT = Number(process.env.PORT);
const FRONTEND_URL = process.env.FRONTEND_URL;
const REQUEST_BODY_LIMIT = process.env.REQUEST_BODY_LIMIT;

app.use(cors({
    origin: FRONTEND_URL
}));

app.use(express.json({
    limit: REQUEST_BODY_LIMIT
}));

app.get("/api/health", (req, res) => {
    res.status(200).json({
        status: "online"
    });
});

app.use("/api/questions", questionsRouter);
app.use("/api/games", gamesRouter);

app.get("/", (req, res) => {
    res.json({
        name: "Performance Quest API",
        status: "online"
    });
});

app.use((error, req, res, next) => {
    console.error(error);

    res.status(500).json({
        error: "Ocorreu um erro interno."
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
