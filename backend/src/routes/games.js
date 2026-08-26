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
const DEFAULT_QUESTION_DURATION_SECONDS = 20;
const MIN_QUESTION_DURATION_SECONDS = 1;
const MAX_QUESTION_DURATION_SECONDS = 120;
const MAX_POINTS_PER_CORRECT_ANSWER = 1000;
const MIN_POINTS_PER_CORRECT_ANSWER = 100;
const GAME_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const findGameByCode = database.prepare(`
    SELECT id, code, host_token, status, total_questions, question_duration_seconds,
           current_question_position, created_at, started_at
    FROM games
    WHERE code = ?
`);

const findCurrentQuestion = database.prepare(`
    SELECT id, position, question_data, correct_alternative, started_at_ms, ends_at_ms
    FROM game_questions
    WHERE game_id = ? AND position = ?
`);

const findPlayerByToken = database.prepare(`
    SELECT id, nickname, score
    FROM players
    WHERE game_id = ? AND player_token = ?
`);

const rankingByGame = database.prepare(`
    SELECT id, nickname, score
    FROM players
    WHERE game_id = ?
    ORDER BY score DESC, joined_at ASC, id ASC
`);

const saveAnswer = database.transaction(({ playerId, gameQuestionId, alternative, isCorrect, points }) => {
    database.prepare(`
        INSERT INTO answers (
            player_id,
            game_question_id,
            selected_alternative,
            is_correct,
            points
        ) VALUES (?, ?, ?, ?, ?)
    `).run(playerId, gameQuestionId, alternative, Number(isCorrect), points);

    database.prepare(`
        UPDATE players
        SET score = score + ?
        WHERE id = ?
    `).run(points, playerId);

    return database.prepare("SELECT score FROM players WHERE id = ?").get(playerId).score;
});

const createGame = database.transaction(({ hostNickname, questions, questionDurationSeconds }) => {
    let game;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = createGameCode();
        const hostToken = randomUUID();

        try {
            const result = database.prepare(`
                INSERT INTO games (code, host_token, total_questions, question_duration_seconds)
                VALUES (?, ?, ?, ?)
            `).run(code, hostToken, questions.length, questionDurationSeconds);

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
        const {
            hostNickname,
            year,
            area,
            quantity = 10,
            questionDurationSeconds = DEFAULT_QUESTION_DURATION_SECONDS
        } = req.body;
        const validationError = validateGameCreationInput({
            hostNickname,
            year,
            area,
            quantity,
            questionDurationSeconds
        });

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
            questions,
            questionDurationSeconds: Number(questionDurationSeconds)
        });

        return res.status(201).json({
            game: {
                code: game.code,
                status: "waiting",
                totalQuestions: game.totalQuestions,
                questionDurationSeconds: Number(questionDurationSeconds)
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

        const questionStartedAtMs = Date.now();
        const questionEndsAtMs = questionStartedAtMs + (game.question_duration_seconds * 1000);

        database.transaction(() => {
            database.prepare(`
            UPDATE games
            SET status = 'in_progress', started_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `).run(game.id);

            database.prepare(`
                UPDATE game_questions
                SET started_at_ms = ?, ends_at_ms = ?
                WHERE game_id = ? AND position = ?
            `).run(questionStartedAtMs, questionEndsAtMs, game.id, game.current_question_position);
        })();

        return res.status(200).json({
            game: {
                code: game.code,
                status: "in_progress",
                totalQuestions: game.total_questions,
                questionDurationSeconds: game.question_duration_seconds,
                questionStartedAt: questionStartedAtMs,
                questionEndsAt: questionEndsAtMs
            }
        });
    } catch (error) {
        return handleGameError(error, res, next);
    }
});

router.get("/:code/current", (req, res, next) => {
    try {
        const game = findGameByCode.get(normalizeGameCode(req.params.code));

        if (!game) {
            return res.status(404).json({ error: "Sala não encontrada." });
        }

        if (game.status !== "in_progress") {
            return res.status(409).json({ error: "A partida ainda não está em andamento." });
        }

        const currentQuestion = findCurrentQuestion.get(game.id, game.current_question_position);

        if (!currentQuestion) {
            return res.status(409).json({ error: "Não existe uma questão ativa nesta partida." });
        }

        const answeredAtMs = Date.now();

        if (isQuestionExpired(currentQuestion, answeredAtMs)) {
            return res.status(409).json({ error: "O tempo desta questão terminou." });
        }

        return res.status(200).json({
            question: JSON.parse(currentQuestion.question_data),
            position: currentQuestion.position,
            totalQuestions: game.total_questions,
            questionDurationSeconds: game.question_duration_seconds,
            questionStartedAt: currentQuestion.started_at_ms,
            questionEndsAt: currentQuestion.ends_at_ms,
            remainingTimeMs: Math.max(0, currentQuestion.ends_at_ms - Date.now())
        });
    } catch (error) {
        return handleGameError(error, res, next);
    }
});

router.post("/:code/answer", (req, res, next) => {
    try {
        const game = findGameByCode.get(normalizeGameCode(req.params.code));
        const playerToken = req.get("x-player-token");
        const alternative = typeof req.body.alternative === "string"
            ? req.body.alternative.trim().toUpperCase()
            : "";

        if (!game) {
            return res.status(404).json({ error: "Sala não encontrada." });
        }

        if (game.status !== "in_progress") {
            return res.status(409).json({ error: "A partida não está recebendo respostas." });
        }

        const player = findPlayerByToken.get(game.id, playerToken);

        if (!player) {
            return res.status(401).json({ error: "Token de jogador inválido." });
        }

        const currentQuestion = findCurrentQuestion.get(game.id, game.current_question_position);

        if (!currentQuestion) {
            return res.status(409).json({ error: "Não existe uma questão ativa nesta partida." });
        }

        const answeredAtMs = Date.now();

        if (isQuestionExpired(currentQuestion, answeredAtMs)) {
            return res.status(409).json({ error: "O tempo desta questão terminou." });
        }

        const question = JSON.parse(currentQuestion.question_data);
        const alternativeExists = question.alternatives.some(
            (currentAlternative) => currentAlternative.letter === alternative
        );

        if (!alternativeExists) {
            return res.status(422).json({ error: "Alternativa inválida para esta questão." });
        }

        const isCorrect = alternative === currentQuestion.correct_alternative;
        const points = calculatePoints({
            isCorrect,
            startedAtMs: currentQuestion.started_at_ms,
            endsAtMs: currentQuestion.ends_at_ms,
            answeredAtMs
        });
        const totalScore = saveAnswer({
            playerId: player.id,
            gameQuestionId: currentQuestion.id,
            alternative,
            isCorrect,
            points
        });

        return res.status(201).json({
            correct: isCorrect,
            points,
            totalScore
        });
    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(409).json({
                error: "Você já respondeu a questão atual."
            });
        }

        return handleGameError(error, res, next);
    }
});

router.get("/:code/ranking", (req, res, next) => {
    try {
        const game = findGameByCode.get(normalizeGameCode(req.params.code));

        if (!game) {
            return res.status(404).json({ error: "Sala não encontrada." });
        }

        const ranking = rankingByGame.all(game.id).map((player, index) => ({
            position: index + 1,
            nickname: player.nickname,
            score: player.score
        }));

        return res.status(200).json({ ranking });
    } catch (error) {
        return handleGameError(error, res, next);
    }
});

function validateGameCreationInput({ hostNickname, year, area, quantity, questionDurationSeconds }) {
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

    if (
        !Number.isInteger(Number(questionDurationSeconds)) ||
        Number(questionDurationSeconds) < MIN_QUESTION_DURATION_SECONDS ||
        Number(questionDurationSeconds) > MAX_QUESTION_DURATION_SECONDS
    ) {
        return `A duração por questão deve ser um número inteiro entre ${MIN_QUESTION_DURATION_SECONDS} e ${MAX_QUESTION_DURATION_SECONDS} segundos.`;
    }

    return null;
}

function isQuestionExpired(question, now = Date.now()) {
    return !Number.isInteger(question.started_at_ms) ||
        !Number.isInteger(question.ends_at_ms) ||
        now >= question.ends_at_ms;
}

function calculatePoints({ isCorrect, startedAtMs, endsAtMs, answeredAtMs }) {
    if (!isCorrect) {
        return 0;
    }

    const durationMs = endsAtMs - startedAtMs;
    const remainingMs = Math.max(0, endsAtMs - answeredAtMs);
    const variablePoints = MAX_POINTS_PER_CORRECT_ANSWER - MIN_POINTS_PER_CORRECT_ANSWER;

    return MIN_POINTS_PER_CORRECT_ANSWER + Math.floor(
        (variablePoints * remainingMs) / durationMs
    );
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
