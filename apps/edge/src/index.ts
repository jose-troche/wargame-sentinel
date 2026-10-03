import { handleApi } from "./api";

export { SessionDO } from "./session";
export { FactionAgent } from "./faction";
export { UsageDO } from "./usage";

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(req, env);

    const ws = url.pathname.match(/^\/ws\/sessions\/([a-z0-9]{6,16})$/);
    if (ws) {
      const stub = env.SESSION.get(env.SESSION.idFromName(`session:${ws[1]}`));
      return stub.fetch(req); // SessionDO verifies the join token and upgrades
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
