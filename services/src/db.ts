import Database from "better-sqlite3";
import { config } from "./config.js";

export type DB = Database.Database;

export function openDb(path = config.dbPath): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

/// Idempotent schema. Events/fills carry a UNIQUE(txHash, logIndex) so re-indexing is safe.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS mandates (
  vault TEXT PRIMARY KEY,
  issuer TEXT, mm TEXT, market TEXT, base TEXT, quote TEXT,
  createdBlock INTEGER, createdTx TEXT
);
CREATE TABLE IF NOT EXISTS events (
  txHash TEXT, logIndex INTEGER, block INTEGER, ts INTEGER,
  vault TEXT, source TEXT, name TEXT, args TEXT,
  PRIMARY KEY (txHash, logIndex)
);
CREATE INDEX IF NOT EXISTS idx_events_vault_block ON events(vault, block);
CREATE TABLE IF NOT EXISTS orders (
  vault TEXT, orderId INTEGER, isBid INTEGER, price TEXT, size TEXT,
  placedBlock INTEGER, cancelledBlock INTEGER,
  PRIMARY KEY (vault, orderId)
);
CREATE TABLE IF NOT EXISTS fills (
  txHash TEXT, logIndex INTEGER, block INTEGER, ts INTEGER,
  vault TEXT, market TEXT, orderId INTEGER, maker TEXT, taker TEXT,
  isBuyTaker INTEGER, price TEXT, filledSize TEXT, updatedSize TEXT,
  PRIMARY KEY (txHash, logIndex)
);
CREATE INDEX IF NOT EXISTS idx_fills_vault_block ON fills(vault, block);
CREATE TABLE IF NOT EXISTS checkpoints (
  txHash TEXT, logIndex INTEGER, block INTEGER, ts INTEGER,
  vault TEXT, interval INTEGER, passed INTEGER,
  spreadBps TEXT, bidDepth TEXT, askDepth TEXT, mid TEXT,
  PRIMARY KEY (txHash, logIndex)
);
CREATE TABLE IF NOT EXISTS intervals (
  vault TEXT, interval INTEGER, paid INTEGER, amount TEXT, finalizedBlock INTEGER,
  PRIMARY KEY (vault, interval)
);
CREATE TABLE IF NOT EXISTS windows (
  vault TEXT, windowIndex INTEGER, soldAtWindowStart TEXT, block INTEGER,
  PRIMARY KEY (vault, windowIndex)
);
CREATE TABLE IF NOT EXISTS fee_accruals (
  vault TEXT, interval INTEGER, amount TEXT, block INTEGER,
  PRIMARY KEY (vault, interval)
);
CREATE TABLE IF NOT EXISTS price_points (
  vault TEXT, block INTEGER, ts INTEGER, mid TEXT,
  PRIMARY KEY (vault, block)
);
CREATE TABLE IF NOT EXISTS cursor (
  source TEXT PRIMARY KEY, lastBlock INTEGER
);
CREATE TABLE IF NOT EXISTS faucet_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT, ip TEXT, ts INTEGER, monAmount TEXT
);
`;

export function getCursor(db: DB, source: string): number | null {
  const row = db.prepare("SELECT lastBlock FROM cursor WHERE source=?").get(source) as
    | { lastBlock: number }
    | undefined;
  return row?.lastBlock ?? null;
}
export function setCursor(db: DB, source: string, block: number): void {
  db.prepare(
    "INSERT INTO cursor(source,lastBlock) VALUES(?,?) ON CONFLICT(source) DO UPDATE SET lastBlock=excluded.lastBlock",
  ).run(source, block);
}
