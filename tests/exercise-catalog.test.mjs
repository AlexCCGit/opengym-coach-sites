import assert from "node:assert/strict";
import test from "node:test";

import { filterExercises, parseExerciseModule } from "../lib/exercise-catalog.mjs";

const source = 'export const EXDB=[{"id":"0001","n":"Air bike","bp":"cardio","eq":"body weight","tg":"abs","mg":"hip flexors","sm":["quads"],"st":["Pedal"],"img":"one.jpg","gif":"one.gif"}];';

test("interpreta el módulo oficial de ejercicios y conserva medios e instrucciones", () => {
  const [exercise] = parseExerciseModule(source);
  assert.equal(exercise.id, "open-0001");
  assert.equal(exercise.measurement, "cardio");
  assert.match(exercise.imageUrl, /one\.jpg$/);
  assert.deepEqual(exercise.instructions, ["Pedal"]);
});

test("filtra biblioteca por texto, equipo y parte corporal", () => {
  const catalog = parseExerciseModule(source);
  assert.equal(filterExercises(catalog, { query: "bike", equipment: "body weight", bodyPart: "cardio" }).length, 1);
  assert.equal(filterExercises(catalog, { equipment: "barbell" }).length, 0);
});
