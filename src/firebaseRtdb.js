const path = require('path');
const mqtt = require('mqtt');
const admin = require('firebase-admin');
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

async function forwardToRtdb(db, route, topic, message) {
  let payload;
  try {
    payload = JSON.parse(message.toString());
  } catch {
    payload = { raw: message.toString() };
  }

  const doc = {
    topic,
    payload,
    timestamp: admin.database.ServerValue.TIMESTAMP,
  };

  // Replace MQTT topic slashes with valid RTDB path, then append under the configured path
  const topicPath = topic.replace(/[.#$[\]]/g, '_');
  const rtdbPath = `${route.path}/${topicPath}`;

  try {
    await db.ref(rtdbPath).set(doc);
    logger.info({ topic, rtdbPath }, 'Message written to Realtime Database');
  } catch (err) {
    logger.error({ topic, rtdbPath, err: err.message }, 'Failed to write to Realtime Database');
  }
}

function initRtdb(firebaseRtdbConfig) {
  let credential;
  let projectId;

  if (firebaseRtdbConfig.serviceAccountPath) {
    const serviceAccount = require(path.resolve(process.cwd(), firebaseRtdbConfig.serviceAccountPath));
    credential = admin.credential.cert(serviceAccount);
    projectId = serviceAccount.project_id;
  } else {
    credential = admin.credential.applicationDefault();
  }

  const app = admin.initializeApp(
    {
      credential,
      databaseURL: firebaseRtdbConfig.databaseURL,
      ...(projectId && { projectId }),
    },
    'rtdb-bridge'
  );

  return admin.database(app);
}

function createFirebaseRtdbBridge(config) {
  const rtdbConfig = config.firebaseRtdb;

  if (!rtdbConfig) {
    logger.warn('No firebaseRtdb config found — Realtime Database bridge will not start');
    return;
  }

  if (!rtdbConfig.databaseURL) {
    logger.warn('No firebaseRtdb.databaseURL configured — Realtime Database bridge will not start');
    return;
  }

  const routes = rtdbConfig.routes || [];

  if (routes.length === 0) {
    logger.warn('No firebaseRtdb routes configured — Realtime Database bridge will not forward any messages');
    return;
  }

  const db = initRtdb(rtdbConfig);

  const mqttPort = config.mqtt?.port || 1883;
  const client = mqtt.connect(`mqtt://localhost:${mqttPort}`, {
    clientId: 'mqtt-to-firebase-rtdb-bridge',
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    logger.info('Realtime Database bridge connected to local MQTT broker');

    const topics = routes.map((r) => r.topic);
    client.subscribe(topics, (err) => {
      if (err) {
        logger.error({ err: err.message }, 'Realtime Database bridge failed to subscribe to topics');
      } else {
        topics.forEach((t) => logger.info({ topic: t }, 'Realtime Database bridge subscribed'));
      }
    });
  });

  client.on('message', (topic, message) => {
    const matched = routes.filter((r) => topicMatches(r.topic, topic));
    matched.forEach((route) => forwardToRtdb(db, route, topic, message));
  });

  client.on('error', (err) => {
    logger.error({ err: err.message }, 'MQTT Realtime Database bridge error');
  });

  client.on('reconnect', () => {
    logger.info('Realtime Database bridge reconnecting to MQTT broker...');
  });
}

module.exports = { createFirebaseRtdbBridge };
