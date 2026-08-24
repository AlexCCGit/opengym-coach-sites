"use client";

import { useCallback, useEffect, useState } from "react";
import { getEstimatedOneRepMaxes, getExercise, getMuscleBalance, prefillExercise } from "../lib/domain.mjs";

type Tab = "hoy" | "rutinas" | "historial" | "progreso" | "ajustes";
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

  const request = useCallback(async (url: string, init: RequestInit = {}) => {
    const currentToken = config?.authMode === "demo" ? "demo" : localStorage.getItem("opengym_access_token");
    return fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${currentToken ?? ""}` } });
  }, [config]);

  const load = useCallback(async () => {
    setBusy(true);
    const response = await request("/api/state/");
    if (response.status === 401) { setRecord(null); setBusy(false); return; }
    if (!response.ok) throw new Error("No se pudo cargar tu entrenamiento");
    setRecord(await response.json());
    setBusy(false);
  }, [request]);

  useEffect(() => {
    fetch("/api/config/").then((response) => response.json()).then(setConfig).catch(() => setMessage("No se pudo cargar la configuración"));
  }, []);
  useEffect(() => {
    if (!config) return;
    const expires = Number(localStorage.getItem("opengym_expires_at") ?? 0);
    if (config.authMode !== "demo" && expires && expires < Date.now()) localStorage.removeItem("opengym_access_token");
    load().catch((error) => { setBusy(false); setMessage(error.message); });
  }, [config, load]);

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
      body: JSON.stringify({ state: { ...nextState, updatedAt: new Date().toISOString() }, revision: record.revision }),
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
  const todayKey = WEEKDAYS[new Date().getDay()];
  const dateKey = new Date().toISOString().slice(0, 10);
  const routineId = Object.prototype.hasOwnProperty.call(state.dayOverrides, dateKey) ? state.dayOverrides[dateKey] : state.weekPlan[todayKey];
  const routine = state.routines.find((entry: any) => entry.id === routineId);

  function startWorkout(selectedRoutine = routine) {
    if (!selectedRoutine) return;
    setActiveWorkout({
      id: crypto.randomUUID(),
      routineId: selectedRoutine.id,
      name: selectedRoutine.name,
      date: new Date().toISOString(),
      startedAt: Date.now(),
      exercises: selectedRoutine.exercises.map((entry: any) => {
        const prefilled = prefillExercise(state, entry.exerciseId);
        return {
          ...prefilled,
          sets: Array.from({ length: entry.targetSets ?? prefilled.sets.length }, (_, index) => ({
            ...(prefilled.sets[index] ?? prefilled.sets.at(-1)),
            id: crypto.randomUUID(),
            reps: entry.targetReps ?? prefilled.sets[index]?.reps ?? 10,
            seconds: entry.targetSeconds ?? prefilled.sets[index]?.seconds,
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
      if (await save({ ...state, workouts: [...state.workouts, finished] }, "Entrenamiento guardado. Buen trabajo.")) setActiveWorkout(null);
    }} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar"><div><span className="eyebrow">OPEN GYM</span><h1>Entrena con intención.</h1></div><div className="revision" title="Versión sincronizada">v{record.revision}</div></header>
      {message && <div className="toast" role="status">{message}</div>}

      <section className="content">
        {tab === "hoy" && <Today state={state} routine={routine} todayKey={todayKey} onStart={() => startWorkout()} onGoRoutines={() => setTab("rutinas")} />}
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
          ["hoy", "Hoy", "●"], ["rutinas", "Rutinas", "▦"], ["historial", "Historial", "↺"], ["progreso", "Progreso", "↗"], ["ajustes", "Ajustes", "⌁"],
        ] as const).map(([id, label, icon]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><span>{icon}</span>{label}</button>)}
      </nav>
    </main>
  );
}

function SignIn({ onLogin, configured }: { onLogin: () => void; configured: boolean }) {
  return <main className="sign-in"><div className="sign-in-card"><span className="eyebrow">OPEN GYM COACH</span><div className="hero-number">01</div><h1>Tu progreso no debería vivir encerrado en otra app.</h1><p>Rutinas, sesiones y marcas sincronizadas. Tus datos siguen siendo tuyos y ChatGPT puede ayudarte cuando tú lo decidas.</p><button className="primary" onClick={onLogin} disabled={!configured}>Entrar de forma segura <span>→</span></button>{!configured && <small>La conexión segura se está configurando.</small>}<a href="https://github.com/AlexCCGit/opengym-coach-sites" target="_blank" rel="noreferrer">Código fuente AGPL-3.0</a></div></main>;
}

function Today({ state, routine, todayKey, onStart, onGoRoutines }: any) {
  const latest = [...state.workouts].sort((a: any, b: any) => b.date.localeCompare(a.date))[0];
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
    <section className="list-section"><div className="section-heading"><div><span className="eyebrow">PRÓXIMO</span><h3>Tu semana</h3></div></div>{Object.entries(state.weekPlan).filter(([, id]) => id).slice(0, 4).map(([day, id]: any) => { const item = state.routines.find((entry: any) => entry.id === id); return <div className="plan-row" key={day}><span>{WEEKDAY_LABELS[day]?.slice(0, 3)}</span><strong>{item?.name}</strong><i className={`dot ${item?.color ?? "lime"}`} /></div>; })}</section>
  </div>;
}

function GuidedWorkout({ workout, state, setWorkout, onCancel, onFinish }: any) {
  const completed = workout.exercises.flatMap((entry: any) => entry.sets).filter((set: any) => set.completed).length;
  const total = workout.exercises.flatMap((entry: any) => entry.sets).length;
  const updateSet = (exerciseIndex: number, setIndex: number, patch: any) => setWorkout((current: any) => ({ ...current, exercises: current.exercises.map((entry: any, index: number) => index !== exerciseIndex ? entry : ({ ...entry, sets: entry.sets.map((set: any, childIndex: number) => childIndex === setIndex ? { ...set, ...patch } : set) })) }));
  return <main className="guided-shell"><header className="guided-header"><button className="icon-button" onClick={onCancel} aria-label="Cerrar entrenamiento">×</button><div><span className="eyebrow">SESIÓN EN CURSO</span><h1>{workout.name}</h1></div><span className="set-count">{completed}/{total}</span></header><div className="session-progress"><span style={{ width: `${total ? completed / total * 100 : 0}%` }} /></div><section className="guided-content">
    {workout.exercises.map((logged: any, exerciseIndex: number) => { const exercise = getExercise(state, logged.exerciseId); const timed = exercise?.measurement === "time"; return <article className="exercise-card" key={logged.exerciseId}><div className="exercise-heading"><div><span>{exercise?.muscle ?? "ejercicio"}</span><h2>{exercise?.name ?? logged.exerciseId}</h2>{exercise?.weightMode === "per-dumbbell" && <small>El peso es por mancuerna</small>}</div><b>{String(exerciseIndex + 1).padStart(2, "0")}</b></div><div className="set-labels"><span>Serie</span>{!timed && <span>Peso kg</span>}<span>{timed ? "Tiempo" : "Reps"}</span><span>Hecha</span></div>{logged.sets.map((set: any, setIndex: number) => <div className={`set-row ${set.completed ? "done" : ""}`} key={set.id}><strong>{setIndex + 1}</strong>{!timed && <input aria-label={`Peso serie ${setIndex + 1}`} type="number" inputMode="decimal" value={set.weight ?? 0} onChange={(event) => updateSet(exerciseIndex, setIndex, { weight: Number(event.target.value) })} />}<div className="stepper"><button aria-label="Restar" onClick={() => updateSet(exerciseIndex, setIndex, timed ? { seconds: Math.max(0, Number(set.seconds ?? 0) - 5) } : { reps: Math.max(0, Number(set.reps ?? 0) - 1) })}>−</button><input aria-label={timed ? "Segundos" : "Repeticiones"} type="number" value={timed ? set.seconds ?? 0 : set.reps ?? 0} onChange={(event) => updateSet(exerciseIndex, setIndex, timed ? { seconds: Number(event.target.value) } : { reps: Number(event.target.value) })} /><button aria-label="Sumar" onClick={() => updateSet(exerciseIndex, setIndex, timed ? { seconds: Number(set.seconds ?? 0) + 5 } : { reps: Number(set.reps ?? 0) + 1 })}>+</button></div><button className="check" aria-label={`Marcar serie ${setIndex + 1}`} onClick={() => updateSet(exerciseIndex, setIndex, { completed: !set.completed })}>{set.completed ? "✓" : ""}</button></div>)}<button className="add-row" onClick={() => setWorkout((current: any) => ({ ...current, exercises: current.exercises.map((entry: any, index: number) => index === exerciseIndex ? { ...entry, sets: [...entry.sets, { ...entry.sets.at(-1), id: crypto.randomUUID(), completed: false }] } : entry) }))}>+ Añadir serie</button></article>; })}
  </section><footer className="finish-bar"><div><span>{completed} de {total}</span><div className="mini-track"><i style={{ width: `${total ? completed / total * 100 : 0}%` }} /></div></div><button className="primary" onClick={onFinish}>Finalizar <span>→</span></button></footer></main>;
}

function Routines({ state, onSave, onStart }: any) {
  const [name, setName] = useState("");
  async function addRoutine() { if (!name.trim()) return; const routine = { id: crypto.randomUUID(), name: name.trim(), color: "amber", exercises: state.exercises.slice(0, 3).map((exercise: any) => ({ exerciseId: exercise.id, targetSets: 3, targetReps: exercise.measurement === "time" ? undefined : 10, targetSeconds: exercise.measurement === "time" ? 45 : undefined })) }; if (await onSave({ ...state, routines: [...state.routines, routine] }, "Rutina creada")) setName(""); }
  return <div className="stack"><div className="page-title"><span className="eyebrow">PLANIFICA</span><h2>Rutinas</h2><p>Crea una base estable. Cambia solo lo que realmente necesitas.</p></div><div className="create-row"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre de la nueva rutina" aria-label="Nombre de rutina" /><button onClick={addRoutine}>Crear</button></div>{state.routines.map((routine: any) => <article className="routine-card" key={routine.id}><div><i className={`dot ${routine.color}`} /><span>{routine.exercises.length} ejercicios</span></div><h3>{routine.name}</h3><ul>{routine.exercises.slice(0, 4).map((entry: any) => <li key={entry.exerciseId}>{getExercise(state, entry.exerciseId)?.name}</li>)}</ul><button className="secondary" onClick={() => onStart(routine)}>Entrenar ahora</button></article>)}<section className="week-editor"><h3>Plan semanal</h3>{Object.entries(state.weekPlan).map(([day, routineId]: any) => <label key={day}><span>{WEEKDAY_LABELS[day]}</span><select value={routineId ?? ""} onChange={(event) => onSave({ ...state, weekPlan: { ...state.weekPlan, [day]: event.target.value || null } }, "Plan semanal actualizado")}><option value="">Descanso</option>{state.routines.map((routine: any) => <option key={routine.id} value={routine.id}>{routine.name}</option>)}</select></label>)}</section></div>;
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
  return <div className="stack"><div className="page-title"><span className="eyebrow">DATOS QUE SIRVEN</span><h2>Progreso</h2><p>Señales claras, sin puntuaciones inventadas ni ruido.</p></div><article className="weight-card"><div><span>PESO ACTUAL</span><strong>{state.bodyweight.at(-1)?.weight ?? "—"}<em> kg</em></strong></div><div className="weight-add"><input value={weight} onChange={(event) => setWeight(event.target.value)} type="number" inputMode="decimal" placeholder="78,0" aria-label="Nuevo peso" /><button onClick={async () => { if (!weight) return; if (await onSave({ ...state, bodyweight: [...state.bodyweight, { id: crypto.randomUUID(), date: new Date().toISOString(), weight: Number(weight) }] }, "Peso registrado")) setWeight(""); }}>Añadir</button></div></article><article className="stats-card"><span className="eyebrow">FUERZA ESTIMADA</span><h3>Mejores 1RM</h3>{Object.entries(estimates).slice(0, 5).map(([id, value]: any) => <div className="stat-row" key={id}><span>{getExercise(state, id)?.name ?? id}</span><strong>{value} kg</strong></div>)}</article><article className="stats-card"><span className="eyebrow">EQUILIBRIO MUSCULAR</span><h3>Volumen acumulado</h3>{Object.entries(balance).filter(([, value]) => Number(value) > 0).map(([muscle, value]: any) => <div className="bar-row" key={muscle}><span>{muscle}</span><div><i style={{ width: `${Number(value) / maxBalance * 100}%` }} /></div><strong>{Math.round(value)}</strong></div>)}</article></div>;
}

function Settings({ config, request, onSave, onLogout }: any) {
  const [report, setReport] = useState<any>(null);
  async function importFile(file?: File) { if (!file) return; const source = JSON.parse(await file.text()); const response = await request("/api/import/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(source) }); const result = await response.json(); if (response.ok) { setReport(result.report); await onSave(result.state, "Importación preparada y guardada"); } }
  return <div className="stack"><div className="page-title"><span className="eyebrow">TU ESPACIO</span><h2>Ajustes</h2><p>Control total sobre identidad, unidades y portabilidad.</p></div><article className="settings-card"><h3>Datos y migración</h3><p>Importa una copia JSON de Gym Coach. Nunca se modifica el origen y los ejercicios sin correspondencia se conservan como personalizados.</p><label className="file-button">Importar copia de Gym Coach<input type="file" accept="application/json,.json" onChange={(event) => importFile(event.target.files?.[0])} /></label>{report && <div className="import-report"><strong>Importación completada</strong><span>{report.workouts} sesiones · {report.exercises} ejercicios · {report.sets} series</span><span>{report.customExercises} ejercicios personalizados · {report.dropped} descartados</span></div>}</article><article className="settings-card"><h3>Unidades</h3><div className="setting-row"><span>Peso</span><strong>Kilogramos</strong></div><div className="setting-row"><span>Mancuernas</span><strong>Peso por mancuerna</strong></div><div className="setting-row"><span>Idioma</span><strong>Español</strong></div></article><article className="settings-card source"><span className="eyebrow">CÓDIGO ABIERTO</span><h3>Hecho sobre openGym</h3><p>Esta adaptación se publica bajo AGPL-3.0 y conserva la atribución del proyecto original.</p><a href="https://github.com/AlexCCGit/opengym-coach-sites" target="_blank" rel="noreferrer">Ver código fuente ↗</a><a href="https://github.com/alexpcosta/opengym" target="_blank" rel="noreferrer">Fork de referencia ↗</a></article><button className="danger-link" onClick={onLogout}>{config.authMode === "demo" ? "Reiniciar sesión local" : "Cerrar sesión"}</button></div>;
}
