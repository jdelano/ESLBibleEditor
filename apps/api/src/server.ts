import fs from "fs";
import path from "path";
import { createApp } from "./app";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    const pkgPath = path.join(current, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg.name === "kjveasy-isl-editor") {
          return current;
        }
      } catch {
        // ignore malformed package.json while walking up
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

const repoRoot = findRepoRoot(__dirname);
const seedSourceDir = path.join(repoRoot, "sample-data", "verses");
const seedTargetDir = process.env.DATA_DIR
  ? path.resolve(process.cwd(), process.env.DATA_DIR, "verses")
  : path.join(repoRoot, "apps", "api", "data", "verses");

if (!fs.existsSync(seedTargetDir) || fs.readdirSync(seedTargetDir).length === 0) {
  fs.mkdirSync(seedTargetDir, { recursive: true });
  for (const file of fs.readdirSync(seedSourceDir)) {
    fs.copyFileSync(path.join(seedSourceDir, file), path.join(seedTargetDir, file));
  }
}

const app = createApp();
const port = Number(process.env.API_PORT ?? 4000);

app.listen(port, () => {
  console.log(`KJVeasy API listening on http://localhost:${port}`);
});
