import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { io } from "socket.io-client";
import type { PublicStationState } from "@rally/shared";
import { api, json } from "../api.js";

type StationOption = { id: string; title: string };

function playTone(
  context: AudioContext,
  frequency: number,
  duration: number,
  volume: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
}

export default function ModeratorPage() {
  const [stationOptions, setStationOptions] = useState<StationOption[]>([]);
  const [state, setState] = useState<PublicStationState | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    void api<{ role: string | null; stationId?: string }>("/api/session")
      .then(async (session) => {
        if (session.role === "moderator" && session.stationId) {
          setSelectedId(session.stationId);
          setState(await api<PublicStationState>("/api/station/state"));
        } else {
          setStationOptions(
            await api<StationOption[]>("/api/moderator/stations"),
          );
        }
      })
      .catch((error: Error) => {
        setMessage(error.message);
        setState(null);
        void api<StationOption[]>("/api/moderator/stations")
          .then(setStationOptions)
          .catch(() => undefined);
      });
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!state) return;
    const socket = io({ withCredentials: true });
    socket.on("connect", () => socket.emit("subscribe:station", state.id));
    socket.on("station:update", (next: PublicStationState) => setState(next));
    return () => {
      socket.disconnect();
    };
  }, [state?.id]);

  const secondsLeft = useMemo(
    () =>
      state?.activeParticipation
        ? Math.max(
            0,
            Math.ceil(
              (Date.parse(state.activeParticipation.endsAt) - now) / 1000,
            ),
          )
        : 0,
    [state?.activeParticipation?.endsAt, now],
  );
  const cooldownLeft = useMemo(
    () =>
      state?.cooldownEndsAt
        ? Math.max(
            0,
            Math.ceil((Date.parse(state.cooldownEndsAt) - now) / 1000),
          )
        : 0,
    [state?.cooldownEndsAt, now],
  );
  const availableTeams = state?.teams.filter((team) => team.available) ?? [];

  async function run(action: () => Promise<void>) {
    setMessage("");
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ocurrió un error.");
    } finally {
      setBusy(false);
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await api("/api/moderator/login", json({ stationId: selectedId, key }));
      setState(await api<PublicStationState>("/api/station/state"));
    });
  }

  async function refresh() {
    setState(await api<PublicStationState>("/api/station/state"));
  }

  async function silence() {
    await run(async () => {
      await api("/api/station/alarm/silence", json({}));
      await refresh();
    });
  }

  async function signOut() {
    await run(async () => {
      await api("/api/logout", { method: "POST" });
      setState(null);
      setSelectedId("");
      setKey("");
      setStationOptions(await api<StationOption[]>("/api/moderator/stations"));
    });
  }

  async function enableSound() {
    try {
      const context = new AudioContext();
      await context.resume();
      audioRef.current = context;
      setSoundEnabled(true);
    } catch {
      setMessage(
        "El navegador no permitió activar el sonido. La alerta visual seguirá disponible.",
      );
    }
  }

  useEffect(() => {
    if (!state?.alarmPending || !soundEnabled || !audioRef.current) return;
    const context = audioRef.current;
    const beep = () => {
      playTone(context, 1046, 0.32, 0.08);
    };
    beep();
    const timer = window.setInterval(beep, 900);
    return () => window.clearInterval(timer);
  }, [state?.alarmPending, soundEnabled]);

  useEffect(() => {
    if (
      !state?.activeParticipation ||
      secondsLeft === 0 ||
      secondsLeft > 10 ||
      !soundEnabled ||
      !audioRef.current
    )
      return;
    playTone(audioRef.current, 660, 0.16, 0.06);
  }, [state?.activeParticipation?.id, secondsLeft, soundEnabled]);

  useEffect(
    () => () => {
      void audioRef.current?.close();
    },
    [],
  );

  if (!state)
    return (
      <main className="page-shell moderator-shell">
        <header className="page-header">
          <Link className="brand" to="/">
            <span className="brand-star">✦</span> RallyFML
          </Link>
        </header>
        <section className="moderator-login panel">
          <p className="eyebrow">PANEL DE ESTACIÓN</p>
          <h1>Ingresar a la actividad</h1>
          <p className="muted">
            Selecciona tu estación e ingresa su clave para comenzar.
          </p>
          <form className="form-stack" onSubmit={(event) => void login(event)}>
            <label className="field">
              <span>Estación</span>
              <select
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
                required
              >
                <option value="">Seleccionar estación</option>
                {stationOptions.map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Clave de estación</span>
              <input
                type="password"
                autoComplete="current-password"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                required
              />
            </label>
            <button
              className="button button-primary button-wide"
              disabled={busy || !selectedId}
            >
              Ingresar
            </button>
          </form>
          {message && (
            <p className="notice notice-error" role="alert">
              {message}
            </p>
          )}
        </section>
      </main>
    );

  const active = state.activeParticipation;
  const formatTime = (seconds: number) =>
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <main className="moderator-app">
      <header className="moderator-header">
        <Link className="brand" to="/">
          <span className="brand-star">✦</span> RallyFML
        </Link>
        <div className="station-heading">
          <span className="eyebrow">ESTACIÓN</span>
          <strong>{state.title}</strong>
        </div>
        <div className="moderator-header-actions">
          {!soundEnabled ? (
            <button
              className="button button-quiet"
              onClick={() => void enableSound()}
            >
              Activar sonido
            </button>
          ) : (
            <span className="sound-ready">● Sonido activo</span>
          )}
          <button
            className="button button-quiet"
            onClick={() => void signOut()}
          >
            Salir
          </button>
        </div>
      </header>

      {state.alarmPending && (
        <section
          className="alarm-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="alarm-title"
          aria-describedby="alarm-description"
        >
          <div className="alarm-content">
            <span className="alarm-bell" aria-hidden="true">
              🔔
            </span>
            <p className="eyebrow">TIEMPO TERMINADO</p>
            <h2 id="alarm-title">¡Cambio de equipo!</h2>
            <p id="alarm-description">
              La actividad quedó cerrada y los puntos guardados.
            </p>
            <button
              className="button button-light"
              onClick={() => void silence()}
              disabled={busy}
              autoFocus
            >
              Cerrar
            </button>
          </div>
        </section>
      )}

      {state.gameStatus === "setup" && (
        <section className="waiting-card">
          <span className="waiting-icon">◷</span>
          <h1>Esperando el inicio</h1>
          <p>El administrador iniciará el rally cuando todos estén listos.</p>
        </section>
      )}
      {state.gameStatus === "completed" && (
        <section className="waiting-card">
          <span className="waiting-icon">✓</span>
          <h1>Rally terminado</h1>
          <p>Gracias por acompañar a los equipos.</p>
        </section>
      )}

      {state.gameStatus === "live" && (
        <div className="moderator-layout">
          <section
            className={`timer-panel ${active && secondsLeft <= 10 ? "timer-warning" : ""}`}
            aria-live="polite"
          >
            <div className="timer-label">
              {active
                ? "TIEMPO RESTANTE"
                : cooldownLeft > 0
                  ? "DESCANSO ENTRE RONDAS"
                  : "ESPERANDO RONDA GLOBAL"}
            </div>
            <div className="timer-value">
              {active
                ? formatTime(secondsLeft)
                : cooldownLeft > 0
                  ? formatTime(cooldownLeft)
                  : "— — : — —"}
            </div>
            <div className="timer-caption">
              {active
                ? `Equipo ${active.teamName}`
                : cooldownLeft > 0
                  ? "Selecciona el próximo equipo; el administrador iniciará la ronda"
                  : state.selectedTeamId
                    ? `Equipo ${state.teams.find((team) => team.id === state.selectedTeamId)?.name ?? "listo"}. Esperando al administrador.`
                    : state.description ||
                      "Selecciona un equipo; el administrador iniciará la ronda"}
            </div>
          </section>

          {active ? (
            <section className="activity-card panel">
              <div className="activity-title">
                <div>
                  <p className="eyebrow">
                    {state.type === "trivia"
                      ? "TRIVIA"
                      : state.type === "charades"
                        ? "CHARADAS"
                        : typeNames[state.type]}
                  </p>
                  <h1>{active.teamName}</h1>
                </div>
                <span className="score-badge">
                  {active.score}
                  <small>pts</small>
                </span>
              </div>
              {active.nextPrompt ? (
                <div className="prompt-card">
                  <span className="prompt-count">
                    {active.nextPrompt.index} / {active.nextPrompt.total}
                  </span>
                  <p>{active.nextPrompt.content}</p>
                </div>
              ) : (
                <div className="prompt-card">
                  <p>Se completaron los mandatos. El temporizador continúa.</p>
                </div>
              )}
              {active.nextPrompt && state.type === "trivia" ? (
                <div
                  className="trivia-options"
                  aria-label="Opciones de respuesta"
                >
                  {(active.nextPrompt.options ?? []).map((option, index) => (
                    <button
                      className="button button-large trivia-option"
                      key={index}
                      onClick={() =>
                        void run(async () => {
                          await api(
                            "/api/station/answer",
                            json({
                              promptId: active.nextPrompt!.id,
                              choiceIndex: index,
                            }),
                          );
                          await refresh();
                        })
                      }
                      disabled={busy || secondsLeft === 0}
                    >
                      <span>{String.fromCharCode(65 + index)}</span>
                      {option}
                    </button>
                  ))}
                </div>
              ) : active.nextPrompt && state.type === "charades" ? (
                <div className="answer-actions">
                  <button
                    className="button button-success button-large"
                    onClick={() =>
                      void run(async () => {
                        await api(
                          "/api/station/answer",
                          json({
                            promptId: active.nextPrompt!.id,
                            correct: true,
                          }),
                        );
                        await refresh();
                      })
                    }
                    disabled={busy || secondsLeft === 0}
                  >
                    ✓ Correcta · +1
                  </button>
                  <button
                    className="button button-danger button-large"
                    onClick={() =>
                      void run(async () => {
                        await api(
                          "/api/station/answer",
                          json({
                            promptId: active.nextPrompt!.id,
                            correct: false,
                          }),
                        );
                        await refresh();
                      })
                    }
                    disabled={busy || secondsLeft === 0}
                  >
                    ✕ Incorrecta · 0
                  </button>
                </div>
              ) : active.scoreSubmitted ? (
                <p className="score-confirmation" role="status">
                  Puntaje registrado: <strong>{active.score} puntos</strong>
                </p>
              ) : (
                active.nextPrompt && (
                  <div
                    className="score-picker"
                    aria-label="Puntaje de la participación"
                  >
                    {[0, 1, 2, 3, 4, 5].map((score) => (
                      <button
                        key={score}
                        className={`score-choice ${active.scoreSubmitted && active.score === score ? "selected" : ""}`}
                        onClick={() =>
                          void run(async () => {
                            await api("/api/station/score", {
                              method: "PUT",
                              body: JSON.stringify({ score }),
                            });
                            await refresh();
                          })
                        }
                        disabled={busy || secondsLeft === 0}
                        aria-pressed={
                          active.scoreSubmitted && active.score === score
                        }
                      >
                        {score}
                      </button>
                    ))}
                  </div>
                )
              )}
              <p className="muted help-line">
                El puntaje se bloquea cuando termina el tiempo.
              </p>
            </section>
          ) : (
            <section className="team-picker panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">ELIGE EL EQUIPO</p>
                  <h2>¿Quién participa ahora?</h2>
                </div>
                <span className="availability-count">
                  {availableTeams.length} disponibles
                </span>
              </div>
              <div className="team-grid">
                {state.teams.map((team) => (
                  <button
                    key={team.id}
                    className={`team-tile ${state.selectedTeamId === team.id ? "selected" : ""}`}
                    onClick={() =>
                      void run(async () => {
                        await api(
                          "/api/station/select",
                          json({ teamId: team.id }),
                        );
                        await refresh();
                      })
                    }
                    disabled={busy || !team.available}
                    aria-pressed={state.selectedTeamId === team.id}
                  >
                    <span className="team-tile-check">
                      {state.selectedTeamId === team.id
                        ? "✓"
                        : String(state.teams.indexOf(team) + 1).padStart(
                            2,
                            "0",
                          )}
                    </span>
                    <strong>{team.name}</strong>
                    <small>
                      {team.completed
                        ? "Completó esta estación"
                        : team.activeElsewhere
                          ? "En otra estación"
                          : "Disponible"}
                    </small>
                  </button>
                ))}
              </div>
              {availableTeams.length === 0 && (
                <p className="empty-inline">
                  Todos los equipos completaron esta estación o están
                  participando en otra.
                </p>
              )}
              <p className="round-waiting" role="status">
                {cooldownLeft > 0
                  ? `Disponible en ${formatTime(cooldownLeft)}. Luego selecciona el próximo equipo.`
                  : state.selectedTeamId
                    ? "Estación lista. El administrador iniciará el tiempo cuando todas estén preparadas."
                    : "Selecciona un equipo y espera a que el administrador inicie el tiempo."}
              </p>
            </section>
          )}
        </div>
      )}
      {message && (
        <p className="notice notice-error moderator-notice" role="alert">
          {message}
        </p>
      )}
    </main>
  );
}

const typeNames = {
  trivia: "Trivia",
  charades: "Charadas",
  creativity: "Creatividad",
  dramatization: "Dramatización",
  external: "Dinámica externa",
};
