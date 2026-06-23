import { GoogleGenAI } from "@google/genai";

const key = process.env.GOOGLE_API_KEY;

const ai = new GoogleGenAI({
  apiKey: key,
});

// ======================================================
// HIGIENIZAÇÃO DE TEXTO (REGEX PARA LIMPEZA DE OCR)
// ======================================================
function higienizarTextoFatura(textoBruto) {
  if (!textoBruto) return "";

  return textoBruto
    .split("\n")
    .map(linha => {
      // 1. Remove o número do meio de captura (1, 2 ou 3) isolado no início antes da data
      // Transforma: "3   22/04 PDV..." -> "22/04 PDV..."
      // Transforma: "2 29/04DL..." -> "29/04DL..."
      let linhaTratada = linha.replace(/^[1-3]\s*(\d{2}\/\d{2})/, "$1");

      // 2. Afasta letras ou caracteres que o PDF colou na data
      // Transforma: "29/04DL *UBERRIDES" -> "29/04 DL *UBERRIDES"
      linhaTratada = linhaTratada.replace(/^(\d{2}\/\d{2})([A-Za-z*])/, "$1 $2");

      return linhaTratada;
    })
    .join("\n");
}

// ======================================================
// GERAÇÃO DINÂMICA DO PROMPT (TEXTO JÁ LIMPO)
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

# REGRA DE ORIENTAÇÃO DE LAYOUT (CRÍTICO)

O texto foi pré-processado e a estrutura das linhas de transação segue RIGIDAMENTE o padrão:

[DATA] [DESCRIÇÃO DO ESTABELECIMENTO] [PARCELA OPCIONAL] [VALOR]

Exemplo:
"04/02 EBENEZER EVANGELICA MU 03/03 68,64"
* "04/02" = data
* "EBENEZER EVANGELICA MU" = descrição
* "03/03" = parcela
* "68,64" = valor

# REGRA ABSOLUTA DE PARCELAMENTO (MUITO IMPORTANTE)

Uma compra SOMENTE pode ser considerada parcelada quando existir explicitamente o padrão:
NN/NN

onde:
* ambos os lados possuem exatamente 2 dígitos;
* a fração aparece isolada imediatamente ANTES do valor;
* a fração está separada da descrição por espaço;
* a fração não faz parte do nome do estabelecimento (ex: "Posto 24/7").

Exemplos VÁLIDOS (eParcela: true):
* "SMARTFIT 03/12 89,90" -> parcelaAtual: 3, parcelaFinal: 12
* "MAGAZINE XPTO 01/10 250,00" -> parcelaAtual: 1, parcelaFinal: 10

Exemplos INVÁLIDOS (eParcela: false):
* "POSTO 24/7 150,00"
* "UBER 2024/01 25,00"
* "MERCADO 12/05"

REGRA DE SEGURANÇA:
Se houver QUALQUER dúvida sobre a existência de parcelamento, defina eParcela = false.
Nunca deduza parcelamentos. Nunca infira parcelamentos.

# REGRAS DE DATA
* Extraia exatamente a data (DD/MM) exibida no início da linha.
* Utilize o ano presente em "${periodoPrincipal}".
* Formato obrigatório: DD/MM/AAAA.
* Não altere o mês original da transação.

# REGRAS DE CATEGORIZAÇÃO
Defina uma categoria coerente para cada transação (ex: academia, transporte, supermercado, alimentacao, farmacia, saude, vestuario). 
Utilize letras minúsculas e sem acentos.

# REGRAS DE VALOR
* O campo "valor" deve ser sempre positivo.
* Utilize o campo "tipo" para identificar se é "debito" ou "credito" (estornos como "-25,99" ou pagamentos de fatura são crédito).

# CHECKLIST OBRIGATÓRIO ANTES DE MARCAR eParcela = true
Confirme TODOS os itens abaixo:
1. Existe um padrão NN/NN.
2. O padrão aparece logo antes do valor.
3. O padrão não está no início da linha.
4. O padrão não faz parte do nome do estabelecimento.
Se qualquer item falhar: eParcela = false.
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
  let textoLimpo = "";

  try {
    textoDoExtrato = await extrairTextoDePDF(pdfBuffer, senha);
    // ✅ Aplica a limpeza das sujeiras do PDF imediatamente
    textoLimpo = higienizarTextoFatura(textoDoExtrato);
  } catch (error) {
    throw new Error(error.message);
  }

  const periodoFinal = detectarPeriodoPrincipal(textoLimpo);
  console.log(`[Detector] Período unificado identificado: ${periodoFinal}`);

  const blocosDeTexto = quebrarTextoEmBlocos(textoLimpo, 120);
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