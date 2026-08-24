import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState } from "../lib/domain.mjs";
import { handleMcpMessage, MCP_TOOL_NAMES } from "../lib/mcp.mjs";

function memoryRepository() {
  let record = { revision: 1, state: createInitialState("auth0|user-1") };
  return {
    async read() { return structuredClone(record); },
    async write(expectedRevision, nextState) {
      if (expectedRevision !== record.revision) return { ok: false, revision: record.revision };
      record = { revision: record.revision + 1, state: structuredClone(nextState) };
      return { ok: true, ...structuredClone(record) };
    },
  };
}

test("negocia initialize y publica todas las herramientas acordadas", async () => {
  const repository = memoryRepository();
  const initialized = await handleMcpMessage(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { userId: "auth0|user-1", permissions: ["gym:read"] },
    repository,
  );
  assert.equal(initialized.result.serverInfo.name, "OpenGym Coach");

  const listed = await handleMcpMessage(
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { userId: "auth0|user-1", permissions: ["gym:read"] },
    repository,
  );
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), MCP_TOOL_NAMES);
});

test("ChatGPT puede leer la ultima sesion y registrar peso corporal", async () => {
  const repository = memoryRepository();
  const context = { userId: "auth0|user-1", permissions: ["gym:read", "gym:write"] };

  const workouts = await handleMcpMessage(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_workouts", arguments: { limit: 1 } } },
    context,
    repository,
  );
  assert.equal(workouts.result.structuredContent.workouts.length, 1);

  const written = await handleMcpMessage(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "add_bodyweight", arguments: { weight: 77.8, date: "2026-08-24" } } },
    context,
    repository,
  );
  assert.equal(written.result.structuredContent.revision, 2);
  assert.equal((await repository.read()).state.bodyweight.at(-1).weight, 77.8);
});

test("una herramienta de escritura exige gym:write", async () => {
  const response = await handleMcpMessage(
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "add_bodyweight", arguments: { weight: 77 } } },
    { userId: "auth0|user-1", permissions: ["gym:read"] },
    memoryRepository(),
  );

  assert.equal(response.error.code, -32003);
});
