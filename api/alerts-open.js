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
    const query = new URLSearchParams();
    query.set(
      "select",
      "id,alert_type,severity,required_qty,available_qty,missing_qty,message,status,created_at,order_id,order_line_id,variant_id,material_id"
    );
    query.set("status", "eq.open");
    query.set("order", "created_at.desc");
    query.set("limit", "50");

    const response = await fetch(
      `${supabaseUrl}/rest/v1/material_alerts?${query.toString()}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        ok: false,
        message: "Impossible de récupérer les alertes ouvertes",
        error: data
      });
    }

    return res.status(200).json({
      ok: true,
      count: data.length,
      alerts: data
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erreur serveur pendant la lecture des alertes",
      error: error.message
    });
  }
}
