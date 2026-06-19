// arquivo: utils/cors.js

export default function cors(req, res) {
  const allowedOrigins = [
    "https://no-sufoco.vercel.app",
    "http://localhost:5173",
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );

  // 1. CORREÇÃO AQUI: Adicione o '*' ou explicite os headers que o navegador costuma enviar no upload.
  // O FormData com Axios costuma exigir que aceitemos quaisquer headers customizados do browser.
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Accept",
  );

  res.setHeader("Access-Control-Allow-Credentials", "true");

  // 2. CORREÇÃO CRÍTICA PARA A VERCEL:
  // Requisições OPTIONS na Vercel precisam responder com status e cabeçalhos imediatamente.
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Requested-With, Accept",
      "Access-Control-Allow-Credentials": "true",
    });
    res.end();
    return true;
  }

  return false;
}
