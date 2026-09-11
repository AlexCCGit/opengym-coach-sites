import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("mantiene el layout móvil contenido y evita el zoom automático de formularios", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");

  assert.match(css, /input, select, textarea \{ font-size: 16px; \}/);
  assert.match(css, /\.stack > \*, \.coach-page > \*/);
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.bottom-nav \.nav-secondary \{ display: none; \}/);
  assert.match(css, /\.set-row \{[^}]*grid-template-areas:/s);
  assert.match(css, /\.active-set-editor \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
});

test("usa un diálogo responsive en vez de prompts nativos al iniciar", async () => {
  const app = await readFile(new URL("app/OpenGymApp.tsx", root), "utf8");

  assert.doesNotMatch(app, /window\.prompt\(/);
  assert.match(app, /className="preworkout-dialog"/);
  assert.match(app, /className={`nav-more/);
});

test("simplifica el registro a una serie activa con cierre rápido", async () => {
  const app = await readFile(new URL("app/OpenGymApp.tsx", root), "utf8");

  assert.match(app, />Completar serie</);
  assert.match(app, /\+ Hacer una serie extra/);
  assert.match(app, /Añadir serie olvidada/);
  assert.match(app, /series completadas/);
  assert.match(app, /Repeticiones en reserva \(RIR\)/);
  assert.doesNotMatch(app, /restLeft|Descanso automático|requestSetCompletion/);
  assert.match(app, /previousSets: prefilled\.sets\.map\(\(set: any\) => \(\{ \.\.\.set, completed: true \}\)\)/);
  assert.match(app, /Continuar sesión/);
  assert.match(app, /ACTIVE_WORKOUT_KEY/);
  assert.match(app, /tracksReps/);
  assert.match(app, /defaultRir/);
});
