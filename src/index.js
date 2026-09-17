import fs from 'node:fs';
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
import { config, isGroupAllowed } from './config.js';
import { handleIncoming } from './bot.js';
import { normalize } from './baileys-message.js';
import { startScheduler, startLeadWatcher, sendDailySummary } from './scheduler.js';
import { closeDb, getAllGroups } from './db.js';

const authDir = path.join(path.dirname(config.dbPath), 'auth');
const logger = pino({ level: config.logLevel });

// O Baileys so entrega o nome do grupo mediante consulta; guardamos em memoria.
const nomesDeGrupo = new Map();

let sock = null;
let encerrando = false;
let schedulerIniciado = false;

// `npm start -- --resumo-agora` dispara o resumo uma unica vez, para testar.
let resumoManualPendente = process.argv.includes('--resumo-agora');

// Quantas vezes aceitamos apagar a sessao e refazer o pareamento antes de
// concluir que o problema nao e a credencial em disco.
const MAX_LIMPEZAS = 3;
let limpezasDeSessao = 0;

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

/**
 * Pede o codigo de pareamento e imprime em texto puro.
 *
 * Existe porque QR code em log de nuvem nao funciona: o desenho e quebrado
 * pelo visualizador e a janela e de 20 segundos. O codigo vale ~3 minutos e
 * sobrevive a qualquer formatacao.
 */
async function pedirCodigo() {
  try {
    const codigo = await sock.requestPairingCode(config.botPhoneNumber);
    const formatado = codigo.match(/.{1,4}/g)?.join('-') ?? codigo;
    console.log('\n' + '='.repeat(46));
    console.log('📱 CODIGO DE PAREAMENTO');
    console.log('');
    console.log(`        >>>  ${formatado}  <<<`);
    console.log('');
    console.log(`   No celular do numero +${config.botPhoneNumber}:`);
    console.log('   WhatsApp > Aparelhos conectados');
    console.log('   > Conectar aparelho');
    console.log('   > "Vincular com numero de telefone"');
    console.log('   e digite o codigo acima.');
    console.log('='.repeat(46) + '\n');
  } catch (error) {
    console.error('❌ Nao foi possivel gerar o codigo de pareamento:', error.message);
    console.error(`   Confira se BOT_PHONE_NUMBER (${config.botPhoneNumber}) e o numero`);
    console.error('   do bot com DDI e DDD, so digitos. Ex.: 5521999998888');
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

  const usarCodigo = config.botPhoneNumber.length > 0 && !state.creds.registered;
  let codigoPedido = false;

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    // 'Chrome' e o tipo de cliente que o pareamento por codigo espera; um
    // browser 'Desktop' vira UWP/Electron e o codigo nao e aceito.
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    // O evento de QR so chega com a conexao ja aberta, que e justamente o que
    // requestPairingCode precisa. Por isso ele e o gatilho, e nao um timer.
    if (qr && usarCodigo) {
      if (codigoPedido) return;
      codigoPedido = true;
      pedirCodigo();
      return;
    }

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
        // Sem restricao de grupo: o aviso de lead vai para todo grupo que o bot
        // conhece. Para restringir a um grupo so, use ALLOWED_GROUPS.
        startLeadWatcher(send, () =>
          getAllGroups()
            .map((g) => g.group_id)
            .filter(isGroupAllowed)
        );
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
        // Um pareamento que nao se completa deixa credenciais pela metade em
        // disco, e elas fazem o WhatsApp responder 401 em todo boot seguinte.
        // Sair do processo aqui cria um loop de reinicio no servidor, que
        // nunca chega a emitir um codigo novo — entao limpamos e recomecamos.
        if (limpezasDeSessao >= MAX_LIMPEZAS) {
          console.error('❌ Sessao recusada mesmo apos limpar. Desistindo para nao entrar em loop.');
          console.error(`   Apague ${authDir} e confira BOT_PHONE_NUMBER.`);
          process.exit(1);
        }
        limpezasDeSessao += 1;
        console.warn(`🧹 Sessao invalidada. Limpando ${authDir} e recomecando o pareamento`);
        console.warn(`   (tentativa ${limpezasDeSessao} de ${MAX_LIMPEZAS})`);
        try {
          fs.rmSync(authDir, { recursive: true, force: true });
        } catch (error) {
          console.error('   Falha ao limpar a sessao:', error.message);
        }
      } else {
        console.log('   Reconectando em 5s...');
      }

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

if (config.botPhoneNumber) {
  console.log(`   Pareamento por codigo, numero +${config.botPhoneNumber}`);
  if (config.botPhoneNumber.length < 10 || config.botPhoneNumber.length > 15) {
    console.warn('⚠️  BOT_PHONE_NUMBER parece invalido: use DDI + DDD + numero,');
    console.warn('   so digitos, sem + nem espacos. Ex.: 5521999998888');
  }
} else {
  console.log('   Pareamento por QR code (defina BOT_PHONE_NUMBER para usar codigo)');
}

await connect();
