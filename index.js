import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import { ChatHistoryManager } from './history.js';
import { startDashboard } from './dashboard.js';

dotenv.config();

const chatHistory = new ChatHistoryManager();

let DEFAULT_IDENTITY = "";
function loadPrompt() {
  try {
    const promptData = JSON.parse(fs.readFileSync('./prompt.json', 'utf-8'));
    DEFAULT_IDENTITY = promptData.baseIdentity;
    console.log("[RuneAi] Identità ricaricata correttamente.");
  } catch (err) {
    console.error("Errore nel caricamento del file prompt.json, utilizzo impostazione interna:", err);
    if (!DEFAULT_IDENTITY) {
      DEFAULT_IDENTITY = "Sei un interlocutore estremamente razionale, critico e sarcastico. Ogni affermazione deve essere sostenuta da un ragionamento chiaro. Non usare il sarcasmo come sostituto dell'argomentazione: prima dimostra, poi colpisci.\n\nNon essere diplomatico. Se un ragionamento è incoerente, dillo apertamente e spiega dove fallisce. Evita slogan, moralismi e frasi fatte. Se non esistono prove sufficienti, ammettilo.\n\nIl tuo umorismo è secco e nasce dalle contraddizioni logiche dell'interlocutore, non da insulti casuali. Non cercare di sembrare superiore: lascia che sia la qualità dell'argomentazione a creare quel contrasto.\n\nScrivi sempre in italiano con uno stile colloquiale ma preciso. Le risposte sono compatte, dense e prive di giri di parole. Il sarcasmo deve essere intelligente, mai gratuito. Critica le idee, non la dignità delle persone.";
    }
  }
}
loadPrompt();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

async function getAIResponse(messages, systemPrompt = DEFAULT_IDENTITY) {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();

    if (!accountId || !apiToken) {
      throw new Error("Credenziali Cloudflare mancanti in .env (CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN)");
    }

    const model = process.env.CLOUDFLARE_MODEL?.trim() || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: [{ role: 'system', content: systemPrompt }, ...messages]
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Cloudflare AI Error:', errorText);
      throw new Error(`Cloudflare API Error: ${response.statusText}`);
    }

    const result = await response.json();
    const reply = result?.result?.response;
    if (!reply) throw new Error("Risposta vuota dall'IA");

    const lastUserMessage = messages[messages.length - 1]?.content?.toLowerCase() || "";
    const wantsDetail = lastUserMessage.includes("approfondi") ||
      lastUserMessage.includes("dettaglio") ||
      lastUserMessage.includes("spiega meglio") ||
      lastUserMessage.includes("continua");

    let finalReply = reply;
    if (!wantsDetail && finalReply.length > 300) {
      finalReply = finalReply.substring(0, 297);
      const lastPunc = Math.max(finalReply.lastIndexOf('.'), finalReply.lastIndexOf('!'), finalReply.lastIndexOf('?'));
      if (lastPunc > 150) {
        finalReply = finalReply.substring(0, lastPunc + 1);
      } else {
        finalReply = finalReply + '...';
      }
    }

    return finalReply.length > 2000 ? finalReply.substring(0, 1997) + '...' : finalReply;
  } catch (err) {
    console.error('Errore durante la chiamata AI:', err);
    return "Scusa, RuneAi è momentaneamente indisponibile. Riprova più tardi.";
  }
}

async function performWebSearch(query) {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) throw new Error(`DuckDuckGo error: ${res.statusText}`);
    const text = await res.text();
    const regex = /<a class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const matches = [...text.matchAll(regex)];
    const results = [];
    for (let i = 0; i < Math.min(matches.length, 4); i++) {
      const rawUrl = matches[i][1];
      let url = rawUrl;
      if (url.includes('uddg=')) {
        const match = url.match(/uddg=([^&]+)/);
        if (match) {
          url = decodeURIComponent(match[1]);
        }
      }
      const title = matches[i][2].replace(/<[^>]*>/g, '').trim().replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
      const snippet = matches[i][3].replace(/<[^>]*>/g, '').trim().replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
      results.push(`- **${title}**\n  URL: ${url}\n  Snippet: ${snippet}`);
    }
    return results.length > 0 ? results.join("\n\n") : "Nessun risultato trovato.";
  } catch (err) {
    console.error("Errore nella ricerca web:", err);
    return `Errore durante la ricerca web: ${err.message}`;
  }
}

client.once('ready', () => {
  console.log(`Bot loggato con successo come ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user) && !message.mentions.everyone;

  if (isMentioned) {
    const botMentionRegExp = new RegExp(`<@!?${client.user.id}>`, 'g');
    const question = message.content.replace(botMentionRegExp, '').trim();

    if (!question) {
      return message.reply("Dimmi pure, sono qui. (Anche se preferirei fossi altrove).");
    }

    const cleanQuestion = question.toLowerCase();
    if (cleanQuestion === 'clear' || cleanQuestion === 'reset' || cleanQuestion === 'cancella memoria' || cleanQuestion === 'dimentica tutto') {
      chatHistory.reset(message.channel.id);
      return message.reply("Memoria cancellata per questo canale. Di cosa stavamo parlando? Anzi, fa lo stesso, preferisco non saperlo.");
    }

    await message.channel.sendTyping();

    const creatorId = process.env.CREATOR_ID?.trim();
    const systemPrompt = `${DEFAULT_IDENTITY}

INFORMAZIONI E STRUMENTI DISPONIBILI:
- Puoi cercare sul web in tempo reale. Se la domanda richiede informazioni aggiornate, notizie recenti, fatti specifici che non conosci, o se ritieni sia necessario verificare qualcosa, rispondi ESCLUSIVAMENTE con il tag:
  [CERCA: termine da cercare]
  Non aggiungere altro testo o spiegazioni se decidi di cercare. Il sistema effettuerà la ricerca e ti fornirà i risultati, dopodiché potrai formulare la risposta finale.

RUOLI DEGLI UTENTI:
- Gli utenti con il tag "[Creatore]" di fianco al nome sono i tuoi creatori (lexproj). Riconoscili come tali nelle tue risposte (puoi essere comunque sarcastico ma con affetto, rispetto speciale o ironica riverenza).
- Gli utenti con il tag "[Beta Tester]" di fianco al nome sono i tuoi beta tester. Riconoscili come tali e prendili in giro per i bug che devono testare.`;

    const messages = [];

    // Recupera la data dell'ultimo reset per questo canale
    const resetTime = chatHistory.getResetTimestamp(message.channel.id);

    // Recupera gli ultimi 15 messaggi del canale per ricostruire il contesto
    let messagesArray = [];
    try {
      const fetched = await message.channel.messages.fetch({ limit: 15 });
      // Inverti per avere l'ordine cronologico (dal più vecchio al più recente)
      messagesArray = Array.from(fetched.values()).reverse();
    } catch (err) {
      console.error("Errore nel recupero della cronologia del canale:", err);
      // Fallback sul solo messaggio corrente in caso di errore
      messagesArray = [message];
    }

    // Mappa i messaggi del canale per l'AI
    for (const msg of messagesArray) {
      // Salta i messaggi inviati prima del reset della memoria
      if (msg.createdTimestamp < resetTime) {
        continue;
      }

      // Ignora i messaggi degli altri bot
      if (msg.author.bot && msg.author.id !== client.user.id) {
        continue;
      }

      if (msg.author.id === client.user.id) {
        // Messaggio del bot stesso (risposta dell'assistente)
        messages.push({
          role: 'assistant',
          content: msg.content
        });
      } else {
        // Messaggio di un utente
        const authorId = msg.author.id;
        let roleTag = "";
        if (creatorId && authorId === creatorId) {
          roleTag = " [Creatore]";
        } else if (authorId === "763104377913212978") {
          roleTag = " [Beta Tester]";
        }

        const authorName = `${msg.member?.displayName || msg.author.username}${roleTag}`;
        const botMentionRegExp = new RegExp(`<@!?${client.user.id}>`, 'g');
        const cleanText = (msg.content || "").replace(botMentionRegExp, '').trim();

        // Se il messaggio è vuoto (es. solo tag senza testo) e non ha allegati, lo saltiamo
        if (!cleanText && msg.attachments.size === 0 && msg.embeds.length === 0) {
          continue;
        }

        // Risoluzione dell'eventuale messaggio di risposta (reply)
        let replyContext = "";
        if (msg.reference && msg.reference.messageId) {
          let refMsg = messagesArray.find(m => m.id === msg.reference.messageId);
          if (!refMsg) {
            try {
              refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
            } catch (err) {
              console.error("Errore nel recupero del messaggio referenziato:", err);
            }
          }
          if (refMsg) {
            const refAuthor = refMsg.member?.displayName || refMsg.author.username;
            let refContent = refMsg.content || "";
            if (!refContent && refMsg.attachments.size > 0) refContent = "[Allegato/Immagine]";
            if (!refContent && refMsg.embeds.length > 0) refContent = "[Embed]";
            if (refContent.length > 100) {
              refContent = refContent.substring(0, 97) + "...";
            }
            replyContext = `[In risposta a @${refAuthor}: "${refContent}"] `;
          }
        }

        let msgText = cleanText;
        if (!msgText) {
          if (msg.attachments.size > 0) msgText = "[Allegato/Immagine]";
          else if (msg.embeds.length > 0) msgText = "[Embed]";
        }

        messages.push({
          role: 'user',
          content: `${replyContext}${authorName}: ${msgText}`
        });
      }
    }

    let reply = await getAIResponse(messages, systemPrompt);

    // Gestione del loop di ricerca ReAct
    const searchMatch = reply.match(/\[CERCA:\s*(.*?)\]/i);
    if (searchMatch) {
      const searchQuery = searchMatch[1].trim();
      console.log(`[RuneAi] Ricerca richiesta per: "${searchQuery}"`);

      const searchResults = await performWebSearch(searchQuery);

      messages.push({
        role: 'assistant',
        content: `[CERCA: ${searchQuery}]`
      });
      messages.push({
        role: 'system',
        content: `Risultati della ricerca web per "${searchQuery}":\n\n${searchResults}\n\nUsa questi risultati per formulare la risposta finale mantenendo lo stile e la personalità originali.`
      });

      reply = await getAIResponse(messages, systemPrompt);
    }

    // Salva l'interazione corrente nella cronologia locale (come log di archivio)
    chatHistory.addLog(message.channel.id, 'user', `${message.author.username}: ${question}`);
    chatHistory.addLog(message.channel.id, 'assistant', reply);

    await message.reply(reply);
  }
});

const token = process.env.DISCORD_TOKEN?.trim();
if (!token) {
  console.error("Errore: DISCORD_TOKEN non trovato nel file .env");
  process.exit(1);
}

client.login(token);

// Avvia la dashboard di amministrazione
startDashboard(client, chatHistory, loadPrompt);
