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

async function listExistingWebhooks({ shopDomain, accessToken }) {
  const response = await fetch(
    `https://${shopDomain}/admin/api/2026-01/webhooks.json`,
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de lister les webhooks Shopify: ${JSON.stringify(data)}`);
  }

  return data.webhooks || [];
}

async function createWebhook({ shopDomain, accessToken, topic, address }) {
  const response = await fetch(
    `https://${shopDomain}/admin/api/2026-01/webhooks.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        webhook: {
          topic,
          address,
          format: "json"
        }
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Impossible de créer le webhook ${topic}: ${JSON.stringify(data)}`);
  }

  return data.webhook;
}

async function deleteWebhook({ shopDomain, accessToken, webhookId }) {
  const response = await fetch(
    `https://${shopDomain}/admin/api/2026-01/webhooks/${webhookId}.json`,
    {
      method: "DELETE",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      }
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Impossible de supprimer le webhook ${webhookId}: ${text}`);
  }
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

    const sharedAddress = `${appUrl}/api/shopify/webhooks/orders-create`;

    const desired = [
      {
        topic: "orders/create",
        address: sharedAddress
      },
      {
        topic: "orders/delete",
        address: sharedAddress
      }
    ];

    const existing = await listExistingWebhooks({
      shopDomain: store.shop_domain,
      accessToken: store.access_token
    });

    const created = [];
    const kept = [];
    const removed = [];

    for (const wanted of desired) {
      const exact = existing.find(
        (w) => w.topic === wanted.topic && w.address === wanted.address
      );

      if (exact) {
        kept.push({
          topic: wanted.topic,
          address: wanted.address,
          id: exact.id
        });
        continue;
      }

      const sameTopicWrongAddress = existing.filter(
        (w) => w.topic === wanted.topic && w.address !== wanted.address
      );

      for (const stale of sameTopicWrongAddress) {
        await deleteWebhook({
          shopDomain: store.shop_domain,
          accessToken: store.access_token,
          webhookId: stale.id
        });

        removed.push({
          topic: stale.topic,
          oldAddress: stale.address,
          id: stale.id
        });
      }

      const newWebhook = await createWebhook({
        shopDomain: store.shop_domain,
        accessToken: store.access_token,
        topic: wanted.topic,
        address: wanted.address
      });

      created.push({
        topic: newWebhook.topic,
        address: newWebhook.address,
        id: newWebhook.id
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Webhooks Shopify enregistrés",
      shop: store.shop_domain,
      kept,
      created,
      removed
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erreur pendant l’enregistrement des webhooks Shopify",
      error: error.message
    });
  }
}
