import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { PullResponse, PushResponse, pushRequestSchema, pullQuerySchema } from "./schemas";
import { handlePull, handlePush } from "./sync";

const PORT = Number(process.env.PORT ?? 3000);
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;

const missing: string[] = [];
if (!SUPABASE_URL) missing.push("SUPABASE_URL");
if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (missing.length) {
  console.error(`[chromodoro-api] missing env: ${missing.join(", ")}`);
  process.exit(1);
}

// service_role bypasses RLS (server is the gatekeeper); anon client just for getUser.
const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const supabaseAnon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app: FastifyInstance = Fastify({ logger: true });

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });

const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.register(cors, { origin: corsOrigins });

/** Require `Authorization: Bearer <supabase access token>`, resolve to userId. */
async function requireUser(request: { headers: { authorization?: string } }): Promise<string> {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    const err = new Error("missing bearer token");
    (err as Error & { code?: string }).code = "UNAUTHORIZED";
    throw err;
  }
  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data.user) {
    const err = new Error("invalid token");
    (err as Error & { code?: string }).code = "UNAUTHORIZED";
    throw err;
  }
  return data.user.id;
}

app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));

app.get("/auth/me", async (request) => {
  const userId = await requireUser(request);
  const { data } = await supabaseAdmin.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  return { userId, settingsUpsertedAt: data?.updated_at ?? null };
});

app.get<{ Querystring: Record<string, string | undefined> }>("/sync/pull", async (request): Promise<PullResponse> => {
  const userId = await requireUser(request);
  const parsed = pullQuerySchema.safeParse({ since: request.query.since });
  if (!parsed.success) throw httpError(400, JSON.stringify(parsed.error.flatten()));
  return handlePull(supabaseAdmin, userId, parsed.data.since);
});

app.post<{ Body: unknown }>("/sync/push", async (request): Promise<PushResponse> => {
  const userId = await requireUser(request);
  const parsed = pushRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw httpError(
      400,
      JSON.stringify({
        error: "invalid envelope",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      })
    );
  }
  return handlePush(supabaseAdmin, userId, parsed.data);
});

const start = async () => {
  try {
    app.setErrorHandler((err, request, reply) => {
      if ((err as Error & { code?: string }).code === "UNAUTHORIZED") {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const status = (err as Error & { statusCode?: number }).statusCode ?? 500;
      if (status >= 500) request.log.error(err);
      return reply.code(status).send({ error: (err as Error).message });
    });
    await app.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`[chromodoro-api] listening on :${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();