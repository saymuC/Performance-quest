import express from "express";
import {
    EnemApiInvalidResponseError,
    EnemApiUnavailableError,
    getQuestions
} from "../services/enemService.js";
import { sanitizeQuestion } from "../utils/sanitizeQuestions.js";

const router = express.Router();
const MAX_QUESTIONS_PER_REQUEST = 50;

router.get("/", async (req, res) => {
    try {
        const { year, area, quantity } = req.query;

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

        const normalizedArea = typeof area === "string" ? area.trim().toLowerCase() : "";

        if (area !== undefined && !normalizedArea) {
            return res.status(422).json({
                error: "A área deve ser um texto válido."
            });
        }

        const quantityNumber = Number(quantity);

        if (quantity !== undefined && (
            !Number.isInteger(quantityNumber) ||
            quantityNumber < 1 ||
            quantityNumber > MAX_QUESTIONS_PER_REQUEST
        )) {
            return res.status(422).json({
                error: `A quantidade deve ser um número inteiro entre 1 e ${MAX_QUESTIONS_PER_REQUEST}.`
            });
        }

        const data = await getQuestions(year);

        let questions = data.questions;

        if (normalizedArea) {
            questions = questions.filter((question) =>
                question.discipline?.toLowerCase() === normalizedArea
            );
        }

        if (quantity !== undefined) {
            questions = questions.slice(0, quantityNumber);
        }

        questions = questions.map(sanitizeQuestion);

        res.json({
            questions
        });
    } catch (error) {
        console.error(error);

        if (
            error instanceof EnemApiUnavailableError ||
            error instanceof EnemApiInvalidResponseError
        ) {
            return res.status(502).json({
                error: "O serviço de questões do ENEM está indisponível. Tente novamente mais tarde."
            });
        }

        res.status(500).json({
            error: "Não foi possível buscar as questões."
        });
    }
});

export default router;
