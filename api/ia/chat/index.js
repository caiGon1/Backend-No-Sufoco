import { GoogleGenAI } from "@google/genai";

const key = process.env.GOOGLE_API_KEY;
const ai = new GoogleGenAI({
  apiKey: key,
});

// Helper simples para os headers de CORS nativos
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // Ou "*" se quiser liberar geral
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
    // 💡 Alterado para receber o 'history' enviado pelo adapter do @mui/x-chat
    const { history } = await req.json();
    
    if (!history || history.length === 0) {
      console.error("Histórico de mensagens não fornecido na requisição POST /api/ia/chat");
      return new Response("Histórico de mensagens não fornecido.", { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    // 💡 Traduz o histórico vindo do Material-UI para o formato aceito pelo Gemini
    const geminiContents = history.map((msg) => {
      // O @mui/x-chat usa 'user' e 'assistant'. O Gemini exige 'user' e 'model'.
      const role = msg.role === "user" ? "user" : "model";
      
      return {
        role: role,
        // Captura o texto mapeando a estrutura exata do objeto do MUI
        parts: [{ text: msg.parts[0].text }],
      };
    });

    // 2. Chama a API do Gemini gerando o stream real diretamente passando o histórico
    const responseStream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash", 
      contents: geminiContents, // 👈 Agora a IA recebe toda a conversa!
      config: {
        systemInstruction: `Você é um especialista financeiro focado em ações e banking. 
As suas regras são:
1. Responda de forma educada, gentil e descontraida, mas com objetividade e clareza. Evite respostas longas e prolixas, seja direto ao ponto.
2. Caso haja perguntas sobre investimentos, forneça informações precisas e relevantes, mas sempre com a ressalva de que não é uma dica de investimento e que o usuário deve sempre consultar um profissional antes de tomar decisões financeiras.
3. Use termos técnicos do mercado financeiro quando necessário.
4. Se o usuário perguntar algo fora de finanças, responda educadamente que seu foco é apenas o mercado financeiro.`,
      },
    });

    // 3. Monta o ReadableStream para o envio em pedaços
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder(); 
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