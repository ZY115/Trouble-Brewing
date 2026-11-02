import type { PublicRecord, RoomView } from "../../shared/types";

function RecordList({ records }: { records: PublicRecord[] }) {
  const current = [...records]
    .filter((r) => !records.some((n) => n.supersedes === r.id))
    .reverse();
  return (
    <div className="pl-list">
      {current.length ? (
        current.map((r) => (
          <div
            key={r.id}
            style={{
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 2,
              padding: "8px 0",
            }}
          >
            <span className="pl-small">
              第 {r.day} {r.period === "DAY" ? "天" : "夜"}
            </span>
            <span>{r.text}</span>
          </div>
        ))
      ) : (
        <div>还没有公开记录。</div>
      )}
    </div>
  );
}

export default function PlayerRecords({ room }: { room: RoomView }) {
  return (
    <>
      <section className="pl-card">
        <span className="pl-small">第 {room.gameNo} 局 · 当前局</span>
        <RecordList records={room.publicRecords} />
      </section>
      {[...room.pastPublicRecords]
        .sort((a, b) => b.gameNo - a.gameNo)
        .map((past) => (
          <details className="pl-card" key={past.gameNo}>
            <summary>第 {past.gameNo} 局 · 公开记录</summary>
            <RecordList records={past.records} />
          </details>
        ))}
    </>
  );
}
