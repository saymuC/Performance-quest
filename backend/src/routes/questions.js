import express from "express";
import { getQuestions } from "../services/enemService.js";
import { sanitizeQuestion } from "../utils/sanitizeQuestions.js";

const router = express.Router();

router.get("/", async (req, res) => {
    try {
        const year = req.query.year || 2023;

        const data = await getQuestions(year);

        const questions = data.questions.map(sanitizeQuestion)

        res.json({
            questions
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Não achou a porra das questões caralho"
        });
    }
});

export default router;