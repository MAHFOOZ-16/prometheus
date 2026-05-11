import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const roots = [".github", "infra", "public", "scripts", "src", "tests"];
const secretPatterns = [
  /AZURE_CLIENT_SECRET\s*[:=]\s*["'][^"']+["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /api[_-]?key\s*[:=]\s*["'][^"']+["']/i,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
const failures = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }

    const text = await readFile(path, "utf8");
    for (const pattern of secretPatterns) {
      if (pattern.test(text)) {
        failures.push(`${path}: possible secret detected by ${pattern}`);
      }
    }
  }
}

for (const root of roots) {
  await walk(root);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("security scan ok");
