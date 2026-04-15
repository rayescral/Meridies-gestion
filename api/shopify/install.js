import crypto from "crypto";

function normalizeShop(shop) {
  const value = String(shop || "").trim().toLowerCase();
  if (!value.endsWith(".myshopify.com")) return null;
  return value;
}

export default function handler(req, res) {
  const shop = normalizeShop(req.query.shop);

  if (!shop) {
    return res.status(400).json({
      ok: false,
      message: "Paramètre shop invalide. Utilise le domaine .myshopify.com"
    });
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const appUrl = process.env.SHOPIFY_APP_URL;
  const scopes = process.env.SHOPIFY_SCOPES;

  if (!clientId || !appUrl || !scopes) {
    return res.status(500).json({
      ok: false,
      message: "Variables Shopify manquantes sur Vercel"
    });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${appUrl}/api/shopify/callback`;

  res.setHeader(
    "Set-Cookie",
    `shopify_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  return res.redirect(302, authUrl.toString());
}
