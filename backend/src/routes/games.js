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
const MAX_QUESTIONS_PER_GAME = 30;
const DEFAULT_QUESTION_DURATION_SECONDS = 20;
const MIN_QUESTION_DURATION_SECONDS = 1;
const MAX_QUESTION_DURATION_SECONDS = 120;
const MAX_POINTS_PER_CORRECT_ANSWER = 1000;
const MIN_POINTS_PER_CORRECT_ANSWER = 1;
const QUESTION_PREPARATION_MS = Number(process.env.QUESTION_PREPARATION_MS);
const GAME_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GAME_CODE_PATTERN = new RegExp(`^[${GAME_CODE_ALPHABET}]{6}$`);
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const findGameByCode = database.prepare(`
    SELECT id, code, host_token, status, round_state, total_questions, question_duration_seconds,
           current_question_position, created_at, started_at
    FROM games
    WHERE code = ?
`);

const findCurrentQuestion = database.prepare(`
    SELECT id, position, question_data, correct_alternative, question_year, discipline,
           started_at_ms, ends_at_ms
    FROM game_questions
    WHERE game_id = ? AND position = ?
`);

const findAnswerByPlayerAndQuestion = database.prepare(`
    SELECT id, selected_alternative
    FROM answers
    WHERE player_id = ? AND game_question_id = ?
`);

const findPlayerByToken = database.prepare(`
    SELECT id, nickname, score
    FROM players
    WHERE game_id = ? AND player_token = ?
`);

const rankingByGame = database.prepare(`
    SELECT id, nickname, profile_image, score
    FROM players
    WHERE game_id = ?
      AND id != (SELECT MIN(id) FROM players WHERE game_id = ?)
    ORDER BY score DESC, joined_at ASC, id ASC
`);

const recordGameEvent = database.prepare(`
    INSERT INTO game_events (game_id, player_id, game_question_id, event_type, event_data, occurred_at_ms)
    VALUES (?, ?, ?, ?, ?, ?)
`);

const recordAnswerAttempt = database.prepare(`
    INSERT INTO answer_attempts (
        player_id,
        game_question_id,
        selected_alternative,
        outcome,
        attempted_at_ms,
        response_time_ms
    ) VALUES (?, ?, ?, ?, ?, ?)
`);

const ensureQuestionProgress = database.prepare(`
    INSERT OR IGNORE INTO player_question_progress (
        player_id,
        game_question_id,
        presented_at_ms
    ) VALUES (?, ?, ?)
`);

const markQuestionViewed = database.prepare(`
    UPDATE player_question_progress
    SET first_viewed_at_ms = COALESCE(first_viewed_at_ms, ?)
    WHERE player_id = ? AND game_question_id = ?
`);

const markQuestionAttempted = database.prepare(`
    UPDATE player_question_progress
    SET first_viewed_at_ms = COALESCE(first_viewed_at_ms, ?),
        first_answer_attempt_at_ms = COALESCE(first_answer_attempt_at_ms, ?)
    WHERE player_id = ? AND game_question_id = ?
`);

const saveAnswer = database.transaction(({
    playerId,
    gameQuestionId,
    alternative,
    isCorrect,
    points,
    questionYear,
    discipline,
    answeredAtMs,
    responseTimeMs
}) => {
    database.prepare(`
        INSERT INTO answers (
            player_id,
            game_question_id,
            selected_alternative,
            is_correct,
            points,
            question_year,
            discipline,
            answered_at_ms,
            response_time_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        playerId,
        gameQuestionId,
        alternative,
        Number(isCorrect),
        points,
        questionYear,
        discipline,
        answeredAtMs,
        responseTimeMs
    );

    database.prepare(`
        UPDATE players
        SET score = score + ?,
            correct_answers = correct_answers + ?,
            wrong_answers = wrong_answers + ?
        WHERE id = ?
    `).run(points, Number(isCorrect), Number(!isCorrect), playerId);

    recordAnswerAttempt.run(
        playerId,
        gameQuestionId,
        alternative,
        "accepted",
        answeredAtMs,
        responseTimeMs
    );

    markQuestionAttempted.run(answeredAtMs, answeredAtMs, playerId, gameQuestionId);
    database.prepare(`
        UPDATE player_question_progress
        SET answered_at_ms = ?, response_time_ms = ?
        WHERE player_id = ? AND game_question_id = ?
    `).run(answeredAtMs, responseTimeMs, playerId, gameQuestionId);

    return database.prepare("SELECT score FROM players WHERE id = ?").get(playerId).score;
});

const createGame = database.transaction(({
    hostNickname,
    hostProfileImage,
    questions,
    questionDurationSeconds,
    selectedYear,
    selectedArea,
    requestedQuantity
}) => {
    let game;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = createGameCode();
        const hostToken = randomUUID();

        try {
            const result = database.prepare(`
                INSERT INTO games (
                    code,
                    host_token,
                    total_questions,
                    question_duration_seconds,
                    selected_year,
                    selected_area,
                    requested_quantity
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                code,
                hostToken,
                questions.length,
                questionDurationSeconds,
                selectedYear,
                selectedArea,
                requestedQuantity
            );

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
        INSERT INTO players (game_id, nickname, player_token, profile_image)
        VALUES (?, ?, ?, ?)
    `).run(game.id, hostNickname, hostPlayerToken, hostProfileImage);

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

    recordGameEvent.run(
        game.id,
        Number(hostPlayerResult.lastInsertRowid),
        null,
        "game_created",
        JSON.stringify({
            year: selectedYear,
            area: selectedArea,
            requestedQuantity,
            questionDurationSeconds
        }),
        Date.now()
    );

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
            years,
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

        const normalizedArea = area?.trim().toLowerCase();
        const selectedYears = normalizeSelectedYears(years, year);
        if (process.env.HOST_PASSWORD && req.get("x-host-password") !== process.env.HOST_PASSWORD) {
            return res.status(401).json({ error: "Senha do host inválida." });
        }
        const questions = await collectQuestions({
            years: selectedYears,
            area: normalizedArea,
            quantity: Number(quantity)
        });

        if (questions.length === 0) {
            return res.status(422).json({
                error: "Não existem questões disponíveis para os filtros informados."
            });
        }

        const game = createGame({
            hostNickname: hostNickname.trim(),
            hostProfileImage: normalizeProfileImage(req.body.profileImage),
            questions,
            questionDurationSeconds: Number(questionDurationSeconds),
            selectedYear: selectedYears[0],
            selectedArea: normalizedArea || null,
            requestedQuantity: Number(quantity)
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
        const code = normalizeGameCode(req.params.code);
        const nickname = typeof req.body.nickname === "string"
            ? req.body.nickname.trim()
            : "";

        if (!code) {
            return res.status(422).json({ error: "Código de sala inválido." });
        }

        const game = findGameByCode.get(code);

        if (!game) {
            return res.status(404).json({ error: "Sala não encontrada." });
        }

        if (game.status !== "waiting") {
            return res.status(409).json({ error: "A partida já foi iniciada." });
        }

        if (!isValidNickname(nickname)) {
            return res.status(422).json({
                error: "O apelido deve ter entre 2 e 30 caracteres."
            });
        }

        if (findProhibitedTerm(nickname)) {
            return res.status(422).json({
                error: "O apelido contém conteúdo não permitido. Escolha outro."
            });
        }

        const profileImage = normalizeProfileImage(req.body.profileImage);
        if (req.body.profileImage !== undefined && !profileImage) {
            return res.status(422).json({ error: "Imagem de perfil inválida ou muito grande." });
        }
        const playerToken = randomUUID();
        const result = database.prepare(`
            INSERT INTO players (game_id, nickname, player_token, profile_image)
            VALUES (?, ?, ?, ?)
        `).run(game.id, nickname, playerToken, profileImage);

        recordGameEvent.run(
            game.id,
            Number(result.lastInsertRowid),
            null,
            "player_joined",
            null,
            Date.now()
        );

        return res.status(201).json({
            player: {
                id: Number(result.lastInsertRowid),
                nickname,
                playerToken,
                profileImage
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
        const code = normalizeGameCode(req.params.code);
        const hostToken = req.get("x-host-token");

        if (!code) {
            return res.status(422).json({ error: "Código de sala inválido." });
        }

        if (!isValidToken(hostToken)) {
            return res.status(401).json({ error: "Token do host inválido." });
        }

        const game = findGameByCode.get(code);

        if (!game) {
            return res.status(404).json({ error: "Sala não encontrada." });
        }

        if (!hostToken || hostToken !== game.host_token) {
            return res.status(403).json({ error: "Apenas o host pode iniciar a partida." });
        }

        if (game.status !== "waiting") {
            return res.status(409).json({ error: "A partida já foi iniciada." });
        }

        const questionStartedAtMs = Date.now() + QUESTION_PREPARATION_MS;
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

            const currentQuestion = findCurrentQuestion.get(
                game.id,
                game.current_question_position
            );

            database.prepare(`
                INSERT OR IGNORE INTO player_question_progress (
                    player_id,
                    game_question_id,
                    presented_at_ms
                )
                SELECT id, ?, ?
                FROM players
                WHERE game_id = ?
            `).run(currentQuestion.id, questionStartedAtMs, game.id);

            recordGameEvent.run(
                game.id,
                null,
                currentQuestion.id,
                "question_started",
                JSON.stringify({ position: currentQuestion.position }),
                questionStartedAtMs
            );
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

router.post("/validate-nickname", (req, res) => {
    const nickname = typeof req.body.nickname === "string" ? req.body.nickname.trim() : "";
    if (!isValidNickname(nickname)) {
        return res.status(422).json({ error: "O apelido deve ter pelo menos 2 letras." });
    }
    if (findProhibitedTerm(nickname)) {
        return res.status(422).json({ error: "Escolha outro apelido." });
    }
    return res.status(204).end();
});

router.post("/:code/leave", (req, res, next) => {
    try {
        const code = normalizeGameCode(req.params.code);
        const playerToken = req.get("x-player-token");
        const game = code && findGameByCode.get(code);
        if (!game) return res.status(404).json({ error: "Sala não encontrada." });
        if (!isValidToken(playerToken)) return res.status(401).json({ error: "Token de jogador inválido." });
        const player = findPlayerByToken.get(game.id, playerToken);
        if (!player) return res.status(401).json({ error: "Token de jogador inválido." });
        if (playerToken === game.host_token) return res.status(409).json({ error: "O host não pode sair da própria sala." });
        database.prepare("DELETE FROM players WHERE id = ?").run(player.id);
        return res.status(204).end();
    } catch (error) {
        return handleGameError(error, res, next);
    }
});

router.post("/:code/next", (req, res, next) => {
    try {
        const code = normalizeGameCode(req.params.code);
        const hostToken = req.get("x-host-token");
        const game = code && findGameByCode.get(code);
        if (!game) return res.status(404).json({ error: "Sala não encontrada." });
        if (!isValidToken(hostToken) || hostToken !== game.host_token) {
            return res.status(403).json({ error: "Apenas o host pode avançar." });
        }
        if (game.status !== "in_progress") return res.status(409).json({ error: "A partida não está em andamento." });
        const currentQuestion = findCurrentQuestion.get(game.id, game.current_question_position);
        if (game.round_state === "question") {
            finishRound(game.id, currentQuestion.id, "host_skipped");
            return res.status(200).json({ status: "results", phase: "results" });
        }
        const nextPosition = game.current_question_position + 1;
        if (nextPosition > game.total_questions) {
            database.prepare("UPDATE games SET status = 'finished', finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(game.id);
            return res.status(200).json({ status: "finished" });
        }
        const startedAt = Date.now() + QUESTION_PREPARATION_MS;
        const endsAt = startedAt + (game.question_duration_seconds * 1000);
        database.transaction(() => {
            database.prepare("UPDATE games SET current_question_position = ?, round_state = 'question' WHERE id = ?").run(nextPosition, game.id);
            database.prepare("UPDATE game_questions SET started_at_ms = ?, ends_at_ms = ? WHERE game_id = ? AND position = ?").run(startedAt, endsAt, game.id, nextPosition);
        })();
        return res.status(200).json({ status: "in_progress", position: nextPosition, endsAt });
    } catch (error) {
        return handleGameError(error, res, next);
    }
});

router.post("/:code/close", (req, res, next) => {
    try {
        const code = normalizeGameCode(req.params.code);
        const hostToken = req.get("x-host-token");
        const game = code && findGameByCode.get(code);

        if (!game) return res.status(404).json({ error: "Sala não encontrada." });
        if (!isValidToken(hostToken) || hostToken !== game.host_token) {
            return res.status(403).json({ error: "Apenas o host pode fechar a sala." });
        }

        database.prepare("DELETE FROM games WHERE id = ?").run(game.id);
        return res.status(204).end();
    } catch (error) {
        return handleGameError(error, res, next);
    }
});

router.get("/:code/current", (req, res, next) => {
    try {
        const code = normalizeGameCode(req.params.code);

        if (!code) {
            return res.status(422).json({ error: "Código de sala inválido." });
        }

        const game = findGameByCode.get(code);

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

        const nowMs = Date.now();

        if (game.round_state === "question" && isQuestionExpired(currentQuestion, nowMs)) {
            finishRound(game.id, currentQuestion.id, "time_expired");
        }

        if (game.round_state === "results" || isQuestionExpired(currentQuestion, nowMs)) {
            return res.status(200).json(buildRoundResults(game, currentQuestion));
        }

        const playerToken = req.get("x-player-token");
        let playerAnswer = null;

        if (playerToken) {
            if (!isValidToken(playerToken)) {
                return res.status(401).json({ error: "Token de jogador inválido." });
            }

            const player = findPlayerByToken.get(game.id, playerToken);

            if (!player) {
                return res.status(401).json({ error: "Token de jogador inválido." });
            }

            ensureQuestionProgress.run(player.id, currentQuestion.id, currentQuestion.started_at_ms);
            markQuestionViewed.run(nowMs, player.id, currentQuestion.id);
            playerAnswer = findAnswerByPlayerAndQuestion.get(
                player.id,
                currentQuestion.id
            )?.selected_alternative || null;
        }

        return res.status(200).json({
            question: JSON.parse(currentQuestion.question_data),
            position: currentQuestion.position,
            totalQuestions: game.total_questions,
            questionDurationSeconds: game.question_duration_seconds,
            questionStartedAt: currentQuestion.started_at_ms,
            questionEndsAt: currentQuestion.ends_at_ms,
            discipline: currentQuestion.discipline,
            questionYear: currentQuestion.question_year,
            remainingTimeMs: Math.max(0, currentQuestion.ends_at_ms - Date.now()),
            playerAnswer,
            expectedAnswers: database.prepare("SELECT COUNT(*) AS count FROM players WHERE game_id = ? AND id != (SELECT MIN(id) FROM players WHERE game_id = ?)").get(game.id, game.id).count,
            receivedAnswers: database.prepare("SELECT COUNT(*) AS count FROM answers WHERE game_question_id = ?").get(currentQuestion.id).count
        });
    } catch (error) {
        return handleGameError(error, res, next);
    }
});

router.post("/:code/answer", (req, res, next) => {
    try {
        const code = normalizeGameCode(req.params.code);
        const playerToken = req.get("x-player-token");
        const alternative = typeof req.body.alternative === "string"
            ? req.body.alternative.trim().toUpperCase()
            : "";

        if (!code) {
            return res.status(422).json({ error: "Código de sala inválido." });
        }

        if (!isValidToken(playerToken)) {
            return res.status(401).json({ error: "Token de jogador inválido." });
        }

        const game = findGameByCode.get(code);

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

        const hostPlayer = database.prepare(`
            SELECT id FROM players WHERE game_id = ? ORDER BY id ASC LIMIT 1
        `).get(game.id);
        if (hostPlayer && player.id === hostPlayer.id) {
            return res.status(403).json({ error: "O host não responde às questões." });
        }

        const currentQuestion = findCurrentQuestion.get(game.id, game.current_question_position);

        if (!currentQuestion) {
            return res.status(409).json({ error: "Não existe uma questão ativa nesta partida." });
        }

        const answeredAtMs = Date.now();
        const responseTimeMs = Math.max(
            0,
            answeredAtMs - currentQuestion.started_at_ms
        );

        ensureQuestionProgress.run(
            player.id,
            currentQuestion.id,
            currentQuestion.started_at_ms
        );

        if (answeredAtMs < currentQuestion.started_at_ms) {
            return res.status(409).json({ error: "Aguarde o início da questão." });
        }

        if (isQuestionExpired(currentQuestion, answeredAtMs)) {
            recordAnswerAttempt.run(
                player.id,
                currentQuestion.id,
                alternative || null,
                "expired",
                answeredAtMs,
                responseTimeMs
            );
            markQuestionAttempted.run(
                answeredAtMs,
                answeredAtMs,
                player.id,
                currentQuestion.id
            );
            return res.status(409).json({ error: "O tempo desta questão terminou." });
        }

        if (!/^[A-E]$/.test(alternative)) {
            recordAnswerAttempt.run(
                player.id,
                currentQuestion.id,
                alternative || null,
                "invalid_alternative",
                answeredAtMs,
                responseTimeMs
            );
            markQuestionAttempted.run(
                answeredAtMs,
                answeredAtMs,
                player.id,
                currentQuestion.id
            );
            return res.status(422).json({ error: "Alternativa inválida." });
        }

        if (findAnswerByPlayerAndQuestion.get(player.id, currentQuestion.id)) {
            recordAnswerAttempt.run(
                player.id,
                currentQuestion.id,
                alternative,
                "duplicate",
                answeredAtMs,
                responseTimeMs
            );
            markQuestionAttempted.run(
                answeredAtMs,
                answeredAtMs,
                player.id,
                currentQuestion.id
            );
            return res.status(409).json({
                error: "Você já respondeu a questão atual."
            });
        }

        const question = JSON.parse(currentQuestion.question_data);
        const alternativeExists = question.alternatives.some(
            (currentAlternative) => currentAlternative.letter === alternative
        );

        if (!alternativeExists) {
            recordAnswerAttempt.run(
                player.id,
                currentQuestion.id,
                alternative,
                "invalid_alternative",
                answeredAtMs,
                responseTimeMs
            );
            markQuestionAttempted.run(
                answeredAtMs,
                answeredAtMs,
                player.id,
                currentQuestion.id
            );
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
            points,
            questionYear: currentQuestion.question_year,
            discipline: currentQuestion.discipline,
            answeredAtMs,
            responseTimeMs
        });
        const roundFinished = finishRoundWhenEveryoneAnswered(game, currentQuestion);

        return res.status(201).json({
            correct: isCorrect,
            points,
            totalScore,
            roundFinished
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
        const code = normalizeGameCode(req.params.code);

        if (!code) {
            return res.status(422).json({ error: "Código de sala inválido." });
        }

        const game = findGameByCode.get(code);

        if (!game) {
            return res.status(404).json({ error: "Sala não encontrada." });
        }

        const ranking = rankingByGame.all(game.id, game.id).map((player, index) => ({
            position: index + 1,
            nickname: player.nickname,
            score: player.score
        }));

        const players = database.prepare(`
            SELECT nickname, profile_image,
                   id = (SELECT MIN(id) FROM players WHERE game_id = ?) AS is_host
            FROM players WHERE game_id = ? ORDER BY joined_at ASC, id ASC
        `).all(game.id, game.id).map((player) => ({
            nickname: player.nickname,
            profileImage: player.profile_image,
            isHost: Boolean(player.is_host)
        }));
        return res.status(200).json({ ranking, players, status: game.status });
    } catch (error) {
        return handleGameError(error, res, next);
    }
});

function validateGameCreationInput({ hostNickname, year, area, quantity, questionDurationSeconds }) {
    if (!isValidNickname(hostNickname)) {
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

function finishRoundWhenEveryoneAnswered(game, currentQuestion) {
    return database.transaction(() => {
        const freshGame = database.prepare(`
            SELECT status, round_state, current_question_position
            FROM games WHERE id = ?
        `).get(game.id);

        if (
            !freshGame ||
            freshGame.status !== "in_progress" ||
            freshGame.round_state !== "question" ||
            freshGame.current_question_position !== currentQuestion.position
        ) {
            return false;
        }

        const expectedAnswers = database.prepare(`
            SELECT COUNT(*) AS count
            FROM players
            WHERE game_id = ?
              AND id != (SELECT MIN(id) FROM players WHERE game_id = ?)
        `).get(game.id, game.id).count;
        const receivedAnswers = database.prepare(
            "SELECT COUNT(*) AS count FROM answers WHERE game_question_id = ?"
        ).get(currentQuestion.id).count;

        if (expectedAnswers === 0 || receivedAnswers < expectedAnswers) {
            return false;
        }
        finishRound(game.id, currentQuestion.id, "all_answered");
        return true;
    })();
}

function finishRound(gameId, questionId, reason) {
    database.prepare("UPDATE games SET round_state = 'results' WHERE id = ?").run(gameId);
    recordGameEvent.run(gameId, null, questionId, "round_finished", JSON.stringify({ reason }), Date.now());
}

function buildRoundResults(game, currentQuestion) {
    const question = JSON.parse(currentQuestion.question_data);
    const counts = database.prepare(`
        SELECT selected_alternative AS letter, COUNT(*) AS count
        FROM answers WHERE game_question_id = ? GROUP BY selected_alternative
    `).all(currentQuestion.id);
    const countByLetter = new Map(counts.map((row) => [row.letter, row.count]));
    return {
        phase: "results",
        position: currentQuestion.position,
        totalQuestions: game.total_questions,
        question: {
            prompt: question.context || question.alternativesIntroduction || "Leia o enunciado e responda.",
            alternatives: question.alternatives,
            correctAlternative: currentQuestion.correct_alternative
        },
        answerCounts: question.alternatives.map((alternative) => ({
            letter: alternative.letter,
            count: countByLetter.get(alternative.letter) || 0
        })),
        ranking: rankingByGame.all(game.id, game.id).slice(0, 5).map((player, index) => ({
            position: index + 1,
            nickname: player.nickname,
            profileImage: player.profile_image,
            score: player.score
        }))
    };
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
    const progress = Math.max(0, Math.min(1, remainingMs / durationMs));
    return Math.max(MIN_POINTS_PER_CORRECT_ANSWER, Math.round(
        MAX_POINTS_PER_CORRECT_ANSWER * (progress ** 1.18)
    ));
}

function shuffleQuestions(questions) {
    const shuffled = [...questions];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const randomIndex = randomBytes(1)[0] % (index + 1);
        [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
    }

    return shuffled;
}

async function collectQuestions({ years, area, quantity }) {
    const requestedYears = shuffleQuestions([...new Set(years)]);
    const questionBuckets = await Promise.all(requestedYears.map(async (year) => ({
        year,
        questions: await getCompatibleQuestions(year, area)
    })));
    const selected = takeBalancedQuestions(questionBuckets, quantity);

    // Só completa com anos anteriores quando os anos escolhidos não têm questões suficientes.
    for (
        let year = Math.min(...requestedYears) - 1;
        year >= 2009 && selected.length < quantity;
        year -= 1
    ) {
        questionBuckets.push({ year, questions: await getCompatibleQuestions(year, area) });
        selected.push(...takeBalancedQuestions(questionBuckets, quantity - selected.length));
    }

    return shuffleQuestions(selected).slice(0, quantity);
}

async function getCompatibleQuestions(year, area) {
    const data = await getQuestions(year);
    const compatible = area
        ? data.questions.filter((question) => question.discipline.toLowerCase() === area)
        : data.questions;
    return shuffleQuestions(compatible);
}

function takeBalancedQuestions(questionBuckets, quantity) {
    const selected = [];
    let available = questionBuckets.filter((bucket) => bucket.questions.length > 0);

    while (selected.length < quantity && available.length > 0) {
        for (const bucket of shuffleQuestions(available)) {
            if (selected.length >= quantity) break;
            const question = bucket.questions.pop();
            if (question) selected.push(question);
        }
        available = available.filter((bucket) => bucket.questions.length > 0);
    }

    return selected;
}

function normalizeSelectedYears(years, fallbackYear) {
    const values = Array.isArray(years) ? years : [fallbackYear];
    return [...new Set(values.map(Number).filter((year) => Number.isInteger(year) && year >= 2009 && year <= 2023))]
        .sort((first, second) => second - first);
}

function createGameCode() {
    const randomValues = randomBytes(6);

    return Array.from(randomValues, (value) =>
        GAME_CODE_ALPHABET[value % GAME_CODE_ALPHABET.length]
    ).join("");
}

function normalizeGameCode(code) {
    if (typeof code !== "string") {
        return null;
    }

    const normalizedCode = code.trim().toUpperCase();

    return GAME_CODE_PATTERN.test(normalizedCode) ? normalizedCode : null;
}

function isValidToken(token) {
    return typeof token === "string" && TOKEN_PATTERN.test(token);
}

function normalizeProfileImage(value) {
    return typeof value === "string" &&
        /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value) &&
        value.length <= 180_000
        ? value
        : null;
}

function isValidNickname(nickname) {
    return typeof nickname === "string" &&
        nickname.trim().length >= 2 &&
        /[A-Za-zÀ-ÿ]/.test(nickname) &&
        !/[\u0000-\u001F\u007F]/.test(nickname);
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
