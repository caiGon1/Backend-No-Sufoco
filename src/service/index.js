import { GoogleGenAI } from "@google/genai";
import pdf from "pdf-parse"; // Substituído o pdfjs-dist por pdf-parse

const key = process.env.GOOGLE_API_KEY;
const ai = new GoogleGenAI({ apiKey: key });

// Função interna atualizada e compatível com a Vercel
async function extrairTextoDePDF(pdfBuffer, senha) {
  // Configura as opções do pdf-parse. Se houver senha, passamos no objeto.
  const options = {
    password: senha || undefined
  };

  // O pdf-parse processa o buffer diretamente de forma nativa no Node.js
  const data = await pdf(pdfBuffer, options);
  
  return data.text; // Retorna o texto bruto extraído do PDF
}

export async function extrairInformacoes(pdfBuffer, senha) {
  let textoDoExtrato = "";

  try {
    // 1. Descriptografa o PDF usando a senha e extrai o conteúdo textual usando o pdf-parse
    textoDoExtrato = await extrairTextoDePDF(pdfBuffer, senha);
  } catch (error) {
    // O pdf-parse costuma jogar um erro com 'password' na mensagem quando a senha falha
    if (error.message && error.message.toLowerCase().includes('password')) {
      throw new Error("Senha do PDF incorreta ou não fornecida.");
    }
    throw new Error(`Falha ao ler o PDF: ${error.message}`);
  }

  // 2. Passa o texto aberto e legível diretamente para o Gemini 2.5 Flash
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    config: {
      responseMimeType: "application/json",
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `
Você é um sistema especialista em análise financeira.
Abaixo está o texto extraído diretamente de um extrato bancário protegido.

CONTEÚDO DO EXTRATO:
\"\"\"
${textoDoExtrato}
\"\"\"

Extraia todas as transações do extrato bancário fornecido acima.

Retorne SOMENTE JSON válido.

Formato:
{
  "transacoes": [
    {
      "data": "DD/MM/YYYY",
      "descricao": "texto",
      "valor": 0.00,
      "tipo": "credito ou debito",
      "categoria": "pix, transferencia, investimento, boleto, cartao"
    }
  ]
}
            `,
          },
        ],
      },
    ],
  });

  const texto = response.text;
  return JSON.parse(texto);
}

export async function analiseDeTransacoes(transacoes) {
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
CONTEÚDO DAS TRANSAÇÕES:
\"\"\"
${JSON.stringify(transacoes, null, 2)}
\"\"\"
Analise as transações acima e forneça um resumo financeiro curto, se necessário, resalte coisas que podem melhorar. Não formate o texto e que seja simples e claro para que todos possam entender.
            `,
          },
        ],
      },
    ],
  });
  return response.text;
} 