// Archive store: R2 when bound, otherwise chunked BLOB rows in D1. Payloads are gzip-compressed.

export interface ArchiveStore {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  kind: "R2" | "D1";
}

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const CHUNK = 900_000;

export function archiveStore(env: Env): ArchiveStore {
  const r2 = env.ARCHIVE;
  if (r2) {
    return {
      kind: "R2",
      async put(key, data) {
        await r2.put(key, await gzip(data));
      },
      async get(key) {
        const obj = await r2.get(key);
        return obj ? gunzip(new Uint8Array(await obj.arrayBuffer())) : null;
      },
    };
  }
  return {
    kind: "D1",
    async put(key, data) {
      const z = await gzip(data);
      const stmts = [env.DB.prepare("DELETE FROM archive WHERE key = ?").bind(key)];
      for (let i = 0, c = 0; i < z.length; i += CHUNK, c++) {
        stmts.push(env.DB.prepare("INSERT INTO archive (key, chunk, data, created_at) VALUES (?, ?, ?, ?)").bind(key, c, z.subarray(i, i + CHUNK), Date.now()));
      }
      await env.DB.batch(stmts);
    },
    async get(key) {
      const rows = await env.DB.prepare("SELECT data FROM archive WHERE key = ? ORDER BY chunk").bind(key).all<{ data: ArrayBuffer }>();
      if (!rows.results.length) return null;
      const parts = rows.results.map((r) => new Uint8Array(r.data));
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return gunzip(out);
    },
  };
}
