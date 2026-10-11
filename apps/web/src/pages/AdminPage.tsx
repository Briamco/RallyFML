import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { activityTypes, type ActivityType } from "@rally/shared";
import { api, json } from "../api.js";

type GameSummary = {
  id: string;
  name: string;
  status: "setup" | "live" | "completed";
  activityDurationSeconds: number;
  cooldownSeconds: number;
  podiumRevealed: boolean;
  createdAt: string;
};
type PromptConfig = {
  content: string;
  options?: string[];
  correctChoiceIndex?: number;
};
type StationConfig = {
  id?: string;
  title: string;
  description: string;
  type: ActivityType;
  key: string;
  prompts: PromptConfig[];
};
type GameDetails = GameSummary & {
  canResume: boolean;
  teams: { id: string; name: string }[];
  stations: Omit<StationConfig, "key">[];
};
type RoundControlState = {
  gameStatus: "setup" | "live" | "completed";
  readyStations: number;
  stationCount: number;
  activeStations: number;
  endsAt: string | null;
};

const typeNames: Record<ActivityType, string> = {
  trivia: "Trivia",
  charades: "Charadas",
  creativity: "Creatividad",
  dramatization: "Dramatización",
  external: "Dinámica externa",
};

function makeKey() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 14);
}

function formatRoundTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function AdminPage() {
  const [setup, setSetup] = useState<{
    needsSetup: boolean;
    setupEnabled: boolean;
  } | null>(null);
  const [session, setSession] = useState<{
    role: string | null;
    username?: string;
  } | null>(null);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadGames(preferredId?: string) {
    const list = await api<GameSummary[]>("/api/admin/games");
    setGames(list);
    const id =
      preferredId ??
      selectedId ??
      list.find((game) => game.status === "live")?.id ??
      list[0]?.id ??
      null;
    setSelectedId(id);
    if (id) setDetails(await api<GameDetails>(`/api/admin/games/${id}`));
    else setDetails(null);
  }

  useEffect(() => {
    void Promise.all([
      api<typeof setup>("/api/setup/status"),
      api<typeof session>("/api/session"),
    ])
      .then(async ([setupState, sessionState]) => {
        setSetup(setupState);
        setSession(sessionState);
        if (sessionState?.role === "admin") await loadGames();
      })
      .catch((error: Error) => {
        setLoadError(error.message);
        setSetup({ needsSetup: false, setupEnabled: false });
        setSession({ role: null });
      });
  }, []);

  async function perform(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setMessage("");
    try {
      await action();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ocurrió un error.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function loginOrSetup(form: FormData) {
    await perform(async () => {
      if (setup?.needsSetup) {
        await api(
          "/api/setup",
          json({
            bootstrapSecret: form.get("bootstrapSecret"),
            username: form.get("username"),
            password: form.get("password"),
          }),
        );
      } else {
        await api(
          "/api/admin/login",
          json({
            username: form.get("username"),
            password: form.get("password"),
          }),
        );
      }
      setSession({ role: "admin" });
      await loadGames();
    });
  }

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loginOrSetup(new FormData(event.currentTarget));
  }

  async function createGame(name: string) {
    await perform(async () => {
      const game = await api<GameSummary>("/api/admin/games", json({ name }));
      await loadGames(game.id);
    });
  }

  async function signOut() {
    await perform(async () => {
      await api("/api/logout", { method: "POST" });
      setSession({ role: null });
      setDetails(null);
      setGames([]);
    });
  }

  if (loadError)
    return (
      <PageFrame title="Administración">
        <p className="notice notice-error" role="alert">
          {loadError}
        </p>
      </PageFrame>
    );
  if (!setup || !session)
    return (
      <PageFrame title="Administración">
        <p className="muted">Cargando…</p>
      </PageFrame>
    );
  if (session.role !== "admin") {
    if (setup.needsSetup && !setup.setupEnabled)
      return (
        <PageFrame title="Configuración pendiente">
          <p>
            El administrador debe configurar `BOOTSTRAP_SECRET` en el entorno
            del servidor.
          </p>
        </PageFrame>
      );
    return (
      <PageFrame
        title={setup.needsSetup ? "Configurar administrador" : "Administración"}
      >
        <form className="form-stack" onSubmit={submitLogin}>
          {setup.needsSetup && (
            <Field label="Secreto de configuración">
              <input
                name="bootstrapSecret"
                type="password"
                autoComplete="off"
                required
              />
            </Field>
          )}
          <Field label="Usuario">
            <input
              name="username"
              autoComplete="username"
              minLength={3}
              maxLength={50}
              required
            />
          </Field>
          <Field label="Contraseña">
            <input
              name="password"
              type="password"
              autoComplete={
                setup.needsSetup ? "new-password" : "current-password"
              }
              minLength={setup.needsSetup ? 12 : 1}
              required
            />
          </Field>
          <button className="button button-primary" disabled={busy}>
            {setup.needsSetup ? "Crear administrador" : "Iniciar sesión"}
          </button>
        </form>
        {message && (
          <p className="notice notice-error" role="alert">
            {message}
          </p>
        )}
      </PageFrame>
    );
  }

  return (
    <PageFrame
      title="Administración"
      action={
        <button className="button button-quiet" onClick={() => void signOut()}>
          Cerrar sesión
        </button>
      }
    >
      <div className="admin-topline">
        <p className="muted">
          Configura el rally, sigue los puntajes y presenta el podio.
        </p>
        <CreateGame onCreate={createGame} busy={busy} />
      </div>
      {games.length > 0 && (
        <div className="toolbar">
          <label className="field">
            <span>Rally</span>
            <select
              value={selectedId ?? ""}
              onChange={(event) =>
                void perform(async () => {
                  setSelectedId(event.target.value);
                  setDetails(
                    await api<GameDetails>(
                      `/api/admin/games/${event.target.value}`,
                    ),
                  );
                })
              }
            >
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name} ·{" "}
                  {game.status === "setup"
                    ? "Configuración"
                    : game.status === "live"
                      ? "En vivo"
                      : "Finalizado"}
                </option>
              ))}
            </select>
          </label>
          {details && (
            <Link
              className="button button-secondary"
              to={`/display/${details.id}`}
              target="_blank"
              rel="noreferrer"
            >
              Abrir marcador
            </Link>
          )}
        </div>
      )}
      {details ? (
        <GameEditor
          key={details.id}
          game={details}
          busy={busy}
          run={perform}
          reload={() => loadGames(details.id)}
          setMessage={setMessage}
        />
      ) : (
        <EmptyState />
      )}
      {message && (
        <p className="notice notice-error" role="alert">
          {message}
        </p>
      )}
    </PageFrame>
  );
}

function CreateGame({
  onCreate,
  busy,
}: {
  onCreate: (name: string) => Promise<void>;
  busy: boolean;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(
      new FormData(event.currentTarget).get("name") ?? "",
    ).trim();
    if (name) void onCreate(name);
  }
  return (
    <form className="create-game" onSubmit={submit}>
      <input
        name="name"
        aria-label="Nombre del nuevo rally"
        placeholder="Nombre del rally"
        maxLength={100}
        required
      />
      <button className="button button-primary" disabled={busy}>
        + Crear rally
      </button>
    </form>
  );
}

function GameEditor({
  game,
  busy,
  run,
  reload,
  setMessage,
}: {
  game: GameDetails;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<boolean>;
  reload: () => Promise<void>;
  setMessage: (message: string) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const locked = game.status !== "setup" && !editMode;
  const [step, setStep] = useState(0);
  const [gameName, setGameName] = useState(game.name);
  const [activityMinutes, setActivityMinutes] = useState(
    Math.floor(game.activityDurationSeconds / 60),
  );
  const [activitySeconds, setActivitySeconds] = useState(
    game.activityDurationSeconds % 60,
  );
  const [cooldownMinutes, setCooldownMinutes] = useState(
    Math.floor(game.cooldownSeconds / 60),
  );
  const [cooldownSeconds, setCooldownSeconds] = useState(
    game.cooldownSeconds % 60,
  );
  const [teamNames, setTeamNames] = useState(
    game.teams.map((team) => team.name),
  );
  const [teamIds, setTeamIds] = useState<Array<string | undefined>>(
    game.teams.map((team) => team.id),
  );
  const [stations, setStations] = useState<StationConfig[]>(
    game.stations.map((station) => ({
      ...station,
      key: "",
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [roundState, setRoundState] = useState<RoundControlState | null>(null);
  const [roundExtensionSeconds, setRoundExtensionSeconds] = useState(30);
  const [now, setNow] = useState(Date.now());
  const stepNames = ["Tiempo", "Equipos", "Estaciones", "Revisión"];
  const live = game.status === "live";
  const gameLabel = useMemo(
    () =>
      game.status === "setup"
        ? "Listo para configurar"
        : live
          ? "Rally en vivo"
          : "Rally finalizado",
    [game.status, live],
  );

  useEffect(() => {
    if (!live) {
      setRoundState(null);
      return;
    }
    let mounted = true;
    let completionReloaded = false;
    const refreshRound = async () => {
      const next = await api<RoundControlState>(
        `/api/admin/games/${game.id}/round`,
      );
      if (!mounted) return;
      setRoundState(next);
      if (next.gameStatus === "completed" && !completionReloaded) {
        completionReloaded = true;
        void reload();
      }
    };
    void refreshRound().catch(() => undefined);
    const timer = window.setInterval(
      () => void refreshRound().catch(() => undefined),
      1_000,
    );
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [game.id, live]);

  useEffect(() => {
    if (!live || !roundState?.endsAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [live, roundState?.endsAt]);

  const roundSecondsLeft = roundState?.endsAt
    ? Math.max(0, Math.ceil((Date.parse(roundState.endsAt) - now) / 1000))
    : 0;

  async function refreshRoundState() {
    setRoundState(
      await api<RoundControlState>(`/api/admin/games/${game.id}/round`),
    );
  }

  async function startRound() {
    await run(async () => {
      await api(`/api/admin/games/${game.id}/round/start`, json({}));
      await reload();
      await refreshRoundState();
    });
  }

  async function endRound() {
    if (
      !window.confirm(
        "¿Terminar la ronda ahora? El tiempo se detendrá en todas las estaciones y cada moderador deberá cerrar su alarma.",
      )
    )
      return;
    await run(async () => {
      await api(`/api/admin/games/${game.id}/round/end`, json({}));
      await reload();
      await refreshRoundState();
    });
  }

  async function extendRound() {
    await run(async () => {
      await api(
        `/api/admin/games/${game.id}/round/extend`,
        json({ seconds: roundExtensionSeconds }),
      );
      await reload();
      await refreshRoundState();
    });
  }

  function updateStation(index: number, patch: Partial<StationConfig>) {
    setErrors({});
    setSaved(false);
    setStations((previous) =>
      previous.map((station, stationIndex) =>
        stationIndex === index ? { ...station, ...patch } : station,
      ),
    );
  }

  function updatePrompt(
    stationIndex: number,
    promptIndex: number,
    patch: Partial<PromptConfig>,
  ) {
    setErrors({});
    setStations((previous) =>
      previous.map((station, index) =>
        index === stationIndex
          ? {
              ...station,
              prompts: station.prompts.map((prompt, itemIndex) =>
                itemIndex === promptIndex ? { ...prompt, ...patch } : prompt,
              ),
            }
          : station,
      ),
    );
    setSaved(false);
  }

  function promptFor(type: ActivityType): PromptConfig {
    return type === "trivia"
      ? {
          content: "",
          options: ["", "", "", ""],
        }
      : { content: "" };
  }

  function errorsForStep(stepIndex: number) {
    const next: Record<string, string> = {};
    if (stepIndex === 0) {
      const activityDurationSeconds = activityMinutes * 60 + activitySeconds;
      const cooldownTotalSeconds = cooldownMinutes * 60 + cooldownSeconds;
      if (!gameName.trim()) next.name = "Escribe el nombre del rally.";
      if (gameName.trim().length > 100)
        next.name = "El nombre debe tener 100 caracteres o menos.";
      if (
        !Number.isInteger(activityDurationSeconds) ||
        activityDurationSeconds < 10 ||
        activityDurationSeconds > 3600
      )
        next.duration = "El tiempo debe estar entre 00:10 y 60:00.";
      if (cooldownTotalSeconds < 0 || cooldownTotalSeconds > 3600)
        next.cooldown = "El cooldown debe estar entre 00:00 y 60:00.";
    }
    if (stepIndex === 1) {
      if (!teamNames.length) next.teams = "Agrega al menos un equipo.";
      if (teamNames.length > 50) next.teams = "El máximo es de 50 equipos.";
      const seen = new Set<string>();
      teamNames.forEach((name, index) => {
        const normalized = name.trim().toLocaleLowerCase();
        if (!normalized)
          next[`team-${index}`] = "Escribe el nombre del equipo.";
        else if (seen.has(normalized))
          next[`team-${index}`] = "Usa un nombre distinto para cada equipo.";
        if (name.trim().length > 60)
          next[`team-${index}`] = "El nombre debe tener 60 caracteres o menos.";
        seen.add(normalized);
      });
    }
    if (stepIndex === 2) {
      if (!stations.length) next.stations = "Agrega al menos una estación.";
      if (stations.length > 30)
        next.stations = "El máximo es de 30 estaciones.";
      if (stations.length > teamNames.length)
        next.stations =
          "Para sincronizar todas las estaciones, debe haber al menos tantos equipos como estaciones.";
      stations.forEach((station, stationIndex) => {
        if (!station.title.trim())
          next[`station-${stationIndex}-title`] =
            "Escribe el título de la estación.";
        if (!station.id && station.key.trim().length < 8)
          next[`station-${stationIndex}-key`] =
            "La clave debe tener al menos 8 caracteres.";
        if (!station.prompts.length)
          next[`station-${stationIndex}-prompts`] =
            "Agrega al menos un mandato.";
        station.prompts.forEach((prompt, promptIndex) => {
          const prefix = `station-${stationIndex}-prompt-${promptIndex}`;
          if (!prompt.content.trim())
            next[`${prefix}-content`] = "Completa este mandato.";
          if (station.type === "trivia") {
            const options = prompt.options ?? [];
            if (
              options.length !== 4 ||
              options.some((option) => !option.trim())
            )
              next[`${prefix}-options`] = "Completa las cuatro opciones.";
            if (
              prompt.correctChoiceIndex === undefined ||
              prompt.correctChoiceIndex < 0 ||
              prompt.correctChoiceIndex > 3
            )
              next[`${prefix}-correct`] = "Marca la opción correcta.";
          }
        });
      });
    }
    return next;
  }

  function validateStep(stepIndex: number) {
    const next = errorsForStep(stepIndex);
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function validateAll() {
    for (let index = 0; index < 3; index += 1) {
      const next = errorsForStep(index);
      if (Object.keys(next).length) {
        setStep(index);
        setErrors(next);
        return false;
      }
    }
    setErrors({});
    return true;
  }

  function stationPayload() {
    const payload = stations.map(({ prompts, key, ...station }) => ({
      ...station,
      ...(key.trim() ? { key: key.trim() } : {}),
      prompts: prompts.map((prompt) =>
        station.type === "trivia"
          ? {
              content: prompt.content.trim(),
              options: (prompt.options ?? []).map((option) => option.trim()),
              correctChoiceIndex: prompt.correctChoiceIndex,
            }
          : { content: prompt.content.trim() },
      ),
    }));
    return payload;
  }

  function cancelEditing() {
    setGameName(game.name);
    setActivityMinutes(Math.floor(game.activityDurationSeconds / 60));
    setActivitySeconds(game.activityDurationSeconds % 60);
    setCooldownMinutes(Math.floor(game.cooldownSeconds / 60));
    setCooldownSeconds(game.cooldownSeconds % 60);
    setTeamNames(game.teams.map((team) => team.name));
    setTeamIds(game.teams.map((team) => team.id));
    setStations(game.stations.map((station) => ({ ...station, key: "" })));
    setStep(0);
    setErrors({});
    setSaved(false);
    setEditMode(false);
  }

  async function saveAll(startAfterSave = false) {
    if (!validateAll()) return;
    setMessage("");
    const succeeded = await run(async () => {
      await api(`/api/admin/games/${game.id}/configuration`, {
        ...json({
          name: gameName.trim(),
          activityDurationSeconds: activityMinutes * 60 + activitySeconds,
          cooldownSeconds: cooldownMinutes * 60 + cooldownSeconds,
          teams: teamNames.map((name, index) => ({
            ...(teamIds[index] ? { id: teamIds[index] } : {}),
            name: name.trim(),
          })),
          stations: stationPayload(),
        }),
        method: "PUT",
      });
      if (startAfterSave)
        await api(`/api/admin/games/${game.id}/start`, json({}));
      await reload();
      if (game.status !== "setup" || startAfterSave) setEditMode(false);
    });
    setSaved(succeeded && !startAfterSave);
  }

  async function reveal() {
    await run(async () => {
      await api(`/api/admin/games/${game.id}/podium`, json({}));
      await reload();
    });
  }

  async function finishGame() {
    if (
      !window.confirm(
        "¿Finalizar el rally ahora? Las actividades en curso se cerrarán y se conservarán los puntos registrados. Después podrás revelar el podio.",
      )
    )
      return;
    await run(async () => {
      await api(`/api/admin/games/${game.id}/finish`, json({}));
      await reload();
    });
  }

  async function reopenGame() {
    if (
      !window.confirm(
        "¿Retomar este rally? Se conservarán los puntajes y las estaciones completadas; el podio se ocultará hasta finalizarlo de nuevo.",
      )
    )
      return;
    await run(async () => {
      await api(`/api/admin/games/${game.id}/reopen`, json({}));
      await reload();
    });
  }

  return (
    <section className="game-editor">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{gameLabel}</p>
          <h2>{game.name}</h2>
        </div>
        {game.status !== "setup" && (
          <span
            className={`status-pill ${live ? "status-live" : "status-complete"}`}
          >
            {live ? "● EN VIVO" : "✓ FINALIZADO"}
          </span>
        )}
      </div>
      {!locked && (
        <>
          <ol className="wizard-progress" aria-label="Pasos de configuración">
            {stepNames.map((name, index) => (
              <li key={name}>
                <button
                  type="button"
                  className={
                    index === step ? "active" : index < step ? "done" : ""
                  }
                  aria-current={index === step ? "step" : undefined}
                  disabled={index > step}
                  onClick={() => {
                    setStep(index);
                    setErrors({});
                  }}
                >
                  <span>{index < step ? "✓" : index + 1}</span>
                  {name}
                </button>
              </li>
            ))}
          </ol>

          <section
            className="panel wizard-panel"
            aria-labelledby="wizard-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Paso {step + 1} de {stepNames.length}
                </p>
                <h3 id="wizard-title">{stepNames[step]}</h3>
                <p className="muted">
                  {step === 0 &&
                    "Los tiempos definidos aquí se aplican a todas las estaciones."}
                  {step === 1 && "Agrega los equipos que recorrerán el rally."}
                  {step === 2 &&
                    "Define las dinámicas, sus mandatos y el acceso de moderación."}
                  {step === 3 &&
                    "Verifica la configuración antes de guardarla o iniciar."}
                </p>
              </div>
            </div>

            {step === 0 && (
              <div className="form-grid">
                <Field label="Nombre del rally">
                  <input
                    value={gameName}
                    maxLength={100}
                    aria-invalid={Boolean(errors.name)}
                    onChange={(event) => {
                      setGameName(event.target.value);
                      setErrors({});
                      setSaved(false);
                    }}
                  />
                  {errors.name && <InlineError>{errors.name}</InlineError>}
                </Field>
                <div className="field">
                  <span>Duración por participación</span>
                  <div className="time-selectors">
                    <label>
                      <span>Minutos</span>
                      <select
                        aria-label="Minutos de duración"
                        value={activityMinutes}
                        aria-invalid={Boolean(errors.duration)}
                        onChange={(event) => {
                          const minutes = Number(event.target.value);
                          setActivityMinutes(minutes);
                          if (minutes === 60) setActivitySeconds(0);
                          setErrors({});
                          setSaved(false);
                        }}
                      >
                        {Array.from({ length: 61 }, (_, minute) => (
                          <option key={minute} value={minute}>
                            {minute}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Segundos</span>
                      <select
                        aria-label="Segundos de duración"
                        value={activitySeconds}
                        aria-invalid={Boolean(errors.duration)}
                        onChange={(event) => {
                          setActivitySeconds(Number(event.target.value));
                          setErrors({});
                          setSaved(false);
                        }}
                      >
                        {Array.from({ length: 60 }, (_, second) => (
                          <option
                            key={second}
                            value={second}
                            disabled={activityMinutes === 60 && second > 0}
                          >
                            {String(second).padStart(2, "0")}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {errors.duration && (
                    <InlineError>{errors.duration}</InlineError>
                  )}
                </div>
                <div className="field">
                  <span>Cooldown entre equipos</span>
                  <div className="time-selectors">
                    <label>
                      <span>Minutos</span>
                      <select
                        aria-label="Minutos de cooldown"
                        value={cooldownMinutes}
                        aria-invalid={Boolean(errors.cooldown)}
                        onChange={(event) => {
                          const minutes = Number(event.target.value);
                          setCooldownMinutes(minutes);
                          if (minutes === 60) setCooldownSeconds(0);
                          setErrors({});
                          setSaved(false);
                        }}
                      >
                        {Array.from({ length: 61 }, (_, minute) => (
                          <option key={minute} value={minute}>
                            {minute}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Segundos</span>
                      <select
                        aria-label="Segundos de cooldown"
                        value={cooldownSeconds}
                        aria-invalid={Boolean(errors.cooldown)}
                        onChange={(event) => {
                          setCooldownSeconds(Number(event.target.value));
                          setErrors({});
                          setSaved(false);
                        }}
                      >
                        {Array.from({ length: 60 }, (_, second) => (
                          <option
                            key={second}
                            value={second}
                            disabled={cooldownMinutes === 60 && second > 0}
                          >
                            {String(second).padStart(2, "0")}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {errors.cooldown && (
                    <InlineError>{errors.cooldown}</InlineError>
                  )}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="wizard-list">
                {teamNames.map((name, index) => (
                  <div className="wizard-row" key={`team-${index}`}>
                    <Field label={`Equipo ${index + 1}`}>
                      <input
                        value={name}
                        maxLength={60}
                        aria-invalid={Boolean(errors[`team-${index}`])}
                        onChange={(event) => {
                          setTeamNames((previous) =>
                            previous.map((teamName, teamIndex) =>
                              teamIndex === index
                                ? event.target.value
                                : teamName,
                            ),
                          );
                          setErrors({});
                          setSaved(false);
                        }}
                      />
                      {errors[`team-${index}`] && (
                        <InlineError>{errors[`team-${index}`]}</InlineError>
                      )}
                    </Field>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Eliminar equipo ${index + 1}`}
                      onClick={() => {
                        setTeamNames((previous) =>
                          previous.filter((_, item) => item !== index),
                        );
                        setTeamIds((previous) =>
                          previous.filter((_, item) => item !== index),
                        );
                        setErrors({});
                        setSaved(false);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {errors.teams && <InlineError>{errors.teams}</InlineError>}
                <button
                  className="button button-secondary wizard-add"
                  type="button"
                  onClick={() => {
                    setTeamNames((previous) => [
                      ...previous,
                      `Equipo ${previous.length + 1}`,
                    ]);
                    setTeamIds((previous) => [...previous, undefined]);
                    setErrors({});
                    setSaved(false);
                  }}
                  disabled={teamNames.length >= 50}
                >
                  + Agregar equipo
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="station-list">
                {errors.stations && (
                  <InlineError>{errors.stations}</InlineError>
                )}
                {stations.map((station, index) => (
                  <article
                    className="station-editor"
                    key={station.id ?? `new-${index}`}
                  >
                    <div className="station-editor-title">
                      <span className="station-index">{index + 1}</span>
                      <strong>{station.title || "Nueva estación"}</strong>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Eliminar estación ${index + 1}`}
                        onClick={() => {
                          setStations((current) =>
                            current.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          );
                          setErrors({});
                          setSaved(false);
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div className="form-grid">
                      <Field label="Título">
                        <input
                          value={station.title}
                          maxLength={100}
                          aria-invalid={Boolean(
                            errors[`station-${index}-title`],
                          )}
                          onChange={(event) =>
                            updateStation(index, { title: event.target.value })
                          }
                        />
                        {errors[`station-${index}-title`] && (
                          <InlineError>
                            {errors[`station-${index}-title`]}
                          </InlineError>
                        )}
                      </Field>
                      <Field label="Tipo de dinámica">
                        <select
                          value={station.type}
                          onChange={(event) => {
                            const type = event.target.value as ActivityType;
                            updateStation(index, {
                              type,
                              prompts: station.prompts.map((prompt) =>
                                type === "trivia"
                                  ? {
                                      content: prompt.content,
                                      options: prompt.options ?? [
                                        "",
                                        "",
                                        "",
                                        "",
                                      ],
                                      correctChoiceIndex:
                                        prompt.correctChoiceIndex,
                                    }
                                  : { content: prompt.content },
                              ),
                            });
                          }}
                        >
                          {activityTypes.map((type) => (
                            <option key={type} value={type}>
                              {typeNames[type]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Clave de moderación">
                        <input
                          value={station.key}
                          placeholder={
                            station.id
                              ? "Deja vacío para conservarla"
                              : "Mínimo 8 caracteres"
                          }
                          autoComplete="new-password"
                          minLength={station.id && !station.key ? undefined : 8}
                          maxLength={128}
                          aria-invalid={Boolean(errors[`station-${index}-key`])}
                          onChange={(event) =>
                            updateStation(index, { key: event.target.value })
                          }
                        />
                        {errors[`station-${index}-key`] && (
                          <InlineError>
                            {errors[`station-${index}-key`]}
                          </InlineError>
                        )}
                      </Field>
                      <Field label="Descripción">
                        <input
                          value={station.description}
                          maxLength={1000}
                          onChange={(event) =>
                            updateStation(index, {
                              description: event.target.value,
                            })
                          }
                        />
                      </Field>
                    </div>
                    <div className="prompt-editor-heading">
                      <div>
                        <strong>
                          {station.type === "trivia"
                            ? "Preguntas"
                            : station.type === "charades"
                              ? "Ítems de charadas"
                              : "Banco de mandatos"}
                        </strong>
                        <p className="muted">
                          {station.type === "trivia" ||
                          station.type === "charades"
                            ? "Se presentan en orden aleatorio durante la participación."
                            : "Se sortea un mandato por equipo; el moderador asigna de 0 a 5 puntos."}
                        </p>
                      </div>
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() =>
                          updateStation(index, {
                            prompts: [
                              ...station.prompts,
                              promptFor(station.type),
                            ],
                          })
                        }
                        disabled={station.prompts.length >= 100}
                      >
                        + Agregar mandato
                      </button>
                    </div>
                    {errors[`station-${index}-prompts`] && (
                      <InlineError>
                        {errors[`station-${index}-prompts`]}
                      </InlineError>
                    )}
                    <div className="prompt-editor-list">
                      {station.prompts.map((prompt, promptIndex) => {
                        const prefix = `station-${index}-prompt-${promptIndex}`;
                        return (
                          <section className="prompt-editor" key={promptIndex}>
                            <div className="station-editor-title">
                              <strong>
                                {station.type === "trivia"
                                  ? `Pregunta ${promptIndex + 1}`
                                  : `Mandato ${promptIndex + 1}`}
                              </strong>
                              <button
                                type="button"
                                className="button button-quiet button-small"
                                onClick={() =>
                                  updateStation(index, {
                                    prompts: station.prompts.filter(
                                      (_, item) => item !== promptIndex,
                                    ),
                                  })
                                }
                                disabled={station.prompts.length <= 1}
                              >
                                Quitar
                              </button>
                            </div>
                            <Field
                              label={
                                station.type === "trivia"
                                  ? "Pregunta"
                                  : "Mandato o escena"
                              }
                            >
                              <textarea
                                value={prompt.content}
                                maxLength={1000}
                                rows={2}
                                aria-invalid={Boolean(
                                  errors[`${prefix}-content`],
                                )}
                                onChange={(event) =>
                                  updatePrompt(index, promptIndex, {
                                    content: event.target.value,
                                  })
                                }
                              />
                              {errors[`${prefix}-content`] && (
                                <InlineError>
                                  {errors[`${prefix}-content`]}
                                </InlineError>
                              )}
                            </Field>
                            {station.type === "trivia" && (
                              <fieldset className="choice-editor">
                                <legend>Opciones · marca la correcta</legend>
                                {(prompt.options ?? ["", "", "", ""]).map(
                                  (option, choiceIndex) => (
                                    <div
                                      className="choice-editor-row"
                                      key={choiceIndex}
                                    >
                                      <input
                                        type="radio"
                                        name={`correct-${index}-${promptIndex}`}
                                        aria-label={`Marcar opción ${choiceIndex + 1} como correcta en la pregunta ${promptIndex + 1}`}
                                        checked={
                                          prompt.correctChoiceIndex ===
                                          choiceIndex
                                        }
                                        onChange={() =>
                                          updatePrompt(index, promptIndex, {
                                            correctChoiceIndex: choiceIndex,
                                          })
                                        }
                                      />
                                      <input
                                        value={option}
                                        maxLength={300}
                                        aria-label={`Opción ${choiceIndex + 1} de la pregunta ${promptIndex + 1}`}
                                        aria-invalid={Boolean(
                                          errors[`${prefix}-options`],
                                        )}
                                        placeholder={`Opción ${choiceIndex + 1}`}
                                        onChange={(event) => {
                                          const options = [
                                            ...(prompt.options ?? [
                                              "",
                                              "",
                                              "",
                                              "",
                                            ]),
                                          ];
                                          options[choiceIndex] =
                                            event.target.value;
                                          updatePrompt(index, promptIndex, {
                                            options,
                                          });
                                        }}
                                      />
                                    </div>
                                  ),
                                )}
                                {errors[`${prefix}-options`] && (
                                  <InlineError>
                                    {errors[`${prefix}-options`]}
                                  </InlineError>
                                )}
                                {errors[`${prefix}-correct`] && (
                                  <InlineError>
                                    {errors[`${prefix}-correct`]}
                                  </InlineError>
                                )}
                              </fieldset>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  </article>
                ))}
                <button
                  className="button button-secondary wizard-add"
                  type="button"
                  onClick={() => {
                    setStations((current) => [
                      ...current,
                      {
                        title: "",
                        description: "",
                        type: "trivia",
                        key: makeKey(),
                        prompts: [promptFor("trivia")],
                      },
                    ]);
                    setErrors({});
                    setSaved(false);
                  }}
                  disabled={stations.length >= 30}
                >
                  + Agregar estación
                </button>
              </div>
            )}

            {step === 3 && (
              <div className="review-summary">
                <div className="summary-grid">
                  <SummaryCard
                    label="Rally"
                    value={gameName.trim() || "Sin nombre"}
                  />
                  <SummaryCard
                    label="Participación"
                    value={`${activityMinutes} min ${String(activitySeconds).padStart(2, "0")} s`}
                  />
                  <SummaryCard
                    label="Cooldown"
                    value={`${cooldownMinutes} min ${String(cooldownSeconds).padStart(2, "0")} s`}
                  />
                  <SummaryCard label="Equipos" value={teamNames.length} />
                  <SummaryCard label="Estaciones" value={stations.length} />
                </div>
                <section>
                  <h4>Equipos</h4>
                  <p>
                    {teamNames
                      .map((name) => name.trim() || "Sin nombre")
                      .join(" · ")}
                  </p>
                </section>
                <section>
                  <h4>Estaciones</h4>
                  {stations.map((station, index) => (
                    <p key={station.id ?? index}>
                      <strong>
                        {station.title || `Estación ${index + 1}`}
                      </strong>{" "}
                      · {typeNames[station.type]} · {station.prompts.length}{" "}
                      ítems
                    </p>
                  ))}
                </section>
              </div>
            )}
          </section>

          <div className="sticky-actions">
            {game.status !== "setup" && (
              <button
                className="button button-quiet"
                type="button"
                onClick={cancelEditing}
                disabled={busy}
              >
                Cancelar edición
              </button>
            )}
            {step > 0 && (
              <button
                className="button button-quiet"
                type="button"
                onClick={() => {
                  setStep(step - 1);
                  setErrors({});
                }}
              >
                Atrás
              </button>
            )}
            {step < 3 ? (
              <button
                className="button button-primary"
                type="button"
                onClick={() => {
                  if (validateStep(step)) setStep(step + 1);
                }}
              >
                Continuar
              </button>
            ) : (
              <>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => void saveAll()}
                  disabled={busy}
                >
                  {game.status === "setup"
                    ? "Guardar configuración"
                    : "Guardar cambios"}
                </button>
                {game.status === "setup" ? (
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => void saveAll(true)}
                    disabled={busy}
                  >
                    Iniciar rally
                  </button>
                ) : null}
              </>
            )}
          </div>
          {saved && (
            <p className="notice notice-success" role="status">
              Configuración guardada.
            </p>
          )}
        </>
      )}
      {locked && (
        <>
          <div className="summary-grid">
            <SummaryCard label="Equipos" value={game.teams.length} />
            <SummaryCard label="Estaciones" value={game.stations.length} />
            <SummaryCard
              label="Estado"
              value={live ? "En juego" : "Completado"}
            />
          </div>
          <div className="reveal-card">
            <div>
              <h3>Editar configuración</h3>
              <p className="muted">
                Puedes cambiar todos los datos del rally. Los puntajes ya
                registrados se conservarán.
                {live && roundState?.activeStations
                  ? " Espera a que termine la ronda para editar."
                  : ""}
              </p>
            </div>
            <button
              className="button button-secondary"
              type="button"
              disabled={
                busy || (live && (!roundState || roundState.activeStations > 0))
              }
              onClick={() => {
                setEditMode(true);
                setStep(0);
                setErrors({});
                setSaved(false);
              }}
            >
              Editar rally
            </button>
          </div>
          <Link
            className="button button-secondary"
            to={`/display/${game.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Ver marcador en pantalla completa
          </Link>
          {live && (
            <div className="reveal-card round-control">
              <div>
                <h3>Ronda sincronizada</h3>
                <p className="muted">
                  {roundState?.activeStations
                    ? `${roundState.activeStations} estaciones en actividad.`
                    : `${roundState?.readyStations ?? 0} de ${roundState?.stationCount ?? game.stations.length} estaciones listas. Cada una debe tener un equipo distinto.`}
                </p>
                {roundState?.endsAt && (
                  <p className="round-countdown" role="timer">
                    Tiempo restante: {formatRoundTime(roundSecondsLeft)}
                  </p>
                )}
              </div>
              <div className="round-actions">
                {roundState?.activeStations ? (
                  <>
                    <label className="field round-extension-field">
                      <span>Extender (segundos)</span>
                      <input
                        type="number"
                        min={1}
                        max={300}
                        step={1}
                        value={roundExtensionSeconds}
                        onChange={(event) =>
                          setRoundExtensionSeconds(Number(event.target.value))
                        }
                      />
                    </label>
                    <button
                      className="button button-secondary"
                      disabled={
                        busy ||
                        !Number.isInteger(roundExtensionSeconds) ||
                        roundExtensionSeconds < 1 ||
                        roundExtensionSeconds > 300
                      }
                      onClick={() => void extendRound()}
                    >
                      Extender tiempo
                    </button>
                    <button
                      className="button button-danger"
                      disabled={busy}
                      onClick={() => void endRound()}
                    >
                      Terminar ronda
                    </button>
                  </>
                ) : (
                  <button
                    className="button button-primary"
                    disabled={
                      busy ||
                      !roundState ||
                      roundState.stationCount === 0 ||
                      roundState.readyStations !== roundState.stationCount
                    }
                    onClick={() => void startRound()}
                  >
                    Iniciar tiempo de ronda
                  </button>
                )}
              </div>
            </div>
          )}
          {live && (
            <div className="reveal-card">
              <div>
                <h3>Finalizar el rally</h3>
                <p className="muted">
                  Se cerrarán las actividades en curso y se conservarán los
                  puntos registrados. Luego podrás presentar el podio.
                </p>
              </div>
              <button
                className="button button-danger"
                disabled={busy}
                onClick={() => void finishGame()}
              >
                Finalizar rally
              </button>
            </div>
          )}
          {game.status === "completed" && (
            <>
              <div className="reveal-card">
                <div>
                  <h3>Presentación final</h3>
                  <p className="muted">
                    Activa el podio cuando el grupo esté listo.
                  </p>
                </div>
                <button
                  className="button button-primary"
                  disabled={game.podiumRevealed || busy}
                  onClick={() => void reveal()}
                >
                  {game.podiumRevealed ? "Podio presentado" : "Revelar podio"}
                </button>
              </div>
              {game.canResume && (
                <div className="reveal-card">
                  <div>
                    <h3>Hay estaciones pendientes</h3>
                    <p className="muted">
                      Retoma el rally para completar las actividades que faltan.
                      Se conservarán los resultados registrados.
                    </p>
                  </div>
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => void reopenGame()}
                  >
                    Retomar rally
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function PageFrame({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="page-shell">
      <header className="page-header">
        <Link className="brand" to="/">
          <span className="brand-star">✦</span> RallyFML
        </Link>
        {action}
      </header>
      <div className="page-content">
        <p className="eyebrow">FML · LASALLISTAS EN MISIÓN</p>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function InlineError({ children }: { children: ReactNode }) {
  return (
    <small className="field-error" role="alert">
      {children}
    </small>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <span className="empty-mark">✦</span>
      <h2>Empieza un rally</h2>
      <p className="muted">
        Crea un rally nuevo para definir los equipos y las estaciones.
      </p>
    </div>
  );
}
