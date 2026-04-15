import crypto from "crypto";

function safeCompare(a, b) {
  const aBuf = Buffer.from(String(a || ""), "utf8");
  const bBuf = Buffer.from(String(b || ""), "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "Webhook Shopify orders/create prêt"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed"
    });
  }

  const shopifySecret = process.env.SHOPIFY_CLIENT_SECRET;
  const appUrl = process.env.SHOPIFY_APP_URL;

  if (!shopifySecret || !appUrl) {
    return res.status(500).json({
      ok: false,
      message: "Variables Shopify manquantes sur Vercel"
    });
  }

  try {
    const rawBody = await readRawBody(req);
    const hmacHeader = req.headers["x-shopify-hmac-sha256"];
    const shopDomain = req.headers["x-shopify-shop-domain"];
    const topic = req.headers["x-shopify-topic"];

    const generatedHmac = crypto
      .createHmac("sha256", shopifySecret)
      .update(rawBody, "utf8")
      .digest("base64");

    if (!safeCompare(generatedHmac, hmacHeader)) {
      return res.status(401).json({
        ok: false,
        message: "HMAC webhook invalide"
      });
    }

    if (!shopDomain) {
      return res.status(400).json({
        ok: false,
        message: "Header x-shopify-shop-domain manquant"
      });
    }

    const syncResponse = await fetch(
      `${appUrl}/api/shopify/sync-orders?shop=${encodeURIComponent(shopDomain)}`
    );

    const syncData = await syncResponse.json();

    if (!syncResponse.ok) {
      return res.status(500).json({
        ok: false,
        message: "Webhook reçu mais sync-orders a échoué",
        topic,
        shop: shopDomain,
        syncData
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Webhook orders/create traité",
      topic,
      shop: shopDomain,
      sync: syncData
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erreur serveur pendant le traitement du webhook",
      error: error.message
    });
  }
}
