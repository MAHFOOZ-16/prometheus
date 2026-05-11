import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVendorPayload } from "../src/integration-normalizer.mjs";

test("normalizes supported vendor payloads", () => {
  const result = normalizeVendorPayload("stripe", {
    payment_id: "pay_001",
    amount_total: 199,
    payment_status: "succeeded",
    created_at: "2026-05-10T10:00:00Z"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.normalized, {
    vendor: "stripe",
    id: "pay_001",
    amount: 199,
    status: "succeeded",
    timestamp: "2026-05-10T10:00:00Z"
  });
});

test("rejects unsupported vendors", () => {
  const result = normalizeVendorPayload("unknown", {});

  assert.equal(result.ok, false);
  assert.match(result.errors[0], /unsupported vendor/);
});
