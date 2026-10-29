// Painel web do Beeflow.
//
// Fala direto com a API (GET /api/panel/overview) usando o mesmo login do app.
// O token vai em Authorization: Bearer — nunca em cookie — e fica no
// sessionStorage, ou no localStorage quando a pessoa marca "manter conectado".
//
// Reconectar criadora: o servidor abre um Chrome e este painel mostra a tela
// dele (POST /api/panel/remote-login). A pessoa faz o login da criadora ali —
// captcha e 2FA incluídos — de qualquer computador ou celular, sem o app. Quando
// o login termina, o servidor grava a sessão e os chatters já usam.
//
// App instalado: com painel.webmanifest o painel vai para a Tela de Início do
// iPhone, e com sw.js recebe notificação (Web Push) do job da API
// src/jobs/panelAlerts.ts. No iPhone, push só existe no app instalado (iOS 16.4+).
//
// Todo texto que vem da API entra na página por textContent (função el), nunca
// por innerHTML: nome de criadora e de funcionário é texto digitado por gente.

(() => {
    'use strict';

    const PROD_API = 'https://api.beeflowapp.com';
    const STORAGE_KEY = 'beeflow.panel.session';
    const REFRESH_MS = 30_000;
    /** A Privacy dá 6h de sessão; base da barra de validade. */
    const SESSION_SPAN_MS = 6 * 3600_000;
    const BASE_TITLE = 'Painel — Beeflow';

    const $ = (id) => document.getElementById(id);

    /* ---------- Configuração ---------- */

    // `?api=` nunca vale no site oficial: lá, um link poderia mandar a senha
    // digitada para outro servidor. Fora dele (localhost, túnel de teste) o
    // servidor é de quem está testando. `?api=self` = mesma origem da página
    // (túnel com proxy). Fica no localStorage porque o app instalado abre sem
    // a query e sem o sessionStorage da aba.
    const PROD_HOSTS = ['beeflowapp.com', 'www.beeflowapp.com'];
    function apiBase() {
        if (PROD_HOSTS.includes(location.hostname)) return PROD_API;
        const fromQuery = new URLSearchParams(location.search).get('api');
        if (fromQuery) safeSet(localStorage, 'beeflow.panel.api', fromQuery);
        const chosen = safeGet(localStorage, 'beeflow.panel.api');
        if (chosen === 'self') return location.origin;
        return chosen || PROD_API;
    }
    const API = apiBase().replace(/\/+$/, '');

    /* ---------- Armazenamento ---------- */

    function safeGet(store, key) {
        try { return store.getItem(key); } catch { return null; }
    }
    function safeSet(store, key, value) {
        try { store.setItem(key, value); } catch { /* navegação privada */ }
    }
    function safeRemove(store, key) {
        try { store.removeItem(key); } catch { /* ignore */ }
    }

    function loadSession() {
        for (const store of [sessionStorage, localStorage]) {
            const raw = safeGet(store, STORAGE_KEY);
            if (!raw) continue;
            try {
                const s = JSON.parse(raw);
                if (s && typeof s.token === 'string') return s;
            } catch { /* corrompido */ }
        }
        return null;
    }
    function saveSession(session, remember) {
        clearSession();
        safeSet(remember ? localStorage : sessionStorage, STORAGE_KEY, JSON.stringify(session));
    }
    function clearSession() {
        safeRemove(sessionStorage, STORAGE_KEY);
        safeRemove(localStorage, STORAGE_KEY);
    }

    /* ---------- API ---------- */

    class ApiError extends Error {
        constructor(message, status, code) {
            super(message);
            this.status = status;
            this.code = code;
        }
    }

    async function request(path, { method = 'GET', body, token } = {}) {
        let res;
        try {
            res = await fetch(API + path, {
                method,
                headers: {
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: body ? JSON.stringify(body) : undefined,
            });
        } catch {
            throw new ApiError('Sem conexão com o servidor. Verifique sua internet.', 0, 'NETWORK');
        }
        let data = null;
        try { data = await res.json(); } catch { /* corpo vazio */ }
        if (!res.ok || (data && data.ok === false)) {
            const fallback = res.status === 429
                ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
                : 'Não foi possível concluir. Tente novamente.';
            throw new ApiError((data && data.error) || fallback, res.status, data && data.code);
        }
        return data;
    }

    /* ---------- Estado ---------- */

    const state = {
        session: null,
        data: null,
        /** Diferença relógio do servidor − relógio local, em ms. */
        skew: 0,
        fetchedAt: 0,
        timer: null,
        loading: false,
        filter: 'all',
    };

    const serverNow = () => Date.now() + state.skew;

    /* ---------- Formatação ---------- */

    const ROLE_LABEL = {
        manager: 'Gestor',
        chatter: 'Chatter',
        chatter_leader: 'Líder de chatters',
        chatter_free: 'Chatter free',
    };
    const HEALTH = {
        stable: { label: 'Estável', tone: 'ok' },
        unstable: { label: 'Instável', tone: 'warn' },
        expiring: { label: 'Vence em breve', tone: 'warn' },
        expired: { label: 'Expirada', tone: 'bad' },
        disconnected: { label: 'Desconectada', tone: 'bad' },
    };
    const AVAILABILITY = {
        available: { label: 'Disponível', tone: 'ok' },
        extra: { label: 'Online fora do turno', tone: 'info' },
        missing: { label: 'Ausente no turno', tone: 'bad' },
        off: { label: 'Fora do turno', tone: 'idle' },
    };
    const PROVIDER_LABEL = { privacy: 'Privacy', onlyfans: 'OnlyFans' };

    function duration(ms) {
        const totalMin = Math.max(0, Math.round(ms / 60_000));
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        if (h && m) return `${h}h ${m}min`;
        if (h) return `${h}h`;
        return `${m} min`;
    }

    function sameDay(a, b) {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    /** "hoje 23:20", "amanhã 02:00", "qua 14:00", "12/11 09:00". */
    function when(isoString) {
        const d = new Date(isoString);
        const now = new Date(serverNow());
        const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        if (sameDay(d, now)) return `hoje ${time}`;
        const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
        if (sameDay(d, tomorrow)) return `amanhã ${time}`;
        const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
        if (sameDay(d, yesterday)) return `ontem ${time}`;
        if (Math.abs(d - now) < 6 * 86_400_000) {
            return `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} ${time}`;
        }
        return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`;
    }

    const ago = (isoString) => `há ${duration(serverNow() - Date.parse(isoString))}`;
    const until = (isoString) => duration(Date.parse(isoString) - serverNow());

    /* ---------- DOM ---------- */

    function el(tag, attrs = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'dataset') Object.assign(node.dataset, v);
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v === true ? '' : v);
        }
        for (const c of children.flat()) {
            if (c == null || c === false) continue;
            node.append(c instanceof Node ? c : document.createTextNode(String(c)));
        }
        return node;
    }

    const pill = ({ label, tone }) => el('span', { class: `pn-pill ${tone}` }, label);

    function meter(fraction) {
        const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
        return el('div', { class: 'pn-meter', role: 'presentation' }, el('i', { style: `width:${pct}%` }));
    }

    /* ---------- Telas ---------- */

    function showLogin(message) {
        stopPolling();
        document.title = BASE_TITLE;
        $('view-panel').hidden = true;
        $('view-login').hidden = false;
        const err = $('login-error');
        err.hidden = !message;
        err.textContent = message || '';
        $('login-email').focus();
    }

    function showPanel() {
        $('view-login').hidden = true;
        $('view-panel').hidden = false;
        refreshPush().catch(() => {});
    }

    /* ---------- Login ---------- */

    async function onLogin(ev) {
        ev.preventDefault();
        const email = $('login-email').value.trim();
        const password = $('login-password').value;
        const remember = $('login-remember').checked;
        const err = $('login-error');
        const btn = $('login-submit');

        if (!email || !password) {
            err.hidden = false;
            err.textContent = 'Informe seu e-mail e senha para continuar.';
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Entrando…';
        err.hidden = true;
        try {
            const res = await request('/api/auth/login', { method: 'POST', body: { email, password } });
            if (!res.token) {
                throw new ApiError('O servidor não emitiu a sessão do painel. Avise o suporte do Beeflow.', 503, 'NO_TOKEN');
            }
            state.session = { token: res.token, name: res.user && res.user.name };
            const data = await fetchOverview();
            saveSession(state.session, remember);
            $('login-password').value = '';
            showPanel();
            render(data);
            startPolling();
        } catch (e) {
            state.session = null;
            err.hidden = false;
            err.textContent = e.message;
        } finally {
            btn.disabled = false;
            btn.textContent = 'Entrar';
        }
    }

    function logout() {
        // Aparelho compartilhado não segue recebendo avisos da conta que saiu.
        disablePush({ quiet: true });
        clearSession();
        state.session = null;
        state.data = null;
        closeRemote();
        showLogin();
    }

    /* ---------- Dados ---------- */

    async function fetchOverview() {
        const data = await request('/api/panel/overview', { token: state.session.token });
        state.skew = Date.parse(data.server_now) - Date.now();
        state.fetchedAt = Date.now();
        state.data = data;
        return data;
    }

    async function refresh() {
        if (state.loading || !state.session) return;
        state.loading = true;
        try {
            const data = await fetchOverview();
            $('panel-error').hidden = true;
            render(data);
        } catch (e) {
            if (e.status === 401 || e.status === 403) {
                clearSession();
                state.session = null;
                showLogin(e.status === 401 ? 'Sua sessão expirou. Entre novamente.' : e.message);
                return;
            }
            // Falha passageira: mantém o último dado na tela e avisa.
            $('panel-error').hidden = false;
            $('panel-error').textContent = state.data
                ? `${e.message} Mostrando os dados de ${duration(Date.now() - state.fetchedAt)} atrás.`
                : e.message;
        } finally {
            state.loading = false;
            tick();
        }
    }

    function startPolling() {
        stopPolling();
        state.timer = setInterval(() => {
            if (!document.hidden) refresh();
        }, REFRESH_MS);
    }
    function stopPolling() {
        clearInterval(state.timer);
        state.timer = null;
    }

    /* ---------- Render ---------- */

    function render(data) {
        const { viewer, account, summary } = data;
        $('viewer-name').textContent = viewer.name || viewer.email;
        $('account-title').textContent = account.name && !viewer.is_owner ? account.name : 'Operação';
        $('account-sub').textContent = viewer.is_owner
            ? 'Todas as criadoras e a equipe da sua conta.'
            : 'As criadoras vinculadas a você e a equipe da conta.';

        renderKpis(summary, account);
        renderCreators(data.creators);
        renderTeam(data.team, summary.activity_visible, data.usage_window_minutes);

        // Quantas criadoras pedem ação: no título da aba e no ícone do app instalado.
        const needs = data.creators.filter((c) => c.health !== 'stable').length;
        document.title = needs ? `(${needs}) ${BASE_TITLE}` : BASE_TITLE;
        try {
            if ('setAppBadge' in navigator) (needs ? navigator.setAppBadge(needs) : navigator.clearAppBadge()).catch(() => {});
        } catch { /* sem suporte */ }
    }

    function kpi({ label, value, total, foot, tone, live }) {
        return el('div', { class: `pn-kpi${tone ? ` is-${tone}` : ''}` },
            el('span', { class: 'pn-kpi-label' }, label),
            el('span', { class: 'pn-kpi-value', ...(live ? { 'data-live': live } : {}) },
                value, total != null ? el('small', {}, ` / ${total}`) : null),
            foot ? el('span', { class: 'pn-kpi-foot' }, foot) : null,
        );
    }

    function renderKpis(summary, account) {
        const c = summary.creators;
        const t = summary.team;
        const attention = c.total - c.stable;
        const next = c.next_expiry;

        const cards = [
            kpi({
                label: 'Criadoras estáveis',
                value: c.stable,
                total: c.total,
                foot: attention ? `${attention} pede${attention > 1 ? 'm' : ''} atenção` : 'Tudo em ordem',
                tone: c.down ? 'bad' : (c.expiring || c.unstable) ? 'warn' : null,
            }),
            kpi({
                label: 'Próxima reconexão',
                value: next ? until(next.at) : '—',
                foot: next ? `${next.name}, ${when(next.at)}` : 'Nenhuma sessão com validade',
                tone: next && Date.parse(next.at) - serverNow() < 3600_000 ? 'warn' : null,
                live: next ? `until:${next.at}` : null,
            }),
            kpi({
                label: 'Chatters online',
                value: t.chatters_online,
                total: t.chatters_total,
                foot: t.missing ? `${t.missing} ausente${t.missing > 1 ? 's' : ''} no turno` : 'Ninguém faltando no turno',
                tone: t.missing ? 'warn' : null,
            }),
            kpi({ label: 'Gestores online', value: t.managers_online, total: t.managers_total }),
            kpi({ label: 'Disponíveis agora', value: t.available, foot: 'Online e no turno' }),
            kpi({ label: 'Horas hoje', value: duration(t.today_clocked_sec * 1000), foot: 'Soma da equipe' }),
        ];
        if (account.seats) {
            const { used, limit } = account.seats;
            cards.push(kpi({
                label: 'Uso do plano',
                value: used,
                total: limit || '—',
                foot: limit ? `${Math.max(0, limit - used)} vaga${limit - used === 1 ? '' : 's'} de criadora` : 'Criadoras cadastradas',
                tone: limit && used >= limit ? 'warn' : null,
            }));
        }
        $('kpis').replaceChildren(...cards);
    }

    function creatorExpiry(c) {
        const s = c.session;
        if (!s.active) {
            const since = s.last_drop_at || s.connected_at;
            return el('div', { class: 'pn-creator-expiry' },
                el('strong', {}, 'Sem sessão ativa'),
                el('span', {}, since ? `Caiu ${ago(since)}. A equipe está sem acesso.` : 'Ainda não foi conectada.'));
        }
        if (!s.expires_at) {
            return el('div', { class: 'pn-creator-expiry' },
                el('strong', {}, 'Validade desconhecida'),
                el('span', {}, 'Sessão antiga, sem data de vencimento. Reconecte para acompanhar.'));
        }
        const left = Date.parse(s.expires_at) - serverNow();
        if (left <= 0) {
            return el('div', { class: 'pn-creator-expiry' },
                el('strong', {}, 'Sessão expirada'),
                el('span', { 'data-live': `ago:${s.expires_at}`, 'data-prefix': 'Venceu ' }, `Venceu ${ago(s.expires_at)}`));
        }
        return el('div', { class: 'pn-creator-expiry' },
            el('strong', { 'data-live': `until:${s.expires_at}`, 'data-prefix': 'Reconectar em ' }, `Reconectar em ${until(s.expires_at)}`),
            el('span', {}, `A sessão vence ${when(s.expires_at)}`),
            meter(left / SESSION_SPAN_MS));
    }

    function creatorNote(c) {
        const s = c.session;
        if (s.pending_reports) {
            return `${s.pending_reports} chatter${s.pending_reports > 1 ? 's relataram' : ' relatou'} falha nesta sessão na última meia hora.`;
        }
        if (s.drops_7d >= 2) return `Caiu ${s.drops_7d} vezes nos últimos 7 dias.`;
        return null;
    }

    function renderCreators(creators) {
        if (!creators.length) {
            $('creators').replaceChildren(el('p', { class: 'pn-empty' }, 'Nenhuma criadora vinculada a esta conta.'));
            return;
        }
        $('creators').replaceChildren(...creators.map((c) => {
            const health = HEALTH[c.health] || HEALTH.stable;
            // Destaque só para quem está fora do ar ou vencendo; instável é atenção, não emergência.
            const urgent = ['expired', 'disconnected', 'expiring'].includes(c.health);
            const note = creatorNote(c);
            return el('article', { class: 'pn-creator', dataset: { health: c.health } },
                el('div', { class: 'pn-creator-head' },
                    el('div', {},
                        el('div', { class: 'pn-creator-name' }, c.name),
                        el('div', { class: 'pn-creator-provider' }, PROVIDER_LABEL[c.provider] || c.provider)),
                    pill(health)),
                creatorExpiry(c),
                el('dl', { class: 'pn-creator-facts' },
                    el('div', {}, el('dt', {}, 'Chatters online'), el('dd', {}, `${c.team.online} de ${c.team.assigned}`)),
                    el('div', {}, el('dt', {}, 'Quedas em 7 dias'), el('dd', {}, String(c.session.drops_7d))),
                    el('div', {}, el('dt', {}, 'Conectada'), el('dd', {}, c.session.connected_at ? when(c.session.connected_at) : '—')),
                    el('div', {}, el('dt', {}, 'Reconexões em 7 dias'), el('dd', {}, String(c.session.reconnects_7d)))),
                note ? el('p', { class: 'pn-creator-note' }, note) : null,
                el('div', { class: 'pn-creator-actions' },
                    el('button', {
                        type: 'button',
                        class: `pn-btn ${urgent ? 'pn-btn-primary' : 'pn-btn-outline'}`,
                        onclick: () => openReconnect(c),
                    }, 'Reconectar')),
            );
        }));
    }

    function teamMatches(m) {
        if (state.filter === 'online') return m.online;
        if (state.filter === 'available') return m.availability === 'available';
        if (state.filter === 'missing') return m.availability === 'missing';
        return true;
    }

    function renderTeam(team, activityVisible, windowMin) {
        const counts = {
            all: team.length,
            online: team.filter((m) => m.online).length,
            available: team.filter((m) => m.availability === 'available').length,
            missing: team.filter((m) => m.availability === 'missing').length,
        };
        for (const btn of $('team-filters').querySelectorAll('button')) {
            const f = btn.dataset.filter;
            btn.setAttribute('aria-selected', String(f === state.filter));
            let count = btn.querySelector('.pn-count');
            if (!count) { count = el('span', { class: 'pn-count' }); btn.append(count); }
            count.textContent = String(counts[f]);
        }

        const table = $('team').closest('table');
        table.classList.toggle('no-usage', !activityVisible);
        table.querySelector('th.col-usage').textContent = `Uso (${windowMin} min)`;

        const creatorNames = new Map((state.data.creators || []).map((c) => [c.id, c.name]));
        const rows = team.filter(teamMatches);
        if (!rows.length) {
            $('team').replaceChildren(el('tr', {}, el('td', { colspan: '6', class: 'pn-empty' }, 'Ninguém aqui agora.')));
            return;
        }

        $('team').replaceChildren(...rows.map((m) => {
            const av = AVAILABILITY[m.availability] || AVAILABILITY.off;
            const presence = m.online
                ? (m.clock_in_at ? `No ponto desde ${when(m.clock_in_at)}` : 'App aberto')
                : (m.last_seen_at ? `Visto ${ago(m.last_seen_at)}` : 'Sem registro recente');

            let shift;
            if (m.shift.on_shift_now) shift = [`Até ${when(m.shift.ends_at)}`, 'Em turno agora'];
            else if (m.shift.next_starts_at) shift = [`Próximo: ${when(m.shift.next_starts_at)}`, `Começa em ${until(m.shift.next_starts_at)}`];
            else shift = [m.shift.has_schedule ? '—' : 'Sem escala', null];

            const usage = m.active_window_sec == null
                ? el('span', { class: 'pn-muted' }, '—')
                : el('div', { class: 'pn-usage', title: `${Math.round(m.active_window_sec / 60)} min ativos nos últimos ${windowMin} min` },
                    meter(m.active_window_sec / (windowMin * 60)),
                    el('span', {}, `${Math.round((m.active_window_sec / (windowMin * 60)) * 100)}%`));

            const names = m.creator_ids.map((id) => creatorNames.get(id)).filter(Boolean);

            return el('tr', {},
                el('td', {}, el('div', { class: 'pn-person' },
                    el('strong', {}, m.name),
                    el('span', {}, ROLE_LABEL[m.role] || m.role))),
                el('td', { 'data-label': 'Situação' }, el('div', {}, pill(av), el('span', { class: 'pn-sub' }, presence))),
                el('td', { 'data-label': 'Turno' }, el('div', {}, shift[0], shift[1] ? el('span', { class: 'pn-sub' }, shift[1]) : null)),
                el('td', { 'data-label': 'Horas hoje', class: 'pn-tnum' }, m.today_clocked_sec ? duration(m.today_clocked_sec * 1000) : '—'),
                el('td', { 'data-label': 'Uso agora', class: 'col-usage' }, usage),
                el('td', { 'data-label': 'Criadoras' }, names.length
                    ? el('div', { class: 'pn-chips' }, names.map((n) => el('span', { class: 'pn-chip' }, n)))
                    : el('span', { class: 'pn-muted' }, '—')),
            );
        }));
    }

    /* ---------- Relógio ---------- */

    // A cada segundo: contagens regressivas e "atualizado há". Não refaz a tela.
    function tick() {
        if (!state.data) return;
        for (const node of document.querySelectorAll('[data-live]')) {
            const [kind, at] = node.dataset.live.split(/:(.+)/);
            const text = kind === 'until' ? until(at) : ago(at);
            const prefix = node.dataset.prefix || '';
            // KPI tem um <small> filho em alguns casos; aqui só texto.
            if (node.firstChild && node.firstChild.nodeType === Node.TEXT_NODE) node.firstChild.textContent = prefix + text;
            else node.textContent = prefix + text;
        }
        const age = Date.now() - state.fetchedAt;
        const label = $('refresh-state');
        label.textContent = state.loading ? 'Atualizando…' : age < 5000 ? 'Atualizado agora' : `Atualizado ${ago(new Date(serverNow() - age).toISOString())}`;
        label.classList.toggle('is-stale', age > REFRESH_MS * 3);
    }

    /* ---------- Reconectar: navegador remoto ---------- */

    const RC_STATUS_MS = 2000;
    const RC_TEXT = {
        starting: 'Abrindo o navegador no servidor…',
        ready: 'Toque na tela para clicar e digitar. Quando entrar na conta, a sessão é salva sozinha.',
        saving: 'Salvando a sessão…',
    };

    /** Login remoto aberto: { id, creator, viewport, seq, frameUrl, timers, closed } */
    let rc = null;

    function rcOverlay(text, tone) {
        const o = $('rc-overlay');
        o.hidden = !text;
        o.className = `pn-remote-overlay${tone ? ` is-${tone}` : ''}`;
        $('rc-overlay-text').textContent = text || '';
        $('rc-retry').hidden = tone !== 'bad';
    }

    function remoteFetch(path, opts = {}) {
        return fetch(`${API}/api/panel/remote-login${path}`, {
            ...opts,
            headers: {
                Authorization: `Bearer ${state.session.token}`,
                ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
            },
        });
    }

    /** Tamanho da tela remota: o espaço que o diálogo tem, para não precisar de zoom. */
    function remoteViewport() {
        const mobile = window.innerWidth <= 760;
        const width = mobile ? window.innerWidth - 16 : Math.min(1100, window.innerWidth - 32) - 40;
        const height = window.innerHeight - (mobile ? 170 : 230);
        return { width: Math.round(width), height: Math.round(height) };
    }

    function openReconnect(creator) {
        lastCreator = creator;
        closeRemote();
        $('rc-name').textContent = creator.name;
        $('rc-frame').removeAttribute('src');
        $('rc-frame').alt = `Tela de login da ${PROVIDER_LABEL[creator.provider] || creator.provider}`;
        $('rc-status').textContent = '';
        $('rc-finish').disabled = true;
        $('reconnect-dialog').showModal();
        startRemote(creator);
    }

    async function startRemote(creator) {
        const session = { id: null, creator, viewport: null, seq: 0, frameUrl: null, timers: [], closed: false, queue: Promise.resolve() };
        rc = session;
        rcOverlay(RC_TEXT.starting);

        const vp = remoteViewport();
        let res;
        let data = null;
        try {
            res = await remoteFetch('', { method: 'POST', body: JSON.stringify({ creatorId: creator.id, ...vp }) });
            data = await res.json().catch(() => null);
        } catch {
            if (rc === session) rcOverlay('Sem conexão com o servidor. Verifique sua internet.', 'bad');
            return;
        }
        if (rc !== session) {
            // Cancelado enquanto abria: fecha o que acabou de abrir.
            if (data && data.id) remoteFetch(`/${data.id}`, { method: 'DELETE' }).catch(() => {});
            return;
        }
        if (!res.ok || !data || !data.ok) {
            rcOverlay((data && data.error) || 'Não foi possível abrir o navegador. Tente de novo.', 'bad');
            return;
        }

        session.id = data.id;
        session.viewport = data.viewport;
        session.loginHost = new URL(data.login_url).hostname;
        rcOverlay(`Carregando a página de login da ${data.provider_label}…`);
        $('rc-frame').style.aspectRatio = `${data.viewport.width} / ${data.viewport.height}`;
        frameLoop(session);
        session.timers.push(setInterval(() => statusCheck(session), RC_STATUS_MS));
        statusCheck(session);
    }

    async function frameLoop(session) {
        while (rc === session && !session.closed) {
            let res;
            try {
                res = await remoteFetch(`/${session.id}/frame?after=${session.seq}`);
            } catch {
                await new Promise((r) => setTimeout(r, 1500));
                continue;
            }
            if (rc !== session) return;
            if (res.status === 404) return statusCheck(session);
            if (res.status === 200) {
                const blob = await res.blob();
                if (rc !== session) return;
                session.seq = Number(res.headers.get('x-frame-seq')) || session.seq + 1;
                const url = URL.createObjectURL(blob);
                $('rc-frame').src = url;
                if (session.frameUrl) URL.revokeObjectURL(session.frameUrl);
                session.frameUrl = url;
                // Primeiros quadros são a aba em branco: só mostra a tela quando a plataforma abriu.
                if (session.loaded && !$('rc-overlay').classList.contains('is-ok') && !$('rc-overlay').classList.contains('is-bad')) {
                    rcOverlay(null);
                    $('rc-status').textContent = RC_TEXT.ready;
                    $('rc-finish').disabled = false;
                }
            }
            const status = res.headers.get('x-remote-status');
            if (status && status !== 'ready' && status !== 'starting') return statusCheck(session);
        }
    }

    async function statusCheck(session) {
        if (rc !== session || !session.id || session.closed) return;
        let data;
        try {
            const res = await remoteFetch(`/${session.id}`);
            data = await res.json();
            if (res.status === 404) data = { status: 'closed', error: data && data.error };
        } catch {
            return;
        }
        if (rc !== session) return;
        if (!session.loaded && data.page_host && session.loginHost && data.page_host.endsWith(session.loginHost.replace(/^www\./, ''))) {
            session.loaded = true;
            if (session.frameUrl && data.status === 'ready') {
                rcOverlay(null);
                $('rc-status').textContent = RC_TEXT.ready;
                $('rc-finish').disabled = false;
            }
        }
        if (data.status === 'saving') {
            rcOverlay(RC_TEXT.saving);
        } else if (data.status === 'captured') {
            endRemote(session);
            const until = data.session_expires_at ? ` Válida até ${when(data.session_expires_at)}.` : '';
            rcOverlay(`${session.creator.name} reconectada.${until} Os chatters já podem usar.`, 'ok');
            $('rc-status').textContent = '';
            $('rc-finish').disabled = true;
            toast(`${session.creator.name} reconectada.${until}`);
            refresh();
            setTimeout(() => { if (rc === session) closeDialog(); }, 3500);
        } else if (data.status === 'failed' || data.status === 'closed') {
            endRemote(session);
            rcOverlay(data.error || 'O navegador foi fechado por inatividade. Comece de novo.', 'bad');
            $('rc-finish').disabled = true;
        }
    }

    /** Para os laços deste login, sem fechar o diálogo. */
    function endRemote(session) {
        session.closed = true;
        session.timers.forEach(clearInterval);
        session.timers = [];
    }

    /** Fecha o login remoto (no servidor também) e limpa a tela. */
    function closeRemote() {
        const session = rc;
        rc = null;
        if (!session) return;
        const wasOpen = !session.closed;
        endRemote(session);
        if (session.id && wasOpen) remoteFetch(`/${session.id}`, { method: 'DELETE' }).catch(() => {});
        if (session.frameUrl) URL.revokeObjectURL(session.frameUrl);
    }

    function closeDialog() {
        closeRemote();
        const dlg = $('reconnect-dialog');
        if (dlg.open) dlg.close();
    }

    /** Entrada em ordem: cliques e letras não podem chegar trocados. */
    function sendInput(payload) {
        const session = rc;
        if (!session || !session.id || session.closed) return;
        session.queue = session.queue
            .then(() => remoteFetch(`/${session.id}/input`, { method: 'POST', body: JSON.stringify(payload) }))
            .catch(() => {});
    }

    /** Ponto na imagem → ponto na página remota. */
    function remotePoint(ev) {
        const img = $('rc-frame');
        const rect = img.getBoundingClientRect();
        if (!rc || !rc.viewport || !rect.width) return null;
        const x = ((ev.clientX - rect.left) / rect.width) * rc.viewport.width;
        const y = ((ev.clientY - rect.top) / rect.height) * rc.viewport.height;
        if (x < 0 || y < 0 || x > rc.viewport.width || y > rc.viewport.height) return null;
        return { x: Math.round(x), y: Math.round(y) };
    }

    const SPECIAL_KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

    function bindRemoteInput() {
        const screen = $('rc-screen');
        const keys = $('rc-keys');
        let down = null;
        let scrollAcc = 0;
        let scrollTimer = null;

        const flushScroll = (point) => {
            if (scrollAcc && point) sendInput({ type: 'scroll', ...point, dy: Math.round(scrollAcc) });
            scrollAcc = 0;
            scrollTimer = null;
        };

        screen.addEventListener('pointerdown', (ev) => {
            if (ev.target.closest('button')) return;
            down = { x: ev.clientX, y: ev.clientY, lastY: ev.clientY, moved: false };
            screen.setPointerCapture(ev.pointerId);
        });
        // Arrastar (dedo no celular) rola a página remota.
        screen.addEventListener('pointermove', (ev) => {
            if (!down) return;
            if (Math.abs(ev.clientY - down.y) > 8) down.moved = true;
            if (!down.moved) return;
            const rect = $('rc-frame').getBoundingClientRect();
            const scale = rc && rc.viewport ? rc.viewport.height / rect.height : 1;
            scrollAcc += (down.lastY - ev.clientY) * scale;
            down.lastY = ev.clientY;
            const point = remotePoint({ clientX: down.x, clientY: down.y });
            if (!scrollTimer) scrollTimer = setTimeout(() => flushScroll(point), 80);
        });
        screen.addEventListener('pointerup', (ev) => {
            const d = down;
            down = null;
            if (!d || d.moved || ev.target.closest('button')) return;
            const point = remotePoint(ev);
            if (!point) return;
            sendInput({ type: 'click', ...point });
            // Abre o teclado (inclusive o do celular) para o que vier depois do clique.
            keys.focus({ preventScroll: true });
        });
        screen.addEventListener('wheel', (ev) => {
            ev.preventDefault();
            scrollAcc += ev.deltaY;
            const point = remotePoint(ev);
            if (!scrollTimer) scrollTimer = setTimeout(() => flushScroll(point), 80);
        }, { passive: false });

        keys.addEventListener('focus', () => screen.classList.add('is-focused'));
        keys.addEventListener('blur', () => screen.classList.remove('is-focused'));
        keys.addEventListener('keydown', (ev) => {
            if (SPECIAL_KEYS.has(ev.key)) {
                // Esc e Tab são do navegador remoto enquanto o foco está nele.
                ev.preventDefault();
                ev.stopPropagation();
                sendInput({ type: 'key', key: ev.key });
            }
        });
        keys.addEventListener('input', () => {
            const text = keys.value;
            keys.value = '';
            if (text) sendInput({ type: 'type', text: text.slice(0, 500) });
        });
        keys.addEventListener('paste', (ev) => {
            ev.preventDefault();
            const text = (ev.clipboardData && ev.clipboardData.getData('text')) || '';
            if (text) sendInput({ type: 'type', text: text.slice(0, 500) });
        });

        $('rc-close').addEventListener('click', closeDialog);
        $('rc-retry').addEventListener('click', () => {
            if (!lastCreator) return;
            closeRemote();
            startRemote(lastCreator);
        });
        $('rc-finish').addEventListener('click', async () => {
            const session = rc;
            if (!session || !session.id) return;
            const res = await remoteFetch(`/${session.id}/finish`, { method: 'POST' }).catch(() => null);
            const data = res ? await res.json().catch(() => null) : null;
            if (res && res.status === 409) $('rc-status').textContent = data.error;
            else statusCheck(session);
        });
        const dlg = $('reconnect-dialog');
        dlg.addEventListener('cancel', (ev) => {
            // Esc fora do campo de teclado fecha; dentro dele, já foi para a página remota.
            if (document.activeElement === keys) ev.preventDefault();
        });
        dlg.addEventListener('close', () => closeRemote());
    }

    /** Criadora do último "Reconectar", para o "Tentar de novo". */
    let lastCreator = null;

    /* ---------- Notificação no celular (Web Push) ---------- */
    //
    // Mesmo desenho do devxviral (components/admin/notificacoes-celular.tsx).
    // No iPhone só funciona com o painel instalado na Tela de Início (iOS 16.4+):
    // no Safari comum o PushManager nem existe. Por isso o primeiro estado do
    // iPhone é a instrução de instalar, e não um botão que não faria nada.
    //
    // A inscrição é por APARELHO: cada celular ou computador ativa o seu. O
    // service worker (sw.js) não tem handler de fetch, então registrá-lo não muda
    // nada no carregamento do site. Na API: src/lib/push.ts.

    const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    // iPad com iPadOS se apresenta como Mac; o toque é o que entrega.
    const isIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

    const PUSH_TEXT = {
        instalar_no_iphone: ['Receba os avisos no iPhone', null],
        bloqueado: ['Notificações bloqueadas neste aparelho', 'Libere as notificações do Beeflow nos ajustes do navegador ou do iPhone e volte aqui.'],
        inativo: ['Receba os avisos no celular', 'Criadora vencendo ou caindo, falha relatada pelos chatters e ausência no turno. Cada aparelho ativa o seu.'],
        ativo: ['Notificações ligadas neste aparelho', 'Criadoras vencendo ou caindo e ausências no turno chegam aqui.'],
    };

    const push = { state: null, busy: false };

    /** A chave VAPID vem em base64url; o subscribe quer os bytes. */
    function keyBytes(b64url) {
        const padded = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
        return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    }

    async function currentSubscription() {
        const reg = await navigator.serviceWorker.getRegistration('/');
        return (reg && (await reg.pushManager.getSubscription())) || null;
    }

    async function refreshPush() {
        push.state = await request('/api/panel/push', { token: state.session.token }).catch(() => null);
        let situation;
        if (!pushSupported()) situation = isIphone() && !isStandalone() ? 'instalar_no_iphone' : 'sem_suporte';
        else if (Notification.permission === 'denied') situation = 'bloqueado';
        else {
            const sub = await currentSubscription().catch(() => null);
            situation = sub && push.state && push.state.endpoints.includes(sub.endpoint) ? 'ativo' : 'inativo';
        }
        renderPush(situation);
    }

    function renderPush(situation) {
        const card = $('push-card');
        // Sem as chaves no servidor, ou num navegador sem push: nada de cartão
        // que não leva a lugar nenhum.
        if (!push.state || !push.state.ligado || situation === 'sem_suporte') {
            card.hidden = true;
            return;
        }
        card.hidden = false;
        const [title, desc] = PUSH_TEXT[situation];
        $('push-title').textContent = title;
        const d = $('push-desc');
        if (situation === 'instalar_no_iphone') {
            d.replaceChildren('No Safari, toque em ', el('strong', {}, 'Compartilhar'), ' e depois em ',
                el('strong', {}, 'Adicionar à Tela de Início'), '. Abra o Beeflow pelo ícone, entre na conta e ative aqui.');
        } else {
            d.textContent = desc;
        }
        $('push-on').hidden = situation !== 'inativo';
        $('push-test').hidden = situation !== 'ativo';
        $('push-off').hidden = situation !== 'ativo';
    }

    function pushBusy(on) {
        push.busy = on;
        for (const id of ['push-on', 'push-test', 'push-off']) $(id).disabled = on;
    }

    async function enablePush() {
        const key = push.state && push.state.chave_publica;
        if (!key || push.busy) return;
        pushBusy(true);
        try {
            // A permissão primeiro, ainda dentro do toque: o Safari recusa o pedido
            // que chega depois de outro await, por não ser mais gesto do usuário.
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                renderPush(permission === 'denied' ? 'bloqueado' : 'inativo');
                return;
            }
            const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            await navigator.serviceWorker.ready;
            const sub = (await reg.pushManager.getSubscription())
                || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
            await request('/api/panel/push/inscrever', {
                method: 'POST',
                token: state.session.token,
                body: { ...sub.toJSON(), aparelho: navigator.userAgent.slice(0, 300) },
            });
            await refreshPush();
            const { entregues } = await request('/api/panel/push/teste', { method: 'POST', token: state.session.token });
            toast(entregues
                ? 'Pronto. A notificação de teste deve chegar em alguns segundos.'
                : 'Ativado, mas o teste não saiu. Tente Enviar teste em instantes.');
        } catch (e) {
            toast(e.message || 'Não foi possível ativar. Tente de novo.');
        } finally {
            pushBusy(false);
        }
    }

    async function disablePush({ quiet = false } = {}) {
        if (!state.session || !pushSupported()) return;
        const token = state.session.token;
        if (!quiet) pushBusy(true);
        try {
            const sub = await currentSubscription();
            if (sub) {
                await request('/api/panel/push/desinscrever', { method: 'POST', token, body: { endpoint: sub.endpoint } });
                await sub.unsubscribe();
            }
            if (!quiet) await refreshPush();
        } catch (e) {
            if (!quiet) toast(e.message);
        } finally {
            if (!quiet) pushBusy(false);
        }
    }

    async function testPush() {
        pushBusy(true);
        try {
            const { entregues } = await request('/api/panel/push/teste', { method: 'POST', token: state.session.token });
            toast(entregues ? 'Teste enviado. Deve chegar em alguns segundos.' : 'Nenhum aparelho recebeu o teste. Desligue e ative de novo.');
        } catch (e) {
            toast(e.message);
        } finally {
            pushBusy(false);
        }
    }

    function bindPush() {
        $('push-on').addEventListener('click', enablePush);
        $('push-test').addEventListener('click', testPush);
        $('push-off').addEventListener('click', () => disablePush());
    }

    let toastTimer = null;
    function toast(message) {
        const t = $('toast');
        t.textContent = message;
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
    }

    /* ---------- Início ---------- */

    async function boot() {
        bindPush();
        // No app instalado o sessionStorage some ao fechar: lá, manter conectado é o padrão.
        if (isStandalone()) $('login-remember').checked = true;
        $('login-form').addEventListener('submit', onLogin);
        $('logout').addEventListener('click', logout);
        $('refresh-now').addEventListener('click', refresh);
        bindRemoteInput();
        // Fechar a aba no meio do login: avisa o servidor para fechar o Chrome.
        window.addEventListener('pagehide', () => {
            if (rc && rc.id && !rc.closed) {
                fetch(`${API}/api/panel/remote-login/${rc.id}`, {
                    method: 'DELETE', keepalive: true, headers: { Authorization: `Bearer ${state.session.token}` },
                }).catch(() => {});
            }
        });
        $('team-filters').addEventListener('click', (ev) => {
            const btn = ev.target.closest('button[data-filter]');
            if (!btn || !state.data) return;
            state.filter = btn.dataset.filter;
            renderTeam(state.data.team, state.data.summary.activity_visible, state.data.usage_window_minutes);
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && state.session && Date.now() - state.fetchedAt > 10_000) refresh();
        });
        setInterval(tick, 1000);

        state.session = loadSession();
        if (!state.session) return showLogin();

        showPanel();
        $('refresh-state').textContent = 'Carregando…';
        await refresh();
        if (state.session) startPolling();
    }

    boot();
})();
