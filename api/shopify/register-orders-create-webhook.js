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

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.SHOPIFY_APP_URL;
  const shop = String(req.query.shop || "").trim().toLowerCase();

  if (!supabaseUrl || !serviceRoleKey || !appUrl) {
    return res.status(500).json({
      ok: false,
      message: "Variables serveur manquantes"
    });
  }

  if (!shop || !shop.endsWith(".myshopify.com")) {
    return res.status(400).json({
      ok: false,
      message: "Paramètre shop invalide"
    });
  }

  try {
    const store = await getStore({
      supabaseUrl,
      serviceRoleKey,
      shop
    });

    if (!store) {
      return res.status(404).json({
        ok: false,
        message: "Boutique non trouvée dans shopify_stores"
      });
    }

    const callbackUrl = `${appUrl}/api/shopify/webhooks/orders-create`;

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
            mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
              webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
                userErrors {
                  field
                  message
                }
                webhookSubscription {
                  id
                  topic
                  uri
                }
              }
            }
          `,
          variables: {
            topic: "ORDERS_CREATE",
            webhookSubscription: {
              uri: callbackUrl,
              format: "JSON"
            }
          }
        })
      }
    );

    const graphqlData = await graphqlResponse.json();

    return res.status(graphqlResponse.ok ? 200 : 500).json({
      ok: graphqlResponse.ok && !(graphqlData?.data?.webhookSubscriptionCreate?.userErrors?.length),
      shop: store.shop_domain,
      callbackUrl,
      result: graphqlData
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erreur serveur pendant l'enregistrement du webhook",
      error: error.message
    });
  }
}
