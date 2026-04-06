const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const versesDir = path.join(rootDir, "apps", "api", "data", "verses");

if (!fs.existsSync(versesDir)) {
  console.error(`Verse directory not found: ${versesDir}`);
  process.exit(1);
}

for (const fileName of fs.readdirSync(versesDir)) {
  if (!fileName.endsWith(".json")) continue;
  const filePath = path.join(versesDir, fileName);
  const verse = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const now = new Date().toISOString();

  verse.tokenAnnotations = Array.isArray(verse.tokenAnnotations) ? verse.tokenAnnotations : [];
  verse.tokenLinks = Array.isArray(verse.tokenLinks) ? verse.tokenLinks : [];
  verse.verseAnnotations = Array.isArray(verse.verseAnnotations) ? verse.verseAnnotations : [];
  verse.verseMedia = Array.isArray(verse.verseMedia) ? verse.verseMedia : [];
  verse.editorLayout = verse.editorLayout || { annotationPlacements: {}, notePanelPlacement: "right", mediaOrder: [] };
  verse.metadata = verse.metadata || {};
  verse.metadata.createdAt = verse.metadata.createdAt || now;
  verse.metadata.updatedAt = verse.metadata.updatedAt || now;
  verse.metadata.createdBy = verse.metadata.createdBy || "migration";
  verse.metadata.updatedBy = verse.metadata.updatedBy || "migration";
  verse.metadata.version = Number.isInteger(verse.metadata.version) ? verse.metadata.version : 1;
  verse.metadata.status = verse.metadata.status || "draft";

  fs.writeFileSync(filePath, `${JSON.stringify(verse, null, 2)}\n`, "utf8");
  console.log(`Migrated ${fileName}`);
}
