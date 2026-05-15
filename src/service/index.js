import { GoogleGenAI } from "@google/genai";

export default async function iaAnalise() {

  const key = process.env.ai;

  const ai = new GoogleGenAI({
    apiKey: key
  });

  const textoDoExtrato = `
  02/05/2026   COMPRA CARTAO - Supermercado BH   -R$ 150,20
  05/05/2026   PIX RECEBIDO - Joao Silva         +R$ 500,00
  08/05/2026   DOC ELETRONICO - Netflix          -R$ 55,90
  `;

  try {

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `
      Organize o seguinte extrato bruto em uma tabela de texto limpa (.txt). 

      Use o formato:
      DATA | DESCRIÇÃO | VALOR

      Não adicione introduções nem explicações.

      Extrato:
      ${textoDoExtrato}
      `,
    });

    return response.text;

  } catch (erro) {

    console.error(erro);

    throw new Error("Erro ao processar IA");
  }
}