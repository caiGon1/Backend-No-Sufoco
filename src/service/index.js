import { GoogleGenAI } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const key = process.env.GOOGLE_API_KEY;
const ai = new GoogleGenAI({ apiKey: key });

// Função interna para extrair o texto de um PDF protegido
async function extrairTextoDePDF(pdfBuffer, senha) {
  const data = new Uint8Array(pdfBuffer);
  
  // Configura os parâmetros de carregamento incluindo a senha se ela existir
  const loadingTask = pdfjsLib.getDocument({
    data: data,
    password: senha || undefined,
    useWorkerFetch: false,
    isEvalSupported: false
  });

  const pdf = await loadingTask.promise;
  let textoCompleto = "";

  // Percorre todas as páginas extraindo apenas o texto puro
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(" ");
    textoCompleto += `--- PÁGINA ${i} ---\n${pageText}\n`;
  }

  return textoCompleto;
}

export async function extrairInformacoes(pdfBuffer, senha) {
  let textoDoExtrato = "";

  try {
    // 1. Descriptografa o PDF usando a senha e extrai o conteúdo textual
    textoDoExtrato = await extrairTextoDePDF(pdfBuffer, senha);
  } catch (error) {
    if (error.name === 'PasswordException') {
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