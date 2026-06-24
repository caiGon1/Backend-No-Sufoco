import { analisarAcoes } from "../../src/service/monitoramento.js";

export default async function handler(req, res) {
  // 1. Só aceita requisições do tipo GET (padrão do Vercel Crons)
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Método ${req.method} não permitido` });
  }

  // 2. Proteção de Segurança Crítica da Vercel
  // Isso garante que apenas a Vercel consiga chamar essa URL de forma automatizada
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized: Invalid Cron Secret" });
  }

  try {
    console.log("[Cron] Iniciando execução automática do monitoramento às 18:15...");
    
    // Executa a rotina que busca as ações e dispara os e-mails
    await analisarAcoes();

    return res.status(200).json({ 
      success: true, 
      message: "Rotina de monitoramento executada com sucesso!" 
    });
  } catch (error) {
    console.error("[Cron Erro] Falha ao rodar o monitoramento automático:", error);
    return res.status(500).json({ error: "Erro interno ao processar a rotina de ações." });
  }
}