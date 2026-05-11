#!/usr/bin/env node

// ═══════════════════════════════════════════════════════
//  PROMETHEUS CLI | Unified CI/CD Pipeline Tool
//  Usage:
//    node bin/prometheus.mjs validate  <file>
//    node bin/prometheus.mjs normalize <file>
//    node bin/prometheus.mjs analyze   <file>
//    node bin/prometheus.mjs pipeline
// ═══════════════════════════════════════════════════════

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { validateReleasePayload } from "../src/release-gatekeeper.mjs";
import { normalizeVendorPayload } from "../src/integration-normalizer.mjs";
import { analyzeIncidentLogs } from "../src/incident-analyst.mjs";

// ── ANSI Colors ──
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
  bgGreen: "\x1b[42m",
  bgRed: "\x1b[41m",
};

const PASS = `${c.bgGreen}${c.bold} PASS ${c.reset}`;
const FAIL = `${c.bgRed}${c.bold} FAIL ${c.reset}`;

// ── Helpers ──
async function readJsonFile(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

function printHeader() {
  console.log(`\n${c.cyan}${c.bold}  PROMETHEUS CI/CD PIPELINE${c.reset}`);
  console.log(`${c.dim}  AI-powered release gates, API normalization, and incident analysis${c.reset}\n`);
}

function printStage(name, result, timeMs) {
  const status = result.ok ? PASS : FAIL;
  const time = `${c.dim}${timeMs.toFixed(0)}ms${c.reset}`;
  console.log(`  ${status} ${c.bold}${name}${c.reset}  ${time}`);

  if (!result.ok && result.errors?.length > 0) {
    for (const err of result.errors) {
      console.log(`       ${c.red}> ${err}${c.reset}`);
    }
  }
}

function printSummary(stages) {
  const totalTime = stages.reduce((sum, s) => sum + s.time, 0);
  const allPassed = stages.every((s) => s.result.ok);
  const passCount = stages.filter((s) => s.result.ok).length;

  console.log(`\n${c.dim}  ${"─".repeat(50)}${c.reset}`);
  console.log(`  ${c.bold}Pipeline Summary${c.reset}`);
  console.log(`  ${c.dim}Stages:${c.reset} ${passCount}/${stages.length} passed`);
  console.log(`  ${c.dim}Total:${c.reset}  ${totalTime.toFixed(0)}ms`);
  console.log(`  ${c.dim}Result:${c.reset} ${allPassed ? `${c.green}${c.bold}PIPELINE PASSED${c.reset}` : `${c.red}${c.bold}PIPELINE FAILED${c.reset}`}\n`);

  return allPassed;
}

// ── Commands ──
async function cmdValidate(file) {
  const data = await readJsonFile(file);
  const start = performance.now();
  const result = validateReleasePayload(data);
  const time = performance.now() - start;

  printHeader();
  printStage("Release Gatekeeper", result, time);
  console.log(`\n${JSON.stringify(result, null, 2)}\n`);
  return result.ok;
}

async function cmdNormalize(file) {
  const data = await readJsonFile(file);
  const start = performance.now();
  const result = normalizeVendorPayload(data.vendor, data.payload, {
    mode: data.mode,
    template: data.template,
    xml: data.xml,
    xslt: data.xslt,
  });
  const time = performance.now() - start;

  printHeader();
  printStage("Integration Normalizer", result, time);
  console.log(`\n${JSON.stringify(result, null, 2)}\n`);
  return result.ok;
}

async function cmdAnalyze(file) {
  const data = await readJsonFile(file);
  const start = performance.now();
  const result = analyzeIncidentLogs(data);
  const time = performance.now() - start;

  printHeader();
  printStage("Incident Agent", result, time);
  console.log(`\n${JSON.stringify(result, null, 2)}\n`);
  return result.ok;
}

async function cmdPipeline() {
  printHeader();

  const stages = [];

  // Stage 1: Validate
  const validateData = await readJsonFile("tests/fixtures/good-data.json");
  let start = performance.now();
  let result = validateReleasePayload(validateData);
  stages.push({ name: "Release Gatekeeper", result, time: performance.now() - start });
  printStage("Release Gatekeeper", result, stages[0].time);

  // Stage 2: Normalize (Stripe)
  const normalizeData = await readJsonFile("tests/fixtures/vendor-payload.json");
  start = performance.now();
  result = normalizeVendorPayload(normalizeData.vendor, normalizeData.payload);
  stages.push({ name: "Normalizer (Stripe)", result, time: performance.now() - start });
  printStage("Normalizer (Stripe)", result, stages[1].time);

  // Stage 3: Normalize (Bitstamp)
  const bitstampData = await readJsonFile("tests/fixtures/bitstamp-payload.json");
  start = performance.now();
  result = normalizeVendorPayload(bitstampData.vendor, bitstampData.payload);
  stages.push({ name: "Normalizer (Bitstamp)", result, time: performance.now() - start });
  printStage("Normalizer (Bitstamp)", result, stages[2].time);

  // Stage 4: Normalize (Liquid)
  const liquidData = await readJsonFile("tests/fixtures/liquid-template.json");
  start = performance.now();
  result = normalizeVendorPayload(liquidData.vendor, liquidData.payload, {
    mode: liquidData.mode,
    template: liquidData.template,
  });
  stages.push({ name: "Normalizer (Liquid)", result, time: performance.now() - start });
  printStage("Normalizer (Liquid)", result, stages[3].time);

  // Stage 5: Normalize (XSLT)
  const xsltData = await readJsonFile("tests/fixtures/xslt-transform.json");
  start = performance.now();
  result = normalizeVendorPayload(xsltData.vendor, xsltData.payload, {
    mode: xsltData.mode,
    xml: xsltData.xml,
    xslt: xsltData.xslt,
  });
  stages.push({ name: "Normalizer (XSLT)", result, time: performance.now() - start });
  printStage("Normalizer (XSLT)", result, stages[4].time);

  // Stage 6: Analyze
  const analyzeData = await readJsonFile("tests/fixtures/incident-logs.json");
  start = performance.now();
  result = analyzeIncidentLogs(analyzeData);
  stages.push({ name: "Incident Agent", result, time: performance.now() - start });
  printStage("Incident Agent", result, stages[5].time);

  const allPassed = printSummary(stages);
  return allPassed;
}

// ── CLI Entry Point ──
const [command, file] = process.argv.slice(2);

if (!command) {
  console.log(`
${c.cyan}${c.bold}Prometheus CLI${c.reset}
${c.dim}AI-powered CI/CD pipeline tool${c.reset}

${c.bold}Usage:${c.reset}
  node bin/prometheus.mjs validate  <file.json>   Run Release Gatekeeper
  node bin/prometheus.mjs normalize <file.json>   Run Integration Normalizer
  node bin/prometheus.mjs analyze   <file.json>   Run Incident Agent
  node bin/prometheus.mjs pipeline                Run full pipeline

${c.bold}Examples:${c.reset}
  node bin/prometheus.mjs validate tests/fixtures/good-data.json
  node bin/prometheus.mjs normalize tests/fixtures/bitstamp-payload.json
  node bin/prometheus.mjs pipeline
`);
  process.exit(0);
}

try {
  let ok = false;

  switch (command) {
    case "validate":
      if (!file) { console.error(`${c.red}Error: validate requires a file path${c.reset}`); process.exit(2); }
      ok = await cmdValidate(file);
      break;
    case "normalize":
      if (!file) { console.error(`${c.red}Error: normalize requires a file path${c.reset}`); process.exit(2); }
      ok = await cmdNormalize(file);
      break;
    case "analyze":
      if (!file) { console.error(`${c.red}Error: analyze requires a file path${c.reset}`); process.exit(2); }
      ok = await cmdAnalyze(file);
      break;
    case "pipeline":
      ok = await cmdPipeline();
      break;
    default:
      console.error(`${c.red}Unknown command: ${command}${c.reset}`);
      process.exit(2);
  }

  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error(`${c.red}${c.bold}Error:${c.reset} ${err.message}`);
  process.exit(2);
}
