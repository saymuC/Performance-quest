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
            status TEXT NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting', 'in_progress', 'finished')),
            total_questions INTEGER NOT NULL DEFAULT 0
                CHECK (total_questions >= 0),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            started_at TEXT,
            finished_at TEXT
        );

        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            nickname TEXT NOT NULL COLLATE NOCASE,
            score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
            joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
            UNIQUE (game_id, nickname)
        );

        CREATE TABLE IF NOT EXISTS game_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            position INTEGER NOT NULL CHECK (position >= 1),
            question_year INTEGER NOT NULL,
            discipline TEXT NOT NULL,
            question_data TEXT NOT NULL,
            correct_alternative TEXT NOT NULL,
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
}

export default database;
