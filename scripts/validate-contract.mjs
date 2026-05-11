import { normalizeVendorPayload } from "../src/integration-normalizer.mjs";
import { readJsonFile } from "./read-json.mjs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/validate-contract.mjs <payload.json>");
  process.exit(2);
}

const input = await readJsonFile(file);
const result = normalizeVendorPayload(input.vendor, input.payload, {
  mode: input.mode,
  template: input.template,
  xml: input.xml,
  xslt: input.xslt
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
