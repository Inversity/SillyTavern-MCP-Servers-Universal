// Path-independent access: rely on global objects exposed by SillyTavern runtime
// so the extension can live under /data/default-user/extensions/... without adjusting relative paths.
// Access through bracket notation to avoid type complaints in environments without declarations.
const renderExtensionTemplateAsync = (window['renderExtensionTemplateAsync'] || window['render_extension_template_async'] || (() => Promise.resolve('')));
const extension_settings = (window['extension_settings'] = window['extension_settings'] || {});
const eventSource = window['eventSource'];
const event_types = window['event_types'] || {};
const getRequestHeaders = window['getRequestHeaders'] || (() => ({}));
const saveSettingsDebounced = window['saveSettingsDebounced'] || (() => {});
const Popup = window['Popup'];
const POPUP_TYPE = window['POPUP_TYPE'] || {};
const ToolManager = window['ToolManager'] || window['toolManager'];

if (!eventSource || !ToolManager) {
    console.warn('[MCP Servers Universal] Core globals missing. Extension may not function until SillyTavern finishes loading.');
}

const MODULE = 'mcp';

const DEFAULTS = {
    enabledServers: [], // mirrors server disabled list inversely
};

function ensureDefaults() {
    if (!extension_settings[MODULE]) extension_settings[MODULE] = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (extension_settings[MODULE][k] === undefined) extension_settings[MODULE][k] = v;
    }
}

async function api(path, init = {}) {
    const res = await fetch(`/api/plugins/mcp${path}`, {
        ...init,
        headers: {
            ...(init.headers || {}),
            ...getRequestHeaders(),
            'Content-Type': 'application/json',
        },
    });
    if (!res.ok) throw new Error(await res.text() || res.statusText);
    return res.headers.get('content-type')?.includes('application/json') ? res.json() : res.text();
}

function statusPill(isRunning) {
    return `<span class="pill ${isRunning ? 'on' : 'off'}">${isRunning ? 'Running' : 'Stopped'}</span>`;
}

function toast(kind, msg, title) {
    try {
        if (window.toastr && typeof window.toastr[kind] === 'function') {
            // @ts-ignore
            window.toastr[kind](msg, title);
        } else {
            console[(kind === 'error' ? 'error' : 'log')](title ? `${title}: ${msg}` : msg);
        }
    } catch { console.log(msg); }
}

async function render() {
    ensureDefaults();
    const container = document.getElementById('mcp_container');
    if (!container) return;

    // Fetch server list
    let servers = [];
    try {
        servers = await api('/servers');
    } catch (e) {
        container.innerHTML = `<div class="mcp_info error">Failed to load MCP servers: ${String(e)}</div>`;
        return;
    }

    const html = await renderExtensionTemplateAsync(MODULE, 'panel', {});
    container.innerHTML = html;

    // Wire actions (static header buttons)
    container.querySelectorAll('[data-action]')?.forEach(el => {
        el.addEventListener('click', async () => {
            const action = el.getAttribute('data-action');
            const name = el.getAttribute('data-name');
            try {
                switch (action) {
                    case 'start':
                        await api(`/servers/${encodeURIComponent(name)}/start`, { method: 'POST' });
                        break;
                    case 'stop':
                        await api(`/servers/${encodeURIComponent(name)}/stop`, { method: 'POST' });
                        break;
                    case 'open-settings':
                        await api('/open-settings', { method: 'POST' });
                        break;
                    case 'reload-tools':
                        await api(`/servers/${encodeURIComponent(name)}/reload-tools`, { method: 'POST' });
                        break;
                    case 'add-server':
                        await addServerFlow();
                        break;
                    case 'import-servers':
                        await importServersFlow();
                        break;
                }
                await render();
                await syncMcpTools();
            } catch (err) {
                toast('error', String(err));
            }
        });
    });

    // Build server list
    const list = container.querySelector('#mcp_server_list');
    if (!list) return;
    if (!servers || servers.length === 0) {
        list.innerHTML = '<div class="mcp_info">No MCP servers configured yet. Use the settings file to add servers.</div>';
        return;
    }
    list.innerHTML = '';
    for (const s of servers) {
        const row = document.createElement('div');
        row.className = 'srv';
        const label = document.createElement('label');
        label.title = 'Enable/disable this server';
        label.setAttribute('aria-label', `Enable/disable server ${s.name}`);
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.setAttribute('data-name', s.name);
        chk.checked = !!s.enabled;
        label.appendChild(chk);
        const flex = document.createElement('div');
        flex.className = 'flex';
        const nameEl = document.createElement('b');
        nameEl.textContent = s.name;
        const pill = document.createElement('span');
        pill.className = `pill ${s.isRunning ? 'on' : 'off'}`;
        pill.textContent = s.isRunning ? 'Running' : 'Stopped';
        flex.appendChild(nameEl);
        flex.appendChild(document.createTextNode(' '));
        flex.appendChild(pill);
        if (s.capabilities) {
            const cap = document.createElement('span');
            cap.className = 'tools';
            cap.textContent = ` capabilities: ${JSON.stringify(s.capabilities)}`;
            flex.appendChild(document.createTextNode(' '));
            flex.appendChild(cap);
        }
        const actions = document.createElement('div');
        actions.className = 'actions';
        const btn = document.createElement('button');
        btn.className = 'menu_button';
        btn.setAttribute('data-name', s.name);
        if (s.isRunning) {
            btn.setAttribute('data-action', 'stop');
            btn.innerHTML = '<i class="fa-solid fa-stop"></i><span>Stop</span>';
        } else {
            btn.setAttribute('data-action', 'start');
            btn.innerHTML = '<i class="fa-solid fa-play"></i><span>Start</span>';
        }
    const reloadBtn = document.createElement('button');
        reloadBtn.className = 'menu_button';
        reloadBtn.setAttribute('data-action', 'reload-tools');
        reloadBtn.setAttribute('data-name', s.name);
        reloadBtn.innerHTML = '<i class="fa-solid fa-rotate"></i><span>Reload tools</span>';
    const toolsBtn = document.createElement('button');
    toolsBtn.className = 'menu_button';
    toolsBtn.setAttribute('data-action', 'tools');
    toolsBtn.setAttribute('data-name', s.name);
    toolsBtn.innerHTML = '<i class="fa-solid fa-screwdriver-wrench"></i><span>Tools</span>';
        actions.appendChild(btn);
        actions.appendChild(reloadBtn);
    actions.appendChild(toolsBtn);
    // Inline edit/delete
    const inlineBtns = document.createElement('div');
    inlineBtns.className = 'inline-buttons';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'mini';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => editServerFlow(s));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'mini';
    delBtn.textContent = 'Del';
    delBtn.addEventListener('click', () => deleteServerFlow(s));
    inlineBtns.append(editBtn, delBtn);
    actions.appendChild(inlineBtns);
        row.appendChild(label);
        row.appendChild(flex);
        row.appendChild(actions);
        list.appendChild(row);

        // Events
        chk.addEventListener('change', async () => {
            const disabled = Array.from(container.querySelectorAll('input[type=checkbox][data-name]'))
                .filter(c => (c instanceof HTMLInputElement) ? !c.checked : false)
                .map(c => c.getAttribute('data-name'));
            try {
                await api('/servers/disabled', { method: 'POST', body: JSON.stringify({ disabledServers: disabled }) });
                await render();
            } catch (e) {
                toast('error', String(e));
            }
        });
    chk.addEventListener('change', async () => {
            try {
                if (s.isRunning) {
                    await api(`/servers/${encodeURIComponent(s.name)}/stop`, { method: 'POST' });
                } else {
                    await api(`/servers/${encodeURIComponent(s.name)}/start`, { method: 'POST' });
                }
        await syncMcpTools();
                await render();
            } catch (e) { toast('error', String(e)); }
        });
        reloadBtn.addEventListener('click', async () => {
            try {
                await api(`/servers/${encodeURIComponent(s.name)}/reload-tools`, { method: 'POST' });
            } catch (e) {
                toast('error', String(e));
            }
        });

        toolsBtn.addEventListener('click', async () => {
        await syncMcpTools();
            try {
                const tools = await api(`/servers/${encodeURIComponent(s.name)}/list-tools`, { method: 'GET' });
                const wrapper = document.createElement('div');
                if (!tools || tools.length === 0) {
                    wrapper.textContent = 'No tools found on this server.';
                } else {
        await syncMcpTools();
                    for (const t of tools) {
                        const toolRow = document.createElement('div');
                        toolRow.className = 'flex-container gap5px alignItemsCenter';
                        const toolChk = document.createElement('input');
                        toolChk.type = 'checkbox';
                        toolChk.checked = !!t._enabled;
                        toolChk.setAttribute('data-tool', t.name);
                        const toolLabel = document.createElement('label');
                        toolLabel.textContent = `${t.name}${t.description ? ' — ' + t.description : ''}`;
                        toolRow.appendChild(toolChk);
                        toolRow.appendChild(toolLabel);
                        wrapper.appendChild(toolRow);
                    }
                }
                const popup = new Popup(wrapper, POPUP_TYPE.CONFIRM, `Tools — ${s.name}`, { okButton: 'Save', cancelButton: 'Close' });
                const res = await popup.show();
                if (!res) return;
                const disabled = Array.from(wrapper.querySelectorAll('input[type=checkbox][data-tool]'))
                    .filter(el => el instanceof HTMLInputElement && !el.checked)
                    .map(el => el.getAttribute('data-tool'));
                await api(`/servers/${encodeURIComponent(s.name)}/disabled-tools`, { method: 'POST', body: JSON.stringify({ disabledTools: disabled }) });
                toast('success', 'Saved');
                await syncMcpTools();
            } catch (e) {
                toast('error', String(e));
            }
        });
    }
}

async function addServerFlow() {
    // Popup with textarea for raw JSON snippet or key:value form
    const wrapper = document.createElement('div');
    wrapper.className = 'column gap10px';
    const help = document.createElement('div');
    help.innerHTML = `<p>Paste either a single server JSON object (without outer "servers"), e.g.</p>
<pre style="max-height:140px;overflow:auto;white-space:pre-wrap;">"OpenMemory": {\n  "type": "stdio",\n  "command": "npx",\n  "args": ["-y", "openmemory"],\n  "env": {\n    "OPENMEMORY_API_KEY": "YOUR_KEY",\n    "CLIENT_NAME": "openmemory"\n  }\n}</pre>
<p>or just the object body (will prompt for name).</p>`;
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Server name (if not included)';
    nameInput.style.width = '100%';
    const ta = document.createElement('textarea');
    ta.placeholder = 'Paste server config snippet here...';
    ta.rows = 12;
    ta.style.width = '100%';
    const validateBtn = document.createElement('button');
    validateBtn.type = 'button';
    validateBtn.className = 'menu_button';
    validateBtn.textContent = 'Validate';
    const status = document.createElement('div');
    status.style.fontSize = '.8em';
    status.style.opacity = '.8';
    wrapper.append(help, nameInput, ta, validateBtn, status);

    let parsedName = null; let parsedConfig = null;
    function tryParse() {
        status.textContent = '';
        parsedName = null; parsedConfig = null;
        let text = ta.value.trim();
        if (!text) { status.textContent = 'Empty.'; return; }
        // If user pasted a quoted key prefix like "OpenMemory": { ... }
        // Try to wrap into { "X": { ... } } and parse.
        let candidate = text;
        if (!candidate.startsWith('{')) {
            // Possibly starts with "Name":
            if (/^"?[A-Za-z0-9_-]+"?\s*:/.test(candidate)) {
                candidate = '{' + candidate + '}';
            }
        }
        try {
            const obj = JSON.parse(candidate);
            const keys = Object.keys(obj);
            if (keys.length === 1 && typeof obj[keys[0]] === 'object' && obj[keys[0]] !== null) {
                parsedName = keys[0];
                parsedConfig = obj[keys[0]];
            } else {
                // Treat entire object as config body; require name field or outside name input
                parsedConfig = obj;
                parsedName = nameInput.value.trim() || obj.name || null;
            }
        } catch (e) {
            // Try to parse as bare object body
            try {
                const obj2 = JSON.parse(text);
                parsedConfig = obj2;
                parsedName = nameInput.value.trim() || obj2.name || null;
            } catch (e2) {
                status.textContent = 'Parse error: ' + e2.message;
                return;
            }
        }
        if (!parsedName) {
            status.textContent = 'Missing server name (provide in snippet or name field).';
            return;
        }
        // Basic validation
        if (!parsedConfig.type) parsedConfig.type = 'stdio';
        if (parsedConfig.type === 'stdio' && !parsedConfig.command) {
            status.textContent = 'For stdio servers, "command" is required.'; return;
        }
        if ((parsedConfig.type === 'http' || parsedConfig.type === 'sse') && !parsedConfig.url) {
            status.textContent = `For ${parsedConfig.type} servers, "url" is required.`; return;
        }
        status.textContent = `Looks good. Will add server '${parsedName}'.`;
    }
    validateBtn.addEventListener('click', tryParse);

    const popup = new Popup(wrapper, POPUP_TYPE.CONFIRM, 'Add MCP Server', { okButton: 'Add', cancelButton: 'Cancel' });
    const result = await popup.show();
    if (!result) return;
    tryParse();
    if (!parsedName || !parsedConfig) { toast('error', 'Cannot add: invalid or incomplete configuration.'); return; }
    try {
        await api('/servers', { method: 'POST', body: JSON.stringify({ name: parsedName, config: parsedConfig }) });
        toast('success', `Server '${parsedName}' added.`);
    } catch (e) {
        toast('error', 'Failed to add: ' + e.message);
    }
}

async function editServerFlow(server) {
    try {
        const existing = await api('/servers');
        const current = existing.find(x => x.name === server.name);
        if (!current) { toast('error', 'Server not found'); return; }
        const cfg = structuredClone(current.config || {});
        const wrapper = document.createElement('div');
        const ta = document.createElement('textarea');
        ta.rows = 14; ta.style.width = '100%';
        ta.value = JSON.stringify(cfg, null, 2);
        wrapper.innerHTML = `<p>Edit configuration for <b>${server.name}</b>. Invalid JSON will be rejected.</p>`;
        wrapper.appendChild(ta);
        const popup = new Popup(wrapper, POPUP_TYPE.CONFIRM, `Edit ${server.name}`, { okButton: 'Save', cancelButton: 'Cancel' });
        const res = await popup.show();
        if (!res) return;
        try {
            const parsed = JSON.parse(ta.value);
            await api('/servers', { method: 'POST', body: JSON.stringify({ name: server.name, config: parsed }) });
            toast('success', 'Updated.');
        } catch (e) { toast('error', 'Save failed: ' + e.message); }
    } catch (e) { toast('error', String(e)); }
}

async function deleteServerFlow(server) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<p>Delete MCP server <b>${server.name}</b>? Tools and cache entries will be removed.</p>`;
    const popup = new Popup(wrapper, POPUP_TYPE.CONFIRM, 'Delete Server', { okButton: 'Delete', cancelButton: 'Cancel' });
    const res = await popup.show();
    if (!res) return;
    try {
        await api(`/servers/${encodeURIComponent(server.name)}`, { method: 'DELETE' });
        toast('success', 'Deleted.');
        await render();
        await syncMcpTools();
    } catch (e) { toast('error', 'Delete failed: ' + e.message); }
}

function parseMultiServerText(text) {
    const results = [];
    // Strategy: Attempt JSON parse directly; if it contains multiple keys treat each; else split by quoted key patterns
    const trimmed = text.trim();
    if (!trimmed) return results;
    const tryPush = (name, cfg) => { if (name && cfg && typeof cfg === 'object') results.push({ name, config: cfg }); };
    try {
        const obj = JSON.parse(trimmed.startsWith('{') ? trimmed : '{' + trimmed + '}');
        const keys = Object.keys(obj);
        if (keys.length) {
            if (keys.length === 1 && (obj[keys[0]]?.type || obj[keys[0]]?.command || obj[keys[0]]?.url)) {
                tryPush(keys[0], obj[keys[0]]);
            } else {
                for (const k of keys) {
                    if (obj[k] && typeof obj[k] === 'object') tryPush(k, obj[k]);
                }
            }
        }
        if (results.length) return results;
    } catch { /* fallthrough */ }

    // Fallback: regex to capture "Name": { ... } blocks (naive brace match limited depth)
    const blockRegex = /"([A-Za-z0-9_\-]+)"\s*:\s*\{([^{}]|\{[^{}]*\})*\}/g; // simplistic
    let m;
    while ((m = blockRegex.exec(trimmed)) !== null) {
        const full = m[0];
        const name = m[1];
        const idx = full.indexOf('{');
        const body = full.slice(idx);
        try {
            const parsed = JSON.parse(body);
            tryPush(name, parsed);
        } catch { }
    }
    return results;
}

async function importServersFlow() {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<p>Paste one or more server definitions. Examples:</p>
<pre style="max-height:120px;overflow:auto;white-space:pre-wrap;">"A": {"type":"stdio","command":"node","args":["a.js"]},\n"B": {"type":"http","url":"https://example.com/sse"}</pre>`;
    const ta = document.createElement('textarea'); ta.rows = 14; ta.style.width = '100%';
    const status = document.createElement('div'); status.style.fontSize = '.8em'; status.style.marginTop = '4px';
    wrapper.append(ta, status);
    const popup = new Popup(wrapper, POPUP_TYPE.CONFIRM, 'Import MCP Servers', { okButton: 'Import', cancelButton: 'Cancel' });
    const res = await popup.show();
    if (!res) return;
    const entries = parseMultiServerText(ta.value);
    if (!entries.length) { toast('error', 'No valid server blocks detected.'); return; }
    let created = 0, updated = 0, failed = 0;
    for (const { name, config } of entries) {
        try {
            // Basic validation
            if (!config.type) config.type = config.url ? 'http' : 'stdio';
            if (config.type === 'stdio' && !config.command) throw new Error('missing command');
            if ((config.type === 'http' || config.type === 'sse') && !config.url) throw new Error('missing url');
            // Attempt create; if 409 conflict, prompt once for overwrite
            try {
                await api('/servers', { method: 'POST', body: JSON.stringify({ name, config }) });
                created++;
            } catch (e) {
                if (String(e).includes('already exists')) {
                    // Overwrite silently (treat as update)
                    await api(`/servers/${encodeURIComponent(name)}`, { method: 'DELETE' });
                    await api('/servers', { method: 'POST', body: JSON.stringify({ name, config }) });
                    updated++;
                } else throw e;
            }
        } catch (e) { failed++; console.warn('Import failed for', name, e); }
    }
    toast('success', `Import complete. Created: ${created}, Updated: ${updated}, Failed: ${failed}`);
    await render();
    await syncMcpTools();
}

// Maintain a set of currently registered MCP tool names to support clean unregister
const MCP_TOOL_PREFIX = 'mcp__';
let registeredMcpTools = new Set();

function buildToolName(serverName, toolName) {
    // OpenAI function name allows a-zA-Z0-9_- up to 64 chars typically; keep it simple
    return `${MCP_TOOL_PREFIX}${serverName}__${toolName}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

async function fetchEnabledToolsPerServer() {
    const servers = await api('/servers');
    // Only enabled servers; if server not running we can still use cached tools but invocation requires running
    const enabled = servers.filter(s => s.enabled);
    const results = [];
    for (const s of enabled) {
        try {
            const tools = await api(`/servers/${encodeURIComponent(s.name)}/list-tools`, { method: 'GET' });
            const enabledTools = (tools || []).filter(t => t._enabled !== false);
            results.push({ server: s, tools: enabledTools });
        } catch (e) {
            // ignore server fetch error; continue others
            console.warn('MCP list-tools failed', s?.name, e);
        }
    }
    return results;
}

async function syncMcpTools() {
    try {
        const perServer = await fetchEnabledToolsPerServer();
        const nextSet = new Set();

        // Register/refresh current tools
        for (const { server, tools } of perServer) {
            for (const t of tools) {
                const name = buildToolName(server.name, t.name);
                nextSet.add(name);

                // Build JSON schema and register
                const schema = t.inputSchema || { type: 'object', properties: {} };
                const description = t.description || `MCP tool from ${server.name}`;
                const displayName = `${server.name}: ${t.name}`;

                ToolManager.registerFunctionTool({
                    name,
                    displayName,
                    description,
                    parameters: schema,
                    action: async (args) => {
                        // If server is not running, attempt start (best-effort)
                        if (!server.isRunning) {
                            try { await api(`/servers/${encodeURIComponent(server.name)}/start`, { method: 'POST' }); }
                            catch { /* ignore */ }
                        }
                        const res = await api(`/servers/${encodeURIComponent(server.name)}/call-tool`, {
                            method: 'POST',
                            body: JSON.stringify({ toolName: t.name, arguments: args || {} }),
                        });
                        // res may have shape { result: { toolName, status, data } }
                        return res?.result?.data ?? res;
                    },
                    formatMessage: async (args) => `Invoking MCP tool: ${displayName}`,
                    shouldRegister: async () => true,
                    stealth: false,
                });
            }
        }

        // Unregister stale tools
        for (const oldName of registeredMcpTools) {
            if (!nextSet.has(oldName)) {
                ToolManager.unregisterFunctionTool(oldName);
            }
        }
        registeredMcpTools = nextSet;
    } catch (e) {
        console.warn('Failed to sync MCP tools', e);
    }
}

jQuery(async () => {
    ensureDefaults();
    // Panel content
    const panel = await renderExtensionTemplateAsync(MODULE, 'index');
    document.getElementById('objective_container')?.insertAdjacentHTML('afterend', panel);

    await render();
    await syncMcpTools();

    // When user settings loaded or extras toggled, re-render to keep in sync
    eventSource.on(event_types.EXTENSION_SETTINGS_LOADED, render);
    eventSource.on(event_types.EXTENSION_SETTINGS_LOADED, syncMcpTools);
});
