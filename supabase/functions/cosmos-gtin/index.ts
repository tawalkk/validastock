const allowedOrigins = new Set([
  "https://tawalkk.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

function corsHeaders(origin: string | null) {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  });
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(body: unknown, status: number, headers: Headers) {
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  const headers = corsHeaders(origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (origin && !allowedOrigins.has(origin)) return json({ error: "origin_not_allowed" }, 403, headers);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = request.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization || !supabaseUrl || !anonKey) return json({ error: "unauthorized" }, 401, headers);

  const authCheck = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!authCheck.ok) return json({ error: "unauthorized" }, 401, headers);

  const token = Deno.env.get("BLUESOFT_COSMOS_TOKEN");
  const userAgent = Deno.env.get("BLUESOFT_COSMOS_USER_AGENT");
  if (!token || !userAgent) return json({ error: "cosmos_not_configured" }, 503, headers);

  let code = "";
  try {
    const body = await request.json();
    code = String(body?.gtin ?? "").trim();
  } catch {
    return json({ error: "invalid_json" }, 400, headers);
  }
  if (!/^\d{8,14}$/.test(code)) return json({ error: "invalid_gtin" }, 400, headers);

  try {
    const response = await fetch(`https://api.cosmos.bluesoft.com.br/gtins/${encodeURIComponent(code)}.json`, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Cosmos-Token": token,
        "User-Agent": userAgent,
      },
    });
    if (response.status === 404) return json({ found: false }, 200, headers);
    if (response.status === 429) return json({ error: "cosmos_rate_limit" }, 429, headers);
    if (!response.ok) return json({ error: "cosmos_unavailable" }, 502, headers);

    const result = await response.json();
    const product = result?.product ?? result;
    const name = String(product?.description ?? product?.name ?? "").trim();
    const brandValue = product?.brand?.name ?? product?.brand ?? product?.manufacturer?.name ?? product?.manufacturer ?? "";
    const brand = typeof brandValue === "string" ? brandValue.trim() : "";
    return json({ found: Boolean(name), name, brand }, 200, headers);
  } catch {
    return json({ error: "cosmos_unavailable" }, 502, headers);
  }
});
