import { GoogleGenAI } from "@google/genai";

const key = process.env.GOOGLE_API_KEY;

const ai = new GoogleGenAI({ apiKey: key });

export async function main() {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents:"Write 'If you can read this, it works!'",
  });

  return response.text;
}