import assert from "node:assert/strict";
import test from "node:test";
import { applyCoachSuggestions, designPlanProposal, dismissCoachSuggestion, reviewPlan, undoCoachChanges } from "../lib/coach-planner.mjs";
import { createInitialState } from "../lib/domain.mjs";

test("el Coach diseña un plan que solo se activa tras aceptación y se puede deshacer", () => {
  const state = createInitialState("coach-user");
  const original = JSON.stringify(state.routines);
  const suggestion = designPlanProposal(state, { goal: "Fuerza", days: 2, experience: "beginner" });
  const pending = { ...state, coach: { enabled: true, suggestions: [suggestion] } };
  assert.equal(JSON.stringify(pending.routines), original);
  const applied = applyCoachSuggestions(pending, [suggestion.id]);
  assert.notEqual(JSON.stringify(applied.routines), original);
  assert.equal(JSON.stringify(undoCoachChanges(applied).routines), original);
});

test("la revisión produce cambios discretos y permite rechazarlos", () => {
  const state = createInitialState("coach-user");
  state.progression["lat-pulldown"] = { stalls: 3 };
  const suggestions = reviewPlan(state);
  assert.ok(suggestions.some((item) => item.type === "update-entry"));
  const pending = { ...state, coach: { suggestions } };
  const dismissed = dismissCoachSuggestion(pending, suggestions[0].id);
  assert.equal(dismissed.coach.suggestions[0].status, "declined");
});
