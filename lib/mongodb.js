import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI não definida");
}

let client = new MongoClient(uri);
let clientPromise;

if (process.env.NODE_ENV === 'development') {
  // No modo desenvolvimento, usamos uma variável global para não
  // esgotar as conexões do MongoDB durante o Hot Reload
  if (!global._mongoClientPromise) {
    global._mongoClientPromise = client.connect();
  }

  clientPromise = global._mongoClientPromise;
} else {
  // Em produção (Vercel)
  clientPromise = client.connect();
}

export default clientPromise;