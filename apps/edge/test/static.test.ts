import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { signToken, verifyToken } from "../src/auth";

describe("fog-of-war static check", () => {
  it("FactionAgent code never imports the engine's ground-truth types", () => {
    for (const f of ["src/faction.ts", "src/prompts.ts"]) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/from\s+["']@sentinel\/engine["']/);
      expect(src, f).not.toMatch(/WorldState|truthId/);
    }
  });
});

describe("join tokens", () => {
  const claims = { sid: "abc123def4", sub: "u1", name: "Ana", view: "BLUE" as const, host: false, owner: false, exp: Date.now() + 60_000 };
  it("round-trips and rejects tampering", async () => {
    const t = await signToken(claims, "s3cret");
    expect(await verifyToken(t, "s3cret")).toMatchObject({ sid: "abc123def4", view: "BLUE" });
    expect(await verifyToken(t, "other")).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, view: "WHITE" })).toString("base64url");
    expect(await verifyToken(`${forged}.${sig}`, "s3cret")).toBeNull();
    expect(body.length).toBeGreaterThan(10);
  });
  it("rejects expired tokens", async () => {
    const t = await signToken({ ...claims, exp: Date.now() - 1 }, "s3cret");
    expect(await verifyToken(t, "s3cret")).toBeNull();
  });
});
