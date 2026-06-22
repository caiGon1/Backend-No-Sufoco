import { GoogleGenAI } from "@google/genai";

const key = process.env.GOOGLE_API_KEY;

const ai = new GoogleGenAI({
  apiKey: key,
});

// ======================================================
// GERAÇÃO DINÂMICA DO PROMPT (LIBERDADE TOTAL DE CATEGORIAS)
// ======================================================
function gerarPrompt(textoDoExtrato, periodoPrincipal) {
  return `
Você é um sistema especialista em análise financeira e conciliação bancária de alta precisão.

Abaixo está o texto extraído diretamente de um extrato bancário.

CONTEÚDO DO EXTRATO:
"""
${textoDoExtrato}
"""

PERÍODO PRINCIPAL DA FATURA/EXTRATO:
"${periodoPrincipal}"

IMPORTANTE:
O período acima representa o mês vigente da fatura atual.

## TAREFA PRINCIPAL
Extraia TODAS as transações financeiras presentes no texto acima.

## REGRAS DE CATEGORIZAÇÃO (LIBERDADE DE INTELIGÊNCIA)

Você tem TOTAL LIBERDADE para criar e definir a "categoria" de cada transação. Use seu conhecimento de mundo e bom senso para classificar cada estabelecimento de forma lógica e humanizada.

Exemplos de como você deve pensar:
- "CIA MEGA FITNESS" -> categoria: "academia" ou "saúde"
- "EBENEZER EVANGELICA" -> categoria: "compras" ou "religião"
- "PERFUMARIA PRINCESA" ou "NATURA PAY" -> categoria: "beleza" ou "cosméticos"
- "CAEDU ARICANDUVA" -> categoria: "vestuário" ou "roupas"
- "MP*MELIMAIS" -> categoria: "assinaturas" ou "serviços"
- "DF*TIKTOK SHOP" -> categoria: "compras" ou "lazer"
- "CARREFOUR" / "PADARIA" -> categoria: "supermercado" ou "alimentação"

Seja específico e coerente. Use letras minúsculas e sem acentos para as categorias (ex: "saude" em vez de "Saúde", "vestuario" em vez de "Vestuário") para manter o padrão de banco de dados.

SÓ use a categoria "outros" se a linha do extrato for um código incompreensível ou texto sem nexo que impossibilite qualquer dedução.

## REGRAS GERAIS

REGRA 1: Cada mês diferente DEVE ser um objeto separado no array "periodos".
REGRA 2: O campo "mesAno" deve usar EXATAMENTE "M/AAAA".
REGRA 3: Mantenha o campo "data" exatamente como aparece no extrato.
REGRA 4: O campo "valor" deve ser número puro sem símbolo monetário.
REGRA 5: O campo "tags" deve conter apenas uma palavra complementar (ex: "comida", "transporte", "mensalidade").
REGRA 6: Use "credito" ou "debito".
REGRA 7: COMPRAS PARCELADAS DEVEM USAR O PERÍODO DA FATURA.
REGRA 8: Caso identifique uma parcela, coloque no objeto "parcela" no campo "eParcela" TRUE, caso não identifique ou fique na dúvida coloque como "FALSE"
REGRA 9: Caso identifique uma parcela, coloque a parcela atual no campo parcelaAtual e a parcela final em parcelaFinal no objeto parcela. Caso não identifique a parcela, e/ou o campo "eParcela" seja FALSE, omita esses campos.

Retorne SOMENTE JSON válido.
`;
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
      maior = quantidade;
      periodoPrincipal = periodo;
    }
  }

  return periodoPrincipal;
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

  const periodoPrincipal = detectarPeriodoPrincipal(textoDoExtrato);
  const promptDinamico = gerarPrompt(textoDoExtrato, periodoPrincipal);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            periodos: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  mesAno: {
                    type: "STRING",
                  },
                  transacoes: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        data: {
                          type: "STRING",
                        },
                        descricao: {
                          type: "STRING",
                        },
                        valor: {
                          type: "NUMBER",
                        },
                        tipo: {
                          type: "STRING",
                          enum: ["credito", "debito"],
                        },
                        categoria: {
                          type: "STRING",
                          description:
                            "Categoria livre gerada dinamicamente com base no estabelecimento (ex: vestuario, academia, beleza, supermercado, religiao).",
                        },
                        tags: {
                          type: "STRING",
                        },
                        parcela: {
                          type: "OBJECT",
                          properties: {
                            eParcela: {
                              type: "BOOLEAN",
                              description:
                                "Defina como true se a descrição indicar uma compra parcelada (ex: '01/03'). Defina como false se for uma compra comum à vista ou se o número for apenas a data do dia.",
                            },
                            parcelaAtual: { type: "NUMBER" },
                            parcelaFinal: { type: "NUMBER" },
                          },
                          required: ["eParcela"],
                        },
                      },
                      required: [
                        "data",
                        "descricao",
                        "valor",
                        "tipo",
                        "categoria",
                        "tags",
                        "parcela",
                      ],
                    },
                  },
                },
                required: ["mesAno", "transacoes"],
              },
            },
          },
          required: ["periodos"],
        },
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: promptDinamico,
            },
          ],
        },
      ],
    });

    const texto = response.text.trim();

    try {
      return JSON.parse(texto);
    } catch (parseError) {
      console.error("Texto bruto recebido:", texto.substring(0, 300));
      throw parseError;
    }
  } catch (error) {
    console.error("ERRO GEMINI:", error);
    throw new Error(
      `Falha ao processar as informações do extrato: ${error.message}`,
    );
  }
}

// ======================================================
// ANÁLISE FINANCEIRA
// ======================================================
export async function analiseDeTransacoes(transacoes) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
