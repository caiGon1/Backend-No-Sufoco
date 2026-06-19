import { GoogleGenAI } from "@google/genai";

const key = process.env.GOOGLE_API_KEY;

const ai = new GoogleGenAI({
  apiKey: key,
});

// ======================================================
// GERAÇÃO DINÂMICA DO PROMPT (OTIMIZADO PARA CATEGORIZAÇÃO)
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
Compras parceladas detectadas no extrato DEVEM ser agrupadas neste período principal, mesmo que a data textual da compra seja antiga.

## TAREFA PRINCIPAL
Extraia TODAS as transações financeiras presentes no texto acima e classifique-as com precisão.

## REGRAS DE CATEGORIZAÇÃO (CRÍTICO)

Você deve usar o seu conhecimento de mercado para inferir a categoria correta com base no nome do estabelecimento (comerciante). NÃO classifique tudo como "outros" por preciosismo ou preguiça.

Guia de correspondência para ajudar sua inferência de contexto:
- "supermercado": Carrefour, Pão de Açúcar, Extra, Assaí, Atacadão, Zona Sul, Mundial, mercado de bairro, mercearia, hortifruti, sacolão, padaria.
- "delivery": iFood, Rappi, Zé Delivery, Uber Eats.
- "lazer": Uber, 99Pop, postos de combustível (Shell, Ipiranga, BR), cinemas, shows, eventos, bares, restaurantes, vestuário, lojas de shopping, jogos.
- "luz": Enel, CPFL, Light, Coelba, Cemig.
- "água": Sabesp, Sanepar, Cedae, Copasa.
- "internet": Claro, Vivo, Tim, Net, Oi, provedores locais de banda larga.
- "streaming" / "assinaturas": Netflix, Spotify, Amazon Prime, Disney+, Globoplay, Deezer, Apple, Google, Crunchyroll, assinaturas de jornais/softwares.

SÓ use a categoria "outros" se o nome do estabelecimento for um código estritamente incompreensível ou se for absolutamente impossível determinar o ramo do comércio após tentar correlacionar o nome com marcas conhecidas.

## REGRAS GERAIS

REGRA 1: Cada mês diferente DEVE ser um objeto separado no array "periodos".
REGRA 2: O campo "mesAno" deve usar EXATAMENTE "M/AAAA" (Ex: 1/2026, 11/2025).
REGRA 3: Mantenha o campo "data" exatamente como aparece no extrato.
REGRA 4: O campo "valor" deve ser número puro sem símbolo monetário.
REGRA 5: Categorias possíveis (USE APENAS ESTAS): aluguel, luz, água, internet, supermercado, lazer, delivery, streaming, assinaturas, salário, transferência, outros.
REGRA 6: O campo "tags" deve conter apenas uma palavra que resuma o tipo de despesa (ex: "transporte", "comida", "moradia", "combustivel", "vestuario").
REGRA 7: Use "credito" ou "debito".

REGRA 8: COMPRAS PARCELADAS DEVEM USAR O PERÍODO DA FATURA.
Extratos frequentemente mostram a data original da compra e a parcela atual (Ex: 15/01/2026 MAGAZINE LUIZA 03/10). Quando identificar padrões como 1/10, PARC 4/6 ou PX 2/5:
1. Use o PERÍODO PRINCIPAL DA FATURA para definir o "mesAno".
2. NÃO use a data original da compra para agrupar parcelas em blocos de meses antigos.
3. Mantenha a data original da linha exatamente como aparece.

REGRA 9: Nunca invente valores, datas, parcelas, comerciantes ou categorias fora do padrão.

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

  console.log("===== [DEBUG] PERÍODO PRINCIPAL DETECTADO =====");
  console.log(periodoPrincipal);
  console.log("===============================================");

  console.log("===== [DEBUG] TEXTO EXTRAÍDO DO PDF (primeiros 500 chars) =====");
  console.log(textoDoExtrato.substring(0, 500));
  console.log("================================================================");

  // GERA O PROMPT COM O DICIONÁRIO DE CORRESPONDÊNCIAS E REGRAS INJETADAS
  const promptDinamico = gerarPrompt(textoDoExtrato, periodoPrincipal);

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
      const parsed = JSON.parse(texto);

      console.log("===== [DEBUG] RESPOSTA DA IA — PERÍODOS ENCONTRADOS =====");
      parsed.periodos?.forEach((p, i) => {
        console.log(
          `Período ${i + 1}: mesAno="${p.mesAno}" | ${
            p.transacoes?.length ?? 0
          } transações`
        );
      });
      console.log("==========================================================");

      return parsed;
    } catch (parseError) {
      console.error("===== [DEBUG] FALHA AO PARSEAR JSON DA IA =====");
      console.error("Texto bruto recebido:", texto.substring(0, 300));
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