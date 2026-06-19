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
    if (
      error?.name === "PasswordException" ||
      error?.message?.toLowerCase().includes("password")
    ) {
      throw new Error("Senha do PDF incorreta ou não fornecida.");
    }
    throw new Error(`Falha ao ler o PDF: ${error.message}`);
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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
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
                  mesAno: { type: "STRING" },
                  transacoes: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        data: { type: "STRING" },
                        descricao: { type: "STRING" },
                        // CORREÇÃO 2: Valor explicitamente NUMBER para não
                        // haver ambiguidade de tipo na comparação de duplicatas
                        valor: { type: "NUMBER" },
                        tipo: { type: "STRING", enum: ["credito", "debito"] },
                        categoria: { type: "STRING" },
                        tags: { type: "STRING" },
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
              // CORREÇÃO 3: Prompt muito mais explícito sobre separação de períodos.
              // Exemplos concretos e regras reforçadas para o modelo não misturar meses.
              text: `
Você é um sistema especialista em análise financeira e conciliação bancária.

Abaixo está o texto extraído diretamente de um extrato bancário.

CONTEÚDO DO EXTRATO:
"""
${textoDoExtrato}
"""

## TAREFA PRINCIPAL
Extraia TODAS as transações financeiras presentes no texto acima.

## REGRAS OBRIGATÓRIAS DE AGRUPAMENTO POR PERÍODO

**REGRA 1 — SEPARAÇÃO OBRIGATÓRIA POR MÊS/ANO:**
Cada mês diferente DEVE ser um objeto separado no array "periodos".
NÃO agrupe transações de meses diferentes no mesmo objeto.

Exemplo CORRETO de saída quando há transações de jan/2026 e fev/2026:
{
  "periodos": [
    {
      "mesAno": "1/2026",
      "transacoes": [ ...apenas transações de janeiro de 2026... ]
    },
    {
      "mesAno": "2/2026",
      "transacoes": [ ...apenas transações de fevereiro de 2026... ]
    }
  ]
}

Exemplo ERRADO (NÃO FAÇA ISSO — mistura meses):
{
  "periodos": [
    {
      "mesAno": "1/2026-2/2026",
      "transacoes": [ ...transações de janeiro E fevereiro misturadas... ]
    }
  ]
}

**REGRA 2 — FORMATO DO CAMPO "mesAno":**
Use EXATAMENTE o formato "M/AAAA" sem zero à esquerda no mês.
- Janeiro de 2026 → "1/2026"  ✅
- Fevereiro de 2026 → "2/2026"  ✅
- Outubro de 2025 → "10/2025"  ✅
- "01/2026" ou "01-2026" → ERRADO ❌

Para identificar o mês de cada transação, use a data da própria transação (campo "data").

**REGRA 3 — CAMPO "data":**
Mantenha o formato original da data como aparece no extrato (ex: "15/01/2026" ou "2026-01-15").

**REGRA 4 — CAMPO "valor":**
Sempre um número puro sem símbolos. Ex: 150.00, não "R$ 150,00".

**REGRA 5 — CAMPO "categoria":**
Tipo de gasto: aluguel, luz, água, internet, supermercado, lazer, delivery, streaming, assinaturas, salário, transferência. Se não souber, use "outros".

**REGRA 6 — CAMPO "tags":**
Uma única palavra que resume a transação. Ex: "salário", "aluguel", "mercado", "netflix", "uber". Se não souber, use "outros".

**REGRA 7 — CAMPO "tipo":**
"credito" para entradas (recebimentos, depósitos, salário).
"debito" para saídas (pagamentos, compras, saques).
`,
            },
          ],
        },
      ],
    });

    const texto = response.text.trim();
    return JSON.parse(texto);
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