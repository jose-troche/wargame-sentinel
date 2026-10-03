// Bindings that `wrangler types` cannot see: secrets and the optional R2 archive.
interface SentinelSecrets {
  JOIN_SECRET: string;
  TURNSTILE_SECRET?: string;
  ARCHIVE?: R2Bucket;
}
interface Env extends SentinelSecrets {}
declare namespace Cloudflare {
  interface Env extends SentinelSecrets {}
}
