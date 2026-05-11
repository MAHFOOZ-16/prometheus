import { analyzeIncidentLogs } from "../src/incident-analyst.mjs";
import { readJsonFile } from "./read-json.mjs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/analyze-logs.mjs <logs.json>");
  process.exit(2);
}

const result = analyzeIncidentLogs(await readJsonFile(file));
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
