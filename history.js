import fs from 'fs';
import path from 'path';

export class ChatHistoryManager {
  constructor(historyDir = './history', maxHistory = 50) {
    this.historyDir = historyDir;
    this.maxHistory = maxHistory;

    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
  }

  _getFilePath(channelId) {
    return path.join(this.historyDir, `${channelId}.json`);
  }

  _readData(channelId) {
    const filePath = this._getFilePath(channelId);
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.error(`Errore nel caricamento dei dati per il canale ${channelId}:`, err);
    }
    return { resetTimestamp: 0, logs: [] };
  }

  _writeData(channelId, data) {
    const filePath = this._getFilePath(channelId);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error(`Errore nel salvataggio dei dati per il canale ${channelId}:`, err);
    }
  }

  getResetTimestamp(channelId) {
    return this._readData(channelId).resetTimestamp || 0;
  }

  getLogs(channelId) {
    return this._readData(channelId).logs || [];
  }

  addLog(channelId, role, content) {
    const data = this._readData(channelId);
    if (!data.logs) data.logs = [];
    data.logs.push({ role, content, timestamp: Date.now() });

    if (data.logs.length > this.maxHistory) {
      data.logs.splice(0, data.logs.length - this.maxHistory);
    }

    this._writeData(channelId, data);
  }

  reset(channelId) {
    const data = this._readData(channelId);
    data.resetTimestamp = Date.now();
    data.logs = [];
    this._writeData(channelId, data);
  }
}
