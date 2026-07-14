import { useEffect, useState } from "react";
import { getLeaderboard } from "../leaderboardApi.js";

const SORTS = [
  ["max", "Max rings"],
  ["average", "Average"],
  ["time", "Time"],
];

function formatDuration(milliseconds) {
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

export function Leaderboard({ open, onClose, playerName, onEditName, refreshKey = 0 }) {
  const [sort, setSort] = useState("max");
  const [state, setState] = useState({ status: "idle", players: [], error: "" });

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setState((current) => ({ ...current, status: "loading", error: "" }));
    getLeaderboard(sort, controller.signal)
      .then((data) => setState({ status: "ready", players: data.players, error: "" }))
      .catch((error) => {
        if (error.name !== "AbortError") {
          setState((current) => ({ ...current, status: "error", error: error.message }));
        }
      });
    return () => controller.abort();
  }, [open, refreshKey, sort]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="leaderboard-backdrop leaderboard-modal"
      data-game-input-blocking="true"
      role="presentation"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="leaderboard-card" role="dialog" aria-modal="true" aria-labelledby="leaderboard-title">
        <header className="leaderboard-header">
          <div><span className="eyebrow">Global pilot telemetry</span><h2 id="leaderboard-title">Leaderboard</h2></div>
          <button className="dialog-close" type="button" onClick={onClose}>Close</button>
        </header>

        <div className="leaderboard-toolbar">
          <div className="leaderboard-tabs" role="tablist" aria-label="Leaderboard sorting">
            {SORTS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={sort === value}
                className={sort === value ? "is-active" : ""}
                onClick={() => setSort(value)}
              >{label}</button>
            ))}
          </div>
          {playerName && <button className="player-edit-button" type="button" onClick={onEditName}>{playerName} · edit</button>}
        </div>

        <div className="leaderboard-table-wrap">
          <table className="leaderboard-table">
            <thead><tr><th>#</th><th>Player</th><th>Max</th><th>Average</th><th>Time</th><th>Games</th></tr></thead>
            <tbody>
              {state.players.map((player, index) => (
                <tr key={`${player.name}-${index}`}>
                  <td>{String(index + 1).padStart(2, "0")}</td>
                  <th scope="row">{player.name}</th>
                  <td>{player.maxRings}</td>
                  <td>{player.averageRings.toFixed(2)}</td>
                  <td>{formatDuration(player.totalPlayMs)}</td>
                  <td>{player.gamesCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.status === "loading" && <p className="leaderboard-empty">Receiving telemetry…</p>}
          {state.status === "error" && <p className="leaderboard-empty dialog-error" role="alert">{state.error}</p>}
          {state.status === "ready" && state.players.length === 0 && <p className="leaderboard-empty">No games recorded yet. Your first result sets the field.</p>}
        </div>
        <p className="leaderboard-note">Average uses games with 1+ ring. Time includes every game; pauses and hidden tabs are excluded.</p>
      </section>
    </div>
  );
}
