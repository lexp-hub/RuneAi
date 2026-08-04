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
    if (fs.existsSync('./prompt.json')) {
      const promptData = JSON.parse(fs.readFileSync('./prompt.json', 'utf-8'));
      if (promptData && typeof promptData.baseIdentity === 'string' && promptData.baseIdentity.trim().length > 0) {
        DEFAULT_IDENTITY = promptData.baseIdentity.trim();
        console.log("[RuneAi] Identità ricaricata correttamente da prompt.json.");
        return;
      }
    }
  } catch (err) {
    console.error("Errore nel caricamento del file prompt.json, utilizzo impostazione interna:", err);
  }
  
  if (!DEFAULT_IDENTITY || DEFAULT_IDENTITY.trim().length === 0) {
    DEFAULT_IDENTITY = "Sei un analista cinico, spietato e allergico all'ipocrisia umano-sociale. Smonti la propaganda, i ragionamenti fallati e la mediocrità di chiunque ti si ponga davanti — politici, figure pubbliche o gente comune — attaccando senza filtri idee, incoerenze e dignità intellettuale.\n\nRegole d'ingaggio:\n- Stile: Secco, sarcastico, fortemente passivo-aggressivo. La tua violenza verbale nasce dall'evidenziare la miseria logica e le contraddizioni dell'interlocutore, mai da insulti infantili.\n- Tono: Diretto, umano, spietato. Zero diplomazia, zero moralismi, zero frasi fatte. Se mancano prove o il discorso è un cumulo di banalità, umilialo con precisione chirurgica.\n- Target: Chiunque esterni un pensiero illogico, arrogante o incoerente.\n- Limite tassativo: Rispondi SEMPRE in massimo 300 caratteri. Supera il limite solo su esplicita richiesta di approfondimento.";
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
    const model = process.env.CLOUDFLARE_MODEL?.trim() || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

    let reply = "";

    if (model.startsWith('gemini-')) {
      const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
      if (!geminiApiKey) {
        throw new Error("GEMINI_API_KEY non trovata nel file .env per usare il modello Gemini");
      }

      const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: contents
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API Error:', errorText);
        throw new Error(`Gemini API Error: ${response.statusText}`);
      }

      const result = await response.json();
      reply = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!reply) throw new Error("Risposta vuota da Gemini API");
    } else {
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
      const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();

      if (!accountId || !apiToken) {
        throw new Error("Credenziali Cloudflare mancanti in .env (CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN)");
      }

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
      reply = result?.result?.response;
      if (!reply) throw new Error("Risposta vuota dall'IA");
    }

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
    if (res.ok) {
      const text = await res.text();
      const regex = /<a class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      const matches = [...text.matchAll(regex)];
      const results = [];
      for (let i = 0; i < Math.min(matches.length, 4); i++) {
        const rawUrl = matches[i][1];
        let url = rawUrl;
        if (url.includes('uddg=')) {
          const match = url.match(/uddg=([^&]+)/);
          if (match) url = decodeURIComponent(match[1]);
        }
        const title = matches[i][2].replace(/<[^>]*>/g, '').trim().replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
        const snippet = matches[i][3].replace(/<[^>]*>/g, '').trim().replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
        results.push(`- **${title}**\n  URL: ${url}\n  Snippet: ${snippet}`);
      }
      if (results.length > 0) return results.join("\n\n");
    }
  } catch (err) {
    console.warn("[RuneAi] Ricerca DuckDuckGo HTML fallita, tento fallback Wikipedia...", err);
  }

  try {
    const wikiRes = await fetch(`https://it.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`);
    if (wikiRes.ok) {
      const data = await wikiRes.json();
      const searchResults = data?.query?.search || [];
      if (searchResults.length > 0) {
        const results = searchResults.slice(0, 3).map(r => {
          const cleanSnippet = r.snippet.replace(/<[^>]*>/g, '');
          return `- **${r.title}** (Wikipedia)\n  Snippet: ${cleanSnippet}`;
        });
        return results.join("\n\n");
      }
    }
  } catch (err) {
    console.error("Errore fallback Wikipedia:", err);
  }

  return "Nessun risultato rilevante trovato sul web per questa ricerca.";
}

client.once('ready', () => {
  console.log(`Bot loggato con successo come ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user) && !message.mentions.everyone;

  if (isMentioned) {
    try {
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
- Puoi cercare sul web in tempo reale. Se la domanda richiede informazioni aggiornate o fatti non conosciuti, rispondi ESCLUSIVAMENTE con:
  [CERCA: termine da cercare]
  Non aggiungere altro testo se decidi di cercare.

ISTRUZIONI NOMI E RUOLI DEGLI UTENTI:
- Ogni messaggio utente indica il nome reale dell'utente e il suo ruolo tra parentesi.
- Esempio: "Utente: Alex | Ruolo: Creatore del bot".
- REGOLE TASSATIVE SUI NOMI:
  1. Il nome dell'utente è solo la parte "Utente: NOME". Rivolgiti all'utente ESCLUSIVAMENTE con il suo vero nome (es. "Alex").
  2. NON usare MAI le parole "Creatore", "Beta Tester", "[Creatore]" o "(Creatore)" come nome dell'utente. Non iniziare MAI la risposta dicendo "Creatore," o "[Creatore],".
  3. Se l'utente ha ruolo "Creatore del bot", trattalo come il tuo creatore (puoi essere sarcastico ma riconosci che è il tuo creatore).`;

      const messages = [];

      const resetTime = chatHistory.getResetTimestamp(message.channel.id);

      let messagesArray = [];
      try {
        const fetched = await message.channel.messages.fetch({ limit: 15 });
        messagesArray = Array.from(fetched.values()).reverse();
      } catch (err) {
        console.error("Errore nel recupero della cronologia del canale:", err);
        messagesArray = [message];
      }

      for (const msg of messagesArray) {
        if (msg.createdTimestamp < resetTime) {
          continue;
        }

        if (msg.author.bot && msg.author.id !== client.user.id) {
          continue;
        }

        if (msg.author.id === client.user.id) {
          messages.push({
            role: 'assistant',
            content: msg.content
          });
        } else {
          const authorId = msg.author.id;
          const displayName = msg.member?.displayName || msg.author.username;
          let roleDescription = "Utente standard";
          if (creatorId && authorId === creatorId) {
            roleDescription = "Creatore del bot";
          } else if (authorId === "763104377913212978") {
            roleDescription = "Beta Tester del bot";
          }

          const botMentionRegExp = new RegExp(`<@!?${client.user.id}>`, 'g');
          const cleanText = (msg.content || "").replace(botMentionRegExp, '').trim();

          if (!cleanText && msg.attachments.size === 0 && msg.embeds.length === 0) {
            continue;
          }

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
            content: `${replyContext}[Utente: ${displayName} | Ruolo: ${roleDescription}]: ${msgText}`
          });
        }
      }

      let reply = await getAIResponse(messages, systemPrompt);

      const searchMatch = reply.match(/\[CERCA:\s*(.*?)\]/i);
      if (searchMatch) {
        const searchQuery = searchMatch[1].trim();
        console.log(`[RuneAi] Ricerca richiesta per: "${searchQuery}"`);

        const searchResults = await performWebSearch(searchQuery);

        messages.push({
          role: 'assistant',
          content: `Ricerco informazioni sul web per: "${searchQuery}".`
        });

        const finalSystemPrompt = `${DEFAULT_IDENTITY}

ISTRUZIONI PER LA RISPOSTA FINALE:
Hai appena eseguito la ricerca web per l'utente. Ecco i dati aggiornati trovati sul web per "${searchQuery}":

${searchResults}

Utilizza questi dati per rispondere direttamente all'utente. Esprimi la tua opinione cinica, spietata e sarcastica basandoti sui fatti riportati qui sopra. Rispondi in italiano in modo sintetico (massimo 300 caratteri). NON usare comandi o tag di ricerca nella risposta.`;

        reply = await getAIResponse(messages, finalSystemPrompt);
        reply = reply.replace(/\[CERCA:\s*.*?\]/gi, '').trim();
      }

      if (!reply || reply.trim().length === 0) {
        reply = "Ho analizzato i dati ma l'elaborazione non ha prodotto un risultato valido. Riformula la richiesta.";
      }

      chatHistory.addLog(message.channel.id, 'user', `${message.author.username}: ${question}`);
      chatHistory.addLog(message.channel.id, 'assistant', reply);

      await message.reply(reply);
    } catch (err) {
      console.error("Errore durante l'elaborazione del messaggio:", err);
      await message.reply("Ho riscontrato un errore improvviso durante l'elaborazione. Riprova tra poco.").catch(() => {});
    }
  }
});

const token = process.env.DISCORD_TOKEN?.trim();
if (!token) {
  console.error("Errore: DISCORD_TOKEN non trovato nel file .env");
  process.exit(1);
}

client.login(token);

startDashboard(client, chatHistory, loadPrompt);
