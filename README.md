# Bot de Ranking de Conhecimento (WhatsApp)

Bot que entra num grupo do WhatsApp como um número comum, reconhece toda vez que alguém compartilha material de estudo (PDF, .zip, link de Docs/Drive/Notion, artigo, curso, aula, podcast…) e mantém um **top 10 de contribuições** por pessoa.

Feito com [Baileys](https://github.com/WhiskeySockets/Baileys): fala o protocolo multi-dispositivo do WhatsApp direto, sem navegador nem Chromium.

## Como funciona o número do bot

O bot **não** usa o seu número pessoal. Você precisa de um **número dedicado**:

1. Arranje um chip novo (ou um número virtual) e instale o WhatsApp nele, em qualquer celular.
2. Rode o bot — ele mostra um QR code no terminal.
3. No celular do **número do bot**: WhatsApp → Aparelhos conectados → Conectar um aparelho → escaneia o QR.
4. Adicione esse número ao grupo, como qualquer outro membro.

A sessão fica salva em `data/auth`, então o QR só é escaneado uma vez. O celular do bot precisa estar ligado e com internet de vez em quando (é uma sessão de "aparelho conectado", igual ao WhatsApp Web).

## Instalação

Requer **Node.js 22.5+** (o banco usa o SQLite embutido do Node, sem dependência nativa para compilar).

```bash
npm install
```

Se o npm avisar `allow-scripts` sobre `baileys` e `protobufjs`, pode ignorar — o bot funciona sem rodar esses scripts de instalação.

```bash
copy .env.example .env
npm start
```

Escaneie o QR. Quando aparecer `✅ Bot online.`, adicione o número ao grupo e mande um PDF para testar.

## Comandos no grupo

| Comando | O que faz |
| --- | --- |
| `!ranking` | Top 10 geral |
| `!ranking mes` / `semana` / `hoje` | Top 10 do período |
| `!meu` | Sua posição e quanto falta para subir |
| `!ultimas` | Últimos materiais compartilhados |
| `!regras` | O que conta e o que não conta |
| `!ajuda` | Lista de comandos |

`/` também funciona como prefixo (`/ranking`).

Além disso, **todo dia às 20h** (configurável) o bot posta o top 10 automaticamente nos grupos que tiveram atividade.

## O que conta como contribuição

**Anexos:** `.pdf` `.doc(x)` `.ppt(x)` `.xls(x)` `.odt` `.ods` `.odp` `.txt` `.md` `.csv` `.epub` `.mobi` `.ipynb` `.tex` `.zip` `.rar` `.7z` `.tar.gz` — e áudio/vídeo enviado **como documento**.

**Links:** Google Docs/Drive/Sheets/Slides, Notion, Dropbox, OneDrive, SharePoint, Box, Mega, WeTransfer, GitHub, GitLab, Colab, Kaggle, Hugging Face, arXiv, PubMed, IEEE, ScienceDirect, JSTOR, SciELO, Medium, Substack, dev.to, Wikipedia, Udemy, Coursera, edX, Alura, Khan Academy, DeepLearning.AI, Hotmart, SlideShare, Speaker Deck, Canva, Figma, Miro, Prezi, Loom, Vimeo, Read the Docs, GitBook, Confluence, **YouTube** e **podcasts do Spotify**. Qualquer URL que aponte direto para um arquivo (`…/apostila.pdf`) também conta.

**Não conta:** áudio de voz, figurinha, foto solta, vídeo solto (a menos que `COUNT_NATIVE_MEDIA=true`), Instagram, TikTok, X/Twitter, Facebook, convite de grupo, link de loja, link de reunião.

### Anti-farm

- **Repetido não pontua.** O mesmo material só conta uma vez por grupo — o crédito fica com quem mandou primeiro, e o bot reage com ♻️ para avisar. A comparação é por identidade canônica: o mesmo vídeo do YouTube em `youtu.be`, `watch?v=` ou `embed` é reconhecido como um só; parâmetros de rastreamento (`utm_*`, `si`, `fbclid`) são ignorados; o mesmo doc do Drive por URLs diferentes colapsa em um item.
- **Teto por mensagem.** `MAX_ITEMS_PER_MESSAGE` (padrão 3) impede que alguém cole 30 links e dispare no ranking.
- **Teto diário opcional.** `MAX_ITEMS_PER_PERSON_PER_DAY` (padrão 0 = desligado).
- **Dedup por hash opcional.** Com `DEDUP_FILES_BY_HASH=true`, o bot usa o SHA-256 que o próprio WhatsApp envia junto do arquivo — renomear não burla a contagem. Sem isso, o dedup usa nome + tamanho.

## Configuração

Tudo em `.env` (veja `.env.example` para a lista comentada). Os que você provavelmente vai querer mexer:

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `DAILY_SUMMARY_CRON` | `0 20 * * *` | Horário do resumo diário |
| `CONFIRM_MODE` | `reaction` | `reaction`, `reply`, `both` ou `silent` |
| `MAX_ITEMS_PER_MESSAGE` | `3` | Teto de itens por mensagem |
| `RANKING_SIZE` | `10` | Tamanho do top |
| `ALLOWED_GROUPS` | vazio | Restringe a grupos específicos |
| `EXTRA_KNOWLEDGE_DOMAINS` | vazio | Domínios que também devem contar |
| `EXTRA_BLOCKED_DOMAINS` | vazio | Domínios que nunca contam |
| `COUNT_NATIVE_MEDIA` | `false` | Conta vídeo/áudio/imagem soltos |
| `MAX_MESSAGE_AGE_DAYS` | `7` | Idade máxima de mensagem da fila offline |
| `BOT_PHONE_NUMBER` | vazio | Número do bot; ativa pareamento por código |
| `LOG_LEVEL` | `silent` | Verbosidade do Baileys (`debug` para investigar) |

Para descobrir o ID de um grupo, rode o bot uma vez, mande qualquer material lá e depois:

```bash
npm run ranking
```

Isso lista os grupos conhecidos com seus IDs (`120363…@g.us`).

## Ferramentas

```bash
npm test               # 35 testes, sem tocar no WhatsApp
npm run ranking        # lista grupos
npm run ranking -- 120363...@g.us mes   # ranking pelo terminal
npm start -- --resumo-agora             # dispara o resumo diário na hora, para testar
```

## Estrutura

```
src/
  index.js            conexão Baileys, pareamento, reconexão, ciclo de vida
  bot.js              o que fazer com cada mensagem (agnóstico de biblioteca)
  baileys-message.js  traduz a mensagem crua do Baileys para o formato do bot
  detect.js           o que é "conhecimento" (lógica pura, testável)
  db.js               SQLite: schema e queries
  ranking.js          monta o texto do top 10 e os cortes de período
  commands.js         !ranking, !meu, !ultimas, !regras, !ajuda
  scheduler.js        resumo diário
  config.js           leitura do .env
```

`bot.js` não conhece o Baileys: recebe uma mensagem normalizada e um `transport` com `reply()` e `react()`. É por isso que dá para testar o fluxo inteiro sem WhatsApp — e por isso trocar de biblioteca depois mexe só em `index.js` e `baileys-message.js`.

## Rodando em servidor (Railway, VPS…)

Duas coisas mudam em relação a rodar na sua máquina.

### 1. Volume persistente

O disco do container é efêmero: todo redeploy apaga `data/auth` (a sessão) e `data/ranking.db` (o ranking). Monte um volume em:

```
/app/data
```

### 2. Pareamento por código, não por QR

QR code em log de nuvem não funciona: o desenho em ASCII é quebrado pelo visualizador e cada QR vale só 20 segundos. Defina a variável com o número do bot (DDI + DDD, só dígitos):

```
BOT_PHONE_NUMBER=5521999998888
```

Nos logs aparece um código tipo `XBH9-PBEE`. No celular do bot: **Aparelhos conectados → Conectar aparelho → "Vincular com número de telefone"**, e digite. O código vale ~3 minutos e é texto puro, então nenhuma formatação de log o estraga.

Sem essa variável, o bot continua usando QR — que é o certo quando você roda localmente.

## Manter o bot no ar

`npm start` roda em primeiro plano: fechou o terminal, o bot para.

Ficar fora do ar **não faz perder contribuições**. Quando o bot volta, o WhatsApp entrega a fila do período offline e ele contabiliza tudo normalmente — o que passou de `MAX_MESSAGE_AGE_DAYS` (7 dias) é descartado, para a primeira conexão não despejar material antigo de uma vez. O que se perde enquanto ele está parado são só as reações de confirmação em tempo real e a resposta a comandos.

Para não depender de ninguém lembrar de abrir o terminal, use o [PM2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
```

```bash
pm2 start src/index.js --name ranking-bot
```

Daí `pm2 logs ranking-bot` mostra a saída (inclusive o QR na primeira vez), `pm2 restart ranking-bot` reinicia e `pm2 stop ranking-bot` para. Para voltar sozinho quando a máquina liga:

```bash
pm2 save
```

No Windows isso ainda precisa de `pm2-startup` (`npm install -g pm2-windows-startup` e depois `pm2-startup install`). Em Linux, `pm2 startup` imprime o comando a rodar.

O ideal mesmo é um VPS barato rodando 24/7 — num computador pessoal, o bot fica fora do ar toda vez que a máquina dorme.

## Banco de dados

SQLite em `data/ranking.db`, **um ranking por grupo**. Cada contribuição vira uma linha com quem, o quê, quando e a impressão digital do material — dá para auditar e recontar tudo depois.

```sql
SELECT p.display_name, COUNT(*) AS total
FROM contributions c
JOIN people p ON p.group_id = c.group_id AND p.author_id = c.author_id
WHERE c.group_id = '120363...@g.us'
GROUP BY c.author_id
ORDER BY total DESC;
```

Para zerar o ranking de um grupo sem perder o resto:

```sql
DELETE FROM contributions WHERE group_id = '120363...@g.us';
```

## Avisos

- O Baileys **não é oficial**. Ele implementa o protocolo do WhatsApp por engenharia reversa. A Meta não apoia isso e, em tese, pode bloquear a conta — por isso o número dedicado, e não o seu pessoal. Um bot que só lê e responde comandos ocasionais em um grupo é um perfil de uso de baixo risco, mas o risco não é zero.
- O processo precisa ficar rodando. Ver **Manter o bot no ar**, abaixo.
- O protocolo muda de tempos em tempos. Se o bot parar de conectar, atualize a biblioteca: `npm update baileys`.
- Avise o grupo que existe um bot lendo as mensagens. Além de ser o certo a fazer, o ranking só funciona se as pessoas souberem que ele existe.

### Por que não `whatsapp-web.js`

Era a primeira escolha, mas não funciona hoje: ele automatiza o WhatsApp Web num Chrome headless, e a build atual do WhatsApp Web derruba a sessão (`post_logout=1`) cerca de 2 segundos depois que a biblioteca injeta seus scripts na página. Testado com a versão 1.34.7, a mais recente. O Baileys não tem esse problema porque não passa pela página web — e ainda dispensa os ~700 MB de Chromium.
