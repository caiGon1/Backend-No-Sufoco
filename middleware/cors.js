export default function cors(req, res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://no-sufoco.vercel.app",
    "https://no-sufoco.vercel.app/cadastro",
    "https://no-sufoco.vercel.app/dashboard",
    "http://localhost:5173",
    "http://localhost:5173/cadastro",
    "http://localhost:5173/dashboard"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,DELETE,OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();

    return true;
  }

  return false;
}