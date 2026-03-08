const express = require("express");
const axios = require("axios");
const https = require("https");
const fs = require("fs").promises;
const path = require("path");
const compression = require("compression");
const session = require("express-session");

const app = express();
const PORT = 3000;
const STORAGE_FILE = path.join(__dirname, "storage.json");

const AUTH_USER = "hanpeh2u@gmail.com";
const AUTH_PASS = "Zamri800629!";

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
    cookie: { secure: false }
}));

const checkAuth = (req, res, next) => {
    if (req.session.loggedIn) next();
    else res.status(401).json({ error: "UNAUTHORIZED" });
};

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

app.post("/login", (req, res) => {
    const { email, password } = req.body;
    if (email === AUTH_USER && password === AUTH_PASS) {
        req.session.loggedIn = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: "INVALID" });
    }
});

app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

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

app.put("/api/projects/:id", checkAuth, async (req, res) => {
    const { name, clearHistory } = req.body;
    const db = await loadDB();
    const project = db.projects.find(p => p.id === req.params.id);
    if (project) {
        if (name) project.name = name.toUpperCase();
        if (clearHistory) project.history = [];
        await saveDB(db);
        res.json(project);
    } else res.status(404).send("NOT_FOUND");
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
        const messages = [{ role: "system", content: "Senior Engineer. Raw text only, no markdown formatting." }, ...project.history.slice(-10), { role: "user", content: message }];
        const response = await axiosInstance.post(DEEPSEEK_URL, { model: "deepseek-chat", messages, stream: true }, { headers: { Authorization: `Bearer ${API_KEY}` }, responseType: "stream" });
        let fullRes = "";
        response.data.on("data", (chunk) => {
            res.write(chunk);
            const lines = chunk.toString().split("\n");
            for (const line of lines) {
                if (line.startsWith("data: ") && !line.includes("[DONE]")) {
                    try {
                        const d = JSON.parse(line.slice(6));
                        fullRes += d.choices[0]?.delta?.content || "";
                    } catch (e) {}
                }
            }
        });
        response.data.on("end", async () => {
            const finalDB = await loadDB();
            const p = finalDB.projects.find(proj => proj.id === projectId);
            if (p) { p.history.push({ role: "user", content: message }, { role: "assistant", content: fullRes }); await saveDB(finalDB); }
            res.write("event: complete\ndata: {}\n\n");
            res.end();
        });
        req.on("close", () => response.data.destroy());
    } catch (err) { res.end(); }
});

app.get("/", (req, res) => {
    if (req.session.loggedIn) {
        res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>🚀 GREY</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; outline: none !important; border: none; background: none; color: #333; font-family: 'Courier New', monospace; }
        body { height: 100vh; width: 100vw; display: flex; background: #fff; overflow: hidden; }
        #sidebar { width: 280px; min-width: 280px; background: #444; border-right: 1px solid #222; display: flex; flex-direction: column; height: 100%; }
        .sidebar-header { padding: 20px; border-bottom: 1px solid #222; display: flex; justify-content: space-between; align-items: center; color: #fff; }
        .new-btn { padding: 8px 12px; background: #eee; color: #333 !important; cursor: pointer; font-weight: bold; font-size: 11px; }
        #project-list { flex: 1; overflow-y: auto; padding: 10px; }
        .project-item { padding: 12px; margin-bottom: 10px; border: 1px solid #666; cursor: pointer; background: #555; color: #eee !important; font-size: 13px; }
        .project-item.active { background: #eee !important; color: #333 !important; }
        .proj-meta { display: flex; gap: 8px; font-size: 9px; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 5px; }
        .action-link { cursor: pointer; text-decoration: underline; color: #bbb !important; }

        #workspace { flex: 1; display: flex; flex-direction: column; background: #fff; overflow: hidden; position: relative; }
        #top-controls { position: absolute; top: 15px; right: 20px; display: flex; gap: 10px; z-index: 10; }
        .ctrl-btn { padding: 4px 10px; background: #eee; color: #666; font-size: 10px; font-weight: bold; cursor: pointer; border: 1px solid #999; }
        
        #chat { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 20px; }
        .text-node { white-space: pre-wrap; word-wrap: break-word; font-size: 14px; line-height: 1.5; padding: 15px; margin-bottom: 10px; position: relative; }
        .user-text { color: #333 !important; border-bottom: 1px solid #eee; }
        .ai-text { background: #888 !important; color: #fff !important; border-radius: 4px; border: 1px solid #777; }

        .copy-all-btn { position: absolute; top: 5px; right: 5px; font-size: 9px; background: #eee; color: #333 !important; padding: 2px 5px; cursor: pointer; border: 1px solid #333; font-weight: bold; }

        #bottom-bar { padding: 15px 20px; border-top: 1px solid #eee; background: #f9f9f9; display: flex; gap: 10px; align-items: flex-end; }
        textarea { flex: 1; min-height: 40px; max-height: 200px; border: 1px solid #ccc; padding: 10px; background: #fff; resize: none; font-size: 14px; }
        .send-btn { padding: 10px 20px; background: #444; color: #fff !important; cursor: pointer; font-weight: bold; height: 42px; font-size: 12px; }
    </style>
</head>
<body>
    <div id="sidebar">
        <div class="sidebar-header"><div class="new-btn" onclick="createProject()">+ SESSION</div> <a href="/logout" style="font-size:10px; color: #fff; text-decoration: none;">EXIT</a></div>
        <div id="project-list"></div>
    </div>
    <div id="workspace">
        <div id="top-controls"><div class="ctrl-btn" onclick="cls()">CLS</div></div>
        <div id="chat"></div>
        <div id="bottom-bar">
            <textarea id="prompt" placeholder="READY..." disabled oninput="this.style.height='';this.style.height=this.scrollHeight+'px'"></textarea>
            <div id="send" class="send-btn" style="display:none" onclick="ask()">EXEC</div>
        </div>
    </div>
    <script>
        let currentProjectId = null;
        const chatBox = document.getElementById('chat'), listContainer = document.getElementById('project-list'), input = document.getElementById('prompt'), sendBtn = document.getElementById('send');
        function cls() { chatBox.innerHTML = ''; }
        
        async function api(url, method = 'GET', body = null) { 
            const opt = { method, headers: { 'Content-Type': 'application/json' } }; 
            if (body) opt.body = JSON.stringify(body); 
            const r = await fetch(url, opt); if (r.status === 401) location.reload(); 
            return r.json(); 
        }

        async function loadProjects() { 
            const projects = await api('/api/projects'); 
            listContainer.innerHTML = projects.map(p => \`
                <div class="project-item \${p.id === currentProjectId ? 'active' : ''}" data-id="\${p.id}" onclick="selectProject('\${p.id}')">
                    \${p.name}
                    <div class="proj-meta">
                        <span class="action-link" onclick="renameProject(event, '\${p.id}', '\${p.name}')">REN</span>
                        <span class="action-link" onclick="clearHistory(event, '\${p.id}')">CLR</span>
                        <span class="action-link" onclick="deleteProject(event, '\${p.id}')">KILL</span>
                    </div>
                </div>\`).join(''); 
        }

        async function selectProject(id) { 
            currentProjectId = id; input.disabled = false; sendBtn.style.display = 'block'; 
            document.querySelectorAll('.project-item').forEach(el => el.classList.remove('active'));
            const active = document.querySelector(\`[data-id="\${id}"]\`); if (active) active.classList.add('active');
            const data = await api(\`/api/projects/\${id}\`); chatBox.innerHTML = ''; 
            data.history.forEach(m => renderMessage(m.role, m.content)); 
            chatBox.scrollTop = chatBox.scrollHeight; input.focus(); 
        }

        async function createProject() { const n = prompt("NAME:"); if (n) { await api('/api/projects', 'POST', { name: n }); await loadProjects(); } }
        async function renameProject(e, id, old) { e.stopPropagation(); const n = prompt("REN:", old); if(n) { await api(\`/api/projects/\${id}\`, 'PUT', { name: n }); loadProjects(); } }
        async function clearHistory(e, id) { e.stopPropagation(); if(confirm("WIPE?")) { await api(\`/api/projects/\${id}\`, 'PUT', { clearHistory: true }); if(currentProjectId === id) selectProject(id); } }
        async function deleteProject(e, id) { e.stopPropagation(); if(confirm("KILL?")) { await api(\`/api/projects/\${id}\`, 'DELETE'); if(currentProjectId === id) location.reload(); loadProjects(); } }

        function copyResp(btn) {
            const text = btn.parentElement.innerText.replace("COPY", "").trim();
            navigator.clipboard.writeText(text).then(() => { btn.innerText = "DONE"; setTimeout(() => btn.innerText = "COPY", 1000); });
        }

        function renderMessage(role, content) { 
            const node = document.createElement('div');
            node.className = 'text-node ' + (role === 'user' ? 'user-text' : 'ai-text');
            node.textContent = content;
            if(role === 'assistant') {
                const btn = document.createElement('div');
                btn.className = 'copy-all-btn';
                btn.innerText = 'COPY';
                btn.onclick = function() { copyResp(this); };
                node.appendChild(btn);
            }
            chatBox.appendChild(node); return node; 
        }

        async function ask() { 
            const val = input.value.trim(); if (!val || !currentProjectId) return; 
            input.value = ''; input.style.height = '40px'; renderMessage('user', val); 
            const a = renderMessage('assistant', '...'); let full = ""; 
            const r = await fetch('/chat/stream', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ message: val, projectId: currentProjectId }) }); 
            const reader = r.body.getReader(), decoder = new TextDecoder(); 
            while (true) { 
                const { done, value } = await reader.read(); if (done) break; 
                const lines = decoder.decode(value).split('\\n'); 
                for (const line of lines) { if (line.startsWith('data: ')) { try { const d = JSON.parse(line.slice(6)); if (d.choices[0]?.delta?.content) { 
                    full += d.choices[0].delta.content; 
                    // Update content while keeping the button
                    const btnHtml = '<div class="copy-all-btn" onclick="copyResp(this)">COPY</div>';
                    a.innerText = full;
                    a.innerHTML += btnHtml;
                    chatBox.scrollTop = chatBox.scrollHeight; 
                } } catch(e) {} } } 
            } 
        }
        input.onkeydown = (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } };
        loadProjects();
    </script>
</body>
</html>
        `);
    } else {
        res.send(`
<!DOCTYPE html>
<html>
<head><title>LOGIN</title><style>body { background: #fff; height: 100vh; display: flex; align-items: center; justify-content: center; font-family: 'Courier New', monospace; } .gate { border: 1px solid #333; padding: 30px; background: #444; width: 260px; color: #fff; } input { width: 100%; padding: 8px; margin: 10px 0; border: none; } button { width: 100%; padding: 8px; background: #eee; cursor: pointer; border: none; font-weight: bold; }</style></head>
<body><div class="gate">AUTH<input type="text" id="email" placeholder="EMAIL"><input type="password" id="pass" placeholder="PASS"><button onclick="login()">LOGIN</button></div>
<script>async function login() { const r = await fetch('/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('pass').value }) }); if (r.ok) location.reload(); else alert("DENIED"); }</script>
</body></html>
        `);
    }
});

app.listen(PORT, () => console.log(`🚀 Console Live: http://localhost:3000`));