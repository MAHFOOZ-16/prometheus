import { validateReleasePayload } from "../src/release-gatekeeper.mjs";
import { readJsonFile } from "./read-json.mjs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/validate-data.mjs <payload.json>");
  process.exit(2);
}

const result = validateReleasePayload(await readJsonFile(file));
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
