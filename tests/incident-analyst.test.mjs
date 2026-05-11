import test from "node:test";
import assert from "node:assert/strict";
import { analyzeIncidentLogs } from "../src/incident-analyst.mjs";

test("detects upstream timeout incidents", () => {
  const result = analyzeIncidentLogs([
    { level: "error", message: "gateway timeout from payment provider" },
    { level: "warning", message: "retry budget almost exhausted" }
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.rootCause, "Upstream dependency timeout");
  assert.equal(result.severity, "error");
});

test("detects identity incidents", () => {
  const result = analyzeIncidentLogs([
    { level: "critical", message: "unauthorized token when reading secret" }
  ]);

  assert.equal(result.rootCause, "Identity or secret configuration failure");
  assert.equal(result.severity, "critical");
});
