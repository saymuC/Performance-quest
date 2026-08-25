import express from "express";
import cors from "cors";

import questionsRouter from "./src/routes/questions.js";

const app = express();

const PORT = 3000;

app.use(cors({
    origin: "http://localhost:5173"
}));

app.use(express.json({
    limit: "10kb"
}));

app.use("/api/questions", questionsRouter);

app.get("/", (req, res) => {
    res.json({
        name: "Performance Quest API",
        status: "online"
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na casa do caralho: http://localhost:${PORT}`);
});