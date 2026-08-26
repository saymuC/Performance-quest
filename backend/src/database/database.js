import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(__dirname, "../data/banco.db");

mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);

database.pragma("foreign_keys = ON");
database.pragma("journal_mode = WAL");

export function initializeDatabase() {
    database.exec(`
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            host_token TEXT,
            status TEXT NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting', 'in_progress', 'finished')),
            total_questions INTEGER NOT NULL DEFAULT 0
                CHECK (total_questions >= 0),
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
            score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
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
            answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
            FOREIGN KEY (game_question_id) REFERENCES game_questions(id) ON DELETE CASCADE,
            UNIQUE (player_id, game_question_id)
        );

        CREATE INDEX IF NOT EXISTS idx_players_game_id ON players(game_id);
        CREATE INDEX IF NOT EXISTS idx_game_questions_game_id ON game_questions(game_id);
        CREATE INDEX IF NOT EXISTS idx_answers_player_id ON answers(player_id);
        CREATE INDEX IF NOT EXISTS idx_answers_game_question_id ON answers(game_question_id);
    `);

    addColumnIfMissing("games", "host_token", "host_token TEXT");
    addColumnIfMissing(
        "games",
        "current_question_position",
        "current_question_position INTEGER NOT NULL DEFAULT 1"
    );
    addColumnIfMissing("players", "player_token", "player_token TEXT");
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
    addColumnIfMissing("game_questions", "started_at_ms", "started_at_ms INTEGER");
    addColumnIfMissing("game_questions", "ends_at_ms", "ends_at_ms INTEGER");

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
    }
}

initializeDatabase();

export default database;
