import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../config/environment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databasePath = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.resolve(__dirname, "../data/banco.db");

mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);

database.pragma("foreign_keys = ON");
database.pragma("journal_mode = WAL");
database.pragma("synchronous = NORMAL");
database.pragma("busy_timeout = 5000");
database.pragma("temp_store = MEMORY");

export function initializeDatabase() {
    database.exec(`
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            host_token TEXT,
            status TEXT NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting', 'in_progress', 'finished')),
            round_state TEXT NOT NULL DEFAULT 'question'
                CHECK (round_state IN ('question', 'results')),
            total_questions INTEGER NOT NULL DEFAULT 0
                CHECK (total_questions >= 0),
            selected_year INTEGER,
            selected_area TEXT,
            requested_quantity INTEGER,
            question_duration_seconds INTEGER NOT NULL DEFAULT 20
                CHECK (question_duration_seconds BETWEEN 1 AND 120),
            current_question_position INTEGER NOT NULL DEFAULT 1
                CHECK (current_question_position >= 1),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            started_at TEXT,
            finished_at TEXT
        );

        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            nickname TEXT NOT NULL COLLATE NOCASE,
            player_token TEXT,
            profile_image TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            active_from_position INTEGER NOT NULL DEFAULT 1,
            score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
            correct_answers INTEGER NOT NULL DEFAULT 0 CHECK (correct_answers >= 0),
            wrong_answers INTEGER NOT NULL DEFAULT 0 CHECK (wrong_answers >= 0),
            joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
            UNIQUE (game_id, nickname)
        );

        CREATE TABLE IF NOT EXISTS game_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            position INTEGER NOT NULL CHECK (position >= 1),
            external_question_index INTEGER,
            question_year INTEGER NOT NULL,
            discipline TEXT NOT NULL,
            question_data TEXT NOT NULL,
            correct_alternative TEXT NOT NULL,
            started_at_ms INTEGER,
            ends_at_ms INTEGER,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
            UNIQUE (game_id, position)
        );

        CREATE TABLE IF NOT EXISTS answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            game_question_id INTEGER NOT NULL,
            selected_alternative TEXT NOT NULL,
            is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
            points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
            question_year INTEGER,
            discipline TEXT,
            answered_at_ms INTEGER,
            response_time_ms INTEGER,
            answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
            FOREIGN KEY (game_question_id) REFERENCES game_questions(id) ON DELETE CASCADE,
            UNIQUE (player_id, game_question_id)
        );

        CREATE TABLE IF NOT EXISTS game_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            player_id INTEGER,
            game_question_id INTEGER,
            event_type TEXT NOT NULL,
            event_data TEXT,
            occurred_at_ms INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL,
            FOREIGN KEY (game_question_id) REFERENCES game_questions(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS player_question_progress (
            player_id INTEGER NOT NULL,
            game_question_id INTEGER NOT NULL,
            presented_at_ms INTEGER NOT NULL,
            first_viewed_at_ms INTEGER,
            first_answer_attempt_at_ms INTEGER,
            answered_at_ms INTEGER,
            response_time_ms INTEGER,
            PRIMARY KEY (player_id, game_question_id),
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
            FOREIGN KEY (game_question_id) REFERENCES game_questions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS answer_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            game_question_id INTEGER NOT NULL,
            selected_alternative TEXT,
            outcome TEXT NOT NULL,
            attempted_at_ms INTEGER NOT NULL,
            response_time_ms INTEGER,
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
            FOREIGN KEY (game_question_id) REFERENCES game_questions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_players_game_id ON players(game_id);
        CREATE INDEX IF NOT EXISTS idx_game_questions_game_id ON game_questions(game_id);
        CREATE INDEX IF NOT EXISTS idx_answers_player_id ON answers(player_id);
        CREATE INDEX IF NOT EXISTS idx_answers_game_question_id ON answers(game_question_id);
        CREATE INDEX IF NOT EXISTS idx_game_events_game_id ON game_events(game_id);
        CREATE INDEX IF NOT EXISTS idx_game_events_player_id ON game_events(player_id);
        CREATE INDEX IF NOT EXISTS idx_progress_question_id ON player_question_progress(game_question_id);
        CREATE INDEX IF NOT EXISTS idx_answer_attempts_player_id ON answer_attempts(player_id);
        CREATE INDEX IF NOT EXISTS idx_answer_attempts_question_id ON answer_attempts(game_question_id);
    `);

    addColumnIfMissing("games", "host_token", "host_token TEXT");
    addColumnIfMissing(
        "games",
        "round_state",
        "round_state TEXT NOT NULL DEFAULT 'question'"
    );
    addColumnIfMissing(
        "games",
        "current_question_position",
        "current_question_position INTEGER NOT NULL DEFAULT 1"
    );
    addColumnIfMissing("players", "player_token", "player_token TEXT");
    addColumnIfMissing("players", "profile_image", "profile_image TEXT");
    addColumnIfMissing("players", "is_active", "is_active INTEGER NOT NULL DEFAULT 1");
    addColumnIfMissing("players", "active_from_position", "active_from_position INTEGER NOT NULL DEFAULT 1");
    const addedCorrectAnswers = addColumnIfMissing(
        "players",
        "correct_answers",
        "correct_answers INTEGER NOT NULL DEFAULT 0"
    );
    const addedWrongAnswers = addColumnIfMissing(
        "players",
        "wrong_answers",
        "wrong_answers INTEGER NOT NULL DEFAULT 0"
    );
    addColumnIfMissing(
        "game_questions",
        "external_question_index",
        "external_question_index INTEGER"
    );
    addColumnIfMissing(
        "games",
        "question_duration_seconds",
        "question_duration_seconds INTEGER NOT NULL DEFAULT 20"
    );
    addColumnIfMissing("games", "selected_year", "selected_year INTEGER");
    addColumnIfMissing("games", "selected_area", "selected_area TEXT");
    addColumnIfMissing("games", "requested_quantity", "requested_quantity INTEGER");
    addColumnIfMissing("game_questions", "started_at_ms", "started_at_ms INTEGER");
    addColumnIfMissing("game_questions", "ends_at_ms", "ends_at_ms INTEGER");
    addColumnIfMissing("answers", "question_year", "question_year INTEGER");
    addColumnIfMissing("answers", "discipline", "discipline TEXT");
    addColumnIfMissing("answers", "answered_at_ms", "answered_at_ms INTEGER");
    addColumnIfMissing("answers", "response_time_ms", "response_time_ms INTEGER");

    if (addedCorrectAnswers || addedWrongAnswers) {
        database.exec(`
            UPDATE players
            SET correct_answers = (
                    SELECT COUNT(*)
                    FROM answers
                    WHERE answers.player_id = players.id AND answers.is_correct = 1
                ),
                wrong_answers = (
                    SELECT COUNT(*)
                    FROM answers
                    WHERE answers.player_id = players.id AND answers.is_correct = 0
                )
        `);
    }

    database.exec(`
        UPDATE answers
        SET question_year = (
                SELECT question_year
                FROM game_questions
                WHERE game_questions.id = answers.game_question_id
            ),
            discipline = (
                SELECT discipline
                FROM game_questions
                WHERE game_questions.id = answers.game_question_id
            )
        WHERE question_year IS NULL OR discipline IS NULL
    `);

    database.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_games_host_token
            ON games(host_token) WHERE host_token IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_players_player_token
            ON players(player_token) WHERE player_token IS NOT NULL;
    `);
}

function addColumnIfMissing(table, column, definition) {
    const columns = database.pragma(`table_info(${table})`);
    const columnExists = columns.some((currentColumn) => currentColumn.name === column);

    if (!columnExists) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
        return true;
    }

    return false;
}

initializeDatabase();

export default database;
