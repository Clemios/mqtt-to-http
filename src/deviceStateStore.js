const path = require('path');
const admin = require('firebase-admin');
const logger = require('./logger');

let db = null;
let resolved = false;

/**
 * Lazily resolve a Firebase RTDB database reference.
 * Prefers reusing an already-initialised app to avoid duplicate credentials.
 */
function resolveDb(config) {
  if (resolved) return db;
  resolved = true;

  for (const appName of ['rtdb-command-listener', 'rtdb-bridge']) {
    try {
      db = admin.database(admin.app(appName));
      return db;
    } catch {
      // app not yet initialised
    }
  }

  // Neither app exists yet — initialise a dedicated one
  const rtdbCfg = config.commandListener || config.firebaseRtdb;
  if (!rtdbCfg?.databaseURL) {
    logger.warn('No Firebase RTDB config found — device state will not be persisted');
    return null;
  }

  let credential;
  let projectId;
  if (rtdbCfg.serviceAccountPath) {
    const sa = require(path.resolve(process.cwd(), rtdbCfg.serviceAccountPath));
    credential = admin.credential.cert(sa);
    projectId = sa.project_id;
  } else {
    credential = admin.credential.applicationDefault();
  }

  const app = admin.initializeApp(
    { credential, databaseURL: rtdbCfg.databaseURL, ...(projectId && { projectId }) },
    'device-state'
  );
  db = admin.database(app);
  return db;
}

/**
 * Persist the commanded state of a device to Firebase RTDB.
 *
 * MQTT topic slashes become RTDB path segments, so "devices/esp1/led" is
 * stored at "device_state/devices/esp1/led" and can be read per-device
 * with db.ref("device_state/devices/esp1").
 *
 * @param {object}        config  - Full app config
 * @param {string}        topic   - MQTT topic (e.g. "devices/esp1/led")
 * @param {string|object} payload - Command payload
 * @param {string}        source  - Origin of the command: "http" | "firebase"
 */
async function saveDeviceState(config, topic, payload, source) {
  const database = resolveDb(config);
  if (!database) return;

  let parsedPayload = payload;
  if (typeof payload === 'string') {
    try { parsedPayload = JSON.parse(payload); } catch { /* keep as string */ }
  }

  // RTDB paths may not contain . # $ [ ]; slashes are fine (path separators)
  const safePath = topic.replace(/[.#$[\]]/g, '_');
  const rtdbPath = `device_state/${safePath}`;

  try {
    await database.ref(rtdbPath).set({
      topic,
      payload: parsedPayload,
      commandedAt: admin.database.ServerValue.TIMESTAMP,
      source,
    });
    logger.info({ topic, rtdbPath, source }, 'Device state saved to Realtime Database');
  } catch (err) {
    logger.error({ topic, rtdbPath, err: err.message }, 'Failed to save device state');
  }
}

module.exports = { saveDeviceState };
