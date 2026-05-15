import { GoogleGenAI } from "@google/genai";

function iaAnalise() {
  // Inicializa com sua chave gratuita
  const key = process.env.ai; // Certifique-se de que a variável de ambiente 'ai' esteja definida com sua chave Gemini gratuita
  const ai = new GoogleGenAI({ apiKey: key });

  async function extrairTextoPuro() {
    // Simulando o texto que você copiou do extrato bancário
    const textoDoExtrato = `
    02/05/2026   COMPRA CARTAO - Supermercado BH   -R$ 150,20
    05/05/2026   PIX RECEBIDO - Joao Silva          +R$ 500,00
    08/05/2026   DOC ELETRONICO - Netflix          -R$ 55,90
  `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        `Organize o seguinte extrato bruto em uma tabela de texto limpa (.txt). 
      Use o formato de colunas: DATA | DESCRIÇÃO | VALOR.
      Não adicione nenhuma introdução, notas ou explicações, apenas o texto formatado.
      
      Extrato:
      ${textoDoExtrato}`,
      ],
    });

    // Exibe a resposta em texto puro no console
    console.log(response.text);
  }

  extrairTextoPuro();
}
