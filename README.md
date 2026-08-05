# RuneAi 🧠

RuneAi è un bot Discord avanzato che integra l'intelligenza artificiale di **Cloudflare Workers AI** (utilizzando di default il modello Llama 3.3 70B) per interagire con gli utenti. Programmato da **lexproj**, RuneAi risponde con una personalità definita dall'utente.

## 🚀 Caratteristiche
- **Integrazione Cloudflare AI**: Utilizza di default `@cf/meta/llama-3.3-70b-instruct-fp8-fast` per risposte rapide ed estremamente intelligenti, configurabile tramite file `.env`.
- **Interazione Naturale**: Risponde automaticamente quando viene menzionato nei canali testuali.
- **Personalità Configurabile**: La personalità del bot può essere modificata tramite il file `prompt.json`.
- **Memoria Conversazionale & Contesto**: Quando viene menzionato, il bot legge in tempo reale gli ultimi 15 messaggi del canale per comprendere appieno il contesto della conversazione. Inoltre, salva un log storico delle interazioni in locale in file JSON (ideale per hosting come Wispbyte).
- **Risoluzione delle Risposte (Replies)**: Se rispondi a un messaggio specifico taggando il bot, questo recupera automaticamente il contenuto del messaggio originale (con autore) per avere pieno contesto.
- **Ricerca Web Integrata (ReAct)**: Il bot può decidere autonomamente di cercare su internet (tramite DuckDuckGo) per rispondere a domande su notizie dell'ultimo minuto o per verificare fatti, integrando i dati in tempo reale.
- **Riconoscimento dei Ruoli**: Riconosce gli utenti speciali tramite i tag `[Creatore]` (per lexproj) e `[Beta Tester]` (per l'utente 763104377913212978), reagendo in modo personalizzato.
- **Controllo Memoria**: È possibile forzare il bot a dimenticare i messaggi precedenti al momento corrente per un canale menzionandolo e scrivendo `reset`, `clear`, `cancella memoria` o `dimentica tutto`.
- **Pannello di Controllo Web**: Interfaccia web integrata e protetta da password per monitorare le metriche di runtime (latenza, uptime, RAM), modificare e salvare la personalità in tempo reale, selezionare il modello e gestire o pulire la cronologia dei singoli canali.

## ✒️ Autore
Sviluppato da **lexproj**.
