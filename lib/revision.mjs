export function applyRevisionedUpdate(current, expectedRevision, update) {
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) {
    return {
      ok: false,
      status: 409,
      error: "revision_conflict",
      revision: current.revision,
      state: current.state,
    };
  }

  const nextState = update(structuredClone(current.state));
  return {
    ok: true,
    status: 200,
    revision: current.revision + 1,
    state: nextState,
  };
}
