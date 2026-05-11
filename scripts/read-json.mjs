import { readFile } from "node:fs/promises";

export async function readJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
