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

export default async function handler(req, res) {
  const { shop, code, state, hmac, host, timestamp } = req.query;
  const cookies = parseCookies(req.headers.cookie || "");
  const cookieState = cookies.shopify_oauth_state || null;

  if (!shop || !code || !state) {
    return res.status(400).json({
      ok: false,
      message: "Paramètres Shopify manquants dans le callback",
      received: { shop: !!shop, code: !!code, state: !!state }
    });
  }

  const stateOk = cookieState && state === cookieState;

  if (!stateOk) {
    return res.status(400).json({
      ok: false,
      message: "State OAuth invalide",
      receivedState: state,
      cookieState
    });
  }

  return res.status(200).json({
    ok: true,
    message: "Callback Shopify reçu",
    shop,
    codePreview: String(code).slice(0, 8) + "...",
    stateOk: true,
    received: {
      hmac: !!hmac,
      host: !!host,
      timestamp: !!timestamp
    }
  });
}
