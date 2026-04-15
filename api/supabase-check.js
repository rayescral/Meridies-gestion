export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      ok: false,
      message: "Variables Supabase manquantes sur Vercel"
    });
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/app_state?select=id&limit=1`,
      {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`
        }
      }
    );

    const data = await response.json();

    return res.status(response.ok ? 200 : 500).json({
      ok: response.ok,
      status: response.status,
      source: "supabase",
      table: "app_state",
      data
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erreur de connexion à Supabase",
      error: error.message
    });
  }
}
