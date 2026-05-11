import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const roots = ["src", "scripts", "tests"];
const failures = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    if (entry.isFile() && path.endsWith(".mjs")) {
      const text = await readFile(path, "utf8");
      if (text.includes("\t")) failures.push(`${path}: tabs are not allowed`);
      if (!text.endsWith("\n")) failures.push(`${path}: missing trailing newline`);
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

console.log("lint ok");
