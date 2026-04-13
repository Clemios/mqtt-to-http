const path = require('path');
const mqtt = require('mqtt');
const admin = require('firebase-admin');
const logger = require('./logger');

/**
 * Initialize a named Firebase app for the command listener.
 * Reuses an existing app if already initialized with the same name.
 */
function initRtdb(listenerConfig) {
  try {
    return admin.database(admin.app('rtdb-command-listener'));
  } catch {
    // App not yet initialized — create it
  }

  let credential;
  let projectId;

  if (listenerConfig.serviceAccountPath) {
    const serviceAccount = require(path.resolve(process.cwd(), listenerConfig.serviceAccountPath));
    credential = admin.credential.cert(serviceAccount);
    projectId = serviceAccount.project_id;
  } else {
    credential = admin.credential.applicationDefault();
  }

  const app = admin.initializeApp(
    {
      credential,
      databaseURL: listenerConfig.databaseURL,
      ...(projectId && { projectId }),
    },
    'rtdb-command-listener'
  );

  return admin.database(app);
}

/**
 * Process a single RTDB command snapshot:
 * - Reads topic + payload from the snapshot
 * - Publishes to the local MQTT broker
 * - Updates status to 'sent' or 'failed' in RTDB
 */
function processCommand(snapshot, mqttClient) {
  const commandId = snapshot.key;
  const command = snapshot.val();

  if (!command) return;

  const { topic, payload } = command;

  if (!topic) {
    logger.warn({ commandId }, 'Command missing topic field — removing from queue');
    snapshot.ref.remove();
    return;
  }

  const mqttPayload =
    payload === undefined || payload === null
      ? ''
      : typeof payload === 'object'
      ? JSON.stringify(payload)
      : String(payload);

  // Remove from RTDB first to prevent duplicate processing on restart,
  // then publish to MQTT.
  snapshot.ref.remove().then(() => {
    mqttClient.publish(topic, mqttPayload, { qos: 1 }, (err) => {
      if (err) {
        logger.error({ commandId, topic, err: err.message }, 'Failed to publish command to MQTT');
      } else {
        logger.info({ commandId, topic }, 'Command published to MQTT');
      }
    });
  });
}

/**
 * Start listening for commands written to a Firebase Realtime Database path.
 *
 * Expected RTDB command document structure:
 *   {
 *     topic: "devices/esp1/led",     // MQTT topic to publish to
 *     payload: { action: "on" }      // message payload (object or string)
 *   }
 * The document is deleted from RTDB as soon as it is processed.
 *
 * Config section (config.yml):
 *   commandListener:
 *     serviceAccountPath: "./config/serviceAccount.json"
 *     databaseURL: "https://your-project-rtdb.region.firebasedatabase.app"
 *     path: "commands"              # RTDB path to watch
 */
function createFirebaseCommandListener(config) {
  const listenerConfig = config.commandListener;

  if (!listenerConfig) {
    logger.warn('No commandListener config found — Firebase command listener will not start');
    return;
  }

  if (!listenerConfig.databaseURL) {
    logger.warn('No commandListener.databaseURL — Firebase command listener will not start');
    return;
  }

  const listenPath = listenerConfig.path || 'commands';

  const db = initRtdb(listenerConfig);

  const mqttPort = config.mqtt?.port || 1883;
  const mqttClient = mqtt.connect(`mqtt://localhost:${mqttPort}`, {
    clientId: 'firebase-command-listener',
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  mqttClient.on('connect', () => {
    logger.info('Firebase command listener connected to local MQTT broker');

    // child_added fires for each document present at startup and for every new push().
    // Commands are removed from RTDB immediately after processing, so there is no
    // risk of re-processing on restart and no index is needed.
    db.ref(listenPath).on('child_added', (snapshot) => processCommand(snapshot, mqttClient));

    logger.info({ listenPath }, 'Listening for Firebase commands on RTDB');
  });

  mqttClient.on('error', (err) => {
    logger.error({ err: err.message }, 'Firebase command listener MQTT error');
  });

  mqttClient.on('reconnect', () => {
    logger.info('Firebase command listener reconnecting to MQTT broker...');
  });
}

module.exports = { createFirebaseCommandListener };
