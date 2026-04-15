export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    app: "meridies-gestion",
    branch: "shopify-setup",
    message: "API Vercel OK"
  });
}
