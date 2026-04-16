import crypto from "crypto";

function normalizeShop(shop) {
  const value = String(shop || "").trim().toLowerCase();
  if (!value.endsWith(".myshopify.com")) return null;
  return value;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
  if (!hmacHeader || !secret) return false;

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmacHeader, "utf8");

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function getStoreByDomain({ supabaseUrl, serviceRoleKey, shopDomain }) {
  const params = new URLSearchParams();
  params.set("select", "id,shop_domain");
  params.set("shop_domain", `eq.${shopDomain}`);
  params.set("limit", "1");

  const response = await fetch(`${supabaseUrl}/rest/v1/shopify_stores?${params.toString()}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de lire shopify_stores: ${JSON.stringify(data)}`);
  }

  return data?.[0] || null;
}

async function getOrdersForStore({ supabaseUrl, serviceRoleKey, storeId }) {
  const params = new URLSearchParams();
  params.set("select", "id,shopify_order_id,order_name");
  params.set("store_id", `eq.${storeId}`);
  params.set("limit", "1000");

  const response = await fetch(`${supabaseUrl}/rest/v1/shopify_orders?${params.toString()}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de lire shopify_orders: ${JSON.stringify(data)}`);
  }

  return data || [];
}

async function deleteByOrderIds({ supabaseUrl, serviceRoleKey, orderIds }) {
  if (!orderIds.length) {
    return { deletedLines: 0, deletedAlerts: 0, deletedOrders: 0 };
  }

  const idList = orderIds.join(",");

  const deleteLinesRes = await fetch(
    `${supabaseUrl}/rest/v1/shopify_order_lines?order_id=in.(${idList})`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=representation"
      }
    }
  );

  const deleteLinesData = await deleteLinesRes.json();
  if (!deleteLinesRes.ok) {
    throw new Error(`Impossible de supprimer shopify_order_lines: ${JSON.stringify(deleteLinesData)}`);
  }

  let deletedAlertsCount = 0;
  const deleteAlertsRes = await fetch(
    `${supabaseUrl}/rest/v1/material_alerts?order_id=in.(${idList})`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=representation"
      }
    }
  );

  const deleteAlertsData = await deleteAlertsRes.json();
  if (deleteAlertsRes.ok && Array.isArray(deleteAlertsData)) {
    deletedAlertsCount = deleteAlertsData.length;
  }

  const deleteOrdersRes = await fetch(
    `${supabaseUrl}/rest/v1/shopify_orders?id=in.(${idList})`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=representation"
      }
    }
  );

  const deleteOrdersData = await deleteOrdersRes.json();
  if (!deleteOrdersRes.ok) {
    throw new Error(`Impossible de supprimer shopify_orders: ${JSON.stringify(deleteOrdersData)}`);
  }

  return {
    deletedLines: Array.isArray(deleteLinesData) ? deleteLinesData.length : 0,
    deletedAlerts: deletedAlertsCount,
    deletedOrders: Array.isArray(deleteOrdersData) ? deleteOrdersData.length : 0
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Méthode non autorisée" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const webhookSecret =
    process.env.SHOPIFY_API_SECRET ||
    process.env.SHOPIFY_API_SECRET_KEY ||
    process.env.SHOPIFY_CLIENT_SECRET;

  if (!supabaseUrl || !supabaseServiceRoleKey || !webhookSecret) {
    return res.status(500).json({
      ok: false,
      message: "Variables serveur manquantes"
    });
  }

  try {
    const rawBody = await readRawBody(req);

    const hmacHeader = req.headers["x-shopify-hmac-sha256"];
    const shopHeader = normalizeShop(req.headers["x-shopify-shop-domain"]);
    const topicHeader = req.headers["x-shopify-topic"];

    if (!verifyShopifyWebhook(rawBody, hmacHeader, webhookSecret)) {
      return res.status(401).json({ ok: false, message: "Webhook Shopify invalide (HMAC)" });
    }

    if (!shopHeader) {
      return res.status(400).json({ ok: false, message: "Shop domain invalide" });
    }

    if (topicHeader !== "orders/delete") {
      return res.status(400).json({
        ok: false,
        message: `Topic inattendu: ${topicHeader || "absent"}`
      });
    }

    const payload = JSON.parse(rawBody.toString("utf8") || "{}");

    const graphQlId =
      payload.admin_graphql_api_id ||
      (payload.id ? `gid://shopify/Order/${payload.id}` : null);

    if (!graphQlId) {
      return res.status(200).json({
        ok: true,
        message: "Webhook reçu sans identifiant de commande exploitable"
      });
    }

    const store = await getStoreByDomain({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      shopDomain: shopHeader
    });

    if (!store) {
      return res.status(404).json({
        ok: false,
        message: "Boutique Shopify introuvable dans Supabase"
      });
    }

    const existingOrders = await getOrdersForStore({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      storeId: store.id
    });

    const matchedOrders = existingOrders.filter(
      (row) => String(row.shopify_order_id) === String(graphQlId)
    );

    if (!matchedOrders.length) {
      return res.status(200).json({
        ok: true,
        message: "Commande déjà absente de Supabase",
        shop: store.shop_domain,
        shopifyOrderId: graphQlId,
        deletedOrders: 0,
        deletedLines: 0,
        deletedAlerts: 0
      });
    }

    const orderIds = matchedOrders.map((row) => row.id);

    const deletion = await deleteByOrderIds({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      orderIds
    });

    return res.status(200).json({
      ok: true,
      message: "Commande supprimée automatiquement depuis Supabase",
      shop: store.shop_domain,
      shopifyOrderId: graphQlId,
      ...deletion
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erreur serveur pendant le webhook orders/delete",
      error: error.message
    });
  }
}
