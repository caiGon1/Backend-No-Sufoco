```js
import { GoogleGenAI } from "@google/genai";

const key = process.env.GOOGLE_API_KEY;

const ai = new GoogleGenAI({
  apiKey: key,
});

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

      const textosDaPagina = textContent.items.map(
        (item) => item.str
      );

      textoCompleto += textosDaPagina.join(" ") + "\n";
    }

    textoCompleto = textoCompleto
      .replace(/\s+/g, " ")
      .trim();

    if (!textoCompleto || textoCompleto.length < 10) {
      throw new Error(
        "Não foi possível extrair conteúdo textual do PDF."
      );
    }

    return textoCompleto;
  } catch (error) {
    console.error("ERRO PDF:", error);

    if (
      error?.name === "PasswordException" ||
      error?.message?.toLowerCase().includes("password")
    ) {
      throw new Error(
        "Senha do PDF incorreta ou não fornecida."
      );
    }

    throw new Error(
      `Falha ao ler o PDF: ${error.message}`
    );
  }
}

// ======================================================
// DETECTA PERÍODO PRINCIPAL DA FATURA
// ======================================================
function detectarPeriodoPrincipal(texto) {
  const matches =
    texto.match(/\b(0?[1-9]|1[0-2])\/(20\d{2})\b/g) || [];

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
export async function extrairInformacoes(
  pdfBuffer,
  senha
) {
  let textoDoExtrato = "";

  try {
    textoDoExtrato = await extrairTextoDePDF(
      pdfBuffer,
      senha
    );
  } catch (error) {
    throw new Error(error.message);
  }

  // -------------------------------------------------------
  // DETECTA PERÍODO PRINCIPAL
  // -------------------------------------------------------
  const periodoPrincipal =
    detectarPeriodoPrincipal(textoDoExtrato);

  console.log(
    "===== [DEBUG] PERÍODO PRINCIPAL DETECTADO ====="
  );

  console.log(periodoPrincipal);

  console.log(
    "==============================================="
  );

  // -------------------------------------------------------
  // DEBUG TEXTO EXTRAÍDO
  // -------------------------------------------------------
  console.log(
    "===== [DEBUG] TEXTO EXTRAÍDO DO PDF (primeiros 500 chars) ====="
  );

  console.log(
    textoDoExtrato.substring(0, 500)
  );

  console.log(
    "================================================================"
  );

  try {
    const response =
      await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",

        config: {
          responseMimeType:
            "application/json",

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

                            enum: [
                              "credito",
                              "debito",
                            ],
                          },

                          categoria: {
                            type: "STRING",
                          },

                          tags: {
                            type: "STRING",
                          },
                        },

                        required: [
                          "data",
                          "descricao",
                          "valor",
                          "tipo",
                          "categoria",
                          "tags",
                        ],
                      },
                    },
                  },

                  required: [
                    "mesAno",
                    "transacoes",
                  ],
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
                text: `
Você é um sistema especialista em análise financeira e conciliação bancária.

Abaixo está o texto extraído diretamente de um extrato bancário.

CONTEÚDO DO EXTRATO:
"""
${textoDoExtrato}
"""

PERÍODO PRINCIPAL DA FATURA/EXTRATO:
"${periodoPrincipal}"

IMPORTANTE:
O período acima representa o mês vigente da fatura atual.

Compras parceladas detectadas no extrato DEVEM ser agrupadas neste período principal, mesmo que a data textual da compra seja antiga.

## TAREFA PRINCIPAL

Extraia TODAS as transações financeiras presentes no texto acima.

## REGRAS OBRIGATÓRIAS DE AGRUPAMENTO POR PERÍODO

REGRA 1 — SEPARAÇÃO OBRIGATÓRIA POR MÊS/ANO:

Cada mês diferente DEVE ser um objeto separado no array "periodos".

NÃO agrupe transações de meses diferentes no mesmo objeto.

Exemplo CORRETO:

{
  "periodos": [
    {
      "mesAno": "1/2026",
      "transacoes": []
    },
    {
      "mesAno": "2/2026",
      "transacoes": []
    }
  ]
}

REGRA 2 — FORMATO DO CAMPO "mesAno":

Use EXATAMENTE o formato:

"M/AAAA"

Exemplos:
- 1/2026
- 2/2026
- 10/2025

NÃO use:
- 01/2026
- 01-2026

REGRA 3 — CAMPO "data":

Mantenha o formato original da data como aparece no extrato.

REGRA 4 — CAMPO "valor":

Sempre número puro sem símbolo.

Correto:
150.90

Errado:
"R$ 150,90"

REGRA 5 — CAMPO "categoria":

Categorias possíveis:
- aluguel
- luz
- água
- internet
- supermercado
- lazer
- delivery
- streaming
- assinaturas
- salário
- transferência

Se não souber:
"outros"

REGRA 6 — CAMPO "tags":

Uma única palavra.

Exemplos:
- uber
- ifood
- netflix
- salário
- mercado

Se não souber:
"outros"

REGRA 7 — CAMPO "tipo":

Use:
- "credito"
- "debito"

REGRA 8 — COMPRAS PARCELADAS DEVEM USAR O PERÍODO DA FATURA

Extratos de cartão frequentemente mostram:
- a data original da compra
- e também a parcela atual

Exemplo:
"15/01/2026 MAGAZINE LUIZA 03/10"

Mesmo que a data da linha seja janeiro/2026, essa parcela pode pertencer à fatura atual.

Quando identificar sinais de parcelamento como:
- 1/10
- 2/12
- 03/08
- PARC 4/6
- PARCELA 5/10
- PX 2/5

faça o seguinte:

1. Considere que a compra pertence ao PERÍODO PRINCIPAL DA FATURA informado acima.

2. NÃO use a data original da compra para definir o campo "mesAno".

3. Todas as parcelas detectadas devem ser agrupadas no período vigente da fatura.

4. Mantenha a data original exatamente como aparece no extrato.

5. Nunca distribua parcelas em meses antigos por causa da data original da compra.

REGRA 9 — NÃO INVENTAR INFORMAÇÕES

Nunca invente:
- valores
- datas
- parcelas
- categorias
- comerciantes

Extraia apenas o que estiver claramente presente no extrato.
                `,
              },
            ],
          },
        ],
      });

    const texto = response.text.trim();

    try {
      const parsed = JSON.parse(texto);

      console.log(
        "===== [DEBUG] RESPOSTA DA IA — PERÍODOS ENCONTRADOS ====="
      );

      parsed.periodos?.forEach((p, i) => {
        console.log(
          `Período ${
            i + 1
          }: mesAno="${p.mesAno}" | ${
            p.transacoes?.length ?? 0
          } transações`
        );
      });

      console.log(
        "=========================================================="
      );

      return parsed;
    } catch (parseError) {
      console.error(
        "===== [DEBUG] FALHA AO PARSEAR JSON DA IA ====="
      );

      console.error(
        "Texto bruto recebido:",
        texto.substring(0, 300)
      );

      throw parseError;
    }
  } catch (error) {
    console.error("ERRO GEMINI:", error);

    throw new Error(
      `Falha ao processar as informações do extrato: ${error.message}`
    );
  }
}

// ======================================================
// ANÁLISE FINANCEIRA
// ======================================================
export async function analiseDeTransacoes(
  transacoes
) {
  try {
    const response =
      await ai.models.generateContent({
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
${JSON.stringify(
  transacoes,
  null,
  2
)}
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

    throw new Error(
      `Falha ao gerar análise financeira: ${error.message}`
    );
  }
}
```
