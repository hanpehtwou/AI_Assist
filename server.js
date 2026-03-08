const express = require("express");
const axios = require("axios");
const https = require("https");
const fs = require("fs").promises;
const path = require("path");
const compression = require("compression");

const app = express();
const PORT = 3000;
const STORAGE_FILE = path.join(__dirname, "storage.json");

// ================= CONFIGURATION =================
const API_KEY = "sk-beca533e170c4516a9dab3011e1f5aec";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

const axiosInstance = axios.create({
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
    timeout: 60000
});

app.use(compression());
app.use(express.json({ limit: "50mb" }));

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

// ================= API ENDPOINTS =================
app.get("/api/projects", async (req, res) => {
    const db = await loadDB();
    res.json(db.projects.map(p => ({ id: p.id, name: p.name })));
});

app.get("/api/projects/:id", async (req, res) => {
    const db = await loadDB();
    const project = db.projects.find(p => p.id === req.params.id);
    res.json(project || { history: [] });
});

app.post("/api/projects", async (req, res) => {
    const { name } = req.body;
    const db = await loadDB();
    const newProject = { id: "ID_" + Date.now(), name: name.toUpperCase(), history: [] };
    db.projects.push(newProject);
    await saveDB(db);
    res.json(newProject);
});

app.put("/api/projects/:id", async (req, res) => {
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

app.delete("/api/projects/:id", async (req, res) => {
    const db = await loadDB();
    db.projects = db.projects.filter(p => p.id !== req.params.id);
    await saveDB(db);
    res.json({ success: true });
});

app.post("/chat/stream", async (req, res) => {
    const { message, projectId } = req.body;
    const db = await loadDB();
    const project = db.projects.find(p => p.id === projectId);
    if (!project) return res.status(404).send("ERR");

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });

    try {
        const messages = [
            { role: "system", content: "You are a Senior Engineer. Provide technical code in markdown blocks. No fluff." },
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
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>🚀 GREY</title>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/base16/grayscale-light.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <style>
        /* 1. THE GREY FLAT RESET */
        * {
            margin: 0; padding: 0; box-sizing: border-box;
            outline: none !important;
            border: none;
            background: none;
            color: #333; /* Dark Grey instead of Black */
            font-family: 'Courier New', Courier, monospace;
            -webkit-tap-highlight-color: transparent;
        }

        body {
            height: 100vh; display: flex;
            background: #fff; overflow: hidden;
        }

        /* 2. SIDEBAR - GREY & FLAT */
        #sidebar {
            width: 280px; background: #eee;
            border-right: 2px solid #666; /* Grey Border */
            display: flex; flex-direction: column;
        }

        .sidebar-header { padding: 20px; border-bottom: 2px solid #666; }
        .new-btn { 
            width: 100%; padding: 10px; background: #333; color: #eee; 
            cursor: pointer; font-weight: bold; text-align: center;
        }

        #project-list { flex: 1; overflow-y: auto; padding: 10px; }

        .project-item {
            padding: 10px; margin-bottom: 10px;
            border: 1px solid #999;
            cursor: pointer;
            background: #fdfdfd;
        }

        /* PERSISTENT FLAT ACTIVE STATE - INVERTED GREYS */
        .project-item.active {
            background: #333 !important;
            color: #eee !important;
        }
        .project-item.active * { color: #eee !important; }

        .proj-meta { display: flex; gap: 10px; font-size: 10px; margin-top: 5px; }
        .action-link { cursor: pointer; text-decoration: underline; color: #888; }
        .project-item.active .action-link { color: #bbb; }

        /* 3. WORKSPACE */
        #workspace { flex: 1; display: flex; flex-direction: column; background: #fff; }
        #chat { flex: 1; overflow-y: auto; padding: 30px; display: flex; flex-direction: column; gap: 30px; }

        .msg { width: 100%; line-height: 1.6; font-size: 14px; border-bottom: 1px solid #eee; padding-bottom: 20px; }
        .user::before { content: ">> "; font-weight: bold; color: #333; }
        .ai::before { content: "AI: "; font-weight: bold; color: #888; }

        /* 4. CODE BLOCKS - DARK GREY */
        pre { background: #333; padding: 15px; margin: 15px 0; overflow-x: auto; position: relative; }
        code { color: #eee !important; font-family: 'Consolas', monospace; font-size: 13px; }
        .copy-btn { position: absolute; top: 5px; right: 5px; background: #eee; padding: 2px 6px; border: 1px solid #333; font-size: 10px; cursor: pointer; color: #333; }

        /* 5. INPUT */
        #bottom-bar { padding: 20px 30px; border-top: 2px solid #666; background: #eee; display: flex; gap: 10px; align-items: flex-end; }
        textarea { flex: 1; min-height: 40px; max-height: 200px; border: 2px solid #666; padding: 10px; background: #fff; font-size: 14px; resize: none; color: #333; }
        .send-btn { padding: 10px 20px; background: #333; color: #eee; cursor: pointer; font-weight: bold; height: 44px; }
        
        .cursor::after { content: '█'; animation: blink 1s infinite; margin-left: 5px; color: #666; }
        @keyframes blink { 50% { opacity: 0; } }
    </style>
</head>
<body>
    <div id="sidebar">
        <div class="sidebar-header"><div class="new-btn" onclick="createProject()">+ NEW_SESSION</div></div>
        <div id="project-list"></div>
    </div>
    <div id="workspace">
        <div id="chat"></div>
        <div id="bottom-bar">
            <textarea id="prompt" placeholder="COMMAND..." disabled oninput="this.style.height='';this.style.height=this.scrollHeight+'px'"></textarea>
            <div id="send" class="send-btn" style="display:none">EXEC</div>
        </div>
    </div>

    <script>
        let currentProjectId = null;
        const chatBox = document.getElementById('chat'), listContainer = document.getElementById('project-list');
        const input = document.getElementById('prompt'), sendBtn = document.getElementById('send');

        marked.setOptions({ 
            highlight: (code) => hljs.highlightAuto(code).value,
            breaks: true 
        });

        function updateActiveUI(id) {
            document.querySelectorAll('.project-item').forEach(el => el.classList.remove('active'));
            const active = document.querySelector(\`[data-id="\${id}"]\`);
            if (active) active.classList.add('active');
        }

        async function api(url, method = 'GET', body = null) {
            const opt = { method, headers: { 'Content-Type': 'application/json' } };
            if (body) opt.body = JSON.stringify(body);
            return fetch(url, opt).then(r => r.json());
        }

        async function loadProjects() {
            const projects = await api('/api/projects');
            listContainer.innerHTML = projects.map(p => \`
                <div class="project-item \${p.id === currentProjectId ? 'active' : ''}" data-id="\${p.id}" onclick="selectProject('\${p.id}')">
                    <div style="font-weight:bold;">\${p.name}</div>
                    <div class="proj-meta">
                        <span class="action-link" onclick="renameProject(event, '\${p.id}', '\${p.name}')">REN</span>
                        <span class="action-link" onclick="clearHistory(event, '\${p.id}')">CLR</span>
                        <span class="action-link" onclick="deleteProject(event, '\${p.id}')">KILL</span>
                    </div>
                </div>
            \`).join('');
        }

        async function selectProject(id) {
            currentProjectId = id;
            input.disabled = false; sendBtn.style.display = 'block';
            updateActiveUI(id); 

            const data = await api(\`/api/projects/\${id}\`);
            chatBox.innerHTML = '';
            data.history.forEach(m => renderMessage(m.role, m.content));
            chatBox.scrollTop = chatBox.scrollHeight;
            input.focus();
        }

        async function createProject() {
            const n = prompt("NAME:");
            if (n) { await api('/api/projects', 'POST', { name: n }); await loadProjects(); }
        }

        async function renameProject(e, id, old) { e.stopPropagation(); const n = prompt("NEW:", old); if(n) { await api(\`/api/projects/\${id}\`, 'PUT', { name: n }); loadProjects(); } }
        async function clearHistory(e, id) { e.stopPropagation(); if(confirm("WIPE?")) { await api(\`/api/projects/\${id}\`, 'PUT', { clearHistory: true }); if(currentProjectId === id) selectProject(id); } }
        async function deleteProject(e, id) { e.stopPropagation(); if(confirm("DEL?")) { await api(\`/api/projects/\${id}\`, 'DELETE'); location.reload(); } }

        function renderMessage(role, content) {
            const d = document.createElement('div');
            d.className = 'msg ' + (role === 'user' ? 'user' : 'ai');
            let html = role === 'user' ? content : marked.parse(content);
            if (role !== 'user') html = html.replace(/<pre>/g, '<pre><div class="copy-btn" onclick="copyCode(this)">COPY</div>');
            d.innerHTML = html; chatBox.appendChild(d); return d;
        }

        async function ask() {
            const val = input.value.trim(); if (!val || !currentProjectId) return;
            input.value = ''; renderMessage('user', val);
            const a = renderMessage('assistant', ''); a.classList.add('cursor');
            let full = "";
            try {
                const r = await fetch('/chat/stream', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ message: val, projectId: currentProjectId }) });
                const reader = r.body.getReader(), decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read(); if (done) break;
                    const lines = decoder.decode(value).split('\\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const d = JSON.parse(line.slice(6));
                                if (d.choices[0]?.delta?.content) {
                                    full += d.choices[0].delta.content;
                                    a.innerHTML = marked.parse(full).replace(/<pre>/g, '<pre><div class="copy-btn" onclick="copyCode(this)">COPY</div>');
                                    chatBox.scrollTop = chatBox.scrollHeight;
                                }
                            } catch(e) {}
                        }
                    }
                }
            } catch(e) { a.innerHTML += ' [ERR]'; }
            finally { a.classList.remove('cursor'); input.focus(); }
        }

        window.copyCode = (btn) => {
            const code = btn.closest('pre').querySelector('code').innerText;
            navigator.clipboard.writeText(code).then(() => { btn.innerText = "DONE"; setTimeout(() => btn.innerText = "COPY", 1500); });
        };

        sendBtn.onclick = ask;
        input.onkeydown = (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } };
        loadProjects();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log(`🚀 GREY_CONSOLE: http://localhost:3000`));