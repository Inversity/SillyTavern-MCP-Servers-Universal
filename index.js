import { renderExtensionTemplateAsync, extension_settings } from '../../extensions.js';
import { eventSource, event_types, getRequestHeaders, saveSettingsDebounced } from '../../../script.js';
import { Popup, POPUP_TYPE } from '../../popup.js';
import { ToolManager } from '../../tool-calling.js';

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
