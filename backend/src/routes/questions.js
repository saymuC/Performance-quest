import express from "express";
import { getQuestions } from "../services/enemService.js";
import { sanitizeQuestion } from "../utils/sanitizeQuestions.js";

const router = express.Router();

router.get("/", async (req, res) => {
    try {
        const { year } = req.query;

        // validação 1: o valor year existe?
        if (year === undefined || year === "") {
            return res.status(400).json({
                error: "O parâmetro Ano é obrigatório."
            });
        }

        const yearNumber = Number(year);

        //validação 2: o valor year é um numero?
        if (!Number.isInteger(yearNumber)) {
            return res.status(422).json({
                error: "O ano deve ser um número inteiro."
            });
        }

        //validação 3: o valor year está entre 2009 e 2023?
        if (yearNumber < 2009 || yearNumber > 2023) {
            return res.status(422).json({
                error: "O ano de busca deve estar entre 2009 e 2023."
            });
        }
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