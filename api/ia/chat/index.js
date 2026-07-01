import { GoogleGenAI } from "@google/genai";

const key = process.env.GOOGLE_API_KEY;
const ai = new GoogleGenAI({
  apiKey: key,
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(req) {
  try {
    const { history } = await req.json();
    
    if (!history || history.length === 0) {
      console.error("Histórico de mensagens não fornecido na requisição POST /api/ia/chat");
      return new Response("Histórico de mensagens não fornecido.", { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    const geminiContents = history.map((msg) => {
      const role = msg.role === "user" ? "user" : "model";
      
      return {
        role: role,
        parts: [{ text: msg.parts[0].text }],
      };
    });


    const responseStream = await ai.models.generateContentStream({
      model: "gemini-3.1-flash-lite", 
      contents: geminiContents, 
      config: {
        systemInstruction: `Você é um especialista financeiro focado em ações e banking. 
As suas regras são:
1. Responda de forma educada, gentil e descontraida, mas com objetividade e clareza. Evite respostas longas e prolixas, seja direto ao ponto.
2. Caso haja perguntas sobre investimentos, forneça informações precisas e relevantes, mas sempre com a ressalva de que não é uma dica de investimento e que o usuário deve sempre consultar um profissional antes de tomar decisões financeiras.
3. Use termos técnicos do mercado financeiro quando necessário.
4. Se o usuário perguntar algo fora de finanças, responda educadamente que seu foco é apenas o mercado financeiro.`,
      },
    });


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