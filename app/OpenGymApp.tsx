"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createInitialState, getEstimatedOneRepMaxes, getExercise, getMuscleBalance, getOneRepMaxHistory, prefillExercise, weightForTargetOneRepMax } from "../lib/domain.mjs";
import { exportPortableState, importPortableState, normalizeState } from "../lib/state-schema.mjs";
import { detectPersonalRecords, exerciseMode, recommendProgression, shouldStartRest, summarizeEffort, updateProgressionState } from "../lib/training-engine.mjs";
import { fetchExerciseCatalog, filterExercises, loadInstructionPack } from "../lib/exercise-catalog.mjs";
import { importWorkoutCsv } from "../lib/csv-import.mjs";
import { activityHeatmap, muscleFrequency, trainingStreak, weeklySummary } from "../lib/analytics.mjs";
import { buildPlanBundle, decodePlanBundle, encodePlanBundle, mergePlanBundle, printablePlanHtml } from "../lib/plan-share.mjs";
import { LANGUAGES, loadUiLocale, translate } from "../lib/i18n.mjs";
import { applyCoachSuggestions, designPlanProposal, dismissCoachSuggestion, reviewPlan, undoCoachChanges } from "../lib/coach-planner.mjs";
import { migrateGymCoachState } from "../lib/migration.mjs";
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Share } from "@capacitor/share";

type Tab = "hoy" | "coach" | "biblioteca" | "rutinas" | "historial" | "progreso" | "ajustes";
type RecordState = { revision: number; state: any };
type AuthConfig = { authMode: string; auth0Domain: string; auth0ClientId: string; audience: string; scopes: string[] };
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_TRANSLATION_KEYS: Record<string, string> = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };
const LB_PER_KG = 2.2046226218;
const EMPTY_COACH = {};
const weightLabel = (unit: string) => unit === "lb" ? "lb" : "kg";
const displayWeight = (kilograms: any, unit: string) => kilograms == null || kilograms === "" ? "" : Math.round(Number(kilograms) * (unit === "lb" ? LB_PER_KG : 1) * 10) / 10;
const kilogramsFromDisplay = (value: any, unit: string) => Math.round(Number(value) / (unit === "lb" ? LB_PER_KG : 1) * 1000) / 1000;
const NATIVE_STATE_KEY = "opengym_native_record_v2";

async function nativeRequest(url: string, init: RequestInit = {}) {
  const path = new URL(url, "https://native.opengym").pathname.replace(/\/$/, "");
  if (path === "/api/state") {
    const current = JSON.parse(localStorage.getItem(NATIVE_STATE_KEY) ?? "null") ?? { revision: 1, state: createInitialState("native-local") };
    if ((init.method ?? "GET").toUpperCase() === "GET") return Response.json(current);
    const payload = JSON.parse(String(init.body ?? "{}"));
    if (Number(payload.revision) !== Number(current.revision)) return Response.json({ error: "revision_conflict", ...current }, { status: 409 });
    const next = { revision: current.revision + 1, state: normalizeState(payload.state, "native-local") };
    localStorage.setItem(NATIVE_STATE_KEY, JSON.stringify(next));
    return Response.json(next);
  }
  if (path === "/api/coach") return Response.json({ answer: "El modo Android autónomo mantiene tus datos en el teléfono. Usa Diseño o Revisión para propuestas locales; conecta el Site si quieres respuestas del proveedor AI.", mode: "local" });
  if (path === "/api/import") {
    const result = migrateGymCoachState(JSON.parse(String(init.body ?? "{}")), "native-local");
    return Response.json(result);
  }
  if (path === "/api/activity") return Response.json({ ok: true });
  if (path === "/api/admin") return Response.json({ error: "La administración sólo existe en el Site sincronizado" }, { status: 403 });
  return Response.json({ error: "not_found" }, { status: 404 });
}

async function scheduleWorkoutReminders(state: any) {
  if (!Capacitor.isNativePlatform()) return;
  const ids = Array.from({ length: 14 }, (_, index) => ({ id: 7100 + index }));
  await LocalNotifications.cancel({ notifications: ids }).catch(() => undefined);
  if (!state.settings?.reminder?.enabled) return;
  const [hour, minute] = String(state.settings.reminder.time ?? "08:00").split(":").map(Number);
  const logged = new Set((state.workouts ?? []).map((workout: any) => String(workout.date).slice(0, 10)));
  const notifications = [];
  for (let index = 0; index < 14; index += 1) {
    const date = new Date();
    date.setDate(date.getDate() + index);
    date.setHours(hour, minute, 0, 0);
    if (date.getTime() <= Date.now()) continue;
    const dateKey = date.toISOString().slice(0, 10);
    const day = WEEKDAYS[date.getDay()];
    const routineId = Object.prototype.hasOwnProperty.call(state.dayOverrides ?? {}, dateKey) ? state.dayOverrides[dateKey] : state.weekPlan?.[day];
    const routine = state.routines?.find((item: any) => item.id === routineId);
    if (!routine || logged.has(dateKey)) continue;
    notifications.push({ id: 7100 + index, title: "OpenGym", body: `${routine.name} está planificado para hoy.`, schedule: { at: date }, smallIcon: "ic_launcher_foreground" });
  }
  if (notifications.length) await LocalNotifications.schedule({ notifications });
}

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
  const [uiDictionary, setUiDictionary] = useState<Record<string, string>>({});

  const request = useCallback(async (url: string, init: RequestInit = {}) => {
    if (Capacitor.isNativePlatform()) return nativeRequest(url, init);
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
    if (Capacitor.isNativePlatform()) setConfig({ authMode: "demo", auth0Domain: "", auth0ClientId: "", audience: "", scopes: [] });
    else fetch("/api/config/").then((response) => response.json()).then(setConfig).catch(() => setMessage("No se pudo cargar la configuración"));
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
  useEffect(() => {
    let active = true;
    loadUiLocale(record?.state?.profile?.locale ?? "es").then((dictionary) => { if (active) setUiDictionary(dictionary); });
    return () => { active = false; };
  }, [record?.state?.profile?.locale]);
  useEffect(() => {
    if (record?.state && Capacitor.isNativePlatform()) scheduleWorkoutReminders(record.state).catch(() => undefined);
  }, [record?.state]);

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
    if (Capacitor.isNativePlatform()) scheduleWorkoutReminders(body.state).catch(() => undefined);
    setMessage(successMessage);
    window.setTimeout(() => setMessage(""), 2200);
    return true;
  }

  if (!config || busy) return <main className="loading-screen"><div className="brand-orbit">OG</div><p>Preparando tu sesión…</p></main>;
  if (!record) return <SignIn onLogin={login} configured={Boolean(config.auth0Domain && config.auth0ClientId)} />;

  const state = record.state;
  const locale = state.profile?.locale ?? "es";
  const t = (key: string, ...args: any[]) => translate(locale, key, uiDictionary, ...args);
  const todayKey = WEEKDAYS[new Date().getDay()];
  const dateKey = new Date().toISOString().slice(0, 10);
  const routineId = Object.prototype.hasOwnProperty.call(state.dayOverrides, dateKey) ? state.dayOverrides[dateKey] : state.weekPlan[todayKey];
  const routine = state.routines.find((entry: any) => entry.id === routineId);

  async function startWorkout(selectedRoutine = routine) {
    if (!selectedRoutine) return;
    if (state.settings?.promptBodyweight) {
      const unit = state.profile?.weightUnit ?? "kg";
      const latestWeight = state.bodyweight.at(-1)?.weight ?? "";
      const entered = window.prompt(`Peso corporal de hoy en ${weightLabel(unit)} (opcional)`, String(displayWeight(latestWeight, unit)));
      const kilograms = entered ? kilogramsFromDisplay(entered, unit) : null;
      if (kilograms != null && kilograms !== Number(latestWeight)) {
        await save({ ...state, bodyweight: [...state.bodyweight, { id: crypto.randomUUID(), date: new Date().toISOString(), weight: kilograms }] }, "Peso registrado antes de la sesión");
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
          policy: entry.progression === "inherit" || entry.progression == null ? selectedRoutine.progression ?? "off" : entry.progression,
          mode: exerciseMode(getExercise(state, entry.exerciseId)),
          previousSets: prefilled.sets,
          targetReps: entry.targetReps ?? 10,
          minReps: entry.minReps ?? Math.max(1, Number(entry.targetReps ?? 10) - 2),
          targetSeconds: entry.targetSeconds ?? 30,
          increment: entry.increment ?? selectedRoutine.increment ?? 2.5,
          timeIncrement: entry.timeIncrement ?? selectedRoutine.timeIncrement ?? 5,
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
    request("/api/activity/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "training", routineName: selectedRoutine.name }) }).catch(() => undefined);
  }

  if (activeWorkout) {
    return <GuidedWorkout workout={activeWorkout} state={state} t={t} setWorkout={setActiveWorkout} request={request} onCancel={() => { request("/api/activity/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "idle" }) }).catch(() => undefined); setActiveWorkout(null); }} onFinish={async () => {
      const finished = { ...activeWorkout, durationSeconds: Math.max(60, Math.round((Date.now() - activeWorkout.startedAt) / 1000)) };
      delete finished.startedAt;
      const records = detectPersonalRecords(state.workouts, finished);
      const trainedMuscles = [...new Set(finished.exercises.flatMap((entry: any) => { const exercise = getExercise(state, entry.exerciseId); return [exercise?.muscle, exercise?.mainMuscle, ...(exercise?.secondaryMuscles ?? [])].filter(Boolean); }))];
      const success = `${records.length ? `Entrenamiento guardado · ${records.length} nueva${records.length === 1 ? "" : "s"} marca${records.length === 1 ? "" : "s"}` : "Entrenamiento guardado. Buen trabajo."}${trainedMuscles.length ? ` · Trabajaste ${trainedMuscles.slice(0, 4).join(", ")}` : ""}`;
      const progression = updateProgressionState(state.progression, finished);
      if (await save({ ...state, progression, workouts: [...state.workouts, finished] }, success)) { await request("/api/activity/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "idle" }) }); setActiveWorkout(null); }
    }} />;
  }

  return (
    <main className={`app-shell theme-${state.settings?.theme ?? "dark"} accent-${state.settings?.accent ?? "lime"}`}>
      <header className="topbar"><div><span className="eyebrow">OPEN GYM</span><h1>{t("intent")}</h1></div><div className="revision" title="Versión sincronizada">v{record.revision}</div></header>
      {message && <div className="toast" role="status">{message}</div>}

      <section className="content">
        {tab === "hoy" && <Today state={state} t={t} routine={routine} todayKey={todayKey} onStart={() => startWorkout()} onGoRoutines={() => setTab("rutinas")} onSave={save} />}
        {tab === "coach" && <Coach state={state} t={t} request={request} onSave={save} />}
        {tab === "biblioteca" && <Library state={state} t={t} catalog={catalog} error={catalogError} onSave={save} />}
        {tab === "rutinas" && <Routines state={state} t={t} onSave={save} onStart={startWorkout} />}
        {tab === "historial" && <History state={state} t={t} onSave={save} />}
        {tab === "progreso" && <Progress state={state} t={t} onSave={save} />}
        {tab === "ajustes" && <Settings state={state} t={t} config={config} request={request} onSave={save} onLogout={() => {
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

function Today({ state, t, routine, todayKey, onStart, onGoRoutines, onSave }: any) {
  const latest = [...state.workouts].sort((a: any, b: any) => b.date.localeCompare(a.date))[0];
  const dateKey = new Date().toISOString().slice(0, 10);
  return <div className="stack">
    <div className="date-row"><span>{t(DAY_TRANSLATION_KEYS[todayKey])}</span><strong>{new Intl.DateTimeFormat(state.profile?.locale ?? "es", { day: "numeric", month: "long" }).format(new Date())}</strong></div>
    <article className="workout-hero">
      <div className="hero-meta"><span>{t("Today's plan").toUpperCase()}</span><span>{routine ? t(routine.exercises.length === 1 ? "{0} exercise" : "{0} exercises", routine.exercises.length) : t("Rest")}</span></div>
      <h2>{routine?.name ?? t("Rest day")}</h2>
      <p>{routine ? `${t("Weekly plan:")} ${routine.name}` : t("rest day, but no one’s stopping you")}</p>
      {routine ? <button className="primary light" onClick={onStart}>{t("Start workout")} <span>→</span></button> : <button className="secondary light" onClick={onGoRoutines}>{t("Build a plan first")}</button>}
      <div className="progress-track"><span style={{ width: routine ? "38%" : "100%" }} /></div>
    </article>
    <div className="metric-grid"><div><span>{t("Last time")}</span><strong>{latest ? new Intl.DateTimeFormat(state.profile?.locale ?? "es", { day: "numeric", month: "short" }).format(new Date(latest.date)) : "—"}</strong><small>{latest?.name ?? t("No workouts yet.")}</small></div><div><span>{t("Body weight")}</span><strong>{displayWeight(state.bodyweight.at(-1)?.weight, state.profile?.weightUnit) || "—"}<em> {weightLabel(state.profile?.weightUnit)}</em></strong><small>{t("synced with your profile")}</small></div></div>
    <section className="list-section"><div className="section-heading"><div><span className="eyebrow">{t("Today").toUpperCase()}</span><h3>{t("Choose a different workout")}</h3></div></div><label className="day-override"><span>{t("Routine")}</span><select value={routine?.id ?? ""} onChange={(event) => onSave({ ...state, dayOverrides: { ...state.dayOverrides, [dateKey]: event.target.value || null } }, t("rescheduled"))}><option value="">{t("Rest / skip this day")}</option>{state.routines.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button onClick={() => { const next = { ...state.dayOverrides }; delete next[dateKey]; onSave({ ...state, dayOverrides: next }, t("Weekly plan:")); }}>{t("Weekly plan:")}</button></label></section>
    <section className="list-section"><div className="section-heading"><div><span className="eyebrow">{t("Next").toUpperCase()}</span><h3>{t("Your weekly routine")}</h3></div></div>{Object.entries(state.weekPlan).filter(([, id]) => id).slice(0, 4).map(([day, id]: any) => { const item = state.routines.find((entry: any) => entry.id === id); return <div className="plan-row" key={day}><span>{t(DAY_TRANSLATION_KEYS[day]).slice(0, 3)}</span><strong>{item?.name}</strong><i className={`dot ${item?.color ?? "lime"}`} /></div>; })}</section>
  </div>;
}

function GuidedWorkout({ workout, state, t, setWorkout, request, onCancel, onFinish }: any) {
  const [restLeft, setRestLeft] = useState(0);
  const [workTimer, setWorkTimer] = useState<any>(null);
  const previousRest = useRef(0);
  const workoutRef = useRef(workout);
  const completed = workout.exercises.flatMap((entry: any) => entry.sets).filter((set: any) => set.completed).length;
  const total = workout.exercises.flatMap((entry: any) => entry.sets).length;
  const unit = state.profile?.weightUnit ?? "kg";
  const updateSet = useCallback((exerciseIndex: number, setIndex: number, patch: any) => setWorkout((current: any) => ({ ...current, exercises: current.exercises.map((entry: any, index: number) => index !== exerciseIndex ? entry : ({ ...entry, sets: entry.sets.map((set: any, childIndex: number) => childIndex === setIndex ? { ...set, ...patch } : set) })) })), [setWorkout]);
  useEffect(() => {
    const heartbeat = () => request("/api/activity/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "training", routineName: workout.name }) }).catch(() => undefined);
    const timer = window.setInterval(heartbeat, 60_000);
    return () => window.clearInterval(timer);
  }, [request, workout.name]);
  useEffect(() => { workoutRef.current = workout; }, [workout]);
  useEffect(() => {
    if (!restLeft) return;
    const timer = window.setInterval(() => setRestLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [restLeft]);
  useEffect(() => {
    if (!workTimer?.running) return;
    const timer = window.setInterval(() => setWorkTimer((current: any) => {
      if (!current?.running) return current;
      const elapsed = current.elapsed + 1;
      return { ...current, elapsed, running: elapsed < current.target, finished: elapsed >= current.target };
    }), 1000);
    return () => window.clearInterval(timer);
  }, [workTimer?.running]);
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
  const toggleCompleted = useCallback((exerciseIndex: number, setIndex: number, wasCompleted: boolean) => {
    updateSet(exerciseIndex, setIndex, { completed: !wasCompleted });
    if (!wasCompleted && shouldStartRest(workoutRef.current.exercises, exerciseIndex, setIndex)) {
      const seconds = Number(state.settings?.restSeconds ?? 90);
      setRestLeft(seconds);
      if (Capacitor.isNativePlatform()) LocalNotifications.schedule({ notifications: [{ id: 7002, title: "OpenGym", body: "Descanso terminado — siguiente serie.", schedule: { at: new Date(Date.now() + seconds * 1000) }, smallIcon: "ic_launcher_foreground" }] }).catch(() => undefined);
    }
  }, [state.settings?.restSeconds, updateSet]);
  useEffect(() => {
    if (!workTimer) return;
    updateSet(workTimer.exerciseIndex, workTimer.setIndex, { seconds: workTimer.elapsed });
    if (workTimer.finished) {
      const set = workoutRef.current.exercises[workTimer.exerciseIndex]?.sets?.[workTimer.setIndex];
      if (!set?.completed) toggleCompleted(workTimer.exerciseIndex, workTimer.setIndex, false);
      setWorkTimer(null);
    }
  }, [workTimer, toggleCompleted, updateSet]);
  return <main className="guided-shell">
    <header className="guided-header"><button className="icon-button" onClick={onCancel} aria-label={t("Discard workout?")}>×</button><div><span className="eyebrow">{t("Resume").toUpperCase()}</span><h1>{workout.name}</h1></div><span className="set-count">{completed}/{total}</span></header>
    <div className="session-progress"><span style={{ width: `${total ? completed / total * 100 : 0}%` }} /></div>
    {restLeft > 0 && <div className="rest-timer" role="timer"><span>{t("Rest")}</span><strong>{Math.floor(restLeft / 60)}:{String(restLeft % 60).padStart(2, "0")}</strong><button onClick={() => { setRestLeft(0); if (Capacitor.isNativePlatform()) LocalNotifications.cancel({ notifications: [{ id: 7002 }] }).catch(() => undefined); }}>{t("Skip")}</button></div>}
    {workTimer && <div className="rest-timer work-timer" role="timer"><span>{t("Timed")}</span><strong>{Math.floor(workTimer.elapsed / 60)}:{String(workTimer.elapsed % 60).padStart(2, "0")} / {workTimer.target}s</strong><button onClick={() => setWorkTimer(null)}>{t("Save")}</button></div>}
    <section className="guided-content">{workout.exercises.map((logged: any, exerciseIndex: number) => {
      const exercise = getExercise(state, logged.exerciseId);
      const mode = exerciseMode(exercise);
      const timed = mode === "time";
      const cardio = mode === "cardio";
      return <article className="exercise-card" key={logged.exerciseId}>
        <div className="exercise-heading"><div><span>{exercise?.muscle ?? "ejercicio"}{logged.supersetGroup ? ` · superserie ${logged.supersetGroup}` : ""}</span><h2>{exercise?.name ?? logged.exerciseId}</h2>{exercise?.weightMode === "per-dumbbell" && <small>El peso es por mancuerna</small>}{logged.progression?.policy !== "off" && <small className="prescription">{logged.progression.reason}</small>}</div><b>{String(exerciseIndex + 1).padStart(2, "0")}</b></div>
        <div className="set-labels"><span>{t("Sets")}</span><span>{cardio ? t("Speed (km/h)") : t("Weight ({0})", weightLabel(unit))}</span><span>{cardio ? t("Minutes") : timed ? t("Duration") : t("Reps")}</span><span>{t("Timer")}</span><span>{t("Save")}</span></div>
        {logged.sets.map((set: any, setIndex: number) => <div className={`set-row-wrap ${set.completed ? "done" : ""}`} key={set.id}>
          <div className="set-row"><strong>{setIndex + 1}</strong><input aria-label={`${cardio ? "Velocidad" : `Peso en ${weightLabel(unit)}`} serie ${setIndex + 1}`} type="number" inputMode="decimal" value={cardio ? set.speed ?? 0 : displayWeight(set.weight ?? 0, unit)} onChange={(event) => updateSet(exerciseIndex, setIndex, cardio ? { speed: Number(event.target.value) } : { weight: kilogramsFromDisplay(event.target.value, unit) })} /><div className="stepper"><button aria-label="Restar" onClick={() => updateSet(exerciseIndex, setIndex, cardio ? { minutes: Math.max(0, Number(set.minutes ?? 0) - 1) } : timed ? { seconds: Math.max(0, Number(set.seconds ?? 0) - 5) } : { reps: Math.max(0, Number(set.reps ?? 0) - 1) })}>−</button><input aria-label={cardio ? "Minutos" : timed ? "Segundos" : "Repeticiones"} type="number" value={cardio ? set.minutes ?? 0 : timed ? set.seconds ?? 0 : set.reps ?? 0} onChange={(event) => updateSet(exerciseIndex, setIndex, cardio ? { minutes: Number(event.target.value) } : timed ? { seconds: Number(event.target.value) } : { reps: Number(event.target.value) })} /><button aria-label="Sumar" onClick={() => updateSet(exerciseIndex, setIndex, cardio ? { minutes: Number(set.minutes ?? 0) + 1 } : timed ? { seconds: Number(set.seconds ?? 0) + 5 } : { reps: Number(set.reps ?? 0) + 1 })}>+</button></div>{timed ? <button className="timer-button" disabled={Boolean(workTimer)} aria-label={`Iniciar cronómetro de la serie ${setIndex + 1}`} onClick={() => setWorkTimer({ exerciseIndex, setIndex, elapsed: 0, target: Math.max(1, Number(set.seconds ?? logged.progression?.seconds ?? 30)), running: true, finished: false })}>▶</button> : <span />}<button className="check" aria-label={`Marcar serie ${setIndex + 1}`} onClick={() => toggleCompleted(exerciseIndex, setIndex, set.completed)}>{set.completed ? "✓" : ""}</button></div>
          {state.settings?.effortTracking !== "off" && <label className="effort-row"><span>{state.settings?.effortTracking === "rpe" ? "RPE" : "RIR"}</span><input type="range" min="0" max="10" step="1" value={state.settings?.effortTracking === "rpe" ? set.rpe ?? 8 : set.rir ?? 2} onChange={(event) => updateSet(exerciseIndex, setIndex, state.settings?.effortTracking === "rpe" ? { rpe: Number(event.target.value), rir: undefined } : { rir: Number(event.target.value), rpe: undefined })} /><strong>{state.settings?.effortTracking === "rpe" ? set.rpe ?? 8 : set.rir ?? 2}</strong></label>}
        </div>)}
        <button className="add-row" onClick={() => setWorkout((current: any) => ({ ...current, exercises: current.exercises.map((entry: any, index: number) => index === exerciseIndex ? { ...entry, sets: [...entry.sets, { ...entry.sets.at(-1), id: crypto.randomUUID(), completed: false }] } : entry) }))}>+ {t("Add set")}</button>
      </article>;
    })}</section>
    <footer className="finish-bar"><div><span>{t("{0} done", `${completed}/${total}`)}</span><div className="mini-track"><i style={{ width: `${total ? completed / total * 100 : 0}%` }} /></div></div><button className="primary" onClick={onFinish}>{t("Finish workout")} <span>→</span></button></footer>
  </main>;
}

function Coach({ state, t, request, onSave }: any) {
  const [messages, setMessages] = useState<any[]>(state.coach?.messages ?? []);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [intake, setIntake] = useState({ goal: "Fuerza y salud", days: 3, sessionMinutes: 45, experience: "beginner" });
  const coach = state.coach ?? EMPTY_COACH;
  const pending = (coach.suggestions ?? []).filter((item: any) => item.status === "pending");
  useEffect(() => {
    const every = Number(coach.reviewEveryWorkouts ?? 0);
    const since = state.workouts.length - Number(coach.lastReviewWorkoutCount ?? 0);
    if (!coach.enabled || every <= 0 || since < every || pending.length) return;
    const suggestions = reviewPlan(state);
    onSave({ ...state, coach: { ...coach, suggestions, lastReviewWorkoutCount: state.workouts.length, updatedAt: new Date().toISOString() } }, "Revisión automática del Coach preparada");
  }, [coach, onSave, pending.length, state]);
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
  const saveCoach = (patch: any, message: string) => onSave({ ...state, coach: { ...coach, ...patch, updatedAt: new Date().toISOString() } }, message);
  const prepareReview = () => saveCoach({ suggestions: reviewPlan(state), lastReviewWorkoutCount: state.workouts.length }, "Sugerencias del Coach preparadas");
  const preparePlan = () => saveCoach({ suggestions: [designPlanProposal(state, intake)], intake }, "Plan del Coach listo para revisar");
  const applyOne = (id: string) => onSave(applyCoachSuggestions(state, [id]), "Cambio del Coach aplicado; puedes deshacerlo");
  const dismissOne = (id: string) => onSave(dismissCoachSuggestion(state, id), "Sugerencia descartada");
  return <div className="stack coach-page">
    <div className="page-title"><span className="eyebrow">OPEN GYM · {t("Coach").toUpperCase()}</span><h2>{t("Plan design and reviews, from your own training")}</h2><p>{t("Nothing the Coach suggests is applied on its own — you review every change and can undo it afterwards.")}</p></div>
    <article className="settings-card coach-controls"><label className="setting-row"><span>{coach.enabled ? t("The Coach is on") : t("The Coach is off")}</span><input type="checkbox" checked={Boolean(coach.enabled)} onChange={(event) => saveCoach({ enabled: event.target.checked, suggestions: event.target.checked ? coach.suggestions ?? [] : [] }, event.target.checked ? t("The Coach is on") : t("The Coach is off"))} /></label><p>{t("The Coach designs and adjusts your plan; it never changes anything without your say-so.")}</p>{coach.enabled && <><label className="setting-row"><span>{t("Automatic reviews")}</span><select value={coach.reviewEveryWorkouts ?? 0} onChange={(event) => saveCoach({ reviewEveryWorkouts: Number(event.target.value), lastReviewWorkoutCount: state.workouts.length }, t("Automatic reviews"))}><option value="0">{t("Off — the Coach only looks when you ask it to.")}</option><option value="3">3</option><option value="5">5</option><option value="8">8</option></select></label><div className="settings-actions"><button className="secondary" onClick={prepareReview}>{t("Ask for a review")}</button><button className="secondary" disabled={!coach.undoSnapshot} onClick={() => onSave(undoCoachChanges(state), t("Reverted the last Coach changes."))}>{t("Undo")}</button></div></>}</article>
    {coach.enabled && <article className="settings-card coach-intake"><h3>{t("Let the Coach build my plan")}</h3><label>{t("What are you training for?")}<input value={intake.goal} onChange={(event) => setIntake({ ...intake, goal: event.target.value })} /></label><label>{t("How many days a week?")}<input type="number" min="1" max="7" value={intake.days} onChange={(event) => setIntake({ ...intake, days: Number(event.target.value) })} /></label><label>{t("How long is a session?")}<input type="number" min="15" max="180" value={intake.sessionMinutes} onChange={(event) => setIntake({ ...intake, sessionMinutes: Number(event.target.value) })} /></label><label>{t("Where are you starting from?")}<select value={intake.experience} onChange={(event) => setIntake({ ...intake, experience: event.target.value })}><option value="beginner">{t("Beginner")}</option><option value="intermediate">{t("Intermediate")}</option><option value="advanced">{t("Advanced")}</option></select></label><button className="primary" onClick={preparePlan}>{t("Build my plan")}</button></article>}
    {pending.length > 0 && <section className="coach-proposals"><h3>{t(pending.length === 1 ? "{0} suggestion" : "{0} suggestions", pending.length)}</h3>{pending.map((item: any) => <article key={item.id} className="settings-card"><strong>{item.title}</strong><p>{item.reason}</p><div className="settings-actions"><button className="primary" onClick={() => applyOne(item.id)}>{t("Accept plan")}</button><button className="secondary" onClick={() => dismissOne(item.id)}>{t("Dismiss")}</button></div></article>)}</section>}
    {coach.enabled && <><div className="coach-suggestions">{["¿Cómo debería progresar esta semana?", "¿Necesito más descanso?", "Resume mis últimas sesiones"].map((suggestion) => <button key={suggestion} onClick={() => ask(suggestion)}>{suggestion}</button>)}</div><section className="coach-thread">{!messages.length && <div className="coach-empty"><strong>Tu historial ya está preparado.</strong><p>Haz una pregunta concreta sobre carga, fatiga o planificación.</p></div>}{messages.map((message, index) => <article key={index} className={message.role === "user" ? "from-user" : "from-coach"}><span>{message.role === "user" ? "Tú" : `Coach${message.mode === "local" ? " · local" : ""}`}</span><p>{message.content}</p></article>)}{thinking && <article className="from-coach"><span>Coach</span><p>Analizando tu entrenamiento…</p></article>}</section><div className="coach-compose"><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Pregunta sobre tu entrenamiento" aria-label="Pregunta para el Coach" rows={3} /><button className="primary" disabled={thinking || !input.trim()} onClick={() => ask()}>Enviar <span>→</span></button></div></>}
  </div>;
}

function Library({ state, t, catalog, error, onSave }: any) {
  const [query, setQuery] = useState("");
  const [equipment, setEquipment] = useState("all");
  const [bodyPart, setBodyPart] = useState("all");
  const [customName, setCustomName] = useState("");
  const [instructionPack, setInstructionPack] = useState<any>(null);
  useEffect(() => {
    let active = true;
    loadInstructionPack(state.profile?.locale ?? "en").then((pack) => { if (active) setInstructionPack(pack); });
    return () => { active = false; };
  }, [state.profile?.locale]);
  const results = filterExercises(catalog, { query, equipment, bodyPart });
  const equipmentOptions = [...new Set<string>(filterExercises(catalog, { query, bodyPart }).map((exercise: any) => String(exercise.equipment)))].sort();
  const bodyPartOptions = [...new Set<string>(filterExercises(catalog, { query, equipment }).map((exercise: any) => String(exercise.bodyPart)))].sort();
  const installed = new Set([...state.exercises, ...state.customExercises].map((exercise: any) => exercise.id));
  const addExercise = (exercise: any) => onSave({ ...state, exercises: [...state.exercises, exercise] }, `${exercise.name} añadido a tu biblioteca`);
  const addCustom = async () => {
    if (!customName.trim()) return;
    const custom = { id: `custom-${crypto.randomUUID()}`, name: customName.trim(), muscle: "other", bodyPart: "other", equipment: "custom", measurement: "reps", weightMode: "standard", instructions: [] };
    if (await onSave({ ...state, customExercises: [...state.customExercises, custom] }, "Ejercicio personalizado creado")) setCustomName("");
  };
  return <div className="stack library-page">
    <div className="page-title"><span className="eyebrow">1324 {t("Exercises").toUpperCase()}</span><h2>{t("Exercises")}</h2><p>{t("{0} exercises with animations", catalog.length || 1324)}</p></div>
    <div className="create-row"><input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder={t("Your own exercises")} aria-label={t("Exercises")} /><button onClick={addCustom}>{t("New")}</button></div>
    <section className="catalog-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder={t("Search…")} aria-label={t("Exercises")} /><select value={equipment} onChange={(event) => setEquipment(event.target.value)} aria-label={t("Filter by equipment")}><option value="all">{t("All equipment")}</option>{equipmentOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select><select value={bodyPart} onChange={(event) => setBodyPart(event.target.value)} aria-label={t("Body part")}><option value="all">{t("All")}</option>{bodyPartOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></section>
    {error && <article className="settings-card"><strong>No se pudo cargar el catálogo</strong><p>{error}</p></article>}
    {!error && !catalog.length && <article className="settings-card"><p>Cargando la biblioteca completa…</p></article>}
    {catalog.length > 0 && <div className="catalog-summary">{results.length} ejercicios encontrados · mostrando {Math.min(40, results.length)}</div>}
    {results.slice(0, 40).map((exercise: any) => <article className="catalog-card" key={exercise.id}>
      {/* eslint-disable-next-line @next/next/no-img-element -- external open dataset media */}
      {exercise.imageUrl && <img src={exercise.imageUrl} alt="" loading="lazy" />}
      <div><span>{exercise.bodyPart} · {exercise.equipment}</span><h3>{exercise.name}</h3><p>{exercise.muscle}{exercise.mainMuscle ? ` · ${exercise.mainMuscle}` : ""}</p><details><summary>{t("How to")}</summary><ol>{(instructionPack?.[exercise.sourceId] ?? exercise.instructions).map((step: string, index: number) => <li key={index}>{step}</li>)}</ol>{exercise.gifUrl && <a href={exercise.gifUrl} target="_blank" rel="noreferrer">{t("How to")}</a>}</details><button className="secondary" disabled={installed.has(exercise.id)} onClick={() => addExercise(exercise)}>{installed.has(exercise.id) ? t("Chosen") : t("Add to my plan")}</button></div>
    </article>)}
  </div>;
}

function Routines({ state, t, onSave, onStart }: any) {
  const [name, setName] = useState("");
  const [sharedCode, setSharedCode] = useState("");
  const allExercises = [...state.exercises, ...state.customExercises];
  async function addRoutine() {
    if (!name.trim()) return;
    const routine = { id: crypto.randomUUID(), name: name.trim(), color: "amber", progression: "off", increment: 2.5, timeIncrement: 5, exercises: [] };
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
  return <div className="stack"><div className="page-title"><span className="eyebrow">{t("Plan").toUpperCase()}</span><h2>{t("Routines")}</h2><p>{t("Your weekly routine")}</p></div><div className="create-row"><input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("New routine")} aria-label={t("Routine")} /><button onClick={addRoutine}>{t("New")}</button></div>
    <div className="plan-actions"><button className="secondary" onClick={sharePlan}>{t("Share plan")}</button><button className="secondary" onClick={printPlan}>{t("Print / save PDF")}</button></div>
    <div className="create-row"><input value={sharedCode} onChange={(event) => setSharedCode(event.target.value)} placeholder="OpenGym plan:" aria-label={t("Import plan")} /><button onClick={importSharedPlan}>{t("Import")}</button></div>
    {state.routines.map((routine: any) => <article className="routine-card routine-editor" key={routine.id}><div><i className={`dot ${routine.color}`} /><span>{routine.exercises.length} ejercicios</span></div><div className="routine-title-row"><input defaultValue={routine.name} aria-label="Nombre de rutina" onBlur={(event) => updateRoutine(routine.id, (current) => ({ ...current, name: event.target.value.trim() || current.name }))} /><select value={routine.color} onChange={(event) => updateRoutine(routine.id, (current) => ({ ...current, color: event.target.value }))}><option value="lime">Lima</option><option value="violet">Violeta</option><option value="amber">Ámbar</option></select></div>
      <div className="routine-defaults"><label>Progresión de rutina<select value={routine.progression ?? "off"} onChange={(event) => updateRoutine(routine.id, (current) => ({ ...current, progression: event.target.value }))}><option value="off">Manual</option><option value="linear">Lineal</option><option value="greyskull">Greyskull LP</option><option value="double">Doble</option><option value="time">Tiempo</option></select></label><label>Incremento {weightLabel(state.profile?.weightUnit)}<input type="number" min="0.1" step="0.1" value={displayWeight(routine.increment ?? 2.5, state.profile?.weightUnit)} onChange={(event) => updateRoutine(routine.id, (current) => ({ ...current, increment: kilogramsFromDisplay(event.target.value, state.profile?.weightUnit) }))} /></label><label>Incremento temporal<input type="number" min="1" value={routine.timeIncrement ?? 5} onChange={(event) => updateRoutine(routine.id, (current) => ({ ...current, timeIncrement: Number(event.target.value) }))} /></label></div>
      <div className="routine-muscles"><strong>Vista previa muscular</strong><span>{[...new Set(routine.exercises.flatMap((entry: any) => { const exercise = getExercise(state, entry.exerciseId); return [exercise?.muscle, exercise?.mainMuscle, ...(exercise?.secondaryMuscles ?? [])].filter(Boolean); }))].join(" · ") || "Añade ejercicios para ver el mapa"}</span></div>
      <div className="routine-exercises">{routine.exercises.map((entry: any, index: number) => {
        const exercise = getExercise(state, entry.exerciseId); const timed = exerciseMode(exercise) === "time";
        const patchEntry = (patch: any) => updateRoutine(routine.id, (current) => ({ ...current, exercises: current.exercises.map((item: any, child: number) => child === index ? { ...item, ...patch } : item) }));
        return <div className="routine-exercise-row" key={`${entry.exerciseId}-${index}`}><strong>{exercise?.name ?? entry.exerciseId}</strong>
          <label>{t("Sets")}<input type="number" min="1" max="20" value={entry.targetSets ?? 3} onChange={(event) => patchEntry({ targetSets: Number(event.target.value) })} /></label>
          <label>{timed ? t("Step (seconds)") : t("Reps")}<input type="number" min="1" value={timed ? entry.targetSeconds ?? 30 : entry.targetReps ?? 10} onChange={(event) => patchEntry({ [timed ? "targetSeconds" : "targetReps"]: Number(event.target.value) })} /></label>
          {!timed && <label>Reps mín<input type="number" min="1" max={entry.targetReps ?? 10} value={entry.minReps ?? Math.max(1, Number(entry.targetReps ?? 10) - 2)} onChange={(event) => patchEntry({ minReps: Number(event.target.value) })} /></label>}
          <label>Progresión<select value={entry.progression ?? "inherit"} onChange={(event) => patchEntry({ progression: event.target.value })}><option value="inherit">Heredar rutina</option><option value="off">Manual</option><option value="linear">Lineal</option><option value="greyskull">Greyskull</option><option value="double">Doble</option><option value="time">Tiempo</option></select></label>
          <label>{t("Superset")}<input value={entry.supersetGroup ?? ""} placeholder="A, B…" onChange={(event) => patchEntry({ supersetGroup: event.target.value || null })} /></label>
          <div className="reorder-buttons"><button disabled={index === 0} onClick={() => updateRoutine(routine.id, (current) => { const exercises = [...current.exercises]; [exercises[index - 1], exercises[index]] = [exercises[index], exercises[index - 1]]; return { ...current, exercises }; })}>↑</button><button disabled={index === routine.exercises.length - 1} onClick={() => updateRoutine(routine.id, (current) => { const exercises = [...current.exercises]; [exercises[index + 1], exercises[index]] = [exercises[index], exercises[index + 1]]; return { ...current, exercises }; })}>↓</button><button onClick={() => updateRoutine(routine.id, (current) => ({ ...current, exercises: current.exercises.filter((_: any, child: number) => child !== index) }), "Ejercicio eliminado")}>×</button></div>
        </div>;
      })}</div>
      <label className="add-exercise-select">Añadir ejercicio<select value="" onChange={(event) => { const exercise = getExercise(state, event.target.value); if (!exercise) return; updateRoutine(routine.id, (current) => ({ ...current, exercises: [...current.exercises, { exerciseId: exercise.id, targetSets: 3, targetReps: exerciseMode(exercise) === "reps" ? 10 : undefined, minReps: exerciseMode(exercise) === "reps" ? 8 : undefined, targetSeconds: exerciseMode(exercise) === "time" ? 30 : undefined, progression: exerciseMode(exercise) === "time" ? "time" : "inherit", supersetGroup: null }] }), "Ejercicio añadido"); }}><option value="">Selecciona…</option>{allExercises.filter((exercise: any) => !routine.exercises.some((entry: any) => entry.exerciseId === exercise.id)).map((exercise: any) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}</select></label><div className="routine-actions"><button className="secondary" disabled={!routine.exercises.length} onClick={() => onStart(routine)}>Entrenar ahora</button><button className="danger-link" onClick={() => removeRoutine(routine.id)}>Eliminar rutina</button></div></article>)}
    <section className="week-editor"><h3>{t("Week schedule")}</h3>{Object.entries(state.weekPlan).map(([day, routineId]: any) => <label key={day}><span>{t(DAY_TRANSLATION_KEYS[day])}</span><select value={routineId ?? ""} onChange={(event) => onSave({ ...state, weekPlan: { ...state.weekPlan, [day]: event.target.value || null } }, t("Week schedule"))}><option value="">{t("Rest")}</option>{state.routines.map((routine: any) => <option key={routine.id} value={routine.id}>{routine.name}</option>)}</select></label>)}</section></div>;
}

function History({ state, t, onSave }: any) {
  const workouts = [...state.workouts].sort((a: any, b: any) => b.date.localeCompare(a.date));
  const unit = state.profile?.weightUnit ?? "kg";
  const locale = state.profile?.locale ?? "es";
  function editSet(workoutId: string, exerciseIndex: number, setIndex: number, field: string, value: number) { const next = { ...state, workouts: state.workouts.map((workout: any) => workout.id !== workoutId ? workout : ({ ...workout, exercises: workout.exercises.map((exercise: any, index: number) => index !== exerciseIndex ? exercise : ({ ...exercise, sets: exercise.sets.map((set: any, childIndex: number) => childIndex === setIndex ? { ...set, [field]: value } : set) })) })) }; onSave(next, "Historial corregido"); }
  return <div className="stack">
    <div className="page-title"><span className="eyebrow">{t("Log").toUpperCase()}</span><h2>{t("History")}</h2><p>{t("Recent workouts")}</p></div>
    {workouts.map((workout: any) => <article className="history-card" key={workout.id}>
      <div className="history-date"><strong>{new Intl.DateTimeFormat(locale, { day: "2-digit" }).format(new Date(workout.date))}</strong><span>{new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(new Date(workout.date))}</span></div>
      <div className="history-body"><h3>{workout.name}</h3><small>{Math.round((workout.durationSeconds ?? 0) / 60)} min · {workout.exercises.reduce((sum: number, entry: any) => sum + entry.sets.length, 0)} series</small>
        {workout.exercises.map((entry: any, exerciseIndex: number) => { const exercise = getExercise(state, entry.exerciseId); return <details key={`${workout.id}-${entry.exerciseId}`}><summary>{exercise?.name ?? entry.exerciseId}<span>{entry.sets.length} series</span></summary>
          {entry.sets.map((set: any, setIndex: number) => <div className="compact-set" key={set.id}><span>{setIndex + 1}</span>{exercise?.measurement === "time" ? <><input type="number" value={set.seconds ?? 0} onChange={(event) => editSet(workout.id, exerciseIndex, setIndex, "seconds", Number(event.target.value))} /><em>seg</em></> : <><input type="number" value={displayWeight(set.weight ?? 0, unit)} onChange={(event) => editSet(workout.id, exerciseIndex, setIndex, "weight", kilogramsFromDisplay(event.target.value, unit))} /><em>{weightLabel(unit)} ×</em><input type="number" value={set.reps ?? 0} onChange={(event) => editSet(workout.id, exerciseIndex, setIndex, "reps", Number(event.target.value))} /></>}</div>)}
          <button className="add-row" onClick={() => { const last = entry.sets.at(-1) ?? {}; const next = { ...state, workouts: state.workouts.map((item: any) => item.id !== workout.id ? item : ({ ...item, exercises: item.exercises.map((logged: any, index: number) => index !== exerciseIndex ? logged : ({ ...logged, sets: [...logged.sets, { ...last, id: crypto.randomUUID() }] })) })) }; onSave(next, "Serie añadida al historial"); }}>+ Añadir serie omitida</button>
        </details>; })}
      </div>
    </article>)}
  </div>;
}

function Progress({ state, t, onSave }: any) {
  const estimates = getEstimatedOneRepMaxes(state);
  const balance = getMuscleBalance(state);
  const [weight, setWeight] = useState("");
  const [musclePeriod, setMusclePeriod] = useState(28);
  const maxBalance = Math.max(1, ...Object.values(balance).map(Number));
  const effort = summarizeEffort(state.workouts);
  const weekly = weeklySummary(state.workouts);
  const streak = trainingStreak(state.workouts);
  const heatmap = activityHeatmap(state.workouts, 365);
  const muscles = muscleFrequency(state, musclePeriod) as Record<string, number>;
  return <div className="stack"><div className="page-title"><span className="eyebrow">{t("Stats").toUpperCase()}</span><h2>{t("Progress & history")}</h2><p>{t("This week")}</p></div>
    <article className="weight-card"><div><span>PESO ACTUAL</span><strong>{displayWeight(state.bodyweight.at(-1)?.weight, state.profile?.weightUnit) || "—"}<em> {weightLabel(state.profile?.weightUnit)}</em></strong></div><div className="weight-add"><input value={weight} onChange={(event) => setWeight(event.target.value)} type="number" inputMode="decimal" placeholder={state.profile?.weightUnit === "lb" ? "172,0" : "78,0"} aria-label={`Nuevo peso en ${weightLabel(state.profile?.weightUnit)}`} /><button onClick={async () => { if (!weight) return; if (await onSave({ ...state, bodyweight: [...state.bodyweight, { id: crypto.randomUUID(), date: new Date().toISOString(), weight: kilogramsFromDisplay(weight, state.profile?.weightUnit) }] }, "Peso registrado")) setWeight(""); }}>Añadir</button></div></article>
    <WeightChart entries={state.bodyweight} target={state.profile.targetWeight} unit={state.profile?.weightUnit} onTarget={(targetWeight: number | null) => onSave({ ...state, profile: { ...state.profile, targetWeight } }, "Objetivo de peso actualizado")} />
    <article className="stats-card weekly-card"><span className="eyebrow">ÚLTIMOS 7 DÍAS</span><h3>{weekly.workouts} sesiones · {streak} días de racha</h3><div className="metric-strip"><span><strong>{weekly.sets}</strong> series</span><span><strong>{displayWeight(weekly.volume, state.profile?.weightUnit)}</strong> {weightLabel(state.profile?.weightUnit)}·rep</span><span><strong>{weekly.cardioMinutes}</strong> min cardio</span></div></article>
    <article className="stats-card heatmap-card"><span className="eyebrow">ACTIVIDAD</span><h3>Últimos 365 días</h3><div className="heatmap" aria-label="Mapa anual de actividad">{heatmap.map((day) => { const level = day.minutes === 0 ? 0 : day.minutes < 25 ? 1 : day.minutes < 50 ? 2 : day.minutes < 90 ? 3 : 4; return <i key={day.date} className={`level-${level}`} title={`${day.date}: ${day.minutes} min`} />; })}</div></article>
    <div className="period-picker" role="group" aria-label="Periodo del mapa muscular">{[[7, "7 días"], [28, "28 días"], [36500, "Todo"]].map(([days, label]: any) => <button key={days} className={musclePeriod === days ? "active" : ""} onClick={() => setMusclePeriod(days)}>{label}</button>)}</div>
    <BodyMap muscles={muscles} period={musclePeriod} figure={state.settings?.bodyMap ?? "male"} />
    <OneRepMaxPanel state={state} estimates={estimates} />
    <article className="stats-card"><span className="eyebrow">ESFUERZO</span><h3>Intensidad registrada</h3><div className="stat-row"><span>Cobertura</span><strong>{Math.round(effort.coverage * 100)} %</strong></div><div className="stat-row"><span>RIR medio</span><strong>{effort.averageRir ?? "—"}</strong></div><div className="stat-row"><span>Series duras</span><strong>{effort.hardSets}</strong></div></article>
    <article className="stats-card"><span className="eyebrow">EQUILIBRIO MUSCULAR</span><h3>Volumen acumulado</h3>{Object.entries(balance).filter(([, value]) => Number(value) > 0).map(([muscle, value]: any) => <div className="bar-row" key={muscle}><span>{muscle}</span><div><i style={{ width: `${Number(value) / maxBalance * 100}%` }} /></div><strong>{Math.round(value)}</strong></div>)}</article>
  </div>;
}

function WeightChart({ entries, target, unit, onTarget }: { entries: any[]; target: number | null; unit: string; onTarget: (value: number | null) => void }) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date)).slice(-24);
  const values = [...sorted.map((entry) => Number(entry.weight)), ...(target ? [Number(target)] : [])];
  const min = values.length ? Math.min(...values) - 1 : 0, max = values.length ? Math.max(...values) + 1 : 1, range = Math.max(1, max - min);
  const points = sorted.map((entry, index) => `${sorted.length === 1 ? 50 : index / (sorted.length - 1) * 100},${92 - (Number(entry.weight) - min) / range * 82}`).join(" ");
  const targetY = target ? 92 - (Number(target) - min) / range * 82 : null;
  return <article className="stats-card weight-chart"><span className="eyebrow">PESO CORPORAL</span><h3>Tendencia y objetivo · {weightLabel(unit)}</h3><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Gráfico de peso corporal">{targetY != null && <line x1="0" y1={targetY} x2="100" y2={targetY} className="target-line" />}<polyline points={points} /></svg><label className="setting-row"><span>Objetivo</span><input type="number" inputMode="decimal" defaultValue={displayWeight(target, unit)} placeholder="Sin objetivo" onBlur={(event) => onTarget(event.target.value ? kilogramsFromDisplay(event.target.value, unit) : null)} /></label></article>;
}

function OneRepMaxPanel({ state, estimates }: any) {
  const exerciseIds = Object.keys(estimates);
  const [selected, setSelected] = useState(exerciseIds[0] ?? "");
  const [targetReps, setTargetReps] = useState(5);
  const effective = exerciseIds.includes(selected) ? selected : exerciseIds[0] ?? "";
  const history = effective ? getOneRepMaxHistory(state, effective) : [];
  const latest = history.at(-1);
  const min = history.length ? Math.min(...history.map((entry: any) => entry.estimate)) * .95 : 0;
  const max = history.length ? Math.max(...history.map((entry: any) => entry.estimate)) * 1.05 : 1;
  const range = Math.max(1, max - min);
  const points = history.map((entry: any, index: number) => `${history.length === 1 ? 50 : index / (history.length - 1) * 100},${92 - (entry.estimate - min) / range * 82}`).join(" ");
  const targetWeight = latest ? weightForTargetOneRepMax(latest.best, targetReps) : null;
  const unit = state.profile?.weightUnit ?? "kg";
  return <article className="stats-card one-rm-card"><span className="eyebrow">FUERZA ESTIMADA</span><h3>Curva y calculadora 1RM</h3>{exerciseIds.length ? <><select value={effective} onChange={(event) => setSelected(event.target.value)}>{exerciseIds.map((id) => <option key={id} value={id}>{getExercise(state, id)?.name ?? id}</option>)}</select><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Curva de una repetición máxima"><polyline points={points} /></svg>{latest?.sourceSet && <p>Mejor estimación: <strong>{displayWeight(latest.best, unit)} {weightLabel(unit)}</strong>, desde {displayWeight(latest.sourceSet.weight, unit)} {weightLabel(unit)} × {latest.sourceSet.reps} reps.</p>}<label className="setting-row"><span>Carga para</span><input type="number" min="1" max="12" value={targetReps} onChange={(event) => setTargetReps(Math.max(1, Math.min(12, Number(event.target.value))))} /><strong>{displayWeight(targetWeight, unit) || "—"} {weightLabel(unit)}</strong></label></> : <p>Añade una serie de 1 a 12 repeticiones para estimar tu 1RM.</p>}</article>;
}

const BODY_MUSCLES = ["chest", "pectorals", "back", "lats", "abs", "core", "shoulders", "delts", "biceps", "triceps", "traps", "forearms", "glutes", "quads", "hamstrings", "calves", "adductors", "abductors"];

function BodyMap({ muscles, period, figure }: { muscles: Record<string, number>; period: number; figure: string }) {
  const max = Math.max(1, ...Object.values(muscles));
  const tone = (names: string[]) => Math.max(0, ...names.map((name) => muscles[name] ?? 0)) / max;
  const fill = (value: number) => `color-mix(in srgb, var(--lime-deep) ${Math.max(12, Math.round(value * 100))}%, #e4e6df)`;
  const untrained = BODY_MUSCLES.filter((name) => !muscles[name]);
  const waist = figure === "female" ? 72 : 66;
  return <article className="stats-card body-map-card"><span className="eyebrow">MAPA MUSCULAR · {figure === "female" ? "FIGURA FEMENINA" : "FIGURA MASCULINA"}</span><h3>Frecuencia · {period > 1000 ? "todo el historial" : `${period} días`}</h3><div className="body-figures"><svg viewBox="0 0 180 320" role="img" aria-label="Mapa muscular frontal"><circle cx="90" cy="27" r="19" fill="#dfe2dc"/><path d={`M66 52 Q90 43 114 52 L126 126 Q112 151 90 151 Q68 151 54 126Z`} fill={fill(tone(["chest","pectorals","abs","core"]))}/><path d="M55 58 L30 137 L42 143 L70 79Z" fill={fill(tone(["shoulders","delts","biceps","forearms"]))}/><path d="M125 58 L150 137 L138 143 L110 79Z" fill={fill(tone(["shoulders","delts","biceps","forearms"]))}/><path d={`M${waist} 145 L55 273 L76 276 L90 168Z`} fill={fill(tone(["quads","adductors","calves"]))}/><path d={`M${180-waist} 145 L125 273 L104 276 L90 168Z`} fill={fill(tone(["quads","adductors","calves"]))}/></svg><svg viewBox="0 0 180 320" role="img" aria-label="Mapa muscular posterior"><circle cx="90" cy="27" r="19" fill="#dfe2dc"/><path d="M64 52 Q90 44 116 52 L126 128 Q110 151 90 151 Q70 151 54 128Z" fill={fill(tone(["back","lats","traps"]))}/><path d="M55 58 L30 137 L42 143 L70 79Z" fill={fill(tone(["shoulders","delts","triceps","forearms"]))}/><path d="M125 58 L150 137 L138 143 L110 79Z" fill={fill(tone(["shoulders","delts","triceps","forearms"]))}/><path d="M66 145 L55 273 L76 276 L90 168Z" fill={fill(tone(["glutes","hamstrings","calves"]))}/><path d="M114 145 L125 273 L104 276 L90 168Z" fill={fill(tone(["glutes","hamstrings","calves"]))}/></svg></div><div className="muscle-legend">{Object.entries(muscles).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => <span key={name}><i style={{ background: fill(count / max) }} />{name} · {count}</span>)}</div><details><summary>Músculos no entrenados ({untrained.length})</summary><p>{untrained.join(", ") || "Ninguno"}</p></details></article>;
}

function Settings({ state, t, request, onSave, onLogout }: any) {
  const [report, setReport] = useState<any>(null);
  const [admin, setAdmin] = useState<any>(null);
  const [adminError, setAdminError] = useState("");
  const [inviteUserId, setInviteUserId] = useState("");
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
      }
      await scheduleWorkoutReminders({ ...state, settings: { ...state.settings, reminder: { ...state.settings.reminder, enabled } } });
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
    const response = await request("/api/admin/", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
    if (!response.ok) { setAdminError((await response.json()).error ?? "No se pudo eliminar el perfil"); return; }
    await loadAdmin();
  };
  const patchAdmin = async (body: any) => {
    const response = await request("/api/admin/", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) { setAdminError((await response.json()).error ?? "No se pudo actualizar administración"); return false; }
    await loadAdmin(); return true;
  };
  return <div className="stack"><div className="page-title"><span className="eyebrow">OPEN GYM</span><h2>{t("Settings")}</h2><p>{t("Your workouts. Your weights. Your profile.")}</p></div>
    <article className="settings-card"><h3>Datos y migración</h3><p>Exporta una copia completa o importa OpenGym, Gym Coach, Strong, Hevy, FitNotes y Apple Health. El origen nunca se modifica.</p><div className="settings-actions"><button className="secondary" onClick={downloadExport}>Exportar JSON</button><label className="file-button">Importar archivo<input type="file" accept="application/json,.json,text/csv,.csv" onChange={(event) => importFile(event.target.files?.[0])} /></label></div>{report && <div className="import-report"><strong>Importación completada</strong>{report.portable ? <span>Copia completa restaurada</span> : <><span>{report.workouts} sesiones · {report.exercises} ejercicios · {report.sets} series</span><span>{report.customExercises} ejercicios personalizados · {report.dropped} descartados</span></>}</div>}</article>
    <article className="settings-card"><h3>Entrenamiento</h3><label className="setting-row"><span>Descanso automático</span><select value={state.settings.restSeconds} onChange={(event) => updateSettings({ restSeconds: Number(event.target.value) }, "Descanso actualizado")}><option value="30">30 s</option><option value="60">60 s</option><option value="90">90 s</option><option value="120">2 min</option><option value="180">3 min</option></select></label><label className="setting-row"><span>Esfuerzo</span><select value={state.settings.effortTracking} onChange={(event) => updateSettings({ effortTracking: event.target.value }, "Registro de esfuerzo actualizado")}><option value="off">Desactivado</option><option value="rir">RIR</option><option value="rpe">RPE</option></select></label><label className="setting-row"><span>Mantener pantalla activa</span><input type="checkbox" checked={state.settings.keepAwake} onChange={(event) => updateSettings({ keepAwake: event.target.checked }, "Wake lock actualizado")} /></label><label className="setting-row"><span>Recordatorio diario</span><input type="checkbox" checked={state.settings.reminder.enabled} onChange={(event) => toggleReminder(event.target.checked)} /></label><label className="setting-row"><span>Hora</span><input type="time" value={state.settings.reminder.time} onChange={(event) => updateSettings({ reminder: { ...state.settings.reminder, time: event.target.value } }, "Hora del recordatorio actualizada")} /></label></article>
    <article className="settings-card"><h3>Apariencia</h3><label className="setting-row"><span>Tema</span><select value={state.settings.theme} onChange={(event) => updateSettings({ theme: event.target.value }, "Tema actualizado")}><option value="dark">Oscuro</option><option value="light">Claro</option><option value="system">Sistema</option></select></label><label className="setting-row"><span>Acento</span><select value={state.settings.accent} onChange={(event) => updateSettings({ accent: event.target.value }, "Color actualizado")}><option value="lime">Lima</option><option value="violet">Violeta</option><option value="amber">Ámbar</option><option value="blue">Azul</option><option value="cyan">Cian</option><option value="green">Verde</option><option value="red">Rojo</option><option value="pink">Rosa</option></select></label><label className="setting-row"><span>Figura del mapa</span><select value={state.settings.bodyMap} onChange={(event) => updateSettings({ bodyMap: event.target.value }, "Figura actualizada")}><option value="male">Masculina</option><option value="female">Femenina</option></select></label></article>
    <article className="settings-card admin-card"><h3>Administración</h3><p>Actividad, historial, invitaciones y acceso. Disponible únicamente con <code>gym:admin</code>.</p><button className="secondary" onClick={loadAdmin}>Abrir panel</button>{adminError && <p className="error-text">{adminError}</p>}{admin && <><div className="metric-strip"><span><strong>{admin.totals.profiles}</strong> perfiles</span><span><strong>{admin.totals.active}</strong> entrenando</span><span><strong>{admin.totals.disabled}</strong> bloqueados</span></div><label className="setting-row"><span>Registro sólo por invitación</span><input type="checkbox" checked={admin.inviteOnly} onChange={(event) => patchAdmin({ inviteOnly: event.target.checked })} /></label><div className="create-row"><input value={inviteUserId} onChange={(event) => setInviteUserId(event.target.value)} placeholder="ID Auth0 que podrá crear perfil" /><button onClick={async () => { if (inviteUserId.trim() && await patchAdmin({ userId: inviteUserId.trim(), invited: true })) setInviteUserId(""); }}>Invitar</button></div><div className="admin-table">{admin.profiles.map((profile: any) => <div key={profile.user_id} className={profile.active ? "is-active" : ""}><span><strong>{profile.active ? "● " : ""}{profile.user_id}</strong><small>v{profile.revision} · {profile.workoutCount} sesiones · {new Date(profile.updated_at).toLocaleString()}</small>{profile.activity && <small>{profile.activity.routineName} desde {new Date(profile.activity.startedAt).toLocaleTimeString()}</small>}<details><summary>Últimos entrenamientos</summary>{profile.recentWorkouts.map((workout: any) => <small key={workout.id}>{new Date(workout.date).toLocaleDateString()} · {workout.name} · {workout.sets} series</small>)}</details></span><div className="admin-actions"><button onClick={() => patchAdmin({ userId: profile.user_id, disabled: !profile.disabled })}>{profile.disabled ? "Reactivar" : "Bloquear"}</button><button onClick={() => deleteProfile(profile.user_id)}>Eliminar</button></div></div>)}</div></>}</article>
    <article className="settings-card"><h3>{t("General")}</h3><label className="setting-row"><span>{t("Weight unit")}</span><select value={state.profile.weightUnit} onChange={(event) => updateProfile({ weightUnit: event.target.value }, t("Weight unit"))}><option value="kg">kg</option><option value="lb">lb</option></select></label><label className="setting-row"><span>{t("Dumbbell weight is per hand")}</span><input type="checkbox" checked={state.profile.dumbbellWeightIsPerHand} onChange={(event) => updateProfile({ dumbbellWeightIsPerHand: event.target.checked }, t("Weight unit"))} /></label><label className="setting-row"><span>{t("Language")}</span><select value={state.profile.locale} onChange={(event) => updateProfile({ locale: event.target.value }, t("Language"))}>{LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label></article><article className="settings-card source"><span className="eyebrow">AGPL-3.0</span><h3>openGym</h3><p>{t("free & open source (AGPL v3)")}</p><a href="https://github.com/AlexCCGit/opengym-coach-sites" target="_blank" rel="noreferrer">{t("Source code")} ↗</a><a href="https://github.com/alexpcosta/opengym" target="_blank" rel="noreferrer">openGym ↗</a></article><button className="danger-link" onClick={onLogout}>{t("Sign out")}</button></div>;
}
