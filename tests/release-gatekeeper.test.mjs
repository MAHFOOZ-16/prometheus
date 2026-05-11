import test from "node:test";
import assert from "node:assert/strict";
import { validateReleasePayload } from "../src/release-gatekeeper.mjs";

test("accepts valid release payloads", () => {
  const result = validateReleasePayload({
    service: "billing-api",
    environment: "staging",
    schemaVersion: "2026-05",
    records: [{ id: "evt_001", amount: 42, timestamp: "2026-05-10T10:00:00Z" }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.metrics.failureCount, 0);
});

test("blocks bad release payloads", () => {
  const result = validateReleasePayload({
    service: "billing-api",
    environment: "prod",
    schemaVersion: "old",
    records: [{ id: "", amount: -4, timestamp: "not-a-date" }]
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /unsupported environment/);
  assert.match(result.errors.join(" "), /schemaVersion/);
});
