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

PERÍODO PRINCIPAL: "${periodoPrincipal}"

## REGRAS DE DATA (CRÍTICO)
- Use EXATAMENTE a data que aparece ao lado da transação no extrato.
- NÃO invente nem infira datas. Se não houver data clara, use null.
- Formato obrigatório: DD/MM/AAAA. Se o ano não aparecer, use o ano do PERÍODO PRINCIPAL.

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
  const linhas = texto.split("\n");
  const blocos = [];

  for (let i = 0; i < linhas.length; i += linhasPorBloco) {
    const pedaco = linhas.slice(i, i + linhasPorBloco).join("\n");
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

      // Preserva a estrutura linha a linha detectando quebras pelo eixo X
      const linhasDaPagina = [];
      let linhaAtual = [];
      let xAnterior = null;

      for (const item of textContent.items) {
        const xAtual = Math.round(item.transform[4]);
        // Se o X "voltou" muito para a esquerda, é uma nova linha
        if (xAnterior !== null && xAtual < xAnterior - 50) {
          linhasDaPagina.push(linhaAtual.join(" "));
          linhaAtual = [];
        }
        linhaAtual.push(item.str);
        xAnterior = xAtual;
      }
      // Adiciona a última linha pendente
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
  const matches = texto.match(/\b(0?[1-9]|1[0-2])\/(20\d{2})\b/g) || [];
  const contador = {};

  for (const item of matches) {
    const [mes, ano] = item.split("/");
    const chave = `${parseInt(mes, 10)}/${ano}`;
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

  return periodoPrincipal;
}

// ======================================================
// FILTRO ROBUSTO DE PARCELAS
// ======================================================
function higienizarParcela(t) {
  let parcela = t.parcela || { eParcela: false };

  if (parcela.eParcela) {
    const desc = (t.descricao || "").toUpperCase();

    // Busca padrão explícito de fração numérica (ex: 01/12, 3 de 10, Parc 2/6)
    const padraoParcelaReal = /\b(\d{1,2})[\/\-\s](\d{1,2})\b/.exec(desc);

    if (!padraoParcelaReal) {
      // Nenhum padrão numérico de fração encontrado → não é parcela
      parcela = { eParcela: false };
    } else {
      const numAtual = parseInt(padraoParcelaReal[1]);
      const numFinal = parseInt(padraoParcelaReal[2]);

      // Sanity checks: parcela atual <= final, e final > 1
      if (numAtual > numFinal || numFinal <= 1) {
        parcela = { eParcela: false };
      }
    }

    // Garante que parcelaAtual e parcelaFinal existem se eParcela ainda for true
    if (parcela.eParcela && (parcela.parcelaAtual == null || parcela.parcelaFinal == null)) {
      parcela = { eParcela: false };
    }
  }

  return { ...t, parcela };
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

  // 1. Detecta o período real do extrato (ex: "5/2026")
  const periodoDetectado = detectarPeriodoPrincipal(textoDoExtrato);
  const periodoFinal = periodoDetectado;

  // Fatiamento do texto (120 linhas por bloco para fazer poucas chamadas)
  const blocosDeTexto = quebrarTextoEmBlocos(textoDoExtrato, 120);
  console.log(`[Vercel Shield] Extrato processado em ${blocosDeTexto.length} bloco(s).`);

  const transacoesAcumuladas = [];

  try {
    for (let i = 0; i < blocosDeTexto.length; i++) {
      const bloco = blocosDeTexto[i];
      const promptDinamico = gerarPrompt(bloco, periodoFinal);

      const response = await ai.models.generateContent({
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
      });

      const resultadoBruto = JSON.parse(response.text.trim());

      if (resultadoBruto.transacoes && Array.isArray(resultadoBruto.transacoes)) {
        transacoesAcumuladas.push(...resultadoBruto.transacoes);
      }

      if (i < blocosDeTexto.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }

    // 2. Higienização robusta de parcelas
    const transacoesHigienizadas = transacoesAcumuladas.map(higienizarParcela);

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