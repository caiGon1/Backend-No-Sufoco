// arquivo: utils/cors.js

export default function cors(req, res) {
  const allowedOrigins = [
    "https://no-sufoco.vercel.app",
    "http://localhost:5173"
  ];

  const origin = req.headers.origin;

  // Permite a origem se estiver na lista
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    // Opcional: Permite requisições sem origem (ex: Postman ou Server-to-Server)
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  // Configura os métodos e headers permitidos
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  // IMPORTANTE: Permite que cookies/sessões sejam compartilhados se necessário
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Se for uma requisição de teste (Preflight), encerra explicitamente com status 204 ou 200
  if (req.method === "OPTIONS") {
    res.statusCode = 204; // No Content é o padrão ideal para OPTIONS
    res.end();
    return true; // Retorna true informando que a requisição FOI ENCERRADA
  }

  return false; // Retorna false informando que a rota principal pode continuar
}
