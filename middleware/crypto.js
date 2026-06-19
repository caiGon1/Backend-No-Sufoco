import crypto from "crypto";

const SECRET_KEY = process.env.ENCRYPTION_KEY; 
const ALGORITHM = "aes-256-gcm";

export function criptografar(valorOriginal) {
  // Se for nulo ou undefined, retorna o próprio valor
  if (valorOriginal === undefined || valorOriginal === null) return valorOriginal;

  // CORREÇÃO: Se for número, transforma em string temporariamente para poder criptografar
  let texto = typeof valorOriginal === "number" ? valorOriginal.toString() : valorOriginal;

  if (typeof texto !== "string") return texto;

  // Se já parecer criptografado, evita criptografia dupla
  if (texto.includes(":")) {
    const partes = texto.split(":");
    if (partes.length === 3) return texto; 
  }

  if (!SECRET_KEY) {
    console.error("ERRO CRÍTICO: ENCRYPTION_KEY não está definida nas variáveis de ambiente!");
    return valorOriginal; 
  }

  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(SECRET_KEY, "utf-8"), iv);

    let encrypted = cipher.update(texto, "utf-8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag().toString("hex");

    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error("Falha ao criptografar dado:", err);
    return valorOriginal;
  }
}

export function descriptografar(textoCriptografado) {
  if (!textoCriptografado || typeof textoCriptografado !== "string") return textoCriptografado;

  // Se o texto não tiver os dois pontos separadores, é um dado não criptografado antigo.
  if (!textoCriptografado.includes(":")) {
    return textoCriptografado; 
  }

  const partes = textoCriptografado.split(":");
  if (partes.length !== 3) {
    return textoCriptografado; 
  }

  if (!SECRET_KEY) {
    console.error("ERRO CRÍTICO: ENCRYPTION_KEY está faltando no servidor.");
    return textoCriptografado;
  }

  try {
    const [ivHex, authTagHex, encryptedText] = partes;
    
    if (!ivHex || !authTagHex || !encryptedText) {
      return textoCriptografado;
    }

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(SECRET_KEY, "utf-8"), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, "hex", "utf-8");
    decrypted += decipher.final("utf-8");

    // CORREÇÃO: Se o resultado descriptografado for um número num formato válido, converte de volta para Number
    if (!isNaN(decrypted) && decrypted.trim() !== "") {
      return Number(decrypted);
    }

    return decrypted;
  } catch (error) {
    console.error("Erro ao descriptografar dado:", error.message);
    return textoCriptografado; 
  }
}