import { GoogleGenAI } from "@google/genai";

// CORREÇÃO: O import estático do pdfjsLib foi removido daqui para evitar o erro ERR_REQUIRE_ESM

const key = process.env.GOOGLE_API_KEY;

const ai = new GoogleGenAI({
  apiKey: key,
});

// ======================================================
// EXTRAÇÃO DE TEXTO DO PDF
// ======================================================

async function extrairTextoDePDF(pdfBuffer, senha) {
  try {
    // CORREÇÃO: Importação dinâmica do pacote ESM para rodar perfeitamente na Vercel
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

    // Carrega o PDF protegido por senha
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      password: senha || "",
    });

    const pdf = await loadingTask.promise;

    let textoCompleto = "";

    // Percorre todas as páginas
    for (let paginaAtual = 1; paginaAtual <= pdf.numPages; paginaAtual++) {
      const page = await pdf.getPage(paginaAtual);

      const textContent = await page.getTextContent();

      // Extrai os textos da página
      const textosDaPagina = textContent.items.map((item) => item.str);

      textoCompleto += textosDaPagina.join(" ") + "\n";
    }

    // Remove espaços duplicados
    textoCompleto = textoCompleto.replace(/\s+/g, " ").trim();

    if (!textoCompleto || textoCompleto.length < 10) {
      throw new Error("Não foi possível extrair conteúdo textual do PDF.");
    }

    return textoCompleto;
  } catch (error) {
    console.error("ERRO PDF:", error);

    // Senha incorreta
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
    // Extrai texto do PDF protegido
    textoDoExtrato = await extrairTextoDePDF(pdfBuffer, senha);
  } catch (error) {
    throw new Error(error.message);
  }

  try {
    // Envia texto para o Gemini
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
                  mes: { type: "NUMBER" },
                  ano: { type: "NUMBER" },

                  transacoes: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        data: { type: "DATE" },
                        descricao: { type: "STRING" },
                        valor: { type: "NUMBER" },
                        tipo: { type: "STRING", enum: ["credito", "debito"] },
                        categoria: { type: "STRING" },
                      },
                      required: [
                        "data",
                        "descricao",
                        "valor",
                        "tipo",
                        "categoria",
                      ],
                    },
                  },
                },
                required: ["mes", "ano", "transacoes"],
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
Você é um sistema especialista em análise financeira.

Abaixo está o texto extraído diretamente de um extrato bancário.

CONTEÚDO DO EXTRATO:
"""
${textoDoExtrato}
"""

Extraia todas as transações presentes no extrato.

IMPORTANTE:
- Retorne um JSON válido contendo o objeto principal com o array de transações.
- Coloque o mês e ano vigente como valores numéricos. Exemplo: "mes": 1, "ano": 2026.
- Coloque em "categoria" o tipo de gasto que é, como aluguel, luz, água, internet, supermercado, lazer, delivery, cinemas, assinaturas, e streaming. Pesquise o que significa caso não saiba, porém não invente.
- Coloque em "data" como dd/mm/aaaa.
- Caso não identifique o que o estabelecimento é, não invente.
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
