const WebSocket = require('ws');

function connectWebSocket(url, callback) {
  const ws = new WebSocket(url);

  ws.on('open', () => console.log(`Connected to ${url}`));
  ws.on('message', (data) => callback(JSON.parse(data)));
  ws.on('close', () => console.log(`Disconnected from ${url}`));
  ws.on('error', (err) => console.error('WebSocket error:', err));

  return ws;
}

module.exports = { connectWebSocket };
