import express from "express";

import questionsRouter from "./src/routes/questions.js";

const app = express();

const PORT = 3000;

app.use(express.json());

app.use("/api/questions", questionsRouter);

app.get("/", (req, res) => {
    res.json({
        name: "Performance Quest API",
        status: "online",
        feijao: "farinha"
    });
});

app.listen(PORT, () => {
    console.log(`Esse caralho ta rodando em http://localhost:${PORT}`);
});