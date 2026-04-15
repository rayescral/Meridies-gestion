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

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return res.status(500).json({
      ok: false,
      message: "Variables Supabase serveur manquantes"
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
            query GetProducts($first: Int!) {
              products(first: $first) {
                edges {
                  node {
                    id
                    title
                    status
                    variants(first: 50) {
                      edges {
                        node {
                          id
                          title
                          sku
                          barcode
                          price
                          inventoryItem {
                            id
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
        message: "Erreur Shopify pendant la récupération des produits",
        graphqlData
      });
    }

    const products = graphqlData?.data?.products?.edges?.map(edge => edge.node) || [];

    const productRows = products.map(product => ({
      store_id: store.id,
      shopify_product_id: product.id,
      title: product.title,
      status: product.status,
      updated_at: new Date().toISOString()
    }));

    const upsertProductsResponse = await fetch(
      `${supabaseUrl}/rest/v1/shopify_products?on_conflict=store_id,shopify_product_id`,
      {
        method: "POST",
        headers: {
          apikey: supabaseServiceRoleKey,
          Authorization: `Bearer ${supabaseServiceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(productRows)
      }
    );

    const upsertProductsData = await upsertProductsResponse.json();

    if (!upsertProductsResponse.ok) {
      return res.status(500).json({
        ok: false,
        message: "Impossible d'enregistrer les produits dans Supabase",
        supabaseData: upsertProductsData
      });
    }

    const productIdMap = Object.fromEntries(
      upsertProductsData.map(row => [row.shopify_product_id, row.id])
    );

    const variantRows = products.flatMap(product =>
      (product.variants?.edges || []).map(edge => {
        const variant = edge.node;
        return {
          store_id: store.id,
          product_id: productIdMap[product.id] || null,
          shopify_variant_id: variant.id,
          shopify_inventory_item_id: variant.inventoryItem?.id || null,
          sku: variant.sku || null,
          barcode: variant.barcode || null,
          title: variant.title || null,
          price: variant.price != null ? Number(variant.price) : null,
          updated_at: new Date().toISOString()
        };
      })
    );

    let upsertVariantsData = [];
    if (variantRows.length > 0) {
      const upsertVariantsResponse = await fetch(
        `${supabaseUrl}/rest/v1/shopify_variants?on_conflict=store_id,shopify_variant_id`,
        {
          method: "POST",
          headers: {
            apikey: supabaseServiceRoleKey,
            Authorization: `Bearer ${supabaseServiceRoleKey}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=representation"
          },
          body: JSON.stringify(variantRows)
        }
      );

      upsertVariantsData = await upsertVariantsResponse.json();

      if (!upsertVariantsResponse.ok) {
        return res.status(500).json({
          ok: false,
          message: "Produits enregistrés mais impossible d'enregistrer les variantes",
          supabaseData: upsertVariantsData
        });
      }
    }

    return res.status(200).json({
      ok: true,
      message: "Produits Shopify synchronisés",
      shop: store.shop_domain,
      savedProducts: upsertProductsData.length,
      savedVariants: upsertVariantsData.length
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erreur serveur pendant la synchronisation des produits",
      error: error.message
    });
  }
}
