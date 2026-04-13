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

async function forwardToFirestore(db, route, topic, message) {
  let payload;
  try {
    payload = JSON.parse(message.toString());
  } catch {
    payload = { raw: message.toString() };
  }

  const doc = {
    topic,
    payload,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    await db.collection(route.collection).add(doc);
    logger.info({ topic, collection: route.collection }, 'Message written to Firestore');
  } catch (err) {
    logger.error({ topic, collection: route.collection, err: err.message }, 'Failed to write to Firestore');
  }
}

function initFirebase(firebaseConfig) {
  let credential;
  let projectId;

  if (firebaseConfig.serviceAccountPath) {
    const serviceAccount = require(path.resolve(process.cwd(), firebaseConfig.serviceAccountPath));
    credential = admin.credential.cert(serviceAccount);
    projectId = serviceAccount.project_id;
  } else {
    credential = admin.credential.applicationDefault();
  }

  admin.initializeApp({
    credential,
    ...(projectId && { projectId }),
  });

  return admin.firestore();
}

function createFirebaseBridge(config) {
  const firebaseConfig = config.firebase;

  if (!firebaseConfig) {
    logger.warn('No firebase config found — Firebase bridge will not start');
    return;
  }

  const routes = firebaseConfig.routes || [];

  if (routes.length === 0) {
    logger.warn('No firebase routes configured — Firebase bridge will not forward any messages');
    return;
  }

  const db = initFirebase(firebaseConfig);

  const mqttPort = config.mqtt?.port || 1883;
  const client = mqtt.connect(`mqtt://localhost:${mqttPort}`, {
    clientId: 'mqtt-to-firebase-bridge',
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    logger.info('Firebase bridge connected to local MQTT broker');

    const topics = routes.map((r) => r.topic);
    client.subscribe(topics, (err) => {
      if (err) {
        logger.error({ err: err.message }, 'Firebase bridge failed to subscribe to topics');
      } else {
        topics.forEach((t) => logger.info({ topic: t }, 'Firebase bridge subscribed'));
      }
    });
  });

  client.on('message', (topic, message) => {
    const matched = routes.filter((r) => topicMatches(r.topic, topic));
    matched.forEach((route) => forwardToFirestore(db, route, topic, message));
  });

  client.on('error', (err) => {
    logger.error({ err: err.message }, 'MQTT Firebase bridge error');
  });

  client.on('reconnect', () => {
    logger.info('Firebase bridge reconnecting to MQTT broker...');
  });
}

module.exports = { createFirebaseBridge };
