import express from "express";

import database from "../database/database.js";

const router = express.Router();

const findPlayer = database.prepare(`
    SELECT id, nickname, score, correct_answers, wrong_answers
    FROM players
    WHERE id = ?
`);

const playerPerformanceByArea = database.prepare(`
    SELECT discipline AS area,
           COUNT(*) AS total_answers,
           SUM(is_correct) AS correct_answers,
           SUM(1 - is_correct) AS wrong_answers
    FROM answers
    WHERE player_id = ?
    GROUP BY discipline
    ORDER BY total_answers DESC, area ASC
`);

const playerPerformanceByYear = database.prepare(`
    SELECT question_year AS year,
           COUNT(*) AS total_answers,
           SUM(is_correct) AS correct_answers,
           SUM(1 - is_correct) AS wrong_answers
    FROM answers
    WHERE player_id = ?
    GROUP BY question_year
    ORDER BY year DESC
`);

const globalPerformance = database.prepare(`
    SELECT COUNT(*) AS total_answers,
           SUM(is_correct) AS correct_answers,
           SUM(1 - is_correct) AS wrong_answers,
           COUNT(DISTINCT player_id) AS total_players,
           COUNT(DISTINCT game_question_id) AS total_questions_answered
    FROM answers
`);

const globalPerformanceByArea = database.prepare(`
    SELECT discipline AS area,
           COUNT(*) AS total_answers,
           SUM(is_correct) AS correct_answers,
           SUM(1 - is_correct) AS wrong_answers
    FROM answers
    GROUP BY discipline
    ORDER BY total_answers DESC, area ASC
`);

const globalPerformanceByYear = database.prepare(`
    SELECT question_year AS year,
           COUNT(*) AS total_answers,
           SUM(is_correct) AS correct_answers,
           SUM(1 - is_correct) AS wrong_answers
    FROM answers
    GROUP BY question_year
    ORDER BY year DESC
`);

const globalQuestionPerformance = database.prepare(`
    SELECT game_questions.id AS game_question_id,
           game_questions.external_question_index AS external_question_index,
           game_questions.question_year AS year,
           game_questions.discipline AS area,
           COUNT(answers.id) AS total_answers,
           SUM(answers.is_correct) AS correct_answers,
           SUM(1 - answers.is_correct) AS wrong_answers
    FROM answers
    INNER JOIN game_questions ON game_questions.id = answers.game_question_id
    GROUP BY game_questions.id
    ORDER BY total_answers DESC, game_question_id ASC
`);

router.get("/overview", (req, res, next) => {
    try {
        const globalStats = globalPerformance.get();
        const overview = {
            ...formatPerformance(globalStats),
            totalPlayers: Number(globalStats.total_players) || 0,
            totalQuestionsAnswered: Number(globalStats.total_questions_answered) || 0
        };
        const byArea = globalPerformanceByArea.all().map(formatPerformance);
        const byYear = globalPerformanceByYear.all().map(formatPerformance);
        const questions = globalQuestionPerformance.all().map(formatPerformance);

        return res.status(200).json({
            overview,
            byArea,
            byYear,
            areaAnalysis: {
                highestAccuracy: findPerformanceByAccuracy(byArea, "highest"),
                lowestAccuracy: findPerformanceByAccuracy(byArea, "lowest")
            },
            yearAnalysis: {
                highestAccuracy: findPerformanceByAccuracy(byYear, "highest"),
                lowestAccuracy: findPerformanceByAccuracy(byYear, "lowest")
            },
            questionAnalysis: {
                totalQuestions: questions.length,
                mostCorrectAnswers: findQuestionBy(questions, (first, second) =>
                    second.correctAnswers - first.correctAnswers ||
                    second.accuracyPercentage - first.accuracyPercentage
                ),
                fewestCorrectAnswers: findQuestionBy(questions, (first, second) =>
                    first.correctAnswers - second.correctAnswers ||
                    first.accuracyPercentage - second.accuracyPercentage
                ),
                highestAccuracy: findQuestionBy(questions, (first, second) =>
                    second.accuracyPercentage - first.accuracyPercentage ||
                    second.totalAnswers - first.totalAnswers
                ),
                lowestAccuracy: findQuestionBy(questions, (first, second) =>
                    first.accuracyPercentage - second.accuracyPercentage ||
                    second.totalAnswers - first.totalAnswers
                ),
                questions
            }
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/:playerId", (req, res, next) => {
    try {
        const playerId = parsePlayerId(req.params.playerId);

        if (!playerId) {
            return res.status(422).json({ error: "Identificador de jogador inválido." });
        }

        const player = findPlayer.get(playerId);

        if (!player) {
            return res.status(404).json({ error: "Jogador não encontrado." });
        }

        return res.status(200).json({
            player: {
                id: player.id,
                nickname: player.nickname,
                score: player.score
            },
            performance: formatPerformance({
                total_answers: player.correct_answers + player.wrong_answers,
                correct_answers: player.correct_answers,
                wrong_answers: player.wrong_answers
            }),
            byArea: playerPerformanceByArea.all(playerId).map(formatPerformance),
            byYear: playerPerformanceByYear.all(playerId).map(formatPerformance)
        });
    } catch (error) {
        return next(error);
    }
});

function parsePlayerId(value) {
    const playerId = Number(value);

    return Number.isSafeInteger(playerId) && playerId > 0 ? playerId : null;
}

function formatPerformance(row) {
    const totalAnswers = Number(row.total_answers) || 0;
    const correctAnswers = Number(row.correct_answers) || 0;
    const wrongAnswers = Number(row.wrong_answers) || 0;

    return {
        ...("area" in row ? { area: row.area } : {}),
        ...("year" in row ? { year: row.year } : {}),
        ...("game_question_id" in row ? {
            gameQuestionId: row.game_question_id,
            externalQuestionIndex: row.external_question_index
        } : {}),
        totalAnswers,
        correctAnswers,
        wrongAnswers,
        accuracyPercentage: calculateAccuracy(correctAnswers, totalAnswers)
    };
}

function calculateAccuracy(correctAnswers, totalAnswers) {
    if (totalAnswers === 0) {
        return 0;
    }

    return Number(((correctAnswers / totalAnswers) * 100).toFixed(2));
}

function findQuestionBy(questions, compare) {
    if (questions.length === 0) {
        return null;
    }

    return [...questions].sort(compare)[0];
}

function findPerformanceByAccuracy(performance, direction) {
    if (performance.length === 0) {
        return null;
    }

    const multiplier = direction === "highest" ? -1 : 1;

    return [...performance].sort((first, second) =>
        multiplier * (first.accuracyPercentage - second.accuracyPercentage) ||
        second.totalAnswers - first.totalAnswers
    )[0];
}

export default router;
