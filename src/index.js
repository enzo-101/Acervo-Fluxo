import path from 'node:path';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
} from 'baileys';
import { config } from './config.js';
import { handleIncoming } from './bot.js';
import { normalize } from './baileys-message.js';
import { startScheduler, sendDailySummary } from './scheduler.js';
import { closeDb } from './db.js';

const authDir = path.join(path.dirname(config.dbPath), 'auth');
const logger = pino({ level: config.logLevel });

// O Baileys so entrega o nome do grupo mediante consulta; guardamos em memoria.
const nomesDeGrupo = new Map();

let sock = null;
let encerrando = false;
let schedulerIniciado = false;

// `npm start -- --resumo-agora` dispara o resumo uma unica vez, para testar.
let resumoManualPendente = process.argv.includes('--resumo-agora');

async function nomeDoGrupo(groupId) {
  if (nomesDeGrupo.has(groupId)) return nomesDeGrupo.get(groupId);
  try {
    const meta = await sock.groupMetadata(groupId);
    nomesDeGrupo.set(groupId, meta.subject);
    return meta.subject;
  } catch {
    nomesDeGrupo.set(groupId, null);
    return null;
  }
}

/** Envia texto para um chat. Usado pelo resumo diario. */
async function send(groupId, texto) {
  await sock.sendMessage(groupId, { text: texto });
}

function transportFor(msg) {
  return {
    reply: (texto) => sock.sendMessage(msg.key.remoteJid, { text: texto }, { quoted: msg }),
    react: async (emoji) => {
      try {
        await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
      } catch (error) {
        console.warn('[reacao] falhou:', error.message);
      }
    },
  };
}

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`🔌 Protocolo WhatsApp v${version.join('.')}${isLatest ? '' : ' (nao e a mais recente)'}`);

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.appropriate('Desktop'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 Escaneie o QR abaixo com o celular do NUMERO DO BOT');
      console.log('   (WhatsApp > Aparelhos conectados > Conectar aparelho)\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('✅ Bot online.');
      console.log(`   Banco: ${config.dbPath}`);
      console.log(`   Grupos: ${config.allowedGroups.length ? config.allowedGroups.join(', ') : 'todos'}`);
      if (!schedulerIniciado) {
        startScheduler(send);
        schedulerIniciado = true;
      }
      if (resumoManualPendente) {
        resumoManualPendente = false;
        sendDailySummary(send)
          .then(() => console.log('[resumo] disparo manual concluido'))
          .catch((error) => console.error('[resumo] erro:', error));
      }
    }

    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const deslogado = codigo === DisconnectReason.loggedOut;
      console.warn(`⚠️  Conexao caiu (${codigo ?? 'motivo desconhecido'}).`);

      if (encerrando) return;
      if (deslogado) {
        console.error(`❌ Sessao invalidada. Apague ${authDir} e escaneie o QR de novo.`);
        process.exit(1);
      }
      console.log('   Reconectando em 5s...');
      setTimeout(() => connect().catch((e) => console.error('[reconexao]', e)), 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // 'notify' = mensagem nova, em tempo real.
    // 'append' = fila offline entregue na reconexao. Precisa contar tambem,
    //            senao tudo que foi compartilhado com o bot fora do ar some.
    //            O corte por idade em handleIncoming evita backfill antigo.
    if (type !== 'notify' && type !== 'append') return;

    for (const msg of messages) {
      try {
        const incoming = normalize(msg);
        if (!incoming || !incoming.groupId.endsWith('@g.us')) continue;

        incoming.groupName = await nomeDoGrupo(incoming.groupId);
        await handleIncoming(incoming, transportFor(msg));
      } catch (error) {
        console.error('[mensagem] erro:', error);
      }
    }
  });
}

async function shutdown(sinal) {
  if (encerrando) return;
  encerrando = true;
  console.log(`\n${sinal} recebido, encerrando...`);
  try {
    sock?.end?.(undefined);
  } catch (error) {
    console.error('Erro ao encerrar a conexao:', error.message);
  }
  closeDb();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => console.error('[unhandledRejection]', error));

console.log('🚀 Iniciando...');
await connect();
