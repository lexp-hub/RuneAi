import express from 'express';
import path from 'path';
import fs from 'fs';

export function startDashboard(client, chatHistory, onConfigUpdate) {
  const app = express();
  const port = process.env.DASHBOARD_PORT || 3000;
  const password = process.env.DASHBOARD_PASSWORD || 'consilium_secret_pass';

  app.use(express.json());

  // Middleware CORS nativo per consentire chiamate cross-origin (es. da Cloudflare Pages)
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.static('public'));

  // Middleware di autenticazione stateless semplice
  const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${password}`) {
      return res.status(401).json({ error: 'Non autorizzato' });
    }
    next();
  };

  // Endpoint di Login
  app.post('/api/login', (req, res) => {
    const { pass } = req.body;
    if (pass === password) {
      res.json({ token: password });
    } else {
      res.status(401).json({ error: 'Password errata' });
    }
  });

  // Endpoint di Stato del Bot
  app.get('/api/status', authenticate, (req, res) => {
    res.json({
      botTag: client.user ? client.user.tag : 'Non connesso',
      botId: client.user ? client.user.id : null,
      discordStatus: client.readyAt ? 'Online' : 'Offline',
      ping: client.ws ? Math.round(client.ws.ping) : 0,
      uptime: client.uptime ? Math.round(client.uptime / 1000) : 0,
      model: process.env.CLOUDFLARE_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      nodeVersion: process.version
    });
  });

  // Endpoint Configurazione (Identity e Modello)
  app.get('/api/config', authenticate, (req, res) => {
    let baseIdentity = '';
    try {
      const promptData = JSON.parse(fs.readFileSync('./prompt.json', 'utf-8'));
      baseIdentity = promptData.baseIdentity;
    } catch (err) {
      console.error('Errore lettura prompt.json:', err);
    }
    res.json({
      baseIdentity,
      cloudflareModel: process.env.CLOUDFLARE_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    });
  });

  app.post('/api/config', authenticate, (req, res) => {
    const { baseIdentity, cloudflareModel } = req.body;

    try {
      // Aggiorna prompt.json
      if (baseIdentity !== undefined) {
        fs.writeFileSync('./prompt.json', JSON.stringify({ baseIdentity }, null, 2), 'utf-8');
      }

      // Aggiorna in memoria ed env
      if (cloudflareModel !== undefined) {
        process.env.CLOUDFLARE_MODEL = cloudflareModel;
        
        // Aggiorna file .env
        let envContent = fs.readFileSync('.env', 'utf-8');
        if (envContent.includes('CLOUDFLARE_MODEL=')) {
          envContent = envContent.replace(/CLOUDFLARE_MODEL=.*/, `CLOUDFLARE_MODEL=${cloudflareModel}`);
        } else {
          envContent += `\nCLOUDFLARE_MODEL=${cloudflareModel}`;
        }
        fs.writeFileSync('.env', envContent, 'utf-8');
      }

      // Esegui la callback per ricaricare istantaneamente la configurazione
      if (onConfigUpdate) {
        onConfigUpdate();
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Errore aggiornamento configurazione:', err);
      res.status(500).json({ error: 'Errore durante il salvataggio della configurazione' });
    }
  });

  // Endpoint Cronologia Canali
  app.get('/api/history', authenticate, (req, res) => {
    const historyDir = chatHistory.historyDir || './history';
    try {
      if (!fs.existsSync(historyDir)) {
        return res.json([]);
      }
      const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'));
      const channels = files.map(file => {
        const filePath = path.join(historyDir, file);
        const stats = fs.statSync(filePath);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const channelId = file.replace('.json', '');
        return {
          channelId,
          lastUpdated: stats.mtime,
          messageCount: data.logs ? data.logs.length : 0,
          resetTimestamp: data.resetTimestamp || 0
        };
      });
      res.json(channels);
    } catch (err) {
      console.error('Errore recupero lista canali:', err);
      res.status(500).json({ error: 'Errore nel recupero dei canali' });
    }
  });

  app.get('/api/history/:channelId', authenticate, (req, res) => {
    const { channelId } = req.params;
    try {
      const logs = chatHistory.getLogs(channelId);
      const resetTime = chatHistory.getResetTimestamp(channelId);
      res.json({ logs, resetTime });
    } catch (err) {
      console.error(`Errore caricamento log per canale ${channelId}:`, err);
      res.status(500).json({ error: 'Errore nel caricamento del log' });
    }
  });

  app.delete('/api/history/:channelId', authenticate, (req, res) => {
    const { channelId } = req.params;
    try {
      chatHistory.reset(channelId);
      res.json({ success: true });
    } catch (err) {
      console.error(`Errore reset memoria per canale ${channelId}:`, err);
      res.status(500).json({ error: 'Errore nel reset della memoria' });
    }
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`[RuneAi] Pannello di controllo avviato all'indirizzo http://0.0.0.0:${port}`);
  });
}
