import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import type { Scoreboard } from "@rally/shared";
import { io } from "socket.io-client";
import { api } from "../api.js";

export default function DisplayPage() {
  const { gameId = "" } = useParams();
  const [board, setBoard] = useState<Scoreboard | null>(null);
  const [message, setMessage] = useState("");
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    void api<Scoreboard>(`/api/games/${gameId}/scoreboard`)
      .then(setBoard)
      .catch((error: Error) => setMessage(error.message));
    const socket = io({ withCredentials: true });
    socket.on("connect", () => socket.emit("subscribe:game", gameId));
    socket.on("game:update", (next: Scoreboard) => setBoard(next));
    return () => {
      socket.disconnect();
    };
  }, [gameId]);

  if (!board)
    return (
      <main className="display-page">
        <Link className="brand" to="/">
          <span className="brand-star">✦</span> RallyFML
        </Link>
        <p className="muted">{message || "Cargando marcador…"}</p>
      </main>
    );
  const podium = board.teams.filter((team) => team.rank <= 3);

  return (
    <main className="display-page">
      <header className="display-header">
        <Link className="brand" to="/">
          <span className="brand-star">✦</span> RallyFML
        </Link>
        <span className={`display-status ${board.game.status}`}>
          {board.game.status === "live"
            ? "EN VIVO"
            : board.game.status === "completed"
              ? "FINALIZADO"
              : "PREPARACIÓN"}
        </span>
      </header>
      <section className="display-title">
        <p className="eyebrow">FML · LASALLISTAS EN MISIÓN</p>
        <h1>{board.game.name}</h1>
        <p>
          {board.game.status === "live"
            ? "Marcador en tiempo real"
            : board.game.status === "completed"
              ? "Resultados del rally"
              : "El rally todavía no comienza"}
        </p>
      </section>
      {board.game.status === "completed" &&
        board.game.podiumRevealed &&
        podium.length > 0 && (
          <section className="podium-area" aria-label="Podio final">
            {podium.map((team, index) => (
              <motion.article
                key={team.id}
                className={`podium-card podium-rank-${team.rank}`}
                initial={
                  reducedMotion ? false : { opacity: 0, y: 30, scale: 0.96 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  duration: 0.55,
                  delay: Math.min(index * 0.14, 0.7),
                }}
              >
                <span className="podium-medal">
                  {team.rank === 1 ? "✦" : team.rank === 2 ? "✧" : "✣"}
                </span>
                <span className="podium-place">
                  {team.rank}
                  {team.rank === 2 ? "do" : "er"} lugar
                </span>
                <strong>{team.name}</strong>
                <span className="podium-score">
                  {team.score} <small>puntos</small>
                </span>
              </motion.article>
            ))}
          </section>
        )}
      {board.game.status === "completed" && !board.game.podiumRevealed && (
        <p className="reveal-wait">
          El administrador presentará el podio en unos momentos.
        </p>
      )}
      <section className="scoreboard panel">
        <div className="scoreboard-heading">
          <h2>Tabla de puntajes</h2>
          <span>{board.teams.length} equipos</span>
        </div>
        {board.teams.length ? (
          <ol>
            {board.teams.map((team) => (
              <li key={team.id} className={team.rank === 1 ? "leader-row" : ""}>
                <span className="rank-number">{team.rank}</span>
                <strong>{team.name}</strong>
                <span className="score-total">
                  {team.score}
                  <small> pts</small>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty-inline">Aún no hay equipos configurados.</p>
        )}
      </section>
      {board.teams.some(
        (team, index, list) =>
          index > 0 && list[index - 1].score === team.score,
      ) && (
        <p className="tie-note">✦ Los puntajes empatados comparten posición.</p>
      )}
    </main>
  );
}
