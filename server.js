import express from 'express';
import mongoose from 'mongoose';
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

// Chat schema mapped perfectly to Ollama's expected array structure
const SessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  history: [
    {
      role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
      content: { type: String, required: true }
    }
  ],
  updatedAt: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', SessionSchema);

// Target model name for Ollama Cloud
const MODEL_NAME = 'gemma4:3b'; 

// ==========================================
// 2. HELPER FUNCTION: CALL OLLAMA CLOUD API
// ==========================================
async function callOllamaCloud(messages) {
  const response = await fetch('https://ollama.com/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OLLAMA_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: messages,
      stream: false // Turn off streaming for easier batch processing
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama Cloud API Error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.message.content; // Extracts the text response
}

// ==========================================
// 3. BACKGROUND AI AGENT ENGINE (The Worker)
// ==========================================
async function runAgentWorkflow(sessionId) {
  try {
    console.log(`Starting Ollama Cloud agent workflow for session: ${sessionId}`);

    // Fetch existing history or seed a pristine slate context if new
    let sessionRecord = await Session.findOne({ sessionId });
    if (!sessionRecord) {
      sessionRecord = new Session({
        sessionId,
        history: [
          { role: 'system', content: 'You are an automated backend task runner. Keep your technical responses precise.' }
        ]
      });
      await sessionRecord.save();
    }

    // --- PROMPT LOOP 1 ---
    const initialPrompt = "Task Phase 1: Review our data log status and suggest a random synthetic maintenance code command.";
    sessionRecord.history.push({ role: 'user', content: initialPrompt });

    // Call Ollama cloud using our complete history array
    let aiOutput1 = await callOllamaCloud(sessionRecord.history);
    console.log(`[Ollama Cloud Response 1]: ${aiOutput1}`);
    
    // Save response to history (Ollama roles use 'assistant' instead of 'model')
    sessionRecord.history.push({ role: 'assistant', content: aiOutput1 });

    // --- PROMPT LOOP 2 (Sequential chain using context) ---
    const secondPrompt = `Task Phase 2: Take your previous response "${aiOutput1}" and wrap it inside a clean JSON schema format like { status: "processed", code: "YOUR_CODE" }. Return ONLY raw JSON text.`;
    sessionRecord.history.push({ role: 'user', content: secondPrompt });

    let aiOutput2 = await callOllamaCloud(sessionRecord.history);
    console.log(`[Ollama Cloud Response 2]: ${aiOutput2}`);
    
    sessionRecord.history.push({ role: 'assistant', content: aiOutput2 });

    // Commit final history state to MongoDB Atlas
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

app.get('/health', (req, res) => {
  res.status(200).send('Server is alive.');
});

app.post('/trigger-agent', (req, res) => {
  const sessionId = req.body.sessionId || "automated_daily_routine";

  // Instantly free up cron-job.org / manual cURL triggers
  res.status(200).json({
    status: "accepted",
    message: "Ollama Cloud workflow triggered in background process."
  });

  // Execute the async chain
  runAgentWorkflow(sessionId);
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});