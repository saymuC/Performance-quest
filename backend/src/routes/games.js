import express from "express";
import { randomBytes, randomUUID } from "node:crypto";

import database from "../database/database.js";
import {
    EnemApiInvalidResponseError,
    EnemApiUnavailableError,
    getQuestions
} from "../services/enemService.js";
import { findProhibitedTerm } from "../utils/nicknameModeration.js";
import { sanitizeQuestion } from "../utils/sanitizeQuestions.js";

const router = express.Router();
const MAX_QUESTIONS_PER_GAME = 50;
const GAME_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const findGameByCode = database.prepare(`
    SELECT id, code, host_token, status, total_questions, created_at, started_at
    FROM games
    WHERE code = ?
`);

const createGame = database.transaction(({ hostNickname, questions }) => {
    let game;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = createGameCode();
        const hostToken = randomUUID();

        try {
            const result = database.prepare(`
                INSERT INTO games (code, host_token, total_questions)
                VALUES (?, ?, ?)
            `).run(code, hostToken, questions.length);

            game = {
                id: result.lastInsertRowid,
                code,
                hostToken
            };
            break;
        } catch (error) {
            if (error.code !== "SQLITE_CONSTRAINT_UNIQUE") {
                throw error;
            }
        }
    }

    if (!game) {
        throw new Error("Não foi possível gerar um código de sala único.");
    }

    const hostPlayerToken = randomUUID();
    const hostPlayerResult = database.prepare(`
        INSERT INTO players (game_id, nickname, player_token)
        VALUES (?, ?, ?)
    `).run(game.id, hostNickname, hostPlayerToken);

    const insertQuestion = database.prepare(`
        INSERT INTO game_questions (
            game_id,
            position,
            external_question_index,
            question_year,
            discipline,
            question_data,
            correct_alternative
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    questions.forEach((question, index) => {
        insertQuestion.run(
            game.id,
            index + 1,
            question.index,
            question.year,
            question.discipline,
            JSON.stringify(sanitizeQuestion(question)),
            question.correctAlternative
        );
    });

    return {
        code: game.code,
        hostToken: game.hostToken,
        hostPlayerId: Number(hostPlayerResult.lastInsertRowid),
        hostPlayerToken,
        totalQuestions: questions.length
    };
});

router.post("/", async (req, res, next) => {
    try {
        const { hostNickname, year, area, quantity = 10 } = req.body;
        const validationError = validateGameCreationInput({ hostNickname, year, area, quantity });

        if (validationError) {
            return res.status(422).json({ error: validationError });
        }

        const data = await getQuestions(Number(year));
        const normalizedArea = area?.trim().toLowerCase();
        let questions = data.questions;

        if (normalizedArea) {
            questions = questions.filter((question) =>
                question.discipline.toLowerCase() === normalizedArea
            );
        }

        questions = shuffleQuestions(questions).slice(0, Number(quantity));

        if (questions.length === 0) {
            return res.status(422).json({
                error: "Não existem questões disponíveis para os filtros informados."
            });
        }

        const game = createGame({
            hostNickname: hostNickname.trim(),
            questions
        });

        return res.status(201).json({
            game: {
                code: game.code,
                status: "waiting",
                totalQuestions: game.totalQuestions
            },
            host: {
                playerId: game.hostPlayerId,
                playerToken: game.hostPlayerToken,
                hostToken: game.hostToken
            }
        });
    } catch (error) {
        return handleGameError(error, res, next);
    }
});

router.post("/:code/join", (req, res, next) => {
    try {
        const game = findGameByCode.get(normalizeGameCode(req.params.code));
        const nickname = typeof req.body.nickname === "string"
            ? req.body.nickname.trim()
            : "";

        if (!game) {
            return res.status(404).json({ error: "Sala não encontrada." });
        }

        if (game.status !== "waiting") {
            return res.status(409).json({ error: "A partida já foi iniciada." });
        }

        if (typeof nickname !== "string" || nickname.length < 2 || nickname.length > 30) {
            return res.status(422).json({
                error: "O apelido deve ter entre 2 e 30 caracteres."
            });
        }

        if (findProhibitedTerm(nickname)) {
            return res.status(422).json({
                error: "O apelido contém conteúdo não permitido. Escolha outro."
            });
        }

        const playerToken = randomUUID();
        const result = database.prepare(`
            INSERT INTO players (game_id, nickname, player_token)
            VALUES (?, ?, ?)
        `).run(game.id, nickname, playerToken);

        return res.status(201).json({
            player: {
                id: Number(result.lastInsertRowid),
                nickname,
                playerToken
            }
        });
    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(409).json({
                error: "Este apelido já está sendo usado na sala."
            });
        }

        return handleGameError(error, res, next);
    }
});

router.post("/:code/start", (req, res, next) => {
    try {
        const game = findGameByCode.get(normalizeGameCode(req.params.code));
        const hostToken = req.get("x-host-token");

        if (!game) {
            return res.status(404).json({ error: "Sala não encontrada." });
        }

        if (!hostToken || hostToken !== game.host_token) {
            return res.status(403).json({ error: "Apenas o host pode iniciar a partida." });
        }

        if (game.status !== "waiting") {
            return res.status(409).json({ error: "A partida já foi iniciada." });
        }

        database.prepare(`
            UPDATE games
            SET status = 'in_progress', started_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(game.id);

        return res.status(200).json({
            game: {
                code: game.code,
                status: "in_progress",
                totalQuestions: game.total_questions
            }
        });
    } catch (error) {
        return handleGameError(error, res, next);
    }
});

function validateGameCreationInput({ hostNickname, year, area, quantity }) {
    if (typeof hostNickname !== "string" || hostNickname.trim().length < 2 || hostNickname.trim().length > 30) {
        return "O apelido do host deve ter entre 2 e 30 caracteres.";
    }

    if (findProhibitedTerm(hostNickname)) {
        return "O apelido do host contém conteúdo não permitido. Escolha outro.";
    }

    if (!Number.isInteger(Number(year)) || Number(year) < 2009 || Number(year) > 2023) {
        return "O ano deve ser um número inteiro entre 2009 e 2023.";
    }

    if (area !== undefined && (typeof area !== "string" || !area.trim())) {
        return "A área deve ser um texto válido.";
    }

    if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > MAX_QUESTIONS_PER_GAME) {
        return `A quantidade deve ser um número inteiro entre 1 e ${MAX_QUESTIONS_PER_GAME}.`;
    }

    return null;
}

function shuffleQuestions(questions) {
    const shuffled = [...questions];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const randomIndex = randomBytes(1)[0] % (index + 1);
        [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
    }

    return shuffled;
}

function createGameCode() {
    const randomValues = randomBytes(6);

    return Array.from(randomValues, (value) =>
        GAME_CODE_ALPHABET[value % GAME_CODE_ALPHABET.length]
    ).join("");
}

function normalizeGameCode(code) {
    return code.trim().toUpperCase();
}

function handleGameError(error, res, next) {
    if (
        error instanceof EnemApiUnavailableError ||
        error instanceof EnemApiInvalidResponseError
    ) {
        return res.status(502).json({
            error: "O serviço de questões do ENEM está indisponível. Tente novamente mais tarde."
        });
    }

    return next(error);
}

export default router;
