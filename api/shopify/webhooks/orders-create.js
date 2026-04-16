import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false
  }
};

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
    .update(rawBody)
    .digest("base64");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmacHeader, "utf8");

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function getStoreByDomain({ supabaseUrl, serviceRoleKey, shopDomain }) {
  const params = new URLSearchParams();
  params.set("select", "*");
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

function toGraphqlOrderId(payload) {
  if (payload?.admin_graphql_api_id) return payload.admin_graphql_api_id;
  if (payload?.id) return `gid://shopify/Order/${payload.id}`;
  return null;
}

function toGraphqlVariantId(rawVariantId) {
  if (!rawVariantId) return null;
  const str = String(rawVariantId);
  if (str.startsWith("gid://shopify/")) return str;
  if (/^\d+$/.test(str)) return `gid://shopify/ProductVariant/${str}`;
  return str;
}

async function getVariantMap({ supabaseUrl, serviceRoleKey, storeId }) {
  const params = new URLSearchParams();
  params.set("select", "id,shopify_variant_id");
  params.set("store_id", `eq.${storeId}`);
  params.set("limit", "1000");

  const response = await fetch(`${supabaseUrl}/rest/v1/shopify_variants?${params.toString()}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de lire shopify_variants: ${JSON.stringify(data)}`);
  }

  return Object.fromEntries((data || []).map(row => [row.shopify_variant_id, row.id]));
}

async function getExistingOrderByShopifyId({ supabaseUrl, serviceRoleKey, storeId, shopifyOrderId }) {
  const params = new URLSearchParams();
  params.set("select", "id,shopify_order_id,meridies_status");
  params.set("store_id", `eq.${storeId}`);
  params.set("shopify_order_id", `eq.${shopifyOrderId}`);
  params.set("limit", "1");

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

async function upsertOrder({ supabaseUrl, serviceRoleKey, row }) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/shopify_orders?on_conflict=store_id,shopify_order_id`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify([row])
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible d'enregistrer la commande: ${JSON.stringify(data)}`);
  }

  return data?.[0] || null;
}

async function upsertLines({ supabaseUrl, serviceRoleKey, rows }) {
  if (!rows.length) return [];

  const response = await fetch(
    `${supabaseUrl}/rest/v1/shopify_order_lines?on_conflict=order_id,shopify_line_item_id`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(rows)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible d'enregistrer les lignes: ${JSON.stringify(data)}`);
  }

  return data || [];
}

async function fetchExistingLines({ supabaseUrl, serviceRoleKey, orderIds }) {
  if (!orderIds.length) return [];

  const params = new URLSearchParams();
  params.set("select", "id,order_id,shopify_line_item_id");
  params.set("order_id", `in.(${orderIds.join(",")})`);
  params.set("limit", "5000");

  const response = await fetch(`${supabaseUrl}/rest/v1/shopify_order_lines?${params.toString()}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de lire shopify_order_lines: ${JSON.stringify(data)}`);
  }

  return data || [];
}

async function deleteObsoleteLines({ supabaseUrl, serviceRoleKey, obsoleteLineIds }) {
  if (!obsoleteLineIds.length) return 0;

  const response = await fetch(
    `${supabaseUrl}/rest/v1/shopify_order_lines?id=in.(${obsoleteLineIds.join(",")})`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=representation"
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de supprimer les lignes obsolètes: ${JSON.stringify(data)}`);
  }

  return Array.isArray(data) ? data.length : 0;
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

async function triggerMaterialCheck(appUrl, shopDomain) {
  try {
    const response = await fetch(
      `${appUrl}/api/shopify/check-materials?shop=${encodeURIComponent(shopDomain)}`
    );

    const data = await response.json();
    return { ok: response.ok, data };
  } catch (error) {
    return {
      ok: false,
      data: { ok: false, message: error.message }
    };
  }
}

async function handleOrdersCreate({
  payload,
  supabaseUrl,
  serviceRoleKey,
  appUrl,
  store
}) {
  const shopifyOrderId = toGraphqlOrderId(payload);
  if (!shopifyOrderId) {
    return {
      ok: true,
      message: "Webhook create reçu sans identifiant exploitable"
    };
  }

  const existingOrder = await getExistingOrderByShopifyId({
    supabaseUrl,
    serviceRoleKey,
    storeId: store.id,
    shopifyOrderId
  });

  const amount =
    payload?.current_total_price != null
      ? Number(payload.current_total_price)
      : payload?.total_price != null
        ? Number(payload.total_price)
        : null;

  const currency =
    payload?.currency ||
    payload?.presentment_currency ||
    null;

  const financialStatus =
    payload?.financial_status ? String(payload.financial_status).toUpperCase() : null;

  const fulfillmentStatus =
    payload?.fulfillment_status ? String(payload.fulfillment_status).toUpperCase() : "UNFULFILLED";

  const customerEmail =
    payload?.customer?.email ||
    payload?.email ||
    null;

  const orderRow = {
    store_id: store.id,
    shopify_order_id: shopifyOrderId,
    order_name: payload?.name || `#${payload?.order_number || payload?.id || ""}`,
    customer_email: customerEmail,
    financial_status: financialStatus,
    fulfillment_status: fulfillmentStatus,
    currency,
    total_price: Number.isFinite(amount) ? amount : null,
    meridies_status: existingOrder?.meridies_status || "nouvelle",
    raw_payload: payload,
    created_at_shopify: payload?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const savedOrder = await upsertOrder({
    supabaseUrl,
    serviceRoleKey,
    row: orderRow
  });

  const variantMap = await getVariantMap({
    supabaseUrl,
    serviceRoleKey,
    storeId: store.id
  });

  const lineItems = Array.isArray(payload?.line_items) ? payload.line_items : [];
  const lineRows = lineItems.map((line) => {
    const shopifyVariantId = toGraphqlVariantId(line?.admin_graphql_api_id_variant || line?.variant_id);
    const shopifyLineItemId =
      line?.admin_graphql_api_id ||
      (line?.id ? `gid://shopify/LineItem/${line.id}` : null);

    return {
      order_id: savedOrder.id,
      shopify_line_item_id: shopifyLineItemId,
      shopify_variant_id: shopifyVariantId,
      variant_id: shopifyVariantId ? (variantMap[shopifyVariantId] || null) : null,
      title: line?.name || line?.title || null,
      sku: line?.sku || null,
      quantity: Number(line?.quantity || 0),
      unit_price: line?.price != null ? Number(line.price) : null,
      material_check_status: "pending"
    };
  }).filter(row => !!row.shopify_line_item_id);

  const savedLines = await upsertLines({
    supabaseUrl,
    serviceRoleKey,
    rows: lineRows
  });

  const existingLines = await fetchExistingLines({
    supabaseUrl,
    serviceRoleKey,
    orderIds: [savedOrder.id]
  });

  const liveLineKeys = new Set(
    lineRows.map(line => `${line.order_id}__${line.shopify_line_item_id}`)
  );

  const obsoleteLineIds = existingLines
    .filter(line => !liveLineKeys.has(`${line.order_id}__${line.shopify_line_item_id}`))
    .map(line => line.id);

  const deletedLines = await deleteObsoleteLines({
    supabaseUrl,
    serviceRoleKey,
    obsoleteLineIds
  });

  const materialCheck = await triggerMaterialCheck(appUrl, store.shop_domain);

  return {
    ok: true,
    message: "Commande Shopify créée / mise à jour automatiquement",
    shop: store.shop_domain,
    shopifyOrderId,
    savedOrders: savedOrder ? 1 : 0,
    savedLines: savedLines.length,
    deletedLines,
    materialCheck
  };
}

async function handleOrdersDelete({
  payload,
  supabaseUrl,
  serviceRoleKey,
  store
}) {
  const graphQlId = toGraphqlOrderId(payload);

  if (!graphQlId) {
    return {
      ok: true,
      message: "Webhook delete reçu sans identifiant exploitable"
    };
  }

  const existingOrders = await getOrdersForStore({
    supabaseUrl,
    serviceRoleKey,
    storeId: store.id
  });

  const matchedOrders = existingOrders.filter(
    (row) => String(row.shopify_order_id) === String(graphQlId)
  );

  if (!matchedOrders.length) {
    return {
      ok: true,
      message: "Commande déjà absente de Supabase",
      shop: store.shop_domain,
      shopifyOrderId: graphQlId,
      deletedOrders: 0,
      deletedLines: 0,
      deletedAlerts: 0
    };
  }

  const orderIds = matchedOrders.map((row) => row.id);

  const deletion = await deleteByOrderIds({
    supabaseUrl,
    serviceRoleKey,
    orderIds
  });

  return {
    ok: true,
    message: "Commande supprimée automatiquement depuis Supabase",
    shop: store.shop_domain,
    shopifyOrderId: graphQlId,
    ...deletion
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Méthode non autorisée" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.SHOPIFY_APP_URL;
  const webhookSecret =
    process.env.SHOPIFY_API_SECRET ||
    process.env.SHOPIFY_API_SECRET_KEY ||
    process.env.SHOPIFY_CLIENT_SECRET;

  if (!supabaseUrl || !supabaseServiceRoleKey || !appUrl || !webhookSecret) {
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

    const payload = JSON.parse(rawBody.toString("utf8") || "{}");

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

    if (topicHeader === "orders/create") {
      const result = await handleOrdersCreate({
        payload,
        supabaseUrl,
        serviceRoleKey: supabaseServiceRoleKey,
        appUrl,
        store
      });
      return res.status(200).json(result);
    }

    if (topicHeader === "orders/delete") {
      const result = await handleOrdersDelete({
        payload,
        supabaseUrl,
        serviceRoleKey: supabaseServiceRoleKey,
        store
      });
      return res.status(200).json(result);
    }

    return res.status(400).json({
      ok: false,
      message: `Topic inattendu: ${topicHeader || "absent"}`
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erreur serveur pendant le webhook Shopify",
      error: error.message
    });
  }
}
