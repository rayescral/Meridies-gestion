async function getStore({ supabaseUrl, serviceRoleKey, shop }) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("limit", "1");
  params.set("shop_domain", `eq.${shop}`);

  const response = await fetch(
    `${supabaseUrl}/rest/v1/shopify_stores?${params.toString()}`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de lire shopify_stores: ${JSON.stringify(data)}`);
  }

  return data?.[0] || null;
}

async function getOrders({ supabaseUrl, serviceRoleKey, storeId }) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("store_id", `eq.${storeId}`);
  params.set("order", "created_at_shopify.desc");
  params.set("limit", "50");

  const response = await fetch(
    `${supabaseUrl}/rest/v1/shopify_orders?${params.toString()}`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de lire shopify_orders: ${JSON.stringify(data)}`);
  }

  return data || [];
}

async function getOrderLines({ supabaseUrl, serviceRoleKey, orderIds }) {
  if (!orderIds.length) return [];

  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order_id", `in.(${orderIds.join(",")})`);
  params.set("limit", "1000");

  const response = await fetch(
    `${supabaseUrl}/rest/v1/shopify_order_lines?${params.toString()}`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de lire shopify_order_lines: ${JSON.stringify(data)}`);
  }

  return data || [];
}

async function getBoms({ supabaseUrl, serviceRoleKey, variantIds }) {
  if (!variantIds.length) return [];

  const quoted = variantIds.map(id => `"${id}"`).join(",");
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("variant_id", `in.(${quoted})`);
  params.set("limit", "1000");

  const response = await fetch(
    `${supabaseUrl}/rest/v1/boms?${params.toString()}`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de lire boms: ${JSON.stringify(data)}`);
  }

  return data || [];
}

async function getBomItemsDetailed({ supabaseUrl, serviceRoleKey, bomIds }) {
  if (!bomIds.length) return [];

  const quoted = bomIds.map(id => `"${id}"`).join(",");
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,bom_id,qty_needed,material_id,materials(id,code,name,stock_on_hand,stock_reserved,stock_available)"
  );
  params.set("bom_id", `in.(${quoted})`);
  params.set("limit", "1000");

  const response = await fetch(
    `${supabaseUrl}/rest/v1/bom_items?${params.toString()}`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de lire bom_items: ${JSON.stringify(data)}`);
  }

  return data || [];
}

async function safeDeleteOrder({
  supabaseUrl,
  serviceRoleKey,
  supabaseOrderId,
  orderName
}) {
  if (!supabaseOrderId) {
    return {
      status: 400,
      body: {
        ok: false,
        message: "supabaseOrderId manquant"
      }
    };
  }

  const orderResp = await fetch(
    `${supabaseUrl}/rest/v1/shopify_orders?id=eq.${encodeURIComponent(
      supabaseOrderId
    )}&select=id,order_name,name,deleted_on_shopify`,
    {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    }
  );

  const orderData = await orderResp.json();

  if (!orderResp.ok) {
    return {
      status: 500,
      body: {
        ok: false,
        message: "Impossible de lire la commande dans Supabase",
        details: orderData
      }
    };
  }

  const order = orderData?.[0];

  if (!order) {
    return {
      status: 404,
      body: {
        ok: false,
        message: "Commande introuvable dans Supabase"
      }
    };
  }

  const deletedOnShopify =
    order.deleted_on_shopify === true ||
    order.deleted_on_shopify === "true" ||
    order.deleted_on_shopify === 1 ||
    order.deleted_on_shopify === "1";

  if (!deletedOnShopify) {
    return {
      status: 409,
      body: {
        ok: false,
        message: `La commande ${orderName || order.order_name || order.name || ""} est encore présente sur Shopify. Suppression bloquée.`
      }
    };
  }

  const selectLinesResp = await fetch(
    `${supabaseUrl}/rest/v1/shopify_order_lines?order_id=eq.${encodeURIComponent(
      supabaseOrderId
    )}&select=id`,
    {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    }
  );

  if (!selectLinesResp.ok) {
    const txt = await selectLinesResp.text();
    return {
      status: 500,
      body: {
        ok: false,
        message: "Impossible de lire les lignes Supabase",
        details: txt
      }
    };
  }

  const lines = await selectLinesResp.json();
  const deletedLineIds = (lines || []).map(l => l.id);

  const delLinesResp = await fetch(
    `${supabaseUrl}/rest/v1/shopify_order_lines?order_id=eq.${encodeURIComponent(
      supabaseOrderId
    )}`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    }
  );

  if (!delLinesResp.ok) {
    const txt = await delLinesResp.text();
    return {
      status: 500,
      body: {
        ok: false,
        message: "Impossible de supprimer les lignes Supabase",
        details: txt
      }
    };
  }

  const delOrderResp = await fetch(
    `${supabaseUrl}/rest/v1/shopify_orders?id=eq.${encodeURIComponent(
      supabaseOrderId
    )}`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    }
  );

  if (!delOrderResp.ok) {
    const txt = await delOrderResp.text();
    return {
      status: 500,
      body: {
        ok: false,
        message: "Impossible de supprimer la commande Supabase",
        details: txt
      }
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      message: `Commande ${orderName || order.order_name || order.name || ""} supprimée du site et de Supabase.`,
      deletedLineIds
    }
  };
}

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({
      ok: false,
      message: "Variables Supabase serveur manquantes"
    });
  }

  try {
    if (req.method === "POST" && req.body && req.body.action === "safe_delete_order") {
      const result = await safeDeleteOrder({
        supabaseUrl,
        serviceRoleKey,
        supabaseOrderId: req.body.supabaseOrderId,
        orderName: req.body.orderName
      });

      return res.status(result.status).json(result.body);
    }

    const shop = String(req.query.shop || "").trim().toLowerCase();

    if (!shop || !shop.endsWith(".myshopify.com")) {
      return res.status(400).json({
        ok: false,
        message: "Paramètre shop invalide"
      });
    }

    const store = await getStore({ supabaseUrl, serviceRoleKey, shop });

    if (!store) {
      return res.status(404).json({
        ok: false,
        message: "Boutique non trouvée dans shopify_stores"
      });
    }

    const orders = await getOrders({
      supabaseUrl,
      serviceRoleKey,
      storeId: store.id
    });

    const orderIds = orders.map(o => o.id);

    const lines = await getOrderLines({
      supabaseUrl,
      serviceRoleKey,
      orderIds
    });

    const variantIds = [...new Set(lines.map(l => l.variant_id).filter(Boolean))];

    const boms = await getBoms({
      supabaseUrl,
      serviceRoleKey,
      variantIds
    });

    const bomMap = Object.fromEntries(boms.map(b => [b.variant_id, b]));
    const bomIds = boms.map(b => b.id);

    const bomItems = await getBomItemsDetailed({
      supabaseUrl,
      serviceRoleKey,
      bomIds
    });

    const bomItemsByBomId = bomItems.reduce((acc, item) => {
      if (!acc[item.bom_id]) acc[item.bom_id] = [];
      acc[item.bom_id].push(item);
      return acc;
    }, {});

    const alerts = [];
    const orderStatusUpdates = [];
    const lineStatusUpdates = [];

    for (const order of orders) {
      const orderLines = lines.filter(l => l.order_id === order.id);
      let orderHasMissing = false;

      for (const line of orderLines) {
        if (!line.variant_id) {
          orderHasMissing = true;

          alerts.push({
            order_id: order.id,
            order_line_id: line.id,
            variant_id: null,
            material_id: null,
            alert_type: "mapping_missing",
            severity: "high",
            required_qty: null,
            available_qty: null,
            missing_qty: null,
            status: "open",
            message: `Aucune variante interne liée pour la ligne "${line.title}"`
          });

          lineStatusUpdates.push({
            id: line.id,
            material_check_status: "mapping_missing"
          });

          continue;
        }

        const bom = bomMap[line.variant_id];

        if (!bom) {
          orderHasMissing = true;

          alerts.push({
            order_id: order.id,
            order_line_id: line.id,
            variant_id: line.variant_id,
            material_id: null,
            alert_type: "bom_missing",
            severity: "high",
            required_qty: null,
            available_qty: null,
            missing_qty: null,
            status: "open",
            message: `Aucune BOM trouvée pour la variante "${line.title}"`
          });

          lineStatusUpdates.push({
            id: line.id,
            material_check_status: "bom_missing"
          });

          continue;
        }

        const items = bomItemsByBomId[bom.id] || [];
        let lineHasMissing = false;

        for (const item of items) {
          const material = item.materials;
          const requiredQty = Number(item.qty_needed) * Number(line.quantity || 0);
          const availableQty = Number(
            material?.stock_available ?? material?.stock_on_hand ?? 0
          );
          const missingQty = Math.max(0, requiredQty - availableQty);

          if (missingQty > 0) {
            orderHasMissing = true;
            lineHasMissing = true;

            alerts.push({
              order_id: order.id,
              order_line_id: line.id,
              variant_id: line.variant_id,
              material_id: material?.id || null,
              alert_type: "material_missing",
              severity: "high",
              required_qty: requiredQty,
              available_qty: availableQty,
              missing_qty: missingQty,
              status: "open",
              message: `Matière manquante "${material?.code}" pour "${line.title}" : besoin ${requiredQty}, dispo ${availableQty}`
            });
          }
        }

        lineStatusUpdates.push({
          id: line.id,
          material_check_status: lineHasMissing ? "missing" : "ok"
        });
      }

      orderStatusUpdates.push({
        id: order.id,
        meridies_status: orderHasMissing ? "manquant_matiere" : "a_produire"
      });
    }

    if (orderIds.length > 0) {
      for (const orderId of orderIds) {
        const resolveResponse = await fetch(
          `${supabaseUrl}/rest/v1/material_alerts?order_id=eq.${orderId}&status=eq.open`,
          {
            method: "PATCH",
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
              "Content-Type": "application/json",
              Prefer: "return=representation"
            },
            body: JSON.stringify({
              status: "resolved",
              resolved_at: new Date().toISOString()
            })
          }
        );

        if (!resolveResponse.ok) {
          const err = await resolveResponse.json();
          return res.status(500).json({
            ok: false,
            message: "Impossible de clôturer les anciennes alertes ouvertes",
            error: err
          });
        }
      }
    }

    if (alerts.length > 0) {
      const alertResponse = await fetch(`${supabaseUrl}/rest/v1/material_alerts`, {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify(alerts)
      });

      const alertData = await alertResponse.json();

      if (!alertResponse.ok) {
        return res.status(500).json({
          ok: false,
          message: "Impossible d'enregistrer les alertes",
          error: alertData
        });
      }
    }

    if (orderStatusUpdates.length > 0) {
      for (const update of orderStatusUpdates) {
        const orderPatchResponse = await fetch(
          `${supabaseUrl}/rest/v1/shopify_orders?id=eq.${update.id}`,
          {
            method: "PATCH",
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
              "Content-Type": "application/json",
              Prefer: "return=representation"
            },
            body: JSON.stringify({
              meridies_status: update.meridies_status
            })
          }
        );

        if (!orderPatchResponse.ok) {
          const err = await orderPatchResponse.json();
          return res.status(500).json({
            ok: false,
            message: "Impossible de mettre à jour les statuts de commandes",
            error: err
          });
        }
      }
    }

    if (lineStatusUpdates.length > 0) {
      for (const update of lineStatusUpdates) {
        const linePatchResponse = await fetch(
          `${supabaseUrl}/rest/v1/shopify_order_lines?id=eq.${update.id}`,
          {
            method: "PATCH",
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
              "Content-Type": "application/json",
              Prefer: "return=representation"
            },
            body: JSON.stringify({
              material_check_status: update.material_check_status
            })
          }
        );

        if (!linePatchResponse.ok) {
          const err = await linePatchResponse.json();
          return res.status(500).json({
            ok: false,
            message: "Impossible de mettre à jour les statuts de lignes",
            error: err
          });
        }
      }
    }

    return res.status(200).json({
      ok: true,
      message: "Contrôle matière terminé",
      shop,
      scannedOrders: orders.length,
      scannedLines: lines.length,
      createdAlerts: alerts.length,
      ordersWithMissing: orderStatusUpdates.filter(
        o => o.meridies_status === "manquant_matiere"
      ).length
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erreur serveur pendant le contrôle matière",
      error: error.message
    });
  }
}
