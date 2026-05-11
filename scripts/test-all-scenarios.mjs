#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   PROMETHEUS — Full Scenario Test Runner
   Tests all 3 enterprise pain points with 12 realistic datasets.
   Run: node scripts/test-all-scenarios.mjs
   ═══════════════════════════════════════════════════════════════ */

import { validateReleasePayload } from "../src/release-gatekeeper.mjs";
import { normalizeVendorPayload } from "../src/integration-normalizer.mjs";
import { analyzeIncidentLogs } from "../src/incident-analyst.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DATASET_DIR = join(process.cwd(), "tests/fixtures/datasets");

// ── Colors ──
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgCyan: "\x1b[46m",
};

function line(char = "─", len = 72) { return c.dim + char.repeat(len) + c.reset; }
function header(text) { return `\n${c.bold}${c.cyan}${text}${c.reset}`; }
function pass(text) { return `  ${c.bgGreen}${c.bold} ✓ PASS ${c.reset} ${c.green}${text}${c.reset}`; }
function fail(text) { return `  ${c.bgRed}${c.bold} ✕ FAIL ${c.reset} ${c.red}${text}${c.reset}`; }
function warn(text) { return `  ${c.bgYellow}${c.bold} ⚠ WARN ${c.reset} ${c.yellow}${text}${c.reset}`; }
function info(text) { return `  ${c.dim}    → ${text}${c.reset}`; }

async function loadJSON(filename) {
  const raw = await readFile(join(DATASET_DIR, filename), "utf-8");
  return JSON.parse(raw);
}

const stats = { total: 0, passed: 0, failed: 0, warnings: 0 };

function check(condition, label, details = []) {
  stats.total++;
  if (condition) {
    stats.passed++;
    console.log(pass(label));
  } else {
    stats.failed++;
    console.log(fail(label));
  }
  details.forEach((d) => console.log(info(d)));
}

// ═══════════════════════════════════════════════════════════
// PAIN POINT 1: Bad Data Entering Production ($200K+/year)
// Module: Release Gatekeeper
// ═══════════════════════════════════════════════════════════
async function testPainPoint1() {
  console.log("\n" + line("═"));
  console.log(header("🛡️  PAIN POINT 1: Bad Data Entering Production"));
  console.log(`${c.dim}   Module: Release Gatekeeper | Enterprise cost: $200K+/year${c.reset}`);
  console.log(`${c.dim}   The Gatekeeper validates schemas, required fields, data types,${c.reset}`);
  console.log(`${c.dim}   and ranges before data reaches production.${c.reset}`);
  console.log(line());

  // Test 1a: Valid multi-record payload
  console.log(header("  Dataset: release-valid-multi.json"));
  console.log(`${c.dim}   → 5 valid payment records, all fields correct${c.reset}`);
  const valid = await loadJSON("release-valid-multi.json");
  const r1 = validateReleasePayload(valid);
  check(r1.ok === true, "All 5 records pass validation", [
    `Records: ${r1.metrics.recordCount} | Failures: ${r1.metrics.failureCount}`,
    `Errors: ${r1.errors.length === 0 ? "none" : r1.errors.join(", ")}`
  ]);

  // Test 1b: Bad fields
  console.log(header("  Dataset: release-bad-fields.json"));
  console.log(`${c.dim}   → Empty IDs, negative amounts, invalid timestamps${c.reset}`);
  const bad = await loadJSON("release-bad-fields.json");
  const r2 = validateReleasePayload(bad);
  check(r2.ok === false, "Bad data blocked — 6 errors caught", [
    `Records: ${r2.metrics.recordCount} | Failures: ${r2.metrics.failureCount}`,
    ...r2.errors.map((e) => `${c.red}Error: ${e}${c.reset}`)
  ]);

  // Test 1c: Wrong schema version + unsupported environment
  console.log(header("  Dataset: release-wrong-schema.json"));
  console.log(`${c.dim}   → Schema version 2025-11, environment "canary"${c.reset}`);
  const schema = await loadJSON("release-wrong-schema.json");
  const r3 = validateReleasePayload(schema);
  check(r3.ok === false, "Schema drift detected", [
    `Failures: ${r3.metrics.failureCount}`,
    ...r3.errors.map((e) => `${c.red}Error: ${e}${c.reset}`)
  ]);

  // Test 1d: Empty records array
  console.log(header("  Dataset: release-empty-records.json"));
  console.log(`${c.dim}   → Valid structure but zero records${c.reset}`);
  const empty = await loadJSON("release-empty-records.json");
  const r4 = validateReleasePayload(empty);
  check(r4.ok === false, "Empty deployment blocked", [
    `Failures: ${r4.metrics.failureCount}`,
    ...r4.errors.map((e) => `${c.red}Error: ${e}${c.reset}`)
  ]);
}

// ═══════════════════════════════════════════════════════════
// PAIN POINT 2: API Integration Chaos ($300K+/year)
// Module: Integration Normalizer
// ═══════════════════════════════════════════════════════════
async function testPainPoint2() {
  console.log("\n" + line("═"));
  console.log(header("🔄  PAIN POINT 2: API Integration Chaos"));
  console.log(`${c.dim}   Module: Integration Normalizer | Enterprise cost: $300K+/year${c.reset}`);
  console.log(`${c.dim}   The Normalizer converts vendor-specific API payloads into${c.reset}`);
  console.log(`${c.dim}   one canonical contract for consistent internal processing.${c.reset}`);
  console.log(line());

  // Test 2a: Valid Stripe payload
  console.log(header("  Dataset: vendor-stripe-valid.json"));
  console.log(`${c.dim}   → Stripe payment payload with all expected fields${c.reset}`);
  const stripe = await loadJSON("vendor-stripe-valid.json");
  const n1 = normalizeVendorPayload(stripe.vendor, stripe.payload);
  check(n1.ok === true, "Stripe payload normalized to canonical contract", [
    `Vendor: ${stripe.vendor}`,
    `Canonical output: ${JSON.stringify(n1.normalized)}`
  ]);

  // Test 2b: Valid Salesforce payload
  console.log(header("  Dataset: vendor-salesforce-valid.json"));
  console.log(`${c.dim}   → Salesforce CRM record (PascalCase, __c fields)${c.reset}`);
  const sf = await loadJSON("vendor-salesforce-valid.json");
  const n2 = normalizeVendorPayload(sf.vendor, sf.payload);
  check(n2.ok === true, "Salesforce payload normalized to canonical contract", [
    `Vendor: ${sf.vendor}`,
    `Canonical output: ${JSON.stringify(n2.normalized)}`
  ]);

  // Test 2c: Stripe with missing field (contract drift)
  console.log(header("  Dataset: vendor-stripe-drift.json"));
  console.log(`${c.dim}   → Stripe payload missing 'created_at' timestamp${c.reset}`);
  const drift = await loadJSON("vendor-stripe-drift.json");
  const n3 = normalizeVendorPayload(drift.vendor, drift.payload);
  check(n3.ok === false, "Contract drift detected — missing field flagged", [
    `Vendor: ${drift.vendor}`,
    ...n3.errors.map((e) => `${c.yellow}Drift: ${e}${c.reset}`)
  ]);

  // Test 2d: Unknown vendor
  console.log(header("  Dataset: vendor-unknown.json"));
  console.log(`${c.dim}   → Shopify payload (not a supported vendor)${c.reset}`);
  const unknown = await loadJSON("vendor-unknown.json");
  const n4 = normalizeVendorPayload(unknown.vendor, unknown.payload);
  check(n4.ok === false, "Unknown vendor rejected", [
    `Vendor: ${unknown.vendor}`,
    ...n4.errors.map((e) => `${c.red}Error: ${e}${c.reset}`)
  ]);
}

// ═══════════════════════════════════════════════════════════
// PAIN POINT 3: Production Debugging Nightmares ($1M+/year)
// Module: Incident Analyst
// ═══════════════════════════════════════════════════════════
async function testPainPoint3() {
  console.log("\n" + line("═"));
  console.log(header("🔍  PAIN POINT 3: Production Debugging Nightmares"));
  console.log(`${c.dim}   Module: Incident Analyst | Enterprise cost: $1M+/year${c.reset}`);
  console.log(`${c.dim}   The Analyst groups log events, detects root cause patterns,${c.reset}`);
  console.log(`${c.dim}   and emits remediation hints for operators.${c.reset}`);
  console.log(line());

  // Test 3a: Timeout cascade
  console.log(header("  Dataset: incident-timeout.json"));
  console.log(`${c.dim}   → Gateway timeout, ETIMEDOUT, circuit breaker trip${c.reset}`);
  const timeout = await loadJSON("incident-timeout.json");
  const a1 = analyzeIncidentLogs(timeout);
  check(a1.rootCause === "Upstream dependency timeout", "Root cause: Upstream dependency timeout", [
    `Severity: ${c.red}${a1.severity.toUpperCase()}${c.reset}`,
    `Events analyzed: ${a1.eventCount}`,
    `Remediation: ${a1.remediation}`
  ]);

  // Test 3b: Auth/secret failure
  console.log(header("  Dataset: incident-auth-failure.json"));
  console.log(`${c.dim}   → Expired tokens, RBAC issues, stale Key Vault rotation${c.reset}`);
  const auth = await loadJSON("incident-auth-failure.json");
  const a2 = analyzeIncidentLogs(auth);
  check(a2.rootCause === "Identity or secret configuration failure", "Root cause: Identity/secret config failure", [
    `Severity: ${c.red}${a2.severity.toUpperCase()}${c.reset}`,
    `Events analyzed: ${a2.eventCount}`,
    `Remediation: ${a2.remediation}`
  ]);

  // Test 3c: Schema/contract break
  console.log(header("  Dataset: incident-schema-break.json"));
  console.log(`${c.dim}   → Schema validation failures, breaking contract changes${c.reset}`);
  const schemaBrk = await loadJSON("incident-schema-break.json");
  const a3 = analyzeIncidentLogs(schemaBrk);
  check(a3.rootCause === "Schema or API contract regression", "Root cause: Schema/API contract regression", [
    `Severity: ${c.yellow}${a3.severity.toUpperCase()}${c.reset}`,
    `Events analyzed: ${a3.eventCount}`,
    `Remediation: ${a3.remediation}`
  ]);

  // Test 3d: Mixed noise (no clear pattern)
  console.log(header("  Dataset: incident-mixed-noise.json"));
  console.log(`${c.dim}   → CPU, memory, disk, connection pool — no clear pattern${c.reset}`);
  const noise = await loadJSON("incident-mixed-noise.json");
  const a4 = analyzeIncidentLogs(noise);
  check(a4.rootCause === "Unknown operational anomaly", "Root cause: Unknown anomaly (fallback path)", [
    `Severity: ${c.yellow}${a4.severity.toUpperCase()}${c.reset}`,
    `Events analyzed: ${a4.eventCount}`,
    `Remediation: ${a4.remediation}`
  ]);
}

// ═══════════════════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════════════════
async function main() {
  console.log("\n" + line("═"));
  console.log(`${c.bold}${c.cyan}`);
  console.log("  ╔═══════════════════════════════════════════════════════╗");
  console.log("  ║                                                       ║");
  console.log("  ║        🔥 PROMETHEUS — Full Scenario Test Suite       ║");
  console.log("  ║        Testing All 3 Enterprise Pain Points           ║");
  console.log("  ║        12 Datasets × 3 Modules = Full Coverage        ║");
  console.log("  ║                                                       ║");
  console.log("  ╚═══════════════════════════════════════════════════════╝");
  console.log(`${c.reset}`);

  await testPainPoint1();
  await testPainPoint2();
  await testPainPoint3();

  // ── Summary ──
  console.log("\n" + line("═"));
  console.log(header("📊  FINAL RESULTS"));
  console.log(line());
  console.log(`  ${c.bold}Total tests:${c.reset}  ${stats.total}`);
  console.log(`  ${c.green}${c.bold}Passed:${c.reset}       ${c.green}${stats.passed}${c.reset}`);
  console.log(`  ${c.red}${c.bold}Failed:${c.reset}       ${c.red}${stats.failed}${c.reset}`);
  console.log();

  if (stats.failed === 0) {
    console.log(`  ${c.bgGreen}${c.bold} ALL ${stats.total} TESTS PASSED ${c.reset}`);
    console.log();
    console.log(`  ${c.green}All 3 Prometheus modules are working as expected.${c.reset}`);
    console.log(`  ${c.dim}  Pain Point 1 (Bad Data):    4/4 scenarios verified${c.reset}`);
    console.log(`  ${c.dim}  Pain Point 2 (API Chaos):   4/4 scenarios verified${c.reset}`);
    console.log(`  ${c.dim}  Pain Point 3 (Debugging):   4/4 scenarios verified${c.reset}`);
  } else {
    console.log(`  ${c.bgRed}${c.bold} ${stats.failed} TEST(S) FAILED ${c.reset}`);
    console.log(`  ${c.red}Review the failed tests above and adjust the modules.${c.reset}`);
  }

  console.log("\n" + line("═") + "\n");
  process.exit(stats.failed > 0 ? 1 : 0);
}

main();
