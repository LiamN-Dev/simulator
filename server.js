const express = require('express');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

let state = {
  budget: 10000,
  logs: ["Office initialized. Employees starting shift..."],
  employees: [
    { name: "Alex (CEO)", role: "Visionary, overconfident" },
    { name: "Dev Sam", role: "Stressed coder, pragmatic" },
    { name: "Maya (Design)", role: "Creative, opinionated" }
  ]
};

async function simulationStep() {
  if (!process.env.GROQ_API_KEY) return;
  const prompt = `
    You are running a startup office simulation.
    Current Budget: $${state.budget}
    Employees: ${JSON.stringify(state.employees)}

    Generate 1 funny or dramatic interaction/decision between these employees.
    Keep it short (1-2 sentences). Return raw text only.
  `;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }]
    });

    const event = completion.choices[0].message.content;
    state.logs.unshift(`[${new Date().toLocaleTimeString()}] ${event}`);
    if (state.logs.length > 20) state.logs.pop();
  } catch (err) {
    console.error("AI Error:", err.message);
  }
}

// Tick loop every 20 seconds
setInterval(simulationStep, 20000);

app.get('/api/state', (req, res) => res.json(state));

app.post('/api/admin/event', (req, res) => {
  const { eventMessage } = req.body;
  if (eventMessage) {
    state.logs.unshift(`[⚡ GOD MODE] ${eventMessage}`);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Missing event message" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
