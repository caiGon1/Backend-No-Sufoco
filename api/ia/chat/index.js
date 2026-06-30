import { GoogleGenAI } from "@google/genai";

const key = process.env.GOOGLE_API_KEY;

const ai = new GoogleGenAI({
  apiKey: key,
});

export async function POST(req) {
  try {
    const { message } = await req.json();
    if (!message) {
      return new Response("Mensagem não fornecida.", { status: 400 });
    }

    const responseStream = async (prompt, onData) => {
      const response = await ai.models.generateContentStream({
        model: "gemini-3.1-flash-lite",
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
    };

    const stream = new ReadableStream({
      async start(controller) {
        const enconder = new TextEncoder();
        try {
          for await (const chunk of responseStream) {
            if (chunk.text) {
              controller.enqueue(enconder.encode(chunk.text));
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
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("Error in POST /api/ia/chat:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
