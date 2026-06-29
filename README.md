# Backend-No-Sufoco

This repository contains the serverless backend for the "No Sufoco" personal finance application. Built on Vercel, it leverages Node.js, MongoDB, and Google's Gemini AI to provide robust financial data processing, user management, and automated stock market analysis.

## Core Features

*   **User Authentication**: Secure user registration and login using JWT and bcrypt for password hashing.
*   **Encrypted Data Storage**: Sensitive financial transaction data is encrypted at rest using AES-256-GCM to ensure user privacy.
*   **AI-Powered Bank Statement Analysis**: Users can upload password-protected PDF bank statements. The system extracts transaction data using `pdfjs-dist`, cleans it, and uses Google Gemini to intelligently parse, categorize, and structure the information.
*   **Intelligent Data Merging**: An advanced merging strategy prevents duplicate transaction entries when users upload multiple statements covering overlapping periods.
*   **Automated Stock Monitoring**: Users can select and monitor stocks. A daily cron job fetches market data from the Brapi API, uses Gemini AI to generate buy/sell recommendations based on technical indicators, and sends customized email alerts via Nodemailer.
*   **Serverless Architecture**: Deployed as a set of serverless functions on Vercel, ensuring scalability and efficiency.

## Technology Stack

*   **Platform**: Vercel (Serverless Functions, Cron Jobs)
*   **Database**: MongoDB
*   **AI Model**: Google Gemini (`@google/genai`)
*   **Backend**: Node.js
*   **Key Libraries**:
    *   `jsonwebtoken` & `bcrypt`: Authentication and Hashing
    *   `mongodb`: Database driver
    *   `nodemailer`: Email alerts
    *   `pdfjs-dist`: PDF text extraction
    *   `formidable`: File uploads
    *   `crypto`: Data encryption/decryption

## API Endpoints

All endpoints require a `Bearer <token>` in the `Authorization` header, except for `/api/user/cadastro` and `/api/user/login`.

### User Management

*   `POST /api/user/cadastro`
    *   Registers a new user.
    *   **Body**: `{ "nome": "User Name", "email": "user@email.com", "senha": "password", "banco": "Bank Name" }`
    *   **Response**: A JWT and the new user's ID.

*   `POST /api/user/login`
    *   Authenticates a user.
    *   **Body**: `{ "email": "user@email.com", "senha": "password" }`
    *   **Response**: A JWT and user details.

*   `GET /api/user/[id]`
    *   Retrieves a specific user's profile and all their decrypted financial transactions.

*   `PATCH /api/user/[id]`
    *   Updates user information (e.g., name, email).

*   `DELETE /api/user/[id]`
    *   Deletes a user and all associated data.

### Banking & Financial Analysis

*   `POST /api/banking/[id]`
    *   Uploads a PDF bank statement for processing. The request must be `multipart/form-data`.
    *   **Form Fields**: `arquivo` (the PDF file), `senha` (optional PDF password).
    *   **Logic**: Extracts text, sends to Gemini AI for parsing, and intelligently merges the new transactions with existing user data.
    *   **Response**: Success message and the parsed data from the uploaded file.

*   `GET /api/banking/[id]`
    *   Retrieves an AI-generated financial analysis based on the user's complete transaction history.

### Stock Market Actions

*   `GET /api/acoes/favoritos`
    *   Fetches the user's list of favorite stocks and their current monitoring settings.

*   `POST /api/acoes/favoritos`
    *   Adds new stocks to a user's monitoring list.
    *   **Body**: `{ "ativosSelecionados": ["PETR4", "VALE3"] }`

*   `DELETE /api/acoes/favoritos`
    *   Removes stocks from the user's monitoring list.
    *   **Body**: `{ "ativosParaDeletar": ["PETR4"] }`

*   `PUT /api/acoes/favoritos`
    *   Updates the monitoring status for either the entire stock portfolio or individual stocks.
    *   **Body**: `{ "monitoraGlobal": true, "alteracoesAtivos": { "VALE3": false } }`

### Internal Endpoints

*   `GET /api/acoes/monitoramento`
    *   This endpoint is triggered by a Vercel Cron Job (`15 21 * * 1-5`).
    *   It executes the stock analysis routine and dispatches email alerts. Access is restricted by a `CRON_SECRET` environment variable.
