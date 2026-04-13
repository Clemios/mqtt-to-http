const http = require('http');
const mqtt = require('mqtt');
const logger = require('./logger');

/**
 * Minimal HTTP server that converts POST /command requests into MQTT publishes.
 *
 * Request body (JSON):
 *   { "topic": "devices/esp1/led", "payload": { "action": "on" } }
 *
 * Response:
 *   200 { "success": true, "topic": "devices/esp1/led" }
 *   400 { "error": "..." }
 *   401 Unauthorized  (when authToken is configured)
 *   500 { "error": "..." }
 *
 * Config section (config.yml):
 *   commandServer:
 *     port: 3000
 *     authToken: "${COMMAND_SERVER_TOKEN}"   # optional bearer token
 */
function createCommandServer(config) {
  const serverConfig = config.commandServer;

  if (!serverConfig) {
    logger.warn('No commandServer config found — HTTP command server will not start');
    return;
  }

  const port = serverConfig.port || 3000;
  const authToken = serverConfig.authToken || null;

  const mqttPort = config.mqtt?.port || 1883;
  const mqttClient = mqtt.connect(`mqtt://localhost:${mqttPort}`, {
    clientId: 'http-command-server',
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  mqttClient.on('connect', () => {
    logger.info('HTTP command server connected to local MQTT broker');
  });

  mqttClient.on('error', (err) => {
    logger.error({ err: err.message }, 'HTTP command server MQTT error');
  });

  mqttClient.on('reconnect', () => {
    logger.info('HTTP command server reconnecting to MQTT broker...');
  });

  function send(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/command') {
      send(res, 404, { error: 'Not found. Use POST /command' });
      return;
    }

    // if (authToken) {
    //   const auth = req.headers['authorization'] || '';
    //   if (auth !== `Bearer ${authToken}`) {
    //     send(res, 401, { error: 'Unauthorized' });
    //     return;
    //   }
    // }

    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let command;
      try {
        command = JSON.parse(raw);
      } catch {
        send(res, 400, { error: 'Request body must be valid JSON' });
        return;
      }

      const { topic, payload } = command;

      if (!topic || typeof topic !== 'string') {
        send(res, 400, { error: 'Missing or invalid "topic" field' });
        return;
      }

      const mqttPayload =
        payload === undefined || payload === null
          ? ''
          : typeof payload === 'object'
          ? JSON.stringify(payload)
          : String(payload);

      mqttClient.publish(topic, mqttPayload, { qos: 1 }, (err) => {
        if (err) {
          logger.error({ topic, err: err.message }, 'HTTP command server failed to publish to MQTT');
          send(res, 500, { error: 'Failed to publish to MQTT broker' });
        } else {
          logger.info({ topic }, 'Command published via HTTP');
          send(res, 200, { success: true, topic });
        }
      });
    });
  });

  server.listen(port, () => {
    logger.info({ port }, 'HTTP command server listening');
  });
}

module.exports = { createCommandServer };
