"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getEstimatedOneRepMaxes, getExercise, getMuscleBalance, prefillExercise } from "../lib/domain.mjs";
import { exportPortableState, importPortableState, normalizeState } from "../lib/state-schema.mjs";
import { detectPersonalRecords, exerciseMode, recommendProgression, summarizeEffort, updateProgressionState } from "../lib/training-engine.mjs";
import { fetchExerciseCatalog, filterExercises } from "../lib/exercise-catalog.mjs";
import { importWorkoutCsv } from "../lib/csv-import.mjs";
import { activityHeatmap, muscleFrequency, trainingStreak, weeklySummary } from "../lib/analytics.mjs";
import { buildPlanBundle, decodePlanBundle, encodePlanBundle, mergePlanBundle, printablePlanHtml } from "../lib/plan-share.mjs";
import { LANGUAGES, translate } from "../lib/i18n.mjs";
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Share } from "@capacitor/share";

type Tab = "hoy" | "coach" | "biblioteca" | "rutinas" | "historial" | "progreso" | "ajustes";
type RecordState = { revision: number; state: any };
type AuthConfig = { authMode: string; auth0Domain: string; auth0ClientId: string; audience: string; scopes: string[] };
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_LABELS: Record<string, string> = { monday: "Lunes", tuesday: "Martes", wednesday: "Miércoles", thursday: "Jueves", friday: "Viernes", saturday: "Sábado", sunday: "Domingo" };

const randomUrlSafe = (size = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const sha256 = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function OpenGymApp() {
  const [tab, setTab] = useState<Tab>("hoy");
  const [record, setRecord] = useState<RecordState | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [activeWorkout, setActiveWorkout] = useState<any>(null);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogError, setCatalogError] = useState("");

  const request = useCallback(async (url: string, init: RequestInit = {}) => {
    const currentToken = config?.authMode === "demo" ? "demo" : localStorage.getItem("opengym_access_token");
    return fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${currentToken ?? ""}` } });
  }, [config]);

  const load = useCallback(async () => {
    setBusy(true);
    const response = await request("/api/state/");
    if (response.status === 401) { setRecord(null); setBusy(false); return; }
    if (!response.ok) throw new Error("No se pudo cargar tu entrenamiento");
    const loaded = await response.json();
    setRecord({ ...loaded, state: normalizeState(loaded.state) });
    setBusy(false);
  }, [request]);

  useEffect(() => {
    fetch("/api/config/").then((response) => response.json()).then(setConfig).catch(() => setMessage("No se pudo cargar la configuración"));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!config) return;
    const expires = Number(localStorage.getItem("opengym_expires_at") ?? 0);
    if (config.authMode !== "demo" && expires && expires < Date.now()) localStorage.removeItem("opengym_access_token");
    load().catch((error) => { setBusy(false); setMessage(error.message); });
  }, [config, load]);
  useEffect(() => {
    if (tab !== "biblioteca" || catalog.length || catalogError) return;
    fetchExerciseCatalog().then(setCatalog).catch((error) => setCatalogError(error.message));
  }, [tab, catalog.length, catalogError]);
  useEffect(() => {
    const reminder = record?.state?.settings?.reminder;
    if (!reminder?.enabled || !("Notification" in window)) return;
    const check = () => {
      const now = new Date();
      const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const key = `opengym-reminder-${now.toISOString().slice(0, 10)}`;
      if (clock === reminder.time && !localStorage.getItem(key) && Notification.permission === "granted") {
        new Notification("OpenGym", { body: "Tu entrenamiento está listo cuando tú lo estés.", icon: "/og.png" });
        localStorage.setItem(key, "sent");
      }
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [record?.state?.settings?.reminder]);
  useEffect(() => {
    document.documentElement.lang = record?.state?.profile?.locale ?? "es";
  }, [record?.state?.profile?.locale]);

  async function login() {
    if (!config) return;
    const verifier = randomUrlSafe(48);
    const state = randomUrlSafe(24);
    sessionStorage.setItem("opengym_verifier", verifier);
    sessionStorage.setItem("opengym_oauth_state", state);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.auth0ClientId,
      redirect_uri: `${window.location.origin}/auth/callback/`,
      scope: config.scopes.join(" "),
      audience: config.audience,
      resource: config.audience,
      code_challenge: base64Url(await sha256(verifier)),
      code_challenge_method: "S256",
      state,
    });
    window.location.assign(`https://${config.auth0Domain}/authorize?${params}`);
  }

  async function save(nextState: any, successMessage = "Cambios guardados") {
    if (!record) return false;
    setMessage("Guardando…");
    const response = await request("/api/state/", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": `"${record.revision}"` },
      body: JSON.stringify({ state: normalizeState({ ...nextState, updatedAt: new Date().toISOString() }), revision: record.revision }),
    });
    const body = await response.json();
    if (response.status === 409) {
      setRecord({ revision: body.revision, state: body.state });
      setMessage("Había cambios más recientes. Los hemos recargado para no perderlos.");
      return false;
    }
    if (!response.ok) { setMessage(body.message ?? "No se pudo guardar"); return false; }
    setRecord({ revision: body.revision, state: body.state });
    setMessage(successMessage);
    window.setTimeout(() => setMessage(""), 2200);
    return true;
  }

  if (!config || busy) return <main className="loading-screen"><div className="brand-orbit">OG</div><p>Preparando tu sesión…</p></main>;
  if (!record) return <SignIn onLogin={login} configured={Boolean(config.auth0Domain && config.auth0ClientId)} />;

  const state = record.state;
  const locale = state.profile?.locale ?? "es";
  const t = (key: string) => translate(locale, key);
  const todayKey = WEEKDAYS[new Date().getDay()];
  const dateKey = new Date().toISOString().slice(0, 10);
  const routineId = Object.prototype.hasOwnProperty.call(state.dayOverrides, dateKey) ? state.dayOverrides[dateKey] : state.weekPlan[todayKey];
  const routine = state.routines.find((entry: any) => entry.id === routineId);

  async function startWorkout(selectedRoutine = routine) {
    if (!selectedRoutine) return;
    if (state.settings?.promptBodyweight) {
      const latestWeight = state.bodyweight.at(-1)?.weight ?? "";
      const entered = window.prompt("Peso corporal de hoy (opcional)", String(latestWeight));
      if (entered && Number(entered) !== Number(latestWeight)) {
        await save({ ...state, bodyweight: [...state.bodyweight, { id: crypto.randomUUID(), date: new Date().toISOString(), weight: Number(entered) }] }, "Peso registrado antes de la sesión");
      }
    }
    setActiveWorkout({
      id: crypto.randomUUID(),
      routineId: selectedRoutine.id,
      name: selectedRoutine.name,
      date: new Date().toISOString(),
      startedAt: Date.now(),
      exercises: selectedRoutine.exercises.map((entry: any) => {
        const prefilled = prefillExercise(state, entry.exerciseId);
        const prescription = recommendProgression({
          policy: entry.progression ?? "off",
          mode: exerciseMode(getExercise(state, entry.exerciseId)),
          previousSets: prefilled.sets,
          targetReps: entry.targetReps ?? 10,
          targetSeconds: entry.targetSeconds ?? 30,
          increment: entry.increment ?? 2.5,
          stalls: state.progression?.[entry.exerciseId]?.stalls ?? 0,
        });
        return {
          ...prefilled,
          supersetGroup: entry.supersetGroup ?? null,
          progression: prescription,
          sets: Array.from({ length: entry.targetSets ?? prefilled.sets.length }, (_, index) => ({
            ...(prefilled.sets[index] ?? prefilled.sets.at(-1)),
            id: crypto.randomUUID(),
            weight: prescription.weight,
            reps: prescription.reps,
            seconds: prescription.seconds,
            completed: false,
          })),
        };
      }),
    });
  }

  if (activeWorkout) {
    return <GuidedWorkout workout={activeWorkout} state={state} setWorkout={setActiveWorkout} onCancel={() => setActiveWorkout(null)} onFinish={async () => {
      const finished = { ...activeWorkout, durationSeconds: Math.max(60, Math.round((Date.now() - activeWorkout.startedAt) / 1000)) };
      delete finished.startedAt;
      const records = detectPersonalRecords(state.workouts, finished);
      const success = records.length ? `Entrenamiento guardado · ${records.length} nueva${records.length === 1 ? "" : "s"} marca${records.length === 1 ? "" : "s"}` : "Entrenamiento guardado. Buen trabajo.";
      const progression = updateProgressionState(state.progression, finished);
      if (await save({ ...state, progression, workouts: [...state.workouts, finished] }, success)) setActiveWorkout(null);
    }} />;
  }

  return (
    <main className={`app-shell theme-${state.settings?.theme ?? "dark"} accent-${state.settings?.accent ?? "lime"}`}>
      <header className="topbar"><div><span className="eyebrow">OPEN GYM</span><h1>{t("intent")}</h1></div><div className="revision" title="Versión sincronizada">v{record.revision}</div></header>
      {message && <div className="toast" role="status">{message}</div>}

      <section className="content">
        {tab === "hoy" && <Today state={state} routine={routine} todayKey={todayKey} onStart={() => startWorkout()} onGoRoutines={() => setTab("rutinas")} onSave={save} />}
        {tab === "coach" && <Coach state={state} request={request} onSave={save} />}
        {tab === "biblioteca" && <Library state={state} catalog={catalog} error={catalogError} onSave={save} />}
        {tab === "rutinas" && <Routines state={state} onSave={save} onStart={startWorkout} />}
        {tab === "historial" && <History state={state} onSave={save} />}
        {tab === "progreso" && <Progress state={state} onSave={save} />}
        {tab === "ajustes" && <Settings state={state} config={config} request={request} onSave={save} onLogout={() => {
          localStorage.removeItem("opengym_access_token");
          localStorage.removeItem("opengym_expires_at");
          setRecord(null);
        }} />}
      </section>

      <nav className="bottom-nav" aria-label="Navegación principal">
        {([
          ["hoy", t("today"), "●"], ["coach", t("coach"), "✦"], ["biblioteca", t("library"), "⌕"], ["rutinas", t("routines"), "▦"], ["historial", t("history"), "↺"], ["progreso", t("progress"), "↗"], ["ajustes", t("settings"), "⌁"],
        ] as const).map(([id, label, icon]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><span>{icon}</span>{label}</button>)}
      </nav>
    </main>
  );
}

function SignIn({ onLogin, configured }: { onLogin: () => void; configured: boolean }) {
  return <main className="sign-in"><div className="sign-in-card"><span className="eyebrow">OPEN GYM COACH</span><div className="hero-number">01</div><h1>Tu progreso no debería vivir encerrado en otra app.</h1><p>Rutinas, sesiones y marcas sincronizadas. Tus datos siguen siendo tuyos y ChatGPT puede ayudarte cuando tú lo decidas.</p><button className="primary" onClick={onLogin} disabled={!configured}>Entrar de forma segura <span>→</span></button>{!configured && <small>La conexión segura se está configurando.</small>}<a href="https://github.com/AlexCCGit/opengym-coach-sites" target="_blank" rel="noreferrer">Código fuente AGPL-3.0</a></div></main>;
}

function Today({ state, routine, todayKey, onStart, onGoRoutines, onSave }: any) {
  const latest = [...state.workouts].sort((a: any, b: any) => b.date.localeCompare(a.date))[0];
  const dateKey = new Date().toISOString().slice(0, 10);
  return <div className="stack">
    <div className="date-row"><span>{WEEKDAY_LABELS[todayKey]}</span><strong>{new Intl.DateTimeFormat("es", { day: "numeric", month: "long" }).format(new Date())}</strong></div>
    <article className="workout-hero">
      <div className="hero-meta"><span>ENTRENAMIENTO DE HOY</span><span>{routine ? `${routine.exercises.length} ejercicios` : "Descanso"}</span></div>
      <h2>{routine?.name ?? "Día de recuperación"}</h2>
      <p>{routine ? "Tus cargas y objetivos ya están preparados desde la última sesión." : "Movilidad suave, paseo o descanso completo. Tú eliges."}</p>
      {routine ? <button className="primary light" onClick={onStart}>Empezar sesión <span>→</span></button> : <button className="secondary light" onClick={onGoRoutines}>Cambiar el plan</button>}
      <div className="progress-track"><span style={{ width: routine ? "38%" : "100%" }} /></div>
    </article>
    <div className="metric-grid"><div><span>Última sesión</span><strong>{latest ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date(latest.date)) : "—"}</strong><small>{latest?.name ?? "Sin sesiones"}</small></div><div><span>Peso actual</span><strong>{state.bodyweight.at(-1)?.weight ?? "—"}<em> kg</em></strong><small>Por usuario y dispositivo</small></div></div>
    <section className="list-section"><div className="section-heading"><div><span className="eyebrow">HOY</span><h3>Reprogramar este día</h3></div></div><label className="day-override"><span>Rutina efectiva</span><select value={routine?.id ?? ""} onChange={(event) => onSave({ ...state, dayOverrides: { ...state.dayOverrides, [dateKey]: event.target.value || null } }, "Día reprogramado")}><option value="">Descanso</option>{state.routines.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button onClick={() => { const next = { ...state.dayOverrides }; delete next[dateKey]; onSave({ ...state, dayOverrides: next }, "Plan semanal restaurado"); }}>Usar semana</button></label></section>
    <section className="list-section"><div className="section-heading"><div><span className="eyebrow">PRÓXIMO</span><h3>Tu semana</h3></div></div>{Object.entries(state.weekPlan).filter(([, id]) => id).slice(0, 4).map(([day, id]: any) => { const item = state.routines.find((entry: any) => entry.id === id); return <div className="plan-row" key={day}><span>{WEEKDAY_LABELS[day]?.slice(0, 3)}</span><strong>{item?.name}</strong><i className={`dot ${item?.color ?? "lime"}`} /></div>; })}</section>
  </div>;
}

function GuidedWorkout({ workout, state, setWorkout, onCancel, onFinish }: any) {
  const [restLeft, setRestLeft] = useState(0);
  const previousRest = useRef(0);
  const completed = workout.exercises.flatMap((entry: any) => entry.sets).filter((set: any) => set.completed).length;
  const total = workout.exercises.flatMap((entry: any) => entry.sets).length;
  const updateSet = (exerciseIndex: number, setIndex: number, patch: any) => setWorkout((current: any) => ({ ...current, exercises: current.exercises.map((entry: any, index: number) => index !== exerciseIndex ? entry : ({ ...entry, sets: entry.sets.map((set: any, childIndex: number) => childIndex === setIndex ? { ...set, ...patch } : set) })) }));
  useEffect(() => {
    if (!restLeft) return;
    const timer = window.setInterval(() => setRestLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [restLeft]);
  useEffect(() => {
    if (previousRest.current > 0 && restLeft === 0 && state.settings?.sound) {
      const AudioContextClass = window.AudioContext ?? (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const context = new AudioContextClass(); const oscillator = context.createOscillator(); const gain = context.createGain();
        oscillator.frequency.value = 880; gain.gain.value = 0.08; oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.18);
      }
    }
    previousRest.current = restLeft;
  }, [restLeft, state.settings?.sound]);
  useEffect(() => {
    let lock: any;
    if (state.settings?.keepAwake && "wakeLock" in navigator) {
      (navigator as any).wakeLock.request("screen").then((value: any) => { lock = value; }).catch(() => undefined);
    }
    return () => { lock?.release?.(); };
  }, [state.settings?.keepAwake]);
  const toggleCompleted = (exerciseIndex: number, setIndex: number, wasCompleted: boolean) => {
    updateSet(exerciseIndex, setIndex, { completed: !wasCompleted });
    if (!wasCompleted) setRestLeft(Number(state.settings?.restSeconds ?? 90));
  };
  return <main className="guided-shell">
    <header className="guided-header"><button className="icon-button" onClick={onCancel} aria-label="Cerrar entrenamiento">×</button><div><span className="eyebrow">SESIÓN EN CURSO</span><h1>{workout.name}</h1></div><span className="set-count">{completed}/{total}</span></header>
    <div className="session-progress"><span style={{ width: `${total ? completed / total * 100 : 0}%` }} /></div>
    {restLeft > 0 && <div className="rest-timer" role="timer"><span>Descanso</span><strong>{Math.floor(restLeft / 60)}:{String(restLeft % 60).padStart(2, "0")}</strong><button onClick={() => setRestLeft(0)}>Omitir</button></div>}
    <section className="guided-content">{workout.exercises.map((logged: any, exerciseIndex: number) => {
      const exercise = getExercise(state, logged.exerciseId);
      const mode = exerciseMode(exercise);
      const timed = mode === "time";
      const cardio = mode === "cardio";
      return <article className="exercise-card" key={logged.exerciseId}>
        <div className="exercise-heading"><div><span>{exercise?.muscle ?? "ejercicio"}{logged.supersetGroup ? ` · superserie ${logged.supersetGroup}` : ""}</span><h2>{exercise?.name ?? logged.exerciseId}</h2>{exercise?.weightMode === "per-dumbbell" && <small>El peso es por mancuerna</small>}{logged.progression?.policy !== "off" && <small className="prescription">{logged.progression.reason}</small>}</div><b>{String(exerciseIndex + 1).padStart(2, "0")}</b></div>
        <div className="set-labels"><span>Serie</span><span>{cardio ? "Velocidad" : "Peso kg"}</span><span>{cardio ? "Minutos" : timed ? "Tiempo" : "Reps"}</span><span>Hecha</span></div>
        {logged.sets.map((set: any, setIndex: number) => <div className={`set-row-wrap ${set.completed ? "done" : ""}`} key={set.id}>
          <div className="set-row"><strong>{setIndex + 1}</strong><input aria-label={`${cardio ? "Velocidad" : "Peso"} serie ${setIndex + 1}`} type="number" inputMode="decimal" value={cardio ? set.speed ?? 0 : set.weight ?? 0} onChange={(event) => updateSet(exerciseIndex, setIndex, cardio ? { speed: Number(event.target.value) } : { weight: Number(event.target.value) })} /><div className="stepper"><button aria-label="Restar" onClick={() => updateSet(exerciseIndex, setIndex, cardio ? { minutes: Math.max(0, Number(set.minutes ?? 0) - 1) } : timed ? { seconds: Math.max(0, Number(set.seconds ?? 0) - 5) } : { reps: Math.max(0, Number(set.reps ?? 0) - 1) })}>−</button><input aria-label={cardio ? "Minutos" : timed ? "Segundos" : "Repeticiones"} type="number" value={cardio ? set.minutes ?? 0 : timed ? set.seconds ?? 0 : set.reps ?? 0} onChange={(event) => updateSet(exerciseIndex, setIndex, cardio ? { minutes: Number(event.target.value) } : timed ? { seconds: Number(event.target.value) } : { reps: Number(event.target.value) })} /><button aria-label="Sumar" onClick={() => updateSet(exerciseIndex, setIndex, cardio ? { minutes: Number(set.minutes ?? 0) + 1 } : timed ? { seconds: Number(set.seconds ?? 0) + 5 } : { reps: Number(set.reps ?? 0) + 1 })}>+</button></div><button className="check" aria-label={`Marcar serie ${setIndex + 1}`} onClick={() => toggleCompleted(exerciseIndex, setIndex, set.completed)}>{set.completed ? "✓" : ""}</button></div>
          {state.settings?.effortTracking !== "off" && <label className="effort-row"><span>{state.settings?.effortTracking === "rpe" ? "RPE" : "RIR"}</span><input type="range" min="0" max="10" step="1" value={state.settings?.effortTracking === "rpe" ? set.rpe ?? 8 : set.rir ?? 2} onChange={(event) => updateSet(exerciseIndex, setIndex, state.settings?.effortTracking === "rpe" ? { rpe: Number(event.target.value), rir: undefined } : { rir: Number(event.target.value), rpe: undefined })} /><strong>{state.settings?.effortTracking === "rpe" ? set.rpe ?? 8 : set.rir ?? 2}</strong></label>}
        </div>)}
        <button className="add-row" onClick={() => setWorkout((current: any) => ({ ...current, exercises: current.exercises.map((entry: any, index: number) => index === exerciseIndex ? { ...entry, sets: [...entry.sets, { ...entry.sets.at(-1), id: crypto.randomUUID(), completed: false }] } : entry) }))}>+ Añadir serie</button>
      </article>;
    })}</section>
    <footer className="finish-bar"><div><span>{completed} de {total}</span><div className="mini-track"><i style={{ width: `${total ? completed / total * 100 : 0}%` }} /></div></div><button className="primary" onClick={onFinish}>Finalizar <span>→</span></button></footer>
  </main>;
}

function Coach({ state, request, onSave }: any) {
  const [messages, setMessages] = useState<any[]>(state.coach?.messages ?? []);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const ask = async (suggestion?: string) => {
    const message = (suggestion ?? input).trim();
    if (!message || thinking) return;
    const next = [...messages, { role: "user", content: message }];
    setMessages(next); setInput(""); setThinking(true);
    try {
      const response = await request("/api/coach/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, history: messages.slice(-8) }) });
      const body = await response.json();
      const complete = [...next, { role: "assistant", content: body.answer ?? "No he podido analizarlo ahora.", mode: body.mode }];
      setMessages(complete);
      await onSave({ ...state, coach: { messages: complete.slice(-30), updatedAt: new Date().toISOString() } }, "Conversación del Coach guardada");
    } finally { setThinking(false); }
  };
  return <div className="stack coach-page"><div className="page-title"><span className="eyebrow">COACH OPEN GYM</span><h2>Pregunta con tus datos.</h2><p>El Coach analiza sesiones, esfuerzo, progresión y constancia. No sustituye consejo médico.</p></div><div className="coach-suggestions">{["¿Cómo debería progresar esta semana?", "¿Necesito más descanso?", "Resume mis últimas sesiones"].map((suggestion) => <button key={suggestion} onClick={() => ask(suggestion)}>{suggestion}</button>)}</div><section className="coach-thread">{!messages.length && <div className="coach-empty"><strong>Tu historial ya está preparado.</strong><p>Haz una pregunta concreta sobre carga, fatiga o planificación.</p></div>}{messages.map((message, index) => <article key={index} className={message.role === "user" ? "from-user" : "from-coach"}><span>{message.role === "user" ? "Tú" : `Coach${message.mode === "local" ? " · local" : ""}`}</span><p>{message.content}</p></article>)}{thinking && <article className="from-coach"><span>Coach</span><p>Analizando tu entrenamiento…</p></article>}</section><div className="coach-compose"><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Pregunta sobre tu entrenamiento" aria-label="Pregunta para el Coach" rows={3} /><button className="primary" disabled={thinking || !input.trim()} onClick={() => ask()}>Enviar <span>→</span></button></div></div>;
}

function Library({ state, catalog, error, onSave }: any) {
  const [query, setQuery] = useState("");
  const [equipment, setEquipment] = useState("all");
  const [bodyPart, setBodyPart] = useState("all");
  const [customName, setCustomName] = useState("");
  const results = filterExercises(catalog, { query, equipment, bodyPart });
  const equipmentOptions = [...new Set<string>(catalog.map((exercise: any) => String(exercise.equipment)))].sort();
  const bodyPartOptions = [...new Set<string>(catalog.map((exercise: any) => String(exercise.bodyPart)))].sort();
  const installed = new Set([...state.exercises, ...state.customExercises].map((exercise: any) => exercise.id));
  const addExercise = (exercise: any) => onSave({ ...state, exercises: [...state.exercises, exercise] }, `${exercise.name} añadido a tu biblioteca`);
  const addCustom = async () => {
    if (!customName.trim()) return;
    const custom = { id: `custom-${crypto.randomUUID()}`, name: customName.trim(), muscle: "other", bodyPart: "other", equipment: "custom", measurement: "reps", weightMode: "standard", instructions: [] };
    if (await onSave({ ...state, customExercises: [...state.customExercises, custom] }, "Ejercicio personalizado creado")) setCustomName("");
  };
  return <div className="stack library-page">
    <div className="page-title"><span className="eyebrow">1324 MOVIMIENTOS</span><h2>Biblioteca</h2><p>Busca por nombre, músculo, zona o equipo. Los medios y las instrucciones proceden del catálogo abierto de openGym.</p></div>
    <div className="create-row"><input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="Crear ejercicio personalizado" aria-label="Ejercicio personalizado" /><button onClick={addCustom}>Crear</button></div>
    <section className="catalog-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Buscar ejercicio o músculo" aria-label="Buscar ejercicios" /><select value={equipment} onChange={(event) => setEquipment(event.target.value)} aria-label="Filtrar por equipo"><option value="all">Todo el equipo</option>{equipmentOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select><select value={bodyPart} onChange={(event) => setBodyPart(event.target.value)} aria-label="Filtrar por zona"><option value="all">Todo el cuerpo</option>{bodyPartOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></section>
    {error && <article className="settings-card"><strong>No se pudo cargar el catálogo</strong><p>{error}</p></article>}
    {!error && !catalog.length && <article className="settings-card"><p>Cargando la biblioteca completa…</p></article>}
    {catalog.length > 0 && <div className="catalog-summary">{results.length} ejercicios encontrados · mostrando {Math.min(40, results.length)}</div>}
    {results.slice(0, 40).map((exercise: any) => <article className="catalog-card" key={exercise.id}>
      {/* eslint-disable-next-line @next/next/no-img-element -- external open dataset media */}
      {exercise.imageUrl && <img src={exercise.imageUrl} alt="" loading="lazy" />}
      <div><span>{exercise.bodyPart} · {exercise.equipment}</span><h3>{exercise.name}</h3><p>{exercise.muscle}{exercise.mainMuscle ? ` · ${exercise.mainMuscle}` : ""}</p><details><summary>Instrucciones</summary><ol>{exercise.instructions.map((step: string, index: number) => <li key={index}>{step}</li>)}</ol>{exercise.gifUrl && <a href={exercise.gifUrl} target="_blank" rel="noreferrer">Ver animación</a>}</details><button className="secondary" disabled={installed.has(exercise.id)} onClick={() => addExercise(exercise)}>{installed.has(exercise.id) ? "Añadido" : "Añadir a mis rutinas"}</button></div>
    </article>)}
  </div>;
}

function Routines({ state, onSave, onStart }: any) {
  const [name, setName] = useState("");
  const [sharedCode, setSharedCode] = useState("");
  const allExercises = [...state.exercises, ...state.customExercises];
  async function addRoutine() {
    if (!name.trim()) return;
    const routine = { id: crypto.randomUUID(), name: name.trim(), color: "amber", exercises: [] };
    if (await onSave({ ...state, routines: [...state.routines, routine] }, "Rutina creada")) setName("");
  }
  const updateRoutine = (routineId: string, updater: (routine: any) => any, message = "Rutina actualizada") => onSave({ ...state, routines: state.routines.map((routine: any) => routine.id === routineId ? updater(routine) : routine) }, message);
  const removeRoutine = (routineId: string) => onSave({ ...state, routines: state.routines.filter((routine: any) => routine.id !== routineId), weekPlan: Object.fromEntries(Object.entries(state.weekPlan).map(([day, id]) => [day, id === routineId ? null : id])) }, "Rutina eliminada");
  const sharePlan = async () => {
    const text = `OpenGym plan:${encodePlanBundle(buildPlanBundle(state))}`;
    if (Capacitor.isNativePlatform()) await Share.share({ title: "Mi plan OpenGym", text, dialogTitle: "Compartir plan" });
    else if (navigator.share) await navigator.share({ title: "Mi plan OpenGym", text });
    else { await navigator.clipboard.writeText(text); window.alert("Plan copiado al portapapeles"); }
  };
  const printPlan = () => {
    const popup = window.open("", "opengym-plan");
    if (!popup) return;
    popup.document.write(printablePlanHtml(state));
    popup.document.close();
  };
  const importSharedPlan = async () => {
    const encoded = sharedCode.trim().replace(/^OpenGym plan:/, "");
    if (!encoded) return;
    try {
      if (await onSave(mergePlanBundle(state, decodePlanBundle(encoded)), "Plan compartido importado")) setSharedCode("");
    } catch { window.alert("El código de plan no es válido"); }
  };
  return <div className="stack"><div className="page-title"><span className="eyebrow">PLANIFICA</span><h2>Rutinas</h2><p>Edita ejercicios, orden, objetivos, progresión y superseries sin salir del plan.</p></div><div className="create-row"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre de la nueva rutina" aria-label="Nombre de rutina" /><button onClick={addRoutine}>Crear</button></div>
    <div className="plan-actions"><button className="secondary" onClick={sharePlan}>Compartir plan</button><button className="secondary" onClick={printPlan}>Imprimir / PDF</button></div>
    <div className="create-row"><input value={sharedCode} onChange={(event) => setSharedCode(event.target.value)} placeholder="Pega un código OpenGym plan:" aria-label="Código de plan compartido" /><button onClick={importSharedPlan}>Importar</button></div>
    {state.routines.map((routine: any) => <article className="routine-card routine-editor" key={routine.id}><div><i className={`dot ${routine.color}`} /><span>{routine.exercises.length} ejercicios</span></div><div className="routine-title-row"><input defaultValue={routine.name} aria-label="Nombre de rutina" onBlur={(event) => updateRoutine(routine.id, (current) => ({ ...current, name: event.target.value.trim() || current.name }))} /><select value={routine.color} onChange={(event) => updateRoutine(routine.id, (current) => ({ ...current, color: event.target.value }))}><option value="lime">Lima</option><option value="violet">Violeta</option><option value="amber">Ámbar</option></select></div>
      <div className="routine-exercises">{routine.exercises.map((entry: any, index: number) => { const exercise = getExercise(state, entry.exerciseId); const timed = exerciseMode(exercise) === "time"; return <div className="routine-exercise-row" key={`${entry.exerciseId}-${index}`}><strong>{exercise?.name ?? entry.exerciseId}</strong><label>Series<input type="number" min="1" max="20" defaultValue={entry.targetSets ?? 3} onBlur={(event) => updateRoutine(routine.id, (current) => ({ ...current, exercises: current.exercises.map((item: any, child: number) => child === index ? { ...item, targetSets: Number(event.target.value) } : item) }))} /></label><label>{timed ? "Seg" : "Reps"}<input type="number" min="1" defaultValue={timed ? entry.targetSeconds ?? 30 : entry.targetReps ?? 10} onBlur={(event) => updateRoutine(routine.id, (current) => ({ ...current, exercises: current.exercises.map((item: any, child: number) => child === index ? { ...item, [timed ? "targetSeconds" : "targetReps"]: Number(event.target.value) } : item) }))} /></label><label>Progresión<select value={entry.progression ?? "off"} onChange={(event) => updateRoutine(routine.id, (current) => ({ ...current, exercises: current.exercises.map((item: any, child: number) => child === index ? { ...item, progression: event.target.value } : item) }))}><option value="off">Manual</option><option value="linear">Lineal</option><option value="greyskull">Greyskull</option><option value="double">Doble</option><option value="time">Tiempo</option></select></label><label>Superserie<input value={entry.supersetGroup ?? ""} placeholder="A, B…" onChange={(event) => updateRoutine(routine.id, (current) => ({ ...current, exercises: current.exercises.map((item: any, child: number) => child === index ? { ...item, supersetGroup: event.target.value || null } : item) }))} /></label><div className="reorder-buttons"><button disabled={index === 0} onClick={() => updateRoutine(routine.id, (current) => { const exercises = [...current.exercises]; [exercises[index - 1], exercises[index]] = [exercises[index], exercises[index - 1]]; return { ...current, exercises }; })}>↑</button><button disabled={index === routine.exercises.length - 1} onClick={() => updateRoutine(routine.id, (current) => { const exercises = [...current.exercises]; [exercises[index + 1], exercises[index]] = [exercises[index], exercises[index + 1]]; return { ...current, exercises }; })}>↓</button><button onClick={() => updateRoutine(routine.id, (current) => ({ ...current, exercises: current.exercises.filter((_: any, child: number) => child !== index) }), "Ejercicio eliminado")}>×</button></div></div>; })}</div>
      <label className="add-exercise-select">Añadir ejercicio<select value="" onChange={(event) => { const exercise = getExercise(state, event.target.value); if (!exercise) return; updateRoutine(routine.id, (current) => ({ ...current, exercises: [...current.exercises, { exerciseId: exercise.id, targetSets: 3, targetReps: exerciseMode(exercise) === "reps" ? 10 : undefined, targetSeconds: exerciseMode(exercise) === "time" ? 30 : undefined, progression: exerciseMode(exercise) === "time" ? "time" : "off", supersetGroup: null }] }), "Ejercicio añadido"); }}><option value="">Selecciona…</option>{allExercises.filter((exercise: any) => !routine.exercises.some((entry: any) => entry.exerciseId === exercise.id)).map((exercise: any) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}</select></label><div className="routine-actions"><button className="secondary" disabled={!routine.exercises.length} onClick={() => onStart(routine)}>Entrenar ahora</button><button className="danger-link" onClick={() => removeRoutine(routine.id)}>Eliminar rutina</button></div></article>)}
    <section className="week-editor"><h3>Plan semanal</h3>{Object.entries(state.weekPlan).map(([day, routineId]: any) => <label key={day}><span>{WEEKDAY_LABELS[day]}</span><select value={routineId ?? ""} onChange={(event) => onSave({ ...state, weekPlan: { ...state.weekPlan, [day]: event.target.value || null } }, "Plan semanal actualizado")}><option value="">Descanso</option>{state.routines.map((routine: any) => <option key={routine.id} value={routine.id}>{routine.name}</option>)}</select></label>)}</section></div>;
}

function History({ state, onSave }: any) {
  const workouts = [...state.workouts].sort((a: any, b: any) => b.date.localeCompare(a.date));
  function editSet(workoutId: string, exerciseIndex: number, setIndex: number, field: string, value: number) { const next = { ...state, workouts: state.workouts.map((workout: any) => workout.id !== workoutId ? workout : ({ ...workout, exercises: workout.exercises.map((exercise: any, index: number) => index !== exerciseIndex ? exercise : ({ ...exercise, sets: exercise.sets.map((set: any, childIndex: number) => childIndex === setIndex ? { ...set, [field]: value } : set) })) })) }; onSave(next, "Historial corregido"); }
  return <div className="stack"><div className="page-title"><span className="eyebrow">REGISTRO</span><h2>Historial</h2><p>Cada serie sigue siendo editable. Añade lo que olvidaste sin perder contexto.</p></div>{workouts.map((workout: any) => <article className="history-card" key={workout.id}><div className="history-date"><strong>{new Intl.DateTimeFormat("es", { day: "2-digit" }).format(new Date(workout.date))}</strong><span>{new Intl.DateTimeFormat("es", { month: "short", year: "numeric" }).format(new Date(workout.date))}</span></div><div className="history-body"><h3>{workout.name}</h3><small>{Math.round((workout.durationSeconds ?? 0) / 60)} min · {workout.exercises.reduce((sum: number, entry: any) => sum + entry.sets.length, 0)} series</small>{workout.exercises.map((entry: any, exerciseIndex: number) => { const exercise = getExercise(state, entry.exerciseId); return <details key={`${workout.id}-${entry.exerciseId}`}><summary>{exercise?.name ?? entry.exerciseId}<span>{entry.sets.length} series</span></summary>{entry.sets.map((set: any, setIndex: number) => <div className="compact-set" key={set.id}><span>{setIndex + 1}</span>{exercise?.measurement === "time" ? <><input type="number" value={set.seconds ?? 0} onChange={(event) => editSet(workout.id, exerciseIndex, setIndex, "seconds", Number(event.target.value))} /><em>seg</em></> : <><input type="number" value={set.weight ?? 0} onChange={(event) => editSet(workout.id, exerciseIndex, setIndex, "weight", Number(event.target.value))} /><em>kg ×</em><input type="number" value={set.reps ?? 0} onChange={(event) => editSet(workout.id, exerciseIndex, setIndex, "reps", Number(event.target.value))} /></>}</div>)}<button className="add-row" onClick={() => { const last = entry.sets.at(-1) ?? {}; const next = { ...state, workouts: state.workouts.map((item: any) => item.id !== workout.id ? item : ({ ...item, exercises: item.exercises.map((logged: any, index: number) => index !== exerciseIndex ? logged : ({ ...logged, sets: [...logged.sets, { ...last, id: crypto.randomUUID() }] })) })) }; onSave(next, "Serie añadida al historial"); }}>+ Añadir serie omitida</button></details>; })}</div></article>)}</div>;
}

function Progress({ state, onSave }: any) {
  const estimates = getEstimatedOneRepMaxes(state);
  const balance = getMuscleBalance(state);
  const [weight, setWeight] = useState("");
  const maxBalance = Math.max(1, ...Object.values(balance).map(Number));
  const effort = summarizeEffort(state.workouts);
  const weekly = weeklySummary(state.workouts);
  const streak = trainingStreak(state.workouts);
  const heatmap = activityHeatmap(state.workouts, 112);
  const muscles = muscleFrequency(state) as Record<string, number>;
  return <div className="stack"><div className="page-title"><span className="eyebrow">DATOS QUE SIRVEN</span><h2>Progreso</h2><p>Fuerza, constancia, esfuerzo, cardio y distribución muscular en una sola lectura.</p></div>
    <article className="weight-card"><div><span>PESO ACTUAL</span><strong>{state.bodyweight.at(-1)?.weight ?? "—"}<em> kg</em></strong></div><div className="weight-add"><input value={weight} onChange={(event) => setWeight(event.target.value)} type="number" inputMode="decimal" placeholder="78,0" aria-label="Nuevo peso" /><button onClick={async () => { if (!weight) return; if (await onSave({ ...state, bodyweight: [...state.bodyweight, { id: crypto.randomUUID(), date: new Date().toISOString(), weight: Number(weight) }] }, "Peso registrado")) setWeight(""); }}>Añadir</button></div></article>
    <WeightChart entries={state.bodyweight} target={state.profile.targetWeight} onTarget={(targetWeight: number | null) => onSave({ ...state, profile: { ...state.profile, targetWeight } }, "Objetivo de peso actualizado")} />
    <article className="stats-card weekly-card"><span className="eyebrow">ÚLTIMOS 7 DÍAS</span><h3>{weekly.workouts} sesiones · {streak} días de racha</h3><div className="metric-strip"><span><strong>{weekly.sets}</strong> series</span><span><strong>{weekly.volume}</strong> kg·rep</span><span><strong>{weekly.cardioMinutes}</strong> min cardio</span></div></article>
    <article className="stats-card heatmap-card"><span className="eyebrow">ACTIVIDAD</span><h3>16 semanas</h3><div className="heatmap" aria-label="Mapa de actividad">{heatmap.map((day) => <i key={day.date} className={`level-${Math.min(4, day.count)}`} title={`${day.date}: ${day.count}`} />)}</div></article>
    <BodyMap muscles={muscles} />
    <article className="stats-card"><span className="eyebrow">FUERZA ESTIMADA</span><h3>Mejores 1RM</h3>{Object.entries(estimates).slice(0, 5).map(([id, value]: any) => <div className="stat-row" key={id}><span>{getExercise(state, id)?.name ?? id}</span><strong>{value} kg</strong></div>)}</article>
    <article className="stats-card"><span className="eyebrow">ESFUERZO</span><h3>Intensidad registrada</h3><div className="stat-row"><span>Cobertura</span><strong>{Math.round(effort.coverage * 100)} %</strong></div><div className="stat-row"><span>RIR medio</span><strong>{effort.averageRir ?? "—"}</strong></div><div className="stat-row"><span>Series duras</span><strong>{effort.hardSets}</strong></div></article>
    <article className="stats-card"><span className="eyebrow">EQUILIBRIO MUSCULAR</span><h3>Volumen acumulado</h3>{Object.entries(balance).filter(([, value]) => Number(value) > 0).map(([muscle, value]: any) => <div className="bar-row" key={muscle}><span>{muscle}</span><div><i style={{ width: `${Number(value) / maxBalance * 100}%` }} /></div><strong>{Math.round(value)}</strong></div>)}</article>
  </div>;
}

function WeightChart({ entries, target, onTarget }: { entries: any[]; target: number | null; onTarget: (value: number | null) => void }) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date)).slice(-24);
  const values = [...sorted.map((entry) => Number(entry.weight)), ...(target ? [Number(target)] : [])];
  const min = values.length ? Math.min(...values) - 1 : 0, max = values.length ? Math.max(...values) + 1 : 1, range = Math.max(1, max - min);
  const points = sorted.map((entry, index) => `${sorted.length === 1 ? 50 : index / (sorted.length - 1) * 100},${92 - (Number(entry.weight) - min) / range * 82}`).join(" ");
  const targetY = target ? 92 - (Number(target) - min) / range * 82 : null;
  return <article className="stats-card weight-chart"><span className="eyebrow">PESO CORPORAL</span><h3>Tendencia y objetivo</h3><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Gráfico de peso corporal">{targetY != null && <line x1="0" y1={targetY} x2="100" y2={targetY} className="target-line" />}<polyline points={points} /></svg><label className="setting-row"><span>Objetivo</span><input type="number" inputMode="decimal" defaultValue={target ?? ""} placeholder="Sin objetivo" onBlur={(event) => onTarget(event.target.value ? Number(event.target.value) : null)} /></label></article>;
}

function BodyMap({ muscles }: { muscles: Record<string, number> }) {
  const max = Math.max(1, ...Object.values(muscles));
  const tone = (names: string[]) => Math.max(0, ...names.map((name) => muscles[name] ?? 0)) / max;
  const fill = (value: number) => `color-mix(in srgb, var(--lime-deep) ${Math.max(12, Math.round(value * 100))}%, #e4e6df)`;
  return <article className="stats-card body-map-card"><span className="eyebrow">MAPA MUSCULAR</span><h3>Frecuencia · 28 días</h3><svg viewBox="0 0 180 320" role="img" aria-label="Mapa muscular frontal y posterior"><circle cx="90" cy="27" r="19" fill="#dfe2dc"/><path d="M66 52 Q90 43 114 52 L126 126 Q112 151 90 151 Q68 151 54 126Z" fill={fill(tone(["chest","pectorals","back","lats","abs","core"]))}/><path d="M55 58 L30 137 L42 143 L70 79Z" fill={fill(tone(["shoulders","delts","biceps","triceps"]))}/><path d="M125 58 L150 137 L138 143 L110 79Z" fill={fill(tone(["shoulders","delts","biceps","triceps"]))}/><path d="M68 145 L55 273 L76 276 L90 168Z" fill={fill(tone(["quads","hamstrings","glutes","calves"]))}/><path d="M112 145 L125 273 L104 276 L90 168Z" fill={fill(tone(["quads","hamstrings","glutes","calves"]))}/><path d="M54 274 L52 306 L76 306 L76 276Z" fill={fill(tone(["calves"]))}/><path d="M126 274 L128 306 L104 306 L104 276Z" fill={fill(tone(["calves"]))}/></svg><div className="muscle-legend">{Object.entries(muscles).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => <span key={name}><i style={{ background: fill(count / max) }} />{name} · {count}</span>)}</div></article>;
}

function Settings({ state, config, request, onSave, onLogout }: any) {
  const [report, setReport] = useState<any>(null);
  const [admin, setAdmin] = useState<any>(null);
  const [adminError, setAdminError] = useState("");
  async function importFile(file?: File) {
    if (!file) return;
    if (file.name.toLowerCase().endsWith(".csv")) {
      const result = importWorkoutCsv(await file.text(), state);
      setReport(result.report);
      await onSave(result.state, `Importación ${result.report.source} completada`);
      return;
    }
    const source = JSON.parse(await file.text());
    if (source?.format === "opengym-coach") {
      await onSave(importPortableState(source, state.userId), "Copia de OpenGym restaurada");
      setReport({ portable: true });
      return;
    }
    const response = await request("/api/import/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(source) });
    const result = await response.json();
    if (response.ok) { setReport(result.report); await onSave(result.state, "Importación preparada y guardada"); }
  }
  const downloadExport = async () => {
    const contents = JSON.stringify(exportPortableState(state), null, 2);
    const filename = `opengym-${new Date().toISOString().slice(0, 10)}.json`;
    if (Capacitor.isNativePlatform()) {
      const bytes = new TextEncoder().encode(contents);
      const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
      await Filesystem.writeFile({ path: filename, data: btoa(binary), directory: Directory.Documents });
      window.alert(`Copia guardada en Documentos/${filename}`);
      return;
    }
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const updateSettings = (patch: any, message: string) => onSave({ ...state, settings: { ...state.settings, ...patch } }, message);
  const updateProfile = (patch: any, message: string) => onSave({ ...state, profile: { ...state.profile, ...patch } }, message);
  const toggleReminder = async (enabled: boolean) => {
    if (Capacitor.isNativePlatform()) {
      if (enabled) {
        const permission = await LocalNotifications.requestPermissions();
        if (permission.display !== "granted") return;
        const [hour, minute] = String(state.settings.reminder.time).split(":").map(Number);
        await LocalNotifications.schedule({ notifications: [{ id: 7001, title: "OpenGym", body: "Tu entrenamiento está listo cuando tú lo estés.", schedule: { on: { hour, minute }, repeats: true }, smallIcon: "ic_launcher_foreground" }] });
      } else await LocalNotifications.cancel({ notifications: [{ id: 7001 }] });
      await updateSettings({ reminder: { ...state.settings.reminder, enabled } }, "Recordatorio actualizado");
      return;
    }
    if (enabled && "Notification" in window && Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
    }
    await updateSettings({ reminder: { ...state.settings.reminder, enabled } }, "Recordatorio actualizado");
  };
  const loadAdmin = async () => {
    const response = await request("/api/admin/");
    if (!response.ok) { setAdminError(response.status === 403 ? "Tu cuenta no tiene el permiso gym:admin." : "No se pudo cargar administración."); return; }
    setAdmin(await response.json()); setAdminError("");
  };
  const deleteProfile = async (userId: string) => {
    if (!window.confirm(`Eliminar permanentemente el perfil ${userId}?`)) return;
    await request("/api/admin/", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
    await loadAdmin();
  };
  return <div className="stack"><div className="page-title"><span className="eyebrow">TU ESPACIO</span><h2>Ajustes</h2><p>Control total sobre identidad, unidades y portabilidad.</p></div>
    <article className="settings-card"><h3>Datos y migración</h3><p>Exporta una copia completa o importa OpenGym, Gym Coach, Strong, Hevy, FitNotes y Apple Health. El origen nunca se modifica.</p><div className="settings-actions"><button className="secondary" onClick={downloadExport}>Exportar JSON</button><label className="file-button">Importar archivo<input type="file" accept="application/json,.json,text/csv,.csv" onChange={(event) => importFile(event.target.files?.[0])} /></label></div>{report && <div className="import-report"><strong>Importación completada</strong>{report.portable ? <span>Copia completa restaurada</span> : <><span>{report.workouts} sesiones · {report.exercises} ejercicios · {report.sets} series</span><span>{report.customExercises} ejercicios personalizados · {report.dropped} descartados</span></>}</div>}</article>
    <article className="settings-card"><h3>Entrenamiento</h3><label className="setting-row"><span>Descanso automático</span><select value={state.settings.restSeconds} onChange={(event) => updateSettings({ restSeconds: Number(event.target.value) }, "Descanso actualizado")}><option value="30">30 s</option><option value="60">60 s</option><option value="90">90 s</option><option value="120">2 min</option><option value="180">3 min</option></select></label><label className="setting-row"><span>Esfuerzo</span><select value={state.settings.effortTracking} onChange={(event) => updateSettings({ effortTracking: event.target.value }, "Registro de esfuerzo actualizado")}><option value="off">Desactivado</option><option value="rir">RIR</option><option value="rpe">RPE</option></select></label><label className="setting-row"><span>Mantener pantalla activa</span><input type="checkbox" checked={state.settings.keepAwake} onChange={(event) => updateSettings({ keepAwake: event.target.checked }, "Wake lock actualizado")} /></label><label className="setting-row"><span>Recordatorio diario</span><input type="checkbox" checked={state.settings.reminder.enabled} onChange={(event) => toggleReminder(event.target.checked)} /></label><label className="setting-row"><span>Hora</span><input type="time" value={state.settings.reminder.time} onChange={(event) => updateSettings({ reminder: { ...state.settings.reminder, time: event.target.value } }, "Hora del recordatorio actualizada")} /></label></article>
    <article className="settings-card"><h3>Apariencia</h3><label className="setting-row"><span>Tema</span><select value={state.settings.theme} onChange={(event) => updateSettings({ theme: event.target.value }, "Tema actualizado")}><option value="dark">Oscuro</option><option value="light">Claro</option><option value="system">Sistema</option></select></label><label className="setting-row"><span>Acento</span><select value={state.settings.accent} onChange={(event) => updateSettings({ accent: event.target.value }, "Color actualizado")}><option value="lime">Lima</option><option value="violet">Violeta</option><option value="amber">Ámbar</option></select></label></article>
    <article className="settings-card"><h3>Administración</h3><p>Disponible únicamente para tokens con el permiso <code>gym:admin</code>.</p><button className="secondary" onClick={loadAdmin}>Abrir panel</button>{adminError && <p className="error-text">{adminError}</p>}{admin && <><div className="stat-row"><span>Perfiles</span><strong>{admin.totals.profiles}</strong></div><div className="stat-row"><span>Almacenamiento</span><strong>{Math.round(admin.totals.storageBytes / 1024)} KB</strong></div><div className="admin-table">{admin.profiles.map((profile: any) => <div key={profile.user_id}><span><strong>{profile.user_id}</strong><small>v{profile.revision} · {new Date(profile.updated_at).toLocaleString()}</small></span><button onClick={() => deleteProfile(profile.user_id)}>Eliminar</button></div>)}</div></>}</article>
    <article className="settings-card"><h3>Unidades e idioma</h3><label className="setting-row"><span>Peso</span><select value={state.profile.weightUnit} onChange={(event) => updateProfile({ weightUnit: event.target.value }, "Unidad actualizada")}><option value="kg">Kilogramos</option><option value="lb">Libras</option></select></label><label className="setting-row"><span>Mancuernas por mano</span><input type="checkbox" checked={state.profile.dumbbellWeightIsPerHand} onChange={(event) => updateProfile({ dumbbellWeightIsPerHand: event.target.checked }, "Preferencia de mancuernas actualizada")} /></label><label className="setting-row"><span>Idioma</span><select value={state.profile.locale} onChange={(event) => updateProfile({ locale: event.target.value }, "Idioma actualizado")}>{LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label></article><article className="settings-card source"><span className="eyebrow">CÓDIGO ABIERTO</span><h3>Hecho sobre openGym</h3><p>Esta adaptación se publica bajo AGPL-3.0 y conserva la atribución del proyecto original.</p><a href="https://github.com/AlexCCGit/opengym-coach-sites" target="_blank" rel="noreferrer">Ver código fuente ↗</a><a href="https://github.com/alexpcosta/opengym" target="_blank" rel="noreferrer">Fork de referencia ↗</a></article><button className="danger-link" onClick={onLogout}>{config.authMode === "demo" ? "Reiniciar sesión local" : "Cerrar sesión"}</button></div>;
}
