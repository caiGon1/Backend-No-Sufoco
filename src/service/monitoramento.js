import { GoogleGenAI } from "@google/genai";
import clientPromise from "../../lib/mongodb.js";
import nodemailer from "nodemailer";

// Remova a linha global: const client = await clientPromise;
// Remova a linha global: const db = client.db("NoSufocoDB");
// Remova a linha global: const usersCollection = db.collection("users");

const brapiToken = process.env.BRAPI_TOKEN;
const key = process.env.GOOGLE_API_KEY;
const ai = new GoogleGenAI({
  apiKey: key,
});

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASS,
  },
});

// ─── Ícones SVG inline ───────────────────────────────────────────────
const ICON_UP = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="fill:#fff;display:block"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/></svg>`;
const ICON_DOWN = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="fill:#fff;display:block"><path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"/></svg>`;
const ICON_CHART = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="20" height="20" style="fill:#fff;display:block"><path d="M3 17l4-4 4 4 4-6 4 3V3H3v14zm0 2v2h18v-2H3z"/></svg>`;

// ─── CSS embutido (compatível com clientes de e-mail) ────────────────
const CSS = `
  body{margin:0;padding:0;background-color:#f5f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif}
  .wrapper{width:100%;background-color:#f5f7f5;padding:32px 16px;box-sizing:border-box}
  .container{max-width:560px;margin:0 auto;background-color:#fff;border-radius:12px;overflow:hidden;border:1px solid #d4e8d4}
  .accent-strip{height:4px;background:#1a6b3a}
  .header{background-color:#1a6b3a;padding:28px 32px 24px}
  .header-logo{display:flex;align-items:center;gap:10px;margin-bottom:14px}
  .header-logo-icon{width:36px;height:36px;background-color:rgba(255,255,255,.15);border-radius:8px;display:flex;align-items:center;justify-content:center}
  .header-logo-text{font-size:14px;font-weight:600;color:#b6ddc5;letter-spacing:.04em;text-transform:uppercase}
  .header-title{font-size:22px;font-weight:700;color:#fff;margin:0 0 6px;line-height:1.3}
  .header-subtitle{font-size:13px;color:#90c9a8;margin:0}
  .greeting{padding:24px 32px 8px}
  .greeting p{margin:0;font-size:15px;color:#2d2d2d;line-height:1.6}
  .greeting strong{color:#1a6b3a}
  .section-label{padding:20px 32px 10px}
  .section-label span{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b9b7a}
  .alerts{padding:0 32px 24px;display:flex;flex-direction:column;gap:10px}
  .alert-card{border-radius:10px;overflow:hidden;border:1px solid transparent}
  .alert-card.sell{background-color:#fff4f4;border-color:#f7c1c1}
  .alert-card.buy{background-color:#f0f6ff;border-color:#b5d4f4}
  .alert-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 10px}
  .alert-ticker-wrap{display:flex;align-items:center;gap:8px}
  .alert-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .sell .alert-icon{background-color:#f09595}
  .buy  .alert-icon{background-color:#85b7eb}
  .alert-ticker{font-size:16px;font-weight:700;letter-spacing:.03em}
  .sell .alert-ticker{color:#791f1f}
  .buy  .alert-ticker{color:#0c447c}
  .alert-badge{font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;letter-spacing:.05em;text-transform:uppercase}
  .sell .alert-badge{background-color:#e24b4a;color:#fff}
  .buy  .alert-badge{background-color:#378add;color:#fff}
  .alert-reason{padding:0 16px 12px;font-size:13px;line-height:1.55}
  .sell .alert-reason{color:#993535}
  .buy  .alert-reason{color:#185fa5}
  .alert-reason-label{font-weight:700;margin-right:4px}
  .divider{margin:4px 32px;border:none;border-top:1px solid #e8f0e8}
  .footer{background-color:#f0f7f0;border-top:1px solid #d4e8d4;padding:20px 32px 24px}
  .footer-disclaimer{font-size:12px;color:#5f7b66;line-height:1.6;margin:0 0 16px}
  .footer-disclaimer strong{font-weight:600;color:#3b6d11}
  .footer-meta{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
  .footer-brand{font-size:12px;font-weight:600;color:#3b6d11}
  .footer-date{font-size:11px;color:#8aaa8e}
`;

// ─── Função que gera um card de alerta ───────────────────────────────
function gerarCardAlerta(alerta) {
  const isSell = alerta.status === "VENDER";
  const cssClass = isSell ? "sell" : "buy";
  const icon = isSell ? ICON_UP : ICON_DOWN;
  const badgeLabel = isSell ? "Vender" : "Comprar";

  return `
    <div class="alert-card ${cssClass}">
      <div class="alert-header">
        <div class="alert-ticker-wrap">
          <div class="alert-icon">${icon}</div>
          <span class="alert-ticker">${alerta.ticker}</span>
        </div>
        <span class="alert-badge">${badgeLabel}</span>
      </div>
      <div class="alert-reason">
        <span class="alert-reason-label">Motivo:</span>${alerta.motivo}
      </div>
    </div>`;
}

// ─── Função principal: gera o corpoEmail HTML ────────────────────────
function gerarCorpoEmail(alertasDoUsuario) {
  const dataHoje = new Date().toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const cardsHTML = alertasDoUsuario.map(gerarCardAlerta).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Análise de Ativos</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
 
      <div class="accent-strip"></div>
 
      <div class="header">
        <div class="header-logo">
          <div class="header-logo-icon">${ICON_CHART}</div>
          <span class="header-logo-text">Análise de Ativos</span>
        </div>
        <h1 class="header-title">Oportunidades identificadas hoje</h1>
        <p class="header-subtitle">Relatório automatizado gerado pela IA de mercado</p>
      </div>
 
      <div class="greeting">
        <p>Olá! Nossa <strong>IA analisou seus ativos</strong> e encontrou oportunidades hoje:</p>
      </div>
 
      <div class="section-label">
        <span>Recomendações</span>
      </div>
 
      <div class="alerts">
        ${cardsHTML}
      </div>
 
      <hr class="divider"/>
 
      <div class="footer">
        <p class="footer-disclaimer">
          <strong>Aviso importante:</strong> Este e-mail é um relatório automatizado e não constitui recomendação oficial de compra ou venda de ativos. Sempre consulte um profissional habilitado antes de tomar decisões de investimento.
        </p>
        <div class="footer-meta">
          <span class="footer-brand">Análise de Ativos IA</span>
          <span class="footer-date">Gerado em ${dataHoje}</span>
        </div>
      </div>
 
    </div>
  </div>
</body>
</html>`;
}

// ─── Função Principal ────────────────────────────────────────────────
export async function analisarAcoes() {
  console.log("Iniciando rotina diária...");

  try {
    // 🟢 MOVIDO PARA CÁ: A conexão agora acontece com segurança dentro do escopo assíncrono
    const client = await clientPromise;
    const db = client.db("NoSufocoDB");
    const usersCollection = db.collection("users");

    // 1. AGREGAÇÃO
    const resultadoAgregacao = await usersCollection
      .aggregate([
        { $match: { "acoes.monitora": true } },
        { $project: { ativosArray: { $objectToArray: "$acoes.ativos" } } },
        { $unwind: "$ativosArray" },
        { $match: { "ativosArray.v": true } },
        { $group: { _id: "$ativosArray.k" } },
      ])
      .toArray();

    const tickersDoSistema = resultadoAgregacao.map((item) => item._id);

    if (tickersDoSistema.length === 0) {
      console.log("Nenhuma ação com monitoramento ativo no sistema.");
      return;
    }

    const dadosCompactosParaIA = [];
    for (const ticker of tickersDoSistema) {
      try {
        // 1. Adicionado o parâmetro ?token= na URL
        const response = await fetch(
          `https://brapi.dev/api/quote/${ticker}?token=${brapiToken}`,
        );

        // 2. Removido o bloqueio silencioso para exibir o que está dando errado
        if (!response.ok) {
          console.warn(
            `[Aviso] Falha ao buscar ${ticker}. Status da API: ${response.status} - ${response.statusText}`,
          );
          continue;
        }

        const data = await response.json();
        const info = data.results && data.results[0];

        if (!info) continue;

        dadosCompactosParaIA.push({
          t: info.symbol,
          p: info.regularMarketPrice,
          v_1d: `${info.regularMarketChangePercent?.toFixed(2)}%`,
          max_52s: info.fiftyTwoWeekHigh,
          min_52s: info.fiftyTwoWeekLow,
        });

        // Delay para evitar Rate Limit (bloqueio por muitas requisições seguidas)
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (err) {
        console.error(`Erro ao processar ticker ${ticker}:`, err);
      }
    }

    if (dadosCompactosParaIA.length === 0) {
      console.log("Não foi possível buscar os dados da API.");
      return;
    }

    // 3. IA
    const systemInstruction =
      "Você é um analista financeiro sênior muito rigoroso. Analise o histórico dos ativos fornecidos. " +
      "Suas regras de decisão são ESTRITAMENTE MATEMÁTICAS: " +
      "1. COMPRAR: Somente se o preço atual (p) estiver, no máximo, 5% acima da mínima de 52 semanas (min_52s). " +
      "2. VENDER: Somente se o preço atual (p) estiver, no mínimo, a 5% de distância de romper a máxima de 52 semanas (max_52s). " +
      "3. MANTER: Se o ativo não atender às regras 1 ou 2, marque como MANTER e deixe a propriedade 'motivo' em branco. " +
      "REGRA DE JUSTIFICATIVA: Se a decisão for COMPRAR ou VENDER, o 'motivo' DEVE conter os números exatos. " +
      "Retorne ESTRITAMENTE um JSON estruturado como neste exemplo: " +
      '{"PETR4": {"status": "VENDER", "motivo": "Preço atual (R$ 38,50) está a menos de 5% da máxima (R$ 39,10)."}}';
    const aiResponse = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite", // 🟢 Atualizado: Alinhado com o padrão do seu projeto (index.js)
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.0, // Mantém a resposta determinística e técnica
      },
      contents: [
        {
          role: "user",
          parts: [{ text: JSON.stringify(dadosCompactosParaIA) }],
        },
      ],
    });

    const vereditosIA = JSON.parse(aiResponse.text.trim());

    // 4. VERIFICAÇÃO DOS USUÁRIOS E DISPARO DE E-MAIL
    const usuariosComMonitoramento = await usersCollection
      .find({
        "acoes.monitora": true,
      })
      .toArray();

    for (const usuario of usuariosComMonitoramento) {
      let alertasDoUsuario = [];
      const ativosDoUsuario = usuario.acoes?.ativos || {};

      for (const [ticker, monitorar] of Object.entries(ativosDoUsuario)) {
        if (monitorar === true) {
          const analiseAtivo = vereditosIA[ticker.toUpperCase()];

          if (analiseAtivo && analiseAtivo.status !== "MANTER") {
            alertasDoUsuario.push({
              ticker: ticker.toUpperCase(),
              status: analiseAtivo.status,
              motivo: analiseAtivo.motivo,
            });
          }
        }
      }

      if (alertasDoUsuario.length > 0) {
        const htmlCorpoEmail = gerarCorpoEmail(alertasDoUsuario);

        // 🟢 CORREÇÃO CRÍTICA: Ajustado para enviar para o e-mail do usuário iterado
        await transporter.sendMail({
          from: `"No Sufoco Análises" <${process.env.GMAIL_USER}>`,
          to: usuario.email,
          subject: `Resumo Diário: ${alertasDoUsuario.length} alertas de mercado 📈`,
          html: htmlCorpoEmail,
        });
      }
    }
    console.log(
      "Email disparado:",
      usuariosComMonitoramento.map((u) => u.email),
    );
    console.log("De email:", process.env.GMAIL_USER);
    console.log("Rotina finalizada e e-mails disparados com sucesso.");
  } catch (error) {
    console.error("Erro crítico na execução da rotina:", error);
  }
}
