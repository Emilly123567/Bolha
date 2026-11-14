/* ============================================================
   BOLHA · servidor multiplayer (para o Render)
   Node.js puro, sem nenhuma dependência: HTTP + WebSocket
   escritos à mão. Tudo fica na memória.

   Cada jogador roda o PRÓPRIO jogo no próprio aparelho (sem atraso
   de comando). O servidor só repassa: posição, aparência, efeitos de
   habilidade, domínios (cúpulas tier 3) e chat.

   GET  /        → o jogo (caca-prismas.html desta pasta)
   GET  /status  → "ok" (o Render usa para saber se está vivo)
   GET  /salas   → salas abertas (JSON)
   WS   /ws      → conexão do jogo

   cliente → servidor: {t:'entrar', sala:'MUNDO'|'NOVA'|código, nome, look, ti, au, it, mo}
                       {t:'p', ...} {t:'perfil', ...} {t:'fx', ...} {t:'zona', ...} {t:'chat', txt} {t:'ping', c}
   servidor → cliente: {t:'sala', sala, id, jogadores:[...]} {t:'entrou', ...} {t:'tchau', i}
                       e as mensagens dos outros, com i = id de quem mandou
   ============================================================ */
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORTA = process.env.PORT || 8790;
const MAX_SALA = 30, MAX_MSG = 32 * 1024, MAX_SALAS = 400;
const salas = new Map(); // código → { codigo, criada, membros: Map(id → cliente) }
let proxId = 1, jogoHtml = null;

const novoCodigo = () => { let c; do { c = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join(''); } while (salas.has(c)); return c; };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const num = (v, lim) => { v = +v; return Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0; };

// ---------- HTTP ----------
const servidor = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (url === '/status') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url === '/salas') {
    const lista = [...salas.values()].map((s) => ({ sala: s.codigo, jogadores: s.membros.size, max: MAX_SALA }));
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors));
    return res.end(JSON.stringify(lista));
  }
  if (url === '/' || url === '/index.html') {
    const arq = path.join(__dirname, 'caca-prismas.html');
    if (!jogoHtml && fs.existsSync(arq)) jogoHtml = Buffer.from(fs.readFileSync(arq, 'utf8').replace('<head>', '<head><script>window.CP_SERVIDOR = location.origin;</script>'));
    if (jogoHtml) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(jogoHtml); }
  }
  res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, cors));
  res.end('Bolha · servidor multiplayer ok · ' + salas.size + ' sala(s), ' + [...salas.values()].reduce((a, s) => a + s.membros.size, 0) + ' jogador(es)');
});

// ---------- WebSocket (RFC 6455, só o necessário) ----------
servidor.on('upgrade', (req, socket) => {
  if (req.url.split('?')[0] !== '/ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const chave = req.headers['sec-websocket-key']; if (!chave) { socket.destroy(); return; }
  const aceite = crypto.createHash('sha1').update(chave + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + aceite + '\r\n\r\n');
  socket.setNoDelay(true);
  novoCliente(socket);
});
function quadro(op, dados) {
  const n = dados.length; let cab;
  if (n < 126) { cab = Buffer.alloc(2); cab[1] = n; }
  else if (n < 65536) { cab = Buffer.alloc(4); cab[1] = 126; cab.writeUInt16BE(n, 2); }
  else { cab = Buffer.alloc(10); cab[1] = 127; cab.writeBigUInt64BE(BigInt(n), 2); }
  cab[0] = 0x80 | op;
  return Buffer.concat([cab, dados]);
}
function novoCliente(socket) {
  const c = { id: 'j' + (proxId++).toString(36) + crypto.randomBytes(2).toString('hex'), socket, buf: Buffer.alloc(0), sala: null, vivo: Date.now(), msgs: 0, janela: Date.now(), perfil: null, p: null };
  c.enviar = (obj) => { if (socket.writable) socket.write(quadro(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)))); };
  socket.on('data', (d) => {
    c.buf = Buffer.concat([c.buf, d]);
    if (c.buf.length > MAX_MSG * 2) return socket.destroy();
    for (;;) {
      if (c.buf.length < 2) return;
      const b0 = c.buf[0], b1 = c.buf[1], op = b0 & 0x0f, mask = b1 & 0x80; let n = b1 & 0x7f, p = 2;
      if (n === 126) { if (c.buf.length < 4) return; n = c.buf.readUInt16BE(2); p = 4; }
      else if (n === 127) { if (c.buf.length < 10) return; n = Number(c.buf.readBigUInt64BE(2)); p = 10; }
      if (n > MAX_MSG) return socket.destroy();
      const tot = p + (mask ? 4 : 0) + n; if (c.buf.length < tot) return;
      let dados = c.buf.subarray(p + (mask ? 4 : 0), tot);
      if (mask) { const m = c.buf.subarray(p, p + 4); dados = Buffer.from(dados); for (let i = 0; i < dados.length; i++) dados[i] ^= m[i & 3]; }
      c.buf = c.buf.subarray(tot); c.vivo = Date.now();
      if (op === 8) { socket.end(quadro(8, Buffer.alloc(0))); return; }
      if (op === 9) { socket.write(quadro(10, dados)); continue; }
      if (op === 1) { let m; try { m = JSON.parse(dados.toString('utf8')); } catch (e) { continue; } try { mensagem(c, m); } catch (e) { console.error('mensagem ruim:', e.message); } }
    }
  });
  socket.on('close', () => sair(c));
  socket.on('error', () => sair(c));
}
// ---------- salas ----------
function paraSala(s, obj, exceto) { const txt = JSON.stringify(obj); for (const m of s.membros.values()) if (m !== exceto) m.enviar(txt); }
function limparPerfil(m) {
  const look = {}; if (m.look && typeof m.look === 'object') for (const k of Object.keys(m.look).slice(0, 16)) { const v = m.look[k]; if (typeof v === 'number' || typeof v === 'string') look[k] = typeof v === 'string' ? v.slice(0, 24) : v; }
  const it = m.it && typeof m.it === 'object' ? { tipo: String(m.it.tipo || '').slice(0, 12), rar: num(m.it.rar, 20) | 0, hab: num(m.it.hab, 9999) | 0, tags: Array.isArray(m.it.tags) ? m.it.tags.slice(0, 4).map((t) => String(t).slice(0, 16)) : [] } : null;
  return { nome: String(m.nome || '?').replace(/[<>]/g, '').slice(0, 24), look, ti: num(m.ti, 50) | 0, au: num(m.au, 1), it, mo: Number.isInteger(m.mo) ? m.mo : null };
}
function mensagem(c, m) {
  if (!m || typeof m.t !== 'string') return;
  const agora = Date.now(); if (agora - c.janela > 1000) { c.janela = agora; c.msgs = 0; } if (++c.msgs > 40) return; // no máximo 40 mensagens por segundo
  if (m.t === 'entrar') {
    let cod = String(m.sala || 'MUNDO').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'MUNDO', s;
    if (cod === 'NOVA') { if (salas.size >= MAX_SALAS) return c.enviar({ t: 'erro', msg: 'O servidor está cheio. Tente mais tarde.' }); cod = novoCodigo(); }
    s = salas.get(cod);
    if (!s) { if (cod !== 'MUNDO' && m.sala !== 'NOVA' && String(m.sala).toUpperCase() !== 'NOVA') return c.enviar({ t: 'erro', msg: 'Sala não encontrada. Confira o código.' }); s = { codigo: cod, criada: agora, membros: new Map() }; salas.set(cod, s); }
    s.vazia = 0;
    if (s.membros.size >= MAX_SALA) return c.enviar({ t: 'erro', msg: 'A sala está cheia (' + MAX_SALA + ' jogadores).' });
    if (c.sala) sair(c);
    c.perfil = limparPerfil(m); c.sala = s;
    c.enviar({ t: 'sala', sala: s.codigo, id: c.id, jogadores: [...s.membros.values()].map((o) => Object.assign({ i: o.id, p: o.p }, o.perfil)) });
    s.membros.set(c.id, c); paraSala(s, Object.assign({ t: 'entrou', i: c.id }, c.perfil), c); return;
  }
  if (m.t === 'ping') return c.enviar({ t: 'pong', c: num(m.c, 1e12) });
  const s = c.sala; if (!s) return;
  let out;
  switch (m.t) {
    case 'p': c.p = { x: num(m.x, 1e5), y: num(m.y, 1e4), z: num(m.z, 1e5), r: num(m.r, 100) }; out = { t: 'p', i: c.id, x: c.p.x, y: c.p.y, z: c.p.z, r: c.p.r, a: num(m.a, 255) | 0, hp: num(m.hp, 1), bi: num(m.bi, 999) | 0, v: m.v ? 1 : 0 }; break;
    case 'perfil': c.perfil = limparPerfil(m); out = Object.assign({ t: 'perfil', i: c.id }, c.perfil); break;
    case 'fx': out = { t: 'fx', i: c.id, h: num(m.h, 9999) | 0, x: num(m.x, 1e5), z: num(m.z, 1e5), r: num(m.r, 100) }; break;
    case 'zona': out = { t: 'zona', i: c.id, el: String(m.el || '').slice(0, 10), x: num(m.x, 1e5), z: num(m.z, 1e5), dur: num(m.dur, 60) }; break;
    case 'chat': { const txt = String(m.txt || '').slice(0, 160).trim(); if (!txt) return; out = { t: 'chat', i: c.id, nome: c.perfil ? c.perfil.nome : '?', txt }; break; }
    default: return;
  }
  paraSala(s, out, c);
}
function sair(c) {
  const s = c.sala; if (!s) return; c.sala = null;
  s.membros.delete(c.id); paraSala(s, { t: 'tchau', i: c.id });
  if (!s.membros.size && s.codigo !== 'MUNDO') s.vazia = Date.now(); // sala privada vazia fica guardada 10 min (para quem cair poder voltar)
}
// ---------- vivo? (o Render e alguns roteadores derrubam conexões paradas) ----------
setInterval(() => {
  const agora = Date.now();
  for (const [cod, s] of salas) if (s.vazia && !s.membros.size && agora - s.vazia > 600000) salas.delete(cod);
  for (const s of salas.values()) for (const c of s.membros.values()) {
    if (agora - c.vivo > 70000) { c.socket.destroy(); continue; }
    if (c.socket.writable) c.socket.write(quadro(9, Buffer.alloc(0)));
  }
}, 25000);
process.on('uncaughtException', (e) => console.error('erro (o servidor continua):', e));
servidor.listen(PORTA, '0.0.0.0', () => console.log('Bolha · servidor multiplayer na porta ' + PORTA));
