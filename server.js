import express from 'express';
import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ==========================================
// 1. MONGODB CONFIGURATION & SCHEMAS
// ==========================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => console.error('MongoDB connection error:', err));

// Schema to store the back-and-forth session history
const SessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  history: [
    {
      role: { type: String, enum: ['user', 'model'], required: true },
      parts: [{ text: { type: String, required: true } }]
    }
  ],
  updatedAt: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', SessionSchema);

// ==========================================
// 2. GEMINI API INITIALIZATION
// ==========================================
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = 'gemini-2.5-flash';

// ==========================================
// 3. BACKGROUND AI AGENT ENGINE (The Worker)
// ==========================================
async function runAgentWorkflow(sessionId) {
  try {
    console.log(`Starting agent workflow for session: ${sessionId}`);

    // Fetch existing history or create a baseline context if new
    let sessionRecord = await Session.findOne({ sessionId });
    if (!sessionRecord) {
      sessionRecord = new Session({
        sessionId,
        history: [
          { role: 'user', parts: [{ text: 'Hello. Initialize your systems for our automated task routines.' }] },
          { role: 'model', parts: [{ text: 'Systems initialized. I am ready to process your sequential data tasks.' }] }
        ]
      });
      await sessionRecord.save();
    }

    // --- PROMPT LOOP 1 ---
    const initialPrompt = "Task Phase 1: Review our data log status and suggest a random synthetic maintenance code command.";
    
    // Add current user prompt to history object
    sessionRecord.history.push({ role: 'user', parts: [{ text: initialPrompt }] });

    let response1 = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: sessionRecord.history // Pass the whole array to maintain context
    });

    let aiOutput1 = response1.text;
    console.log(`[Gemini Response 1]: ${aiOutput1}`);
    
    // Save AI response to history
    sessionRecord.history.push({ role: 'model', parts: [{ text: aiOutput1 }] });

    // --- PROMPT LOOP 2 (Sequential processing using context) ---
    const secondPrompt = `Task Phase 2: Take your previous response "${aiOutput1}" and wrap it inside a clean JSON schema format like { status: "processed", code: "YOUR_CODE" }. Return only the valid JSON.`;
    
    sessionRecord.history.push({ role: 'user', parts: [{ text: secondPrompt }] });

    let response2 = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: sessionRecord.history
    });

    let aiOutput2 = response2.text;
    console.log(`[Gemini Response 2]: ${aiOutput2}`);
    
    sessionRecord.history.push({ role: 'model', parts: [{ text: aiOutput2 }] });

    // Save final state back to MongoDB
    sessionRecord.updatedAt = new Date();
    await sessionRecord.save();
    
    console.log(`Agent workflow successfully completed and history updated for ${sessionId}`);

  } catch (error) {
    console.error('Error executing background agent workflow:', error);
  }
}

// ==========================================
// 4. EXPRESS ROUTES
// ==========================================

// Health check endpoint for Render monitoring
app.get('/health', (req, res) => {
  res.status(200).send('Server is alive.');
});

// Endpoint triggered by Cron-job.org
app.post('/trigger-agent', (req, res) => {
  // Use a hardcoded session ID or pass one dynamically through cron JSON payload
  const sessionId = req.body.sessionId || "automated_daily_routine";

  // CRITICAL: Immediately send status 200 back to Cron-job.org 
  // This keeps the connection under 1-2 seconds, avoiding a 30-second timeout.
  res.status(200).json({
    status: "accepted",
    message: "Agent workflow triggered in background process."
  });

  // Run the long sequential tasks asynchronously in the background loop
  runAgentWorkflow(sessionId);
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});