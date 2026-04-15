import crypto from "crypto";

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf("=");
        const key = index >= 0 ? part.slice(0, index) : part;
        const value = index >= 0 ? part.slice(index + 1) : "";
        return [key, decodeURIComponent(value)];
      })
  );
}

function normalizeShop(shop) {
  const value = String(shop || "").trim().toLowerCase();
  if (!value.endsWith(".myshopify.com")) return null;
  return value;
}

function buildHmacMessage(query) {
  return Object.keys(query)
    .filter(key => key !== "hmac" && key !== "signature")
    .sort()
    .map(key => {
      const value = Array.isArray(query[key]) ? query[key].join(",") : query[key];
      return `${key}=${value}`;
    })
    .join("&");
}

function safeCompare(a, b) {
  const aBuf = Buffer.from(String(a), "utf8");
  const bBuf = Buffer.from(String(b), "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export default async function handler(req, res) {
  const { shop, code, state, hmac, host, timestamp } = req.query;

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!clientId || !clientSecret || !supabaseUrl || !supabaseServiceRoleKey) {
    return res.status(500).json({
      ok: false,
      message: "Variables serveur manquantes"
    });
  }

  const normalizedShop = normalizeShop(shop);
  if (!normalizedShop) {
    return res.status(400).json({
      ok: false,
      message: "Shop invalide"
    });
  }

  if (!code || !state || !hmac) {
    return res.status(400).json({
      ok: false,
      message: "Paramètres Shopify manquants dans le callback",
      received: {
        shop: !!shop,
        code: !!code,
        state: !!state,
        hmac: !!hmac,
        host: !!host,
        timestamp: !!timestamp
      }
    });
  }

  const cookies = parseCookies(req.headers.cookie || "");
  const cookieState = cookies.shopify_oauth_state || null;

  if (!cookieState || cookieState !== state) {
    return res.status(400).json({
      ok: false,
      message: "State OAuth invalide",
      receivedState: state,
      cookieState
    });
  }

  const message = buildHmacMessage(req.query);
  const generatedHmac = crypto
    .createHmac("sha256", clientSecret)
    .update(message)
    .digest("hex");

  if (!safeCompare(generatedHmac, hmac)) {
    return res.status(400).json({
      ok: false,
      message: "HMAC invalide"
    });
  }

  try {
    const tokenResponse = await fetch(
      `https://${normalizedShop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(500).json({
        ok: false,
        message: "Impossible de récupérer le token Shopify",
        tokenResponseStatus: tokenResponse.status,
        tokenData
      });
    }

    const scopes = String(tokenData.scope || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    const upsertResponse = await fetch(
      `${supabaseUrl}/rest/v1/shopify_stores?on_conflict=shop_domain`,
      {
        method: "POST",
        headers: {
          apikey: supabaseServiceRoleKey,
          Authorization: `Bearer ${supabaseServiceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify([
          {
            shop_domain: normalizedShop,
            access_token: tokenData.access_token,
            scopes,
            api_version: "2026-04",
            last_sync_at: new Date().toISOString()
          }
        ])
      }
    );

    const upsertData = await upsertResponse.json();

    if (!upsertResponse.ok) {
      return res.status(500).json({
        ok: false,
        message: "Token récupéré mais impossible de l'enregistrer dans Supabase",
        supabaseStatus: upsertResponse.status,
        supabaseData: upsertData
      });
    }

    res.setHeader(
      "Set-Cookie",
      "shopify_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    );

    return res.status(200).json({
      ok: true,
      message: "Shopify connecté et token enregistré V2",
      shop: normalizedShop,
      stateOk: true,
      hmacOk: true,
      saved: true,
      store: upsertData?.[0]
        ? {
            id: upsertData[0].id,
            shop_domain: upsertData[0].shop_domain,
            scopes: upsertData[0].scopes
          }
        : null
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erreur serveur pendant le callback Shopify",
      error: error.message
    });
  }
}
