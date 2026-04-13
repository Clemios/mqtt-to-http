const mqtt = require('mqtt');
const axios = require('axios');
const logger = require('./logger');

/**
 * Match an MQTT topic against a pattern supporting + and # wildcards.
 * + matches exactly one level, # matches zero or more levels (must be last segment).
 */
function topicMatches(pattern, topic) {
  if (pattern === '#') return true;

  const patternParts = pattern.split('/');
  const topicParts = topic.split('/');

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] === '#') return true;
    if (i >= topicParts.length) return false;
    if (patternParts[i] !== '+' && patternParts[i] !== topicParts[i]) return false;
  }

  return patternParts.length === topicParts.length;
}

async function forwardToHttp(route, topic, message) {
  let payload;
  try {
    payload = JSON.parse(message.toString());
  } catch {
    payload = { raw: message.toString() };
  }

  const body = {
    topic,
    payload,
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await axios({
      method: route.method || 'POST',
      url: route.url,
      data: body,
      headers: {
        'Content-Type': 'application/json',
        ...route.headers,
      },
      timeout: route.timeout || 10000,
    });
    logger.info({ topic, url: route.url, status: response.status }, 'Message forwarded');
  } catch (err) {
    const status = err.response?.status;
    logger.error({ topic, url: route.url, status, err: err.message }, 'Failed to forward message');
  }
}

function createBridge(config) {
  const routes = config.bridge?.routes || [];

  if (routes.length === 0) {
    logger.warn('No routes configured — bridge will not forward any messages');
    return;
  }

  const mqttPort = config.mqtt?.port || 1883;
  const client = mqtt.connect(`mqtt://localhost:${mqttPort}`, {
    clientId: 'mqtt-to-http-bridge',
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    logger.info('Bridge connected to local MQTT broker');

    const topics = routes.map((r) => r.topic);
    client.subscribe(topics, (err) => {
      if (err) {
        logger.error({ err: err.message }, 'Failed to subscribe to topics');
      } else {
        topics.forEach((t) => logger.info({ topic: t }, 'Subscribed'));
      }
    });
  });

  client.on('message', (topic, message) => {
    const matched = routes.filter((r) => topicMatches(r.topic, topic));
    matched.forEach((route) => forwardToHttp(route, topic, message));
  });

  client.on('error', (err) => {
    logger.error({ err: err.message }, 'MQTT bridge error');
  });

  client.on('reconnect', () => {
    logger.info('Bridge reconnecting to MQTT broker...');
  });
}

module.exports = { createBridge };
