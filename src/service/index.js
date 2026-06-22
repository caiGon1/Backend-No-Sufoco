import { GoogleGenAI } from "@google/genai";

const key = process.env.GOOGLE_API_KEY;

const ai = new GoogleGenAI({
  apiKey: key,
});

// ======================================================
// GERAÇÃO DINÂMICA DO PROMPT (RECALIBRADO PARA EVITAR ERROS)
// ======================================================
function gerarPrompt(textoDoExtrato, periodoPrincipal) {
  return `
Você é um sistema especialista em análise financeira e conciliação bancária de alta precisão.

Abaixo está o texto extraído diretamente de uma fatia de um extrato bancário.

CONTEÚDO DO EXTRATO:
"""
${textoDoExtrato}
"""

PERÍODO PRINCIPAL DA FATURA/EXTRATO:
"${periodoPrincipal}"

## TAREFA PRINCIPAL
Extraia TODAS as transações financeiras presentes no texto acima.

## REGRAS DE CATEGORIZAÇÃO
Você tem TOTAL LIBERDADE para criar e definir a "categoria" de cada transação de forma lógica e humanizada (ex: "academia", "saude", "beleza", "vestuario", "supermercado"). Use letras minúsculas e sem acentos. SÓ use a categoria "outros" em último caso.

## REGRAS DE PARCELAS (CRÍTICO)
- Analise a descrição da transação. Se houver um padrão de divisão numérico explícito indicando parcelamento (exemplos: "01/12", "Parc 2", "5 de 10", "1/3"), defina "eParcela" como true e extraia "parcelaAtual" e "parcelaFinal".
- Se os números identificados forem IGUAIS à data da própria transação (ex: texto diz "POSTO 22/06" e a data da compra é 22 de junho), isso NÃO é uma parcela, é uma data. Defina "eParcela" como false.
- Caso não haja nenhuma menção clara a parcelamento, defina "eParcela" como false.

Retorne um objeto JSON contendo um array de "transacoes".
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

      const textosDaPagina = textContent.items.map((item) => item.str);

      textoCompleto += textosDaPagina.join(" ") + "\n";
    }

    textoCompleto = textoCompleto.replace(/\s+/g, " ").trim();

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
      maior = quantidade; // Corretinho, apenas atualizando o maior valor
      periodoPrincipal = periodo;
    }
  }

  return periodoPrincipal;
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
  const periodoFinal = periodoDetectado || "6/2026"; // Fallback seguro para o mês atual
  
  // Fatiamento do texto para o Vercel Shield (120 linhas por bloco para fazer poucas chamadas)
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
      
      // Joga todas as transações extraídas deste bloco para o nosso array geral
      if (resultadoBruto.transacoes && Array.isArray(resultadoBruto.transacoes)) {
        transacoesAcumuladas.push(...resultadoBruto.transacoes);
      }

      if (i < blocosDeTexto.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }

    // 2. Filtro de segurança contra alucinações de parcelas nas transações acumuladas
    const transacoesHigienizadas = transacoesAcumuladas.map((t) => {
      let parcelaTratada = t.parcela || { eParcela: false };

      if (parcelaTratada.eParcela) {
        const descricao = (t.descricao || "").trim();
        const dataTransacao = (t.data || "").trim();

        if (descricao.includes(dataTransacao) && !/parc|de/i.test(descricao)) {
          const textoRemanescente = descricao.replace(dataTransacao, "").trim();
          if (!/\d+[\-\/\s]\d+/.test(textoRemanescente)) {
            parcelaTratada = { eParcela: false };
          }
        }

        if (parcelaTratada.parcelaAtual === undefined || parcelaTratada.parcelaFinal === undefined) {
          parcelaTratada = { eParcela: false };
        }
      }

      return { ...t, parcela: parcelaTratada };
    });

    // 3. GARANTIA DE PERÍODO ÚNICO: Envelopa absolutamente tudo no período detectado no início
    const estruturaPeriodos = {
      periodos: [
        {
          mesAno: periodoFinal, // Usa rigorosamente o mesmo M/AAAA para todas as transações
          transacoes: transacoesHigienizadas,
        }
      ]
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
