import { GoogleGenAI } from "@google/genai";

const key = process.env.GOOGLE_API_KEY;

const ai = new GoogleGenAI({
  apiKey: key,
});

// ======================================================
// GERAÇÃO DINÂMICA DO PROMPT (COM REGRAS EXPLÍCITAS)
// ======================================================
function gerarPrompt(textoDoExtrato, periodoPrincipal) {
  return `
Você é um sistema especialista em conciliação bancária de ALTA PRECISÃO.
Extraia APENAS as transações presentes LITERALMENTE no texto abaixo.

CONTEÚDO DO EXTRATO:
"""
${textoDoExtrato}
"""

PERÍODO PRINCIPAL DA FATURA: "${periodoPrincipal}"

## REGRAS DE DATA (CRÍTICO)
- Use EXATAMENTE a data que aparece ao lado da transação no extrato.
- NÃO invente nem infira datas. Se não houver data clara, use null.
- Formato obrigatório de retorno: DD/MM/AAAA. Como o extrato costuma omitir o ano nas transações, use o ano e o mês do PERÍODO PRINCIPAL ("${periodoPrincipal}") para compor a resposta, tratando o primeiro número sempre como o DIA.

## REGRAS DE PARCELAS (CRÍTICO)
"eParcela" só é TRUE se houver um padrão EXPLÍCITO como:
  ✅ "01/12", "Parc 2/6", "3 de 10", "1/3"

"eParcela" é SEMPRE FALSE nos casos abaixo:
  ❌ Número isolado na descrição (ex: "POSTO 476", "LOJA 22")
  ❌ Quando os números coincidem com a data da transação (ex: "COMPRA 15/06" numa transação do dia 15/06)
  ❌ Qualquer dúvida — na dúvida, é FALSE

## REGRAS DE CATEGORIZAÇÃO
Você tem TOTAL LIBERDADE para criar e definir a "categoria" de cada transação de forma lógica e humanizada (ex: "academia", "saude", "beleza", "vestuario", "supermercado"). Use letras minúsculas e sem acentos. SÓ use a categoria "outros" em último caso.

## REGRAS GERAIS
- NÃO invente transações. Se o bloco não tiver transações claras, retorne array vazio.
- "valor" deve ser sempre POSITIVO. Use o campo "tipo" para indicar débito ou crédito.
- "categoria": letra minúscula, sem acento. Use "outros" APENAS se nenhuma categoria fizer sentido.
`;
}

// ======================================================
// FUNÇÃO AUXILIAR: FATIAMENTO DE TEXTO
// ======================================================
function quebrarTextoEmBlocos(texto, linhasPorBloco = 45) {
  const lines = texto.split("\n");
  const blocos = [];

  for (let i = 0; i < lines.length; i += linhasPorBloco) {
    const pedaco = lines.slice(i, i + linhasPorBloco).join("\n");
    blocos.push(pedaco);
  }

  return blocos;
}

// ======================================================
// EXTRAÇÃO DE TEXTO DO PDF (COM DETECÇÃO DE QUEBRA DE LINHA)
// ======================================================
async function extrairTextoDePDF(pdfBuffer, senha) {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      password: senha || "",
    });

    const pdf = await loadingTask.promise;
    let textoCompleto = "";

    for (let paginaAtual = 1; paginaAtual <= pdf.numPages; paginaAtual++) {
      const page = await pdf.getPage(paginaAtual);
      const textContent = await page.getTextContent();

      const linhasDaPagina = [];
      let linhaAtual = [];
      let xAnterior = null;

      for (const item of textContent.items) {
        const xAtual = Math.round(item.transform[4]);
        if (xAnterior !== null && xAtual < xAnterior - 50) {
          linhasDaPagina.push(linhaAtual.join(" "));
          linhaAtual = [];
        }
        linhaAtual.push(item.str);
        xAnterior = xAtual;
      }
      if (linhaAtual.length) linhasDaPagina.push(linhaAtual.join(" "));

      textoCompleto += linhasDaPagina.join("\n") + "\n";
    }

    textoCompleto = textoCompleto.trim();

    if (!textoCompleto || textoCompleto.length < 10) {
      throw new Error("Não foi possível extrair conteúdo textual do PDF.");
    }

    return textoCompleto;
  } catch (error) {
    console.error("ERRO PDF:", error);
    throw new Error(`Falha ao ler o PDF: ${error.message}`);
  }
}

// ======================================================
// DETECTA PERÍODO PRINCIPAL DA FATURA (INTELIGENTE)
// ======================================================
function detectarPeriodoPrincipal(texto) {
  const mesesEps = {
    janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
    jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12
  };

  // Frente 1: Buscar por cabeçalhos textuais explícitos (ex: "Fatura de Maio/2026" ou "Fatura de Maio de 2026")
  const regexExtenso = /(?:fatura de|extrato de|mês de referência|referente a|mês|período)[:\s]*([a-zçáõéíóú]+)(?:[\s\/]+de[\s\/]+|[\s\/]+)(\d{4})/i;
  const matchExtenso = regexExtenso.exec(texto);
  if (matchExtenso) {
    const mesTexto = matchExtenso[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const ano = matchExtenso[2];
    if (mesesEps[mesTexto]) {
      return `${mesesEps[mesTexto]}/${ano}`;
    }
  }

  // Frente 2: Buscar data completa vinculada a palavras-chave (ex: "Vencimento: 10/06/2026")
  const regexDataChave = /(?:fatura de|vencimento|venc\.?|emissão|período)[:\s]+(\d{1,2})[\/](\d{1,2})[\/](\d{4})/i;
  const matchDataChave = regexDataChave.exec(texto);
  if (matchDataChave) {
    const mes = parseInt(matchDataChave[2], 10);
    const ano = matchDataChave[3];
    return `${mes}/${ano}`;
  }

  // Frente 3: Padrão MM/AAAA explícito perto de palavras-chave (ex: "Ref: 05/2026")
  const regexMesAnoChave = /(?:fatura de|mês de referência|referência|ref\.?)[:\s]+(\d{1,2})[\/](\d{4})/i;
  const matchMesAnoChave = regexMesAnoChave.exec(texto);
  if (matchMesAnoChave) {
    const mes = parseInt(matchMesAnoChave[1], 10);
    const ano = matchMesAnoChave[2];
    return `${mes}/${ano}`;
  }

  // Fallback: Método original de contagem estatística adaptado para evitar falsos positivos
  const matchesCompleto = texto.match(/\b(?:\d{1,2})\/(0?[1-9]|1[0-2])\/(20\d{2})\b/g) || [];
  const matchesMesAno = texto.match(/\b(0?[1-9]|1[0-2])\/(20\d{2})\b/g) || [];
  const contador = {};

  for (const item of matchesCompleto) {
    const partes = item.split("/");
    const chave = `${parseInt(partes[1], 10)}/${partes[2]}`;
    contador[chave] = (contador[chave] || 0) + 1;
  }

  for (const item of matchesMesAno) {
    const partes = item.split("/");
    const chave = `${parseInt(partes[0], 10)}/${partes[1]}`;
    contador[chave] = (contador[chave] || 0) + 1;
  }

  let periodoPrincipal = null;
  let maior = 0;

  for (const [periodo, quantidade] of Object.entries(contador)) {
    if (quantidade > maior) {
      maior = quantidade;
      periodoPrincipal = periodo;
    }
  }

  // Se tudo falhar miseravelmente, assume o mês corrente baseado no ano do seu contexto (2026)
  return periodoPrincipal || `${new Date().getMonth() + 1}/2026`;
}

// ======================================================
// FILTRO ROBUSTO DE PARCELAS
// ======================================================
function higienizarParcela(t) {
  let parcela = t.parcela || { eParcela: false };

  if (parcela.eParcela) {
    const desc = (t.descricao || "").toUpperCase();
    const padraoParcelaReal = /\b(\d{1,2})[\/\-\s](\d{1,2})\b/.exec(desc);

    if (!padraoParcelaReal) {
      parcela = { eParcela: false };
    } else {
      const numAtual = parseInt(padraoParcelaReal[1]);
      const numFinal = parseInt(padraoParcelaReal[2]);

      if (numAtual > numFinal || numFinal <= 1) {
        parcela = { eParcela: false };
      }
    }

    if (parcela.eParcela && (parcela.parcelaAtual == null || parcela.parcelaFinal == null)) {
      parcela = { eParcela: false };
    }
  }

  return { ...t, parcela };
}

// ======================================================
// RETRY COM BACKOFF EXPONENCIAL (PARA ERROS 503)
// ======================================================
async function chamarComRetry(fn, tentativas = 3, delayBase = 1500) {
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (err) {
      const mensagem = err?.message || "";
      const e503 = mensagem.includes("503") || err?.status === 503;
      if (e503 && i < tentativas - 1) {
        const espera = delayBase * (i + 1);
        console.warn(`[Retry ${i + 1}/${tentativas - 1}] 503 detectado, aguardando ${espera}ms...`);
        await new Promise((r) => setTimeout(r, espera));
      } else {
        throw err;
      }
    }
  }
}

// ======================================================
// EXTRAÇÃO DE TRANSAÇÕES (MÉTODO SEQUENCIAL COM UNIFICAÇÃO DE PERÍODO)
// ======================================================
export async function extrairInformacoes(pdfBuffer, senha) {
  let textoDoExtrato = "";

  try {
    textoDoExtrato = await extrairTextoDePDF(pdfBuffer, senha);
  } catch (error) {
    throw new Error(error.message);
  }

  // 1. Detecta o período real de forma inteligente no topo do arquivo
  const periodoFinal = detectarPeriodoPrincipal(textoDoExtrato);
  console.log(`[Detector] Período unificado identificado: ${periodoFinal}`);

  // Fatiamento do texto
  const blocosDeTexto = quebrarTextoEmBlocos(textoDoExtrato, 120);
  console.log(`[Vercel Shield] Extrato processado em ${blocosDeTexto.length} bloco(s).`);

  const transacoesAcumuladas = [];

  try {
    for (let i = 0; i < blocosDeTexto.length; i++) {
      const bloco = blocosDeTexto[i];
      const promptDinamico = gerarPrompt(bloco, periodoFinal);

      const response = await chamarComRetry(() =>
        ai.models.generateContent({
          model: "gemini-3.1-flash-lite",
          config: {
            responseMimeType: "application/json",
            temperature: 0.0,
            responseSchema: {
              type: "OBJECT",
              properties: {
                transacoes: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      data: { type: "STRING" },
                      descricao: { type: "STRING" },
                      valor: { type: "NUMBER" },
                      tipo: { type: "STRING", enum: ["credito", "debito"] },
                      categoria: { type: "STRING" },
                      tags: { type: "STRING" },
                      parcela: {
                        type: "OBJECT",
                        properties: {
                          eParcela: { type: "BOOLEAN" },
                          parcelaAtual: { type: "NUMBER" },
                          parcelaFinal: { type: "NUMBER" },
                        },
                        required: ["eParcela"],
                      },
                    },
                    required: ["data", "descricao", "valor", "tipo", "categoria", "tags", "parcela"],
                  },
                },
              },
              required: ["transacoes"],
            },
          },
          contents: [{ role: "user", parts: [{ text: promptDinamico }] }],
        })
      );

      const resultadoBruto = JSON.parse(response.text.trim());

      if (resultadoBruto.transacoes && Array.isArray(resultadoBruto.transacoes)) {
        transacoesAcumuladas.push(...resultadoBruto.transacoes);
      }

      if (i < blocosDeTexto.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    // 2. Higienização de parcelas + Frente 2: Forçar período único em todas as transações
    const [mesTarget, anoTarget] = periodoFinal.split("/");
    const mesFormatado = mesTarget.padStart(2, "0");

    const transacoesHigienizadas = transacoesAcumuladas.map(t => {
      // Primeiro limpa as regras de parcelas
      const transacaoLimpa = higienizarParcela(t);

      // Se não houver data válida retornada pela IA, mantém null
      if (!transacaoLimpa.data) return transacaoLimpa;

      // Isola o dia retornado pela IA e reconstrói a data com o MM/AAAA do período final
      const partesDaData = transacaoLimpa.data.split("/");
      if (partesDaData.length >= 2) {
        const dia = partesDaData[0].padStart(2, "0");
        transacaoLimpa.data = `${dia}/${mesFormatado}/${anoTarget}`;
      }

      return transacaoLimpa;
    });

    // 3. Envelopa tudo no período detectado
    const estruturaPeriodos = {
      periodos: [
        {
          mesAno: periodoFinal,
          transacoes: transacoesHigienizadas,
        },
      ],
    };

    console.log(`[Sucesso] ${transacoesHigienizadas.length} transações consolidadas no período ${periodoFinal}.`);
    return estruturaPeriodos;

  } catch (error) {
    console.error("ERRO NO PROCESSAMENTO:", error);
    throw new Error(`Falha ao processar as informações do extrato: ${error.message}`);
  }
}

// ======================================================
// ANÁLISE FINANCEIRA
// ======================================================
export async function analiseDeTransacoes(transacoes) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `
Você é um sistema especialista em análise financeira.
Abaixo estão as transações extraídas de um extrato bancário.

TRANSAÇÕES:
"""
${JSON.stringify(transacoes, null, 2)}
"""

Analise as transações acima e forneça:
- Um resumo financeiro curto
- Possíveis excessos de gastos
- Dicas simples de melhoria financeira

IMPORTANTE:
- Resposta curta
- Linguagem simples
- Sem markdown
- Sem listas complexas
- Fácil de entender
              `,
            },
          ],
        },
      ],
    });

    return response.text.trim();
  } catch (error) {
    console.error("ERRO ANÁLISE:", error);
    throw new Error(`Falha ao gerar análise financeira: ${error.message}`);
  }
}