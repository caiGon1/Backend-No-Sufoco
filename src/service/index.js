import { GoogleGenerativeAI } from "@google/generative-ai"; // Verifique se o import está assim

export default async function gerarRespostaIA() {
  const key = process.env.ai;

  // O nome da classe no pacote oficial é GoogleGenerativeAI
  const genAI = new GoogleGenerativeAI(key);

  const textoDoExtrato = `
  02/05/2026   COMPRA CARTAO - Supermercado BH   -R$ 150,20
  05/05/2026   PIX RECEBIDO - Joao Silva         +R$ 500,00
  08/05/2026   DOC ELETRONICO - Netflix          -R$ 55,90
  `;

  try {
    // 1. Mudamos para o modelo estável: gemini-1.5-flash
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      Organize o seguinte extrato bruto em uma tabela de texto limpa (.txt). 
      Use o formato: DATA | DESCRIÇÃO | VALOR
      Não adicione introduções nem explicações.
      Extrato:
      ${textoDoExtrato}
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // 2. O texto é uma função: .text()
    return response.text();

  } catch (erro) {
    console.error("Erro na IA:", erro);
    throw new Error("Erro ao processar IA: " + erro.message);
  }
}