import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Room } from "./game";
export class Store {
  db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS archives (code TEXT NOT NULL, game_no INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(code, game_no));
      CREATE TABLE IF NOT EXISTS receipts (code TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(code, receipt));`);
  }
  get(code: string, history = true): Room | undefined {
    const row = this.db.prepare("SELECT body FROM rooms WHERE code = ?").get(code) as { body: string } | undefined;
    if (!row) return;
    const room = JSON.parse(row.body) as Room;
    if (room.archives?.length || room.applied?.length) this.save(room);
    room.archives = history ? this.archives(code) : [];
    room.applied = [];
    return room;
  }
  codes() {
    return (this.db.prepare("SELECT code FROM rooms").all() as { code: string }[]).map((r) => r.code);
  }
  archiveGames(code: string) {
    return (this.db.prepare("SELECT game_no FROM archives WHERE code = ? ORDER BY game_no DESC").all(code) as { game_no: number }[]).map(r => r.game_no);
  }
  archives(code: string): Room["archives"] {
    return (this.db.prepare("SELECT body FROM archives WHERE code = ? ORDER BY game_no").all(code) as { body: string }[]).map(r => JSON.parse(r.body));
  }
  archive(code: string, gameNo: number): Room["archives"][number] | undefined {
    const row = this.db.prepare("SELECT body FROM archives WHERE code = ? AND game_no = ?").get(code, gameNo) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }
  hasReceipt(code: string, receipt: string) {
    return !!this.db.prepare("SELECT 1 FROM receipts WHERE code = ? AND receipt = ?").get(code, receipt);
  }
  save(room: Room) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const archive = this.db.prepare("INSERT INTO archives VALUES (?, ?, ?) ON CONFLICT(code, game_no) DO UPDATE SET body=excluded.body");
      for (const item of room.archives ?? []) archive.run(room.code, item.gameNo, JSON.stringify(item));
      const receipt = this.db.prepare("INSERT OR IGNORE INTO receipts VALUES (?, ?)");
      for (const id of room.applied ?? []) receipt.run(room.code, id);
      this.db.prepare("INSERT INTO rooms VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET body=excluded.body")
        .run(room.code, JSON.stringify({ ...room, archives: [], applied: [] }));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  close() { this.db.close(); }
}
