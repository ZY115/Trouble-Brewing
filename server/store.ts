import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Room } from "./game";
export class Store {
  db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ":memory:")
      mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, body TEXT NOT NULL);",
    );
  }
  get(code: string): Room | undefined {
    const row = this.db
      .prepare("SELECT body FROM rooms WHERE code = ?")
      .get(code) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }
  save(room: Room) {
    this.db
      .prepare(
        "INSERT INTO rooms VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET body=excluded.body",
      )
      .run(room.code, JSON.stringify(room));
  }
  close() {
    this.db.close();
  }
}
