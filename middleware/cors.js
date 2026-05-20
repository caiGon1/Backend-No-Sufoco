// arquivo: utils/cors.js (ou similar)

export default function cors(req, res) {
  const allowedOrigins = [
    "https://no-sufoco.vercel.app",
    "http://localhost:5173"
  ];

  const origin = req.headers.origin;

  // Permite a origem se estiver na lista
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  // Configura os métodos e headers permitidos
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Se for uma requisição de teste (Preflight), encerra aqui com sucesso
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return true; // Indica que a requisição foi encerrada por aqui
  }

  return false; // Indica que a requisição pode continuar para a lógica principal
}
