import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import { describe, expect, it, beforeEach } from "vitest";
import { createApp } from "../src/app";
import sampleVerse from "../../../sample-data/verses/john-3-16.json";
import sampleVerse2 from "../../../sample-data/verses/john-3-17.json";

describe("API", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kjveasy-api-"));

  beforeEach(() => {
    process.env.DATA_DIR = tmpRoot;
    const versesDir = path.join(tmpRoot, "verses");
    fs.mkdirSync(versesDir, { recursive: true });
    fs.writeFileSync(path.join(versesDir, `${sampleVerse.verseId}.json`), JSON.stringify(sampleVerse, null, 2));
    fs.writeFileSync(path.join(versesDir, `${sampleVerse2.verseId}.json`), JSON.stringify(sampleVerse2, null, 2));
  });

  it("returns verse navigation", async () => {
    const res = await request(createApp()).get("/api/navigation");
    expect(res.status).toBe(200);
    expect(res.body.books[0].book).toBe("John");
  });

  it("round-trips a verse export", async () => {
    const res = await request(createApp()).get(`/api/verses/${sampleVerse.verseId}/export`);
    expect(res.status).toBe(200);
    expect(res.body.verseId).toBe(sampleVerse.verseId);
    expect(res.body.tokenAnnotations).toHaveLength(sampleVerse.tokenAnnotations.length);
  });

  it("rejects a broken verse", async () => {
    const broken = {
      ...sampleVerse,
      tokenAnnotations: [
        {
          ...sampleVerse.tokenAnnotations[0],
          tokenId: "missing-token"
        }
      ]
    };

    const res = await request(createApp()).put(`/api/verses/${sampleVerse.verseId}`).send(broken);
    expect(res.status).toBe(400);
    expect(res.body.validationIssues[0].message).toMatch(/missing token/i);
  });

  it("returns a chapter dashboard summary", async () => {
    const res = await request(createApp()).get("/api/chapters/John/3");
    expect(res.status).toBe(200);
    expect(res.body.book).toBe("John");
    expect(res.body.verses).toHaveLength(2);
  });

  it("creates editor notes and returns them with the verse context", async () => {
    const app = createApp();
    const commentRes = await request(app)
      .post("/api/review-comments")
      .send({ verseId: sampleVerse.verseId, anchorType: "verse", body: "Needs revision" });

    expect(commentRes.status).toBe(201);

    const saveRes = await request(app)
      .put(`/api/verses/${sampleVerse.verseId}?mode=checkpoint`)
      .send(sampleVerse);

    expect(saveRes.status).toBe(200);
    expect(saveRes.body.comments).toHaveLength(1);
  });

  it("creates chapter export jobs with manifests", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/export-jobs")
      .send({ mode: "export", scopeType: "chapter", book: "John", chapter: 3 });

    expect(res.status).toBe(201);
    expect(res.body.job.status).toBe("completed");
    expect(res.body.manifest.verseCount).toBe(2);
  });

  it("blocks publish jobs when validation fails", async () => {
    const broken = {
      ...sampleVerse,
      tokenLinks: [
        {
          id: "bad_link",
          sourceTokenId: "missing",
          targetTokenId: "missing-too",
          type: "antecedent"
        }
      ]
    };
    fs.writeFileSync(path.join(tmpRoot, "verses", `${sampleVerse.verseId}.json`), JSON.stringify(broken, null, 2));

    const app = createApp();
    const res = await request(app)
      .post("/api/export-jobs")
      .send({ mode: "publish", scopeType: "chapter", book: "John", chapter: 3 });

    expect(res.status).toBe(400);
    expect(res.body.job.status).toBe("failed");
  });
});
