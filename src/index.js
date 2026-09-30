// Lyric Rep: a tiny API over D1 for saving song lines.
// Static files in /public are served by the assets binding; only /api/* reaches this code.

const MAX_BODY = 20000;
const LIST_LIMIT = 500;
const SEARCH_LIMIT = 200;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (!(await authorized(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }

    try {
      return await route(request, env, url);
    } catch (err) {
      console.error(err);
      return json({ error: "server_error" }, 500);
    }
  },
};

async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/api/auth" && method === "GET") {
    return json({ ok: true });
  }

  if (pathname === "/api/lyrics") {
    if (method === "GET") return listOrSearch(env, url.searchParams.get("q"));
    if (method === "POST") return create(request, env);
  }

  const match = pathname.match(/^\/api\/lyrics\/([\w-]{1,64})$/);
  if (match) {
    const id = match[1];
    if (method === "PUT") return update(request, env, id);
    if (method === "DELETE") return remove(env, id);
  }

  return json({ error: "not_found" }, 404);
}

async function listOrSearch(env, q) {
  const terms = (q || "").trim().split(/\s+/).filter(Boolean).slice(0, 8);

  if (terms.length === 0) {
    const { results } = await env.DB.prepare(
      "SELECT id, body, created_at, updated_at FROM lyrics ORDER BY RANDOM() LIMIT ?"
    )
      .bind(LIST_LIMIT)
      .all();
    return json({ lyrics: results });
  }

  // Every word must appear somewhere in the entry (case-insensitive for ASCII).
  const where = terms.map(() => "body LIKE ? ESCAPE '\\'").join(" AND ");
  const params = terms.map((t) => `%${t.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
  const { results } = await env.DB.prepare(
    `SELECT id, body, created_at, updated_at FROM lyrics WHERE ${where} ORDER BY created_at DESC LIMIT ?`
  )
    .bind(...params, SEARCH_LIMIT)
    .all();
  return json({ lyrics: results });
}

async function create(request, env) {
  const data = await readJson(request);
  const body = cleanBody(data?.body);
  if (!body) return json({ error: "empty" }, 400);

  const id = typeof data.id === "string" && /^[\w-]{1,64}$/.test(data.id) ? data.id : crypto.randomUUID();
  const now = Date.now();
  const createdAt = Number.isFinite(data.created_at) && data.created_at <= now ? Math.floor(data.created_at) : now;

  // INSERT OR IGNORE makes retries from the offline queue harmless.
  await env.DB.prepare("INSERT OR IGNORE INTO lyrics (id, body, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(id, body, createdAt, now)
    .run();

  const lyric = await env.DB.prepare("SELECT id, body, created_at, updated_at FROM lyrics WHERE id = ?").bind(id).first();
  return json({ lyric }, 201);
}

async function update(request, env, id) {
  const data = await readJson(request);
  const body = cleanBody(data?.body);
  if (!body) return json({ error: "empty" }, 400);

  const now = Date.now();
  const res = await env.DB.prepare("UPDATE lyrics SET body = ?, updated_at = ? WHERE id = ?").bind(body, now, id).run();
  if (!res.meta.changes) return json({ error: "not_found" }, 404);
  return json({ ok: true, updated_at: now });
}

async function remove(env, id) {
  await env.DB.prepare("DELETE FROM lyrics WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// If APP_PASSWORD is set (as a secret in the Cloudflare dashboard), every API call must send it.
async function authorized(request, env) {
  const expected = env.APP_PASSWORD;
  if (!expected) return true;
  const header = request.headers.get("Authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function cleanBody(value) {
  if (typeof value !== "string") return "";
  const body = value.replace(/\r\n/g, "\n").trim();
  return body.slice(0, MAX_BODY);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
