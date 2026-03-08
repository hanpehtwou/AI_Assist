const express = require("express");
const axios = require("axios");
const https = require("https");
const fs = require("fs").promises;
const path = require("path");
const compression = require("compression");
const session = require("express-session");

const app = express();
const PORT = 3000; // Updated Port
const STORAGE_FILE = path.join(__dirname, "storage.json");

// ================= AUTH CONFIG =================
const AUTH_USER = "hanpeh2u@gmail.com";
const AUTH_PASS = "Zamri800629!";

// ================= CONFIGURATION =================
const API_KEY = "sk-beca533e170c4516a9dab3011e1f5aec";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

const axiosInstance = axios.create({
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
    timeout: 60000
});

app.use(compression());
app.use(express.json({ limit: "50mb" }));
app.use(session({
    secret: 'grayscale-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// ================= MIDDLEWARE =================
const checkAuth = (req, res, next) => {
    if (req.session.loggedIn) {
        next();
    } else {
        res.status(401).json({ error: "UNAUTHORIZED" });
    }
};

// ================= DATABASE UTILS =================
async function loadDB() {
    try {
        const data = await fs.readFile(STORAGE_FILE, "utf8");
        return JSON.parse(data);
    } catch {
        const initial = { projects: [] };
        await fs.writeFile(STORAGE_FILE, JSON.stringify(initial));
        return initial;
    }
}

async function saveDB(data) {
    await fs.writeFile(STORAGE_FILE, JSON.stringify(data, null, 2));
}

// ================= AUTH ROUTES =================
app.post("/login", (req, res) => {
    const { email, password } = req.body;
    if (email === AUTH_USER && password === AUTH_PASS) {
        req.session.loggedIn = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: "INVALID_CREDENTIALS" });
    }
});

app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

// ================= PROTECTED API ENDPOINTS =================
app.get("/api/projects", checkAuth, async (req, res) => {
    const db = await loadDB();
    res.json(db.projects.map(p => ({ id: p.id, name: p.name })));
});

app.get("/api/projects/:id", checkAuth, async (req, res) => {
    const db = await loadDB();
    const project = db.projects.find(p => p.id === req.params.id);
    res.json(project || { history: [] });
});

app.post("/api/projects", checkAuth, async (req, res) => {
    const { name } = req.body;
    const db = await loadDB();
    const newProject = { id: "ID_" + Date.now(), name: name.toUpperCase(), history: [] };
    db.projects.push(newProject);
    await saveDB(db);
    res.json(newProject);
});

app.delete("/api/projects/:id", checkAuth, async (req, res) => {
    const db = await loadDB();
    db.projects = db.projects.filter(p => p.id !== req.params.id);
    await saveDB(db);
    res.json({ success: true });
});

app.post("/chat/stream", checkAuth, async (req, res) => {
    const { message, projectId } = req.body;
    const db = await loadDB();
    const project = db.projects.find(p => p.id === projectId);
    if (!project) return res.status(404).send("ERR");

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });

    try {
        const messages = [
            { role: "system", content: "You are a Senior Engineer. Provide technical code in markdown blocks." },
            ...project.history.slice(-10),
            { role: "user", content: message }
        ];

        const response = await axiosInstance.post(DEEPSEEK_URL, { model: "deepseek-chat", messages, stream: true }, { headers: { Authorization: `Bearer ${API_KEY}` }, responseType: "stream" });

        let fullAIResponse = "";
        response.data.on("data", (chunk) => {
            res.write(chunk);
            const lines = chunk.toString().split("\n");
            for (const line of lines) {
                if (line.startsWith("data: ") && !line.includes("[DONE]")) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        fullAIResponse += data.choices[0]?.delta?.content || "";
                    } catch (e) {}
                }
            }
        });

        response.data.on("end", async () => {
            const finalDB = await loadDB();
            const p = finalDB.projects.find(proj => proj.id === projectId);
            if (p) {
                p.history.push({ role: "user", content: message }, { role: "assistant", content: fullAIResponse });
                await saveDB(finalDB);
            }
            res.write("event: complete\ndata: {}\n\n");
            res.end();
        });
        req.on("close", () => response.data.destroy());
    } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
});

// ================= WEB INTERFACE =================
app.get("/", (req, res) => {
    if (req.session.loggedIn) {
        // --- Main Console UI ---
        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>GREY_CONSOLE</title>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/base16/grayscale-light.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; outline: none !important; border: none; background: none; color: #333; font-family: 'Courier New', monospace; -webkit-tap-highlight-color: transparent; }
        body { height: 100vh; display: flex; background: #fff; overflow: hidden; }
        #sidebar { width: 280px; background: #eee; border-right: 2px solid #666; display: flex; flex-direction: column; }
        .sidebar-header { padding: 20px; border-bottom: 2px solid #666; display: flex; justify-content: space-between; align-items: center; }
        .new-btn { padding: 8px 12px; background: #333; color: #eee; cursor: pointer; font-weight: bold; font-size: 12px; }
        #project-list { flex: 1; overflow-y: auto; padding: 10px; }
        .project-item { padding: 10px; margin-bottom: 10px; border: 1px solid #999; cursor: pointer; background: #fdfdfd; }
        .project-item.active { background: #333 !important; color: #eee !important; }
        .project-item.active * { color: #eee !important; }
        .proj-meta { display: flex; gap: 10px; font-size: 10px; margin-top: 5px; }
        .action-link { cursor: pointer; text-decoration: underline; color: #888; }
        #workspace { flex: 1; display: flex; flex-direction: column; background: #fff; }
        #chat { flex: 1; overflow-y: auto; padding: 30px; display: flex; flex-direction: column; gap: 30px; }
        .msg { width: 100%; line-height: 1.6; font-size: 14px; border-bottom: 1px solid #eee; padding-bottom: 20px; }
        pre { background: #333; padding: 15px; margin: 15px 0; overflow-x: auto; position: relative; }
        code { color: #eee !important; }
        #bottom-bar { padding: 20px 30px; border-top: 2px solid #666; background: #eee; display: flex; gap: 10px; align-items: flex-end; }
        textarea { flex: 1; min-height: 40px; border: 2px solid #666; padding: 10px; background: #fff; resize: none; }
        .send-btn { padding: 10px 20px; background: #333; color: #eee; cursor: pointer; font-weight: bold; height: 44px; }
        .logout-link { font-size: 10px; text-decoration: underline; cursor: pointer; color: #666; }
    </style>
</head>
<body>
    <div id="sidebar">
        <div class="sidebar-header">
            <div class="new-btn" onclick="createProject()">+ SESSION</div>
            <a href="/logout" class="logout-link">LOGOUT</a>
        </div>
        <div id="project-list"></div>
    </div>
    <div id="workspace">
        <div id="chat"></div>
        <div id="bottom-bar">
            <textarea id="prompt" placeholder="COMMAND..." disabled oninput="this.style.height='';this.style.height=this.scrollHeight+'px'"></textarea>
            <div id="send" class="send-btn" style="display:none" onclick="ask()">EXEC</div>
        </div>
    </div>
    <script>
        let currentProjectId = null;
        const chatBox = document.getElementById('chat'), listContainer = document.getElementById('project-list'), input = document.getElementById('prompt'), sendBtn = document.getElementById('send');
        marked.setOptions({ highlight: (code) => hljs.highlightAuto(code).value, breaks: true });
        function updateActiveUI(id) { document.querySelectorAll('.project-item').forEach(el => el.classList.remove('active')); const active = document.querySelector(\`[data-id="\${id}"]\`); if (active) active.classList.add('active'); }
        async function api(url, method = 'GET', body = null) { const opt = { method, headers: { 'Content-Type': 'application/json' } }; if (body) opt.body = JSON.stringify(body); const r = await fetch(url, opt); if (r.status === 401) location.reload(); return r.json(); }
        async function loadProjects() { const projects = await api('/api/projects'); listContainer.innerHTML = projects.map(p => \` <div class="project-item \${p.id === currentProjectId ? 'active' : ''}" data-id="\${p.id}" onclick="selectProject('\${p.id}')"> <div style="font-weight:bold;">\${p.name}</div> <div class="proj-meta"> <span class="action-link" onclick="deleteProject(event, '\${p.id}')">KILL</span> </div> </div> \`).join(''); }
        async function selectProject(id) { currentProjectId = id; input.disabled = false; sendBtn.style.display = 'block'; updateActiveUI(id); const data = await api(\`/api/projects/\${id}\`); chatBox.innerHTML = ''; data.history.forEach(m => renderMessage(m.role, m.content)); chatBox.scrollTop = chatBox.scrollHeight; input.focus(); }
        async function createProject() { const n = prompt("NAME:"); if (n) { await api('/api/projects', 'POST', { name: n }); await loadProjects(); } }
        async function deleteProject(e, id) { e.stopPropagation(); if(confirm("DEL?")) { await api(\`/api/projects/\${id}\`, 'DELETE'); if(currentProjectId === id) location.reload(); loadProjects(); } }
        function renderMessage(role, content) { const d = document.createElement('div'); d.className = 'msg ' + (role === 'user' ? 'user' : 'ai'); d.innerHTML = role === 'user' ? '>> ' + content : marked.parse(content); chatBox.appendChild(d); return d; }
        async function ask() { const val = input.value.trim(); if (!val || !currentProjectId) return; input.value = ''; renderMessage('user', val); const a = renderMessage('assistant', '...'); let full = ""; const r = await fetch('/chat/stream', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ message: val, projectId: currentProjectId }) }); const reader = r.body.getReader(), decoder = new TextDecoder(); while (true) { const { done, value } = await reader.read(); if (done) break; const lines = decoder.decode(value).split('\\n'); for (const line of lines) { if (line.startsWith('data: ')) { try { const d = JSON.parse(line.slice(6)); if (d.choices[0]?.delta?.content) { full += d.choices[0].delta.content; a.innerHTML = marked.parse(full); chatBox.scrollTop = chatBox.scrollHeight; } } catch(e) {} } } } input.focus(); }
        input.onkeydown = (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } };
        loadProjects();
    </script>
</body>
</html>
        `);
    } else {
        // --- Login Page ---
        res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>LOGIN_GATE</title>
    <style>
        body { background: #fff; height: 100vh; display: flex; align-items: center; justify-content: center; font-family: 'Courier New', monospace; margin: 0; }
        .gate { border: 2px solid #333; padding: 40px; background: #eee; width: 300px; }
        input { width: 100%; padding: 10px; margin: 10px 0; border: 2px solid #666; background: #fff; box-sizing: border-box; }
        button { width: 100%; padding: 10px; background: #333; color: #fff; border: none; cursor: pointer; font-weight: bold; }
        .err { color: #888; font-size: 12px; margin-top: 10px; text-align: center; display: none; }
    </style>
</head>
<body>
    <div class="gate">
        <div style="font-weight:bold; margin-bottom:20px;">SYSTEM_ACCESS</div>
        <input type="text" id="email" placeholder="EMAIL">
        <input type="password" id="pass" placeholder="PASSWORD">
        <button onclick="login()">AUTHORIZE</button>
        <div id="msg" class="err">ACCESS_DENIED</div>
    </div>
    <script>
        async function login() {
            const r = await fetch('/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('pass').value })
            });
            if (r.ok) location.reload();
            else document.getElementById('msg').style.display = 'block';
        }
    </script>
</body>
</html>
        `);
    }
});

app.listen(PORT, () => console.log(`🚀 Console Secure: http://localhost:${PORT}`));