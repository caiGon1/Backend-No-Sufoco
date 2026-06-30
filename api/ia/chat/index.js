import { GoogleGenAI } from "@google/genai";

const key = process.env.GOOGLE_API_KEY;

const ai = new GoogleGenAI({
  apiKey: key,
});

const allowedOrigins = ["https://no-sufoco.vercel.app", "http://localhost:5173"];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Resposta rápida para o Preflight (OPTIONS)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

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
