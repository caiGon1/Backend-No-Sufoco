import { GoogleGenAI } from "@google/genai";

const key = process.env.GOOGLE_API_KEY;

const ai = new GoogleGenAI({
  apiKey: key,
});

// ======================================================
// GERAÇÃO DINÂMICA DO PROMPT (COM REGRAS DE LAYOUT)
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

## REGRA DE ORIENTAÇÃO DE LAYOUT (CRÍTICO)
O texto do extrato foi extraído de uma tabela linha por linha. A ordem das colunas da esquerda para a direita geralmente é:
\`[INDICADOR DE CAPTURA (Opcional)] [DATA DA TRANSAÇÃO] [DESCRIÇÃO DO ESTABELECIMENTO] [FRAÇÃO DA PARCELA (Se houver)] [VALOR]\`

* ATENÇÃO: Números isolados no início da linha (como "1", "2" ou "3") indicam a forma como a compra foi capturada (ícones de aproximação, internet, cartão físico que o leitor de PDF transformou em texto). Você deve IGNORAR esse número inicial completamente. Ele NÃO faz parte da data e NÃO é uma parcela.

Exemplos de interpretação CORRETA (Com Parcela):
- "1   04/02 EBENEZER EVANGELICA MU 03/03 68,64"
  -> O "1" inicial é apenas o meio de captura. IGNORE-O.
  -> Data da transação: "04/02".
  -> Descrição: "EBENEZER EVANGELICA MU".
  -> Parcela: "03/03" (parcelaAtual: 3, parcelaFinal: 3). eParcela: TRUE.

Exemplos de interpretação CORRETA (Sem Parcela - NÃO ALUCINE):
- "3   22/04 PDV*MATRIZ EMBALAGENS 44,12"
  -> O "3" inicial é apenas o meio de captura. IGNORE-O.
  -> Data da transação: "22/04".
  -> Descrição: "PDV*MATRIZ EMBALAGENS".
  -> Parcela: eParcela: FALSE.
- "10/05 POSTO 24/7 150,00"
  -> "24/7" é o nome do posto, NÃO é uma parcela. eParcela: FALSE.

## REGRAS DE DATA (CRÍTICO)
- Extraia EXATAMENTE o dia e o mês que aparecem na linha da transação (ex: se na linha diz "22/04", o mês é Abril, não altere isso).
- Formato obrigatório de retorno: DD/MM/AAAA. 
- Use o ANO do PERÍODO PRINCIPAL ("${periodoPrincipal}") para preencher o ano que falta. NÃO sobrescreva o mês da transação com o mês do período principal.

## REGRAS DE PARCELAS
No objeto "parcela":
- "eParcela": Será TRUE APENAS se houver uma clara indicação de fracionamento com barra isolada no final da descrição (ex: "04/12", "03/03", "02/02").
- Números soltos no INÍCIO da linha (ex: "1", "2", "3" indicando meio de captura) ou números que fazem parte do NOME da loja (ex: "Posto 24/7") NÃO são parcelas.
- "parcelaAtual": O primeiro número da fração isolada (apenas se eParcela for TRUE).
- "parcelaFinal": O segundo número da fração isolada (apenas se eParcela for TRUE).
- Se a linha NÃO tiver uma fração com barra no final da descrição, "eParcela" é SEMPRE FALSE e os campos "parcelaAtual" e "parcelaFinal" não devem ser preenchidos.

## REGRAS DE CATEGORIZAÇÃO
Defina a "categoria" de cada transação de forma lógica e humanizada (ex: "academia", "saude", "vestuario", "supermercado"). Use letras minúsculas e sem acentos.

## REGRAS GERAIS
- "valor": Deve ser sempre POSITIVO. Use o campo "tipo" para indicar se é débito ou crédito (pagamentos de fatura ou estornos como "DL*TIKTOK SHOP S -25,99" são crédito).
- Não invente dados. Se não houver transações claras, retorne um array vazio.
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
// EXTRAÇÃO DE TEXTO DO PDF
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
// DETECTA PERÍODO PRINCIPAL DA FATURA
// ======================================================
function detectarPeriodoPrincipal(texto) {
  const mesesEps = {
    janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
    jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12
  };

  const regexExtenso = /(?:fatura de|extrato de|mês de referência|referente a|mês|período)[:\s]*([a-zçáõéíóú]+)(?:[\s\/]+de[\s\/]+|[\s\/]+)(\d{4})/i;
  const matchExtenso = regexExtenso.exec(texto);
  if (matchExtenso) {
    const mesTexto = matchExtenso[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const ano = matchExtenso[2];
    if (mesesEps[mesTexto]) {
      return `${mesesEps[mesTexto]}/${ano}`;
    }
  }

  const regexDataChave = /(?:fatura de|vencimento|venc\.?|emissão|período)[:\s]+(\d{1,2})[\/](\d{1,2})[\/](\d{4})/i;
  const matchDataChave = regexDataChave.exec(texto);
  if (matchDataChave) {
    const mes = parseInt(matchDataChave[2], 10);
    const ano = matchDataChave[3];
    return `${mes}/${ano}`;
  }

  const regexMesAnoChave = /(?:fatura de|mês de referência|referência|ref\.?)[:\s]+(\d{1,2})[\/](\d{4})/i;
  const matchMesAnoChave = regexMesAnoChave.exec(texto);
  if (matchMesAnoChave) {
    const mes = parseInt(matchMesAnoChave[1], 10);
    const ano = matchMesAnoChave[2];
    return `${mes}/${ano}`;
  }

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

  return periodoPrincipal || `${new Date().getMonth() + 1}/2026`;
}

// ======================================================
// FILTRO ROBUSTO DE PARCELAS
// ======================================================
function higienizarParcela(t) {
  let parcela = { ...t.parcela };

  if (parcela && parcela.eParcela) {
    const numAtual = parseInt(parcela.parcelaAtual, 10);
    const numFinal = parseInt(parcela.parcelaFinal, 10);

    if (isNaN(numAtual) || isNaN(numFinal) || numAtual > numFinal || numFinal <= 1) {
      parcela = { eParcela: false };
    } else {
      parcela.parcelaAtual = numAtual;
      parcela.parcelaFinal = numFinal;
    }
  } else {
    parcela = { eParcela: false };
  }

  return { ...t, parcela };
}

// ======================================================
// RETRY COM BACKOFF EXPONENCIAL
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
// EXTRAÇÃO DE TRANSAÇÕES
// ======================================================
export async function extrairInformacoes(pdfBuffer, senha) {
  let textoDoExtrato = "";

  try {
    textoDoExtrato = await extrairTextoDePDF(pdfBuffer, senha);
    
  } catch (error) {
    throw new Error(error.message);
  }

  const periodoFinal = detectarPeriodoPrincipal(textoDoExtrato);
  console.log(textoDoExtrato);
  console.log(`[Detector] Período unificado identificado: ${periodoFinal}`);

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

    const [mesTarget, anoTarget] = periodoFinal.split("/");
    const mesFormatado = mesTarget.padStart(2, "0");

    const transacoesHigienizadas = transacoesAcumuladas.map(t => {
      const transacaoLimpa = higienizarParcela(t);

      if (!transacaoLimpa.data) return transacaoLimpa;

      const partesDaData = transacaoLimpa.data.split("/");
      if (partesDaData.length >= 2) {
        const dia = partesDaData[0].padStart(2, "0");
        transacaoLimpa.data = `${dia}/${mesFormatado}/${anoTarget}`;
      }

      return transacaoLimpa;
    });

    const estruturaPeriodos = {
      periodos: [
        {
          mesAno: periodoFinal,
          transacoes: transacoesHigienizadas,
        },
      ],
    };

    console.log(`[Sucesso] ${transacoesHigienizadas.length} transações consolidadas.`);
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
      model: "gemini-3.1-flash-lite",
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
- Resposta corta
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