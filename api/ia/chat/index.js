import { GoogleGenAI } from "@google/genai";

const key = process.env.GOOGLE_API_KEY;
const ai = new GoogleGenAI({
  apiKey: key,
});

// Helper simples para os headers de CORS nativos
const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:5173", // Ou "*" se quiser liberar geral
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// 1. Responde à requisição obrigatória de Preflight (OPTIONS) do navegador
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(req) {
  try {
    const { message } = await req.json();
    if (!message) {
      return new Response("Mensagem não fornecida.", { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    // 2. Chama a API do Gemini gerando o stream real diretamente
    const responseStream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash", // Dica: mudei para o 2.5-flash padrão que é o modelo atual e estável
      contents: message,
      config: {
        systemInstruction: `Você é um especialista financeiro focado em ações e banking. 
As suas regras são:
1. Responda de forma extremamente profissional, curta e direta.
2. Nunca dê conselhos de compra ou venda (diga que não pode fazer recomendações).
3. Use termos técnicos do mercado financeiro quando necessário.
4. Se o usuário perguntar algo fora de finanças, responda educadamente que seu foco é apenas o mercado financeiro.`,
      },
    });

    // 3. Monta o ReadableStream para o envio em pedaços
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder(); // Corrigido o erro de digitação 'enconder'
        try {
          for await (const chunk of responseStream) {
            if (chunk.text) {
              controller.enqueue(encoder.encode(chunk.text));
            }
          }
        } catch (error) {
          controller.error(error);
        } finally {
          controller.close();
        }
      },
    });

    // 4. Retorna a resposta combinando os headers de Stream e os headers de CORS
    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });

  } catch (error) {
    console.error("Error in POST /api/ia/chat:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
}