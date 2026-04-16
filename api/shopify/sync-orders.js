function normalizeShop(shop) {
  const value = String(shop || "").trim().toLowerCase();
  if (!value.endsWith(".myshopify.com")) return null;
  return value;
}

async function getStore({ supabaseUrl, serviceRoleKey, shop }) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("limit", "1");

  if (shop) {
    params.set("shop_domain", `eq.${shop}`);
  } else {
    params.set("order", "installed_at.desc");
  }

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

async function fetchExistingOrders({ supabaseUrl, serviceRoleKey, storeId }) {
  const params = new URLSearchParams();
  params.set("select", "id,shopify_order_id,meridies_status");
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
    throw new Error(`Impossible de lire shopify_orders existantes: ${JSON.stringify(data)}`);
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
    throw new Error(`Impossible de lire shopify_order_lines existantes: ${JSON.stringify(data)}`);
  }

  return data || [];
}

async function deleteOrderLinesByOrderIds({ supabaseUrl, serviceRoleKey, orderIds }) {
  if (!orderIds.length) return { ok: true, deleted: 0 };

  const response = await fetch(`${supabaseUrl}/rest/v1/shopify_order_lines?order_id=in.(${orderIds.join(",")})`, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=representation"
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de supprimer shopify_order_lines: ${JSON.stringify(data)}`);
  }

  return { ok: true, deleted: Array.isArray(data) ? data.length : 0 };
}

async function deleteOrdersByIds({ supabaseUrl, serviceRoleKey, orderIds }) {
  if (!orderIds.length) return { ok: true, deleted: 0 };

  const response = await fetch(`${supabaseUrl}/rest/v1/shopify_orders?id=in.(${orderIds.join(",")})`, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=representation"
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de supprimer shopify_orders: ${JSON.stringify(data)}`);
  }

  return { ok: true, deleted: Array.isArray(data) ? data.length : 0 };
}

async function deleteObsoleteLines({ supabaseUrl, serviceRoleKey, obsoleteLineIds }) {
  if (!obsoleteLineIds.length) return { ok: true, deleted: 0 };

  const response = await fetch(`${supabaseUrl}/rest/v1/shopify_order_lines?id=in.(${obsoleteLineIds.join(",")})`, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=representation"
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de supprimer les lignes obsolètes: ${JSON.stringify(data)}`);
  }

  return { ok: true, deleted: Array.isArray(data) ? data.length : 0 };
}

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.SHOPIFY_APP_URL;

  if (!supabaseUrl || !supabaseServiceRoleKey || !appUrl) {
    return res.status(500).json({
      ok: false,
      message: "Variables serveur manquantes"
    });
  }

  const normalizedShop = req.query.shop ? normalizeShop(req.query.shop) : null;
  if (req.query.shop && !normalizedShop) {
    return res.status(400).json({
      ok: false,
      message: "Paramètre shop invalide"
    });
  }

  try {
    const store = await getStore({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      shop: normalizedShop
    });

    if (!store) {
      return res.status(404).json({
        ok: false,
        message: "Aucune boutique Shopify connectée trouvée"
      });
    }

    const existingOrders = await fetchExistingOrders({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      storeId: store.id
    });

    const existingOrderMap = Object.fromEntries(
      existingOrders.map(row => [row.shopify_order_id, row])
    );

    const graphqlResponse = await fetch(
      `https://${store.shop_domain}/admin/api/2026-04/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": store.access_token
        },
        body: JSON.stringify({
          query: `
            query GetOrders($first: Int!) {
              orders(first: $first, sortKey: CREATED_AT, reverse: true) {
                edges {
                  node {
                    id
                    name
                    createdAt
                    updatedAt
                    displayFinancialStatus
                    displayFulfillmentStatus
                    totalPriceSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                    customer {
                      email
                    }
                    lineItems(first: 100) {
                      edges {
                        node {
                          id
                          name
                          quantity
                          originalUnitPriceSet {
                            shopMoney {
                              amount
                            }
                          }
                          variant {
                            id
                            sku
                            title
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: {
            first: 50
          }
        })
      }
    );

    const graphqlData = await graphqlResponse.json();

    if (!graphqlResponse.ok || graphqlData.errors) {
      return res.status(500).json({
        ok: false,
        message: "Erreur Shopify pendant la récupération des commandes",
        graphqlData
      });
    }

    const orders = graphqlData?.data?.orders?.edges?.map(edge => edge.node) || [];
    const liveShopifyOrderIds = new Set(orders.map(order => order.id));

    const orderRows = orders.map(order => ({
      store_id: store.id,
      shopify_order_id: order.id,
      order_name: order.name,
      customer_email: order.customer?.email || null,
      financial_status: order.displayFinancialStatus || null,
      fulfillment_status: order.displayFulfillmentStatus || null,
      currency: order.totalPriceSet?.shopMoney?.currencyCode || null,
      total_price: order.totalPriceSet?.shopMoney?.amount != null
        ? Number(order.totalPriceSet.shopMoney.amount)
        : null,
      meridies_status: existingOrderMap[order.id]?.meridies_status || "nouvelle",
      raw_payload: order,
      created_at_shopify: order.createdAt,
      updated_at: new Date().toISOString()
    }));

    const upsertOrdersResponse = await fetch(
      `${supabaseUrl}/rest/v1/shopify_orders?on_conflict=store_id,shopify_order_id`,
      {
        method: "POST",
        headers: {
          apikey: supabaseServiceRoleKey,
          Authorization: `Bearer ${supabaseServiceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(orderRows)
      }
    );

    const upsertOrdersData = await upsertOrdersResponse.json();

    if (!upsertOrdersResponse.ok) {
      return res.status(500).json({
        ok: false,
        message: "Impossible d'enregistrer les commandes dans Supabase",
        supabaseData: upsertOrdersData
      });
    }

    const orderIdMap = Object.fromEntries(
      upsertOrdersData.map(row => [row.shopify_order_id, row.id])
    );

    const obsoleteOrders = existingOrders.filter(row => !liveShopifyOrderIds.has(row.shopify_order_id));
    const obsoleteOrderIds = obsoleteOrders.map(row => row.id);

    if (obsoleteOrderIds.length > 0) {
      await deleteOrderLinesByOrderIds({
        supabaseUrl,
        serviceRoleKey: supabaseServiceRoleKey,
        orderIds: obsoleteOrderIds
      });

      await deleteOrdersByIds({
        supabaseUrl,
        serviceRoleKey: supabaseServiceRoleKey,
        orderIds: obsoleteOrderIds
      });
    }

    const variantMap = await getVariantMap({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      storeId: store.id
    });

    const lineRows = orders.flatMap(order =>
      (order.lineItems?.edges || []).map(edge => {
        const line = edge.node;
        const shopifyVariantId = line.variant?.id || null;

        return {
          order_id: orderIdMap[order.id],
          shopify_line_item_id: line.id,
          shopify_variant_id: shopifyVariantId,
          variant_id: shopifyVariantId ? (variantMap[shopifyVariantId] || null) : null,
          title: line.name,
          sku: line.variant?.sku || null,
          quantity: line.quantity,
          unit_price: line.originalUnitPriceSet?.shopMoney?.amount != null
            ? Number(line.originalUnitPriceSet.shopMoney.amount)
            : null,
          material_check_status: "pending"
        };
      })
    );

    let upsertLinesData = [];
    if (lineRows.length > 0) {
      const upsertLinesResponse = await fetch(
        `${supabaseUrl}/rest/v1/shopify_order_lines?on_conflict=order_id,shopify_line_item_id`,
        {
          method: "POST",
          headers: {
            apikey: supabaseServiceRoleKey,
            Authorization: `Bearer ${supabaseServiceRoleKey}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=representation"
          },
          body: JSON.stringify(lineRows)
        }
      );

      upsertLinesData = await upsertLinesResponse.json();

      if (!upsertLinesResponse.ok) {
        return res.status(500).json({
          ok: false,
          message: "Commandes enregistrées mais impossible d'enregistrer les lignes",
          supabaseData: upsertLinesData
        });
      }
    }

    const currentOrderIds = upsertOrdersData.map(row => row.id);
    const existingLines = await fetchExistingLines({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      orderIds: currentOrderIds
    });

    const liveLineKeys = new Set(
      lineRows.map(line => `${line.order_id}__${line.shopify_line_item_id}`)
    );

    const obsoleteLineIds = existingLines
      .filter(line => !liveLineKeys.has(`${line.order_id}__${line.shopify_line_item_id}`))
      .map(line => line.id);

    if (obsoleteLineIds.length > 0) {
      await deleteObsoleteLines({
        supabaseUrl,
        serviceRoleKey: supabaseServiceRoleKey,
        obsoleteLineIds
      });
    }

    const materialCheckResponse = await fetch(
      `${appUrl}/api/shopify/check-materials?shop=${encodeURIComponent(store.shop_domain)}`
    );

    const materialCheckData = await materialCheckResponse.json();

    if (!materialCheckResponse.ok) {
      return res.status(500).json({
        ok: false,
        message: "Commandes synchronisées mais le contrôle matière a échoué",
        shop: store.shop_domain,
        savedOrders: upsertOrdersData.length,
        savedLines: upsertLinesData.length,
        deletedOrders: obsoleteOrderIds.length,
        deletedLines: obsoleteLineIds.length,
        materialCheck: materialCheckData
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Commandes Shopify synchronisées + suppressions propagées + contrôle matière lancé",
      shop: store.shop_domain,
      savedOrders: upsertOrdersData.length,
      savedLines: upsertLinesData.length,
      deletedOrders: obsoleteOrderIds.length,
      deletedLines: obsoleteLineIds.length,
      materialCheck: materialCheckData
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erreur serveur pendant la synchronisation des commandes",
      error: error.message
    });
  }
}
