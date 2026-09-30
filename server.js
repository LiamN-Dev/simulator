const express = require('express');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// World State
let state = {
  isPaused: false,
  budget: 10000,
  totalRevenue: 0,
  totalExpenses: 0,
  stage: "Brainstorming", // "Brainstorming", "Building", "Testing", "Launched", "Bankrupt"
  stageIndex: 1, // 1 to 4
  idea: "None yet",
  completedTasks: [],
  currentTask: "Brainstorming pitch & vision",
  productStats: { unitsSold: 0, activeUsers: 0 },
  employees: [
    { id: 1, name: "Alex", role: "CEO (Delusional visionary)" },
    { id: 2, name: "Sam", role: "Dev (Caffeinated, pessimistic coder)" },
    { id: 3, name: "Maya", role: "Design (Perfectionist snob)" }
  ],
  logs: ["🏢 Office initialized. Employees starting shift..."],
  pendingInterventions: []
};

const STAGES = ["Brainstorming", "Building", "Testing", "Launched"];

async function simulationStep() {
  if (state.isPaused || !process.env.GROQ_API_KEY) return;
  if (state.budget <= 0) {
    state.stage = "Bankrupt";
    state.logs.unshift(`[${new Date().toLocaleTimeString()}] 💥 BANKRUPT! Out of cash.`);
    return;
  }

  const prompt = `
You are running a chaotic startup simulator.

CURRENT STATE:
- Bank Budget: $${state.budget}
- Current Stage: ${state.stage} (Stage ${state.stageIndex} of 4)
- Product Idea: "${state.idea}"
- Current Active Task: "${state.currentTask}"
- Roster: ${JSON.stringify(state.employees.map(e => `${e.name} (${e.role})`))}
${state.pendingInterventions.length ? `- GOD EVENTS: ${state.pendingInterventions.join("; ")}` : ""}

INSTRUCTIONS:
1. Complete the current task or advance it with a hilarious interaction.
2. Provide the name of the NEXT specific operational task (e.g. "Fix CSS flexbox bugs", "Pitch angel investor", "Set up Stripe payments").
3. Set "taskCompleted": true IF the current task was wrapped up this turn.
4. If in "Brainstorming" and task completed, lock in a funny startup idea name.
5. Provide specific dynamic expenses ($50-$1200) for concrete office items/servers/coffee.
6. Revenue > 0 ONLY if stage is "Launched".

Respond STRICTLY in valid JSON:
{
  "dialogue": "Alex: '...' | Sam: '...'",
  "actionHeadline": "Sam fixed the auth bug after 4 Red Bulls.",
  "expenseItem": "AWS Cloud Overages",
  "developmentExpenses": 450,
  "revenueGenerated": 0,
  "unitsSoldDelta": 0,
  "activeUsersDelta": 0,
  "ideaName": "Concrete Idea Name",
  "taskCompleted": true,
  "nextTask": "Setup payment gateway integration"
}
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    const res = JSON.parse(completion.choices[0].message.content);

    const revenue = state.stage === "Launched" ? Math.max(0, res.revenueGenerated || 0) : 0;
    const expenses = Math.max(0, res.developmentExpenses || 0);

    state.totalExpenses += expenses;
    state.totalRevenue += revenue;
    state.budget = Math.max(0, state.budget - expenses + revenue);

    if (res.unitsSoldDelta) state.productStats.unitsSold += res.unitsSoldDelta;
    if (res.activeUsersDelta) state.productStats.activeUsers = Math.max(0, state.productStats.activeUsers + res.activeUsersDelta);

    if (res.ideaName && res.ideaName !== "None yet") {
      state.idea = res.ideaName;
    }

    // Task & Milestone Progression
    if (res.taskCompleted) {
      state.completedTasks.unshift({
        task: state.currentTask,
        stage: state.stage,
        time: new Date().toLocaleTimeString()
      });
      if (state.completedTasks.length > 8) state.completedTasks.pop();

      // Stage Progression: Advance stage every 2 completed tasks
      const tasksInCurrentStage = state.completedTasks.filter(t => t.stage === state.stage).length;
      if (tasksInCurrentStage >= 2 && state.stageIndex < 4) {
        state.stageIndex++;
        state.stage = STAGES[state.stageIndex - 1];
        state.logs.unshift(`[🚀 MILESTONE] Team advanced to stage: ${state.stage.toUpperCase()}!`);
      }
    }

    if (res.nextTask) {
      state.currentTask = res.nextTask;
    }

    // Log Entry
    const time = new Date().toLocaleTimeString();
    const moneyTag = revenue > 0 ? ` 🟩 +$${revenue}` : ` 🟥 -$${expenses} (${res.expenseItem || 'dev cost'})`;
    
    const formattedLog = `
      <div style="margin-bottom: 8px;">
        <span style="color: #8b949e; font-size: 0.8rem;">[${time}]</span> 
        <strong style="color: #f0f6fc;">${res.actionHeadline || 'Office Action'}</strong>
        <span style="font-weight: bold;">${moneyTag}</span>
        <div style="background: #161b22; border-left: 3px solid #58a6ff; padding: 6px 10px; margin-top: 4px; border-radius: 4px; font-style: italic; color: #79c0ff;">
          "${res.dialogue ? res.dialogue.replace(/\|/g, '<br>💬 ') : '...'}"
        </div>
      </div>
    `;

    state.logs.unshift(formattedLog);
    if (state.logs.length > 30) state.logs.pop();
    state.pendingInterventions = [];

  } catch (err) {
    console.error("AI Step Error:", err.message);
  }
}

setInterval(simulationStep, 15000);

app.get('/api/state', (req, res) => res.json(state));

app.post('/api/admin/toggle-pause', (req, res) => {
  state.isPaused = !state.isPaused;
  state.logs.unshift(`[⚡ GOD MODE] Simulation ${state.isPaused ? 'PAUSED' : 'RESUMED'}`);
  res.json({ isPaused: state.isPaused });
});

app.post('/api/admin/add-cash', (req, res) => {
  const amount = req.body.amount || 5000;
  state.budget += amount;
  state.logs.unshift(`[⚡ GOD MODE] Injected $${amount} cash!`);
  res.json({ budget: state.budget });
});

app.post('/api/admin/hire', (req, res) => {
  const { name, role } = req.body;
  if (name && role) {
    state.employees.push({ id: Date.now(), name, role });
    state.pendingInterventions.push(`God hired ${name} (${role})`);
    state.logs.unshift(`[⚡ GOD MODE] Hired ${name} as ${role}!`);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Missing name or role" });
  }
});

app.post('/api/admin/command', (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: "No command provided" });
  state.pendingInterventions.push(command);
  state.logs.unshift(`[⚡ GOD EVENT] "${command}"`);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
