export default function cors(req, res) {
  // Lista de origens permitidas (sem caminhos)
  const allowedOrigins = [
    "https://no-sufoco.vercel.app",
    "http://localhost:5173"
  ];

  const origin = req.headers.origin;

  // Se a origem da requisição estiver na lista, permite o acesso
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,DELETE,OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  // Responde imediatamente às requisições de preflight (OPTIONS)
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }

  return false;
}
