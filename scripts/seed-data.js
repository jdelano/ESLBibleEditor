const fs = require("fs");
const path = require("path");

const sourceDir = path.join(__dirname, "..", "sample-data", "verses");
const targetDir = path.join(__dirname, "..", "apps", "api", "data", "verses");

fs.mkdirSync(targetDir, { recursive: true });

for (const file of fs.readdirSync(sourceDir)) {
  fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
}

console.log(`Seeded verse data into ${targetDir}`);
