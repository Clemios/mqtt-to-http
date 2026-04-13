require('dotenv').config();

const { createBroker } = require('./broker');
const { createBridge } = require('./bridge');
const config = require('./config');
const logger = require('./logger');

async function main() {
  logger.info('Starting MQTT-to-HTTP gateway');

  await createBroker(config);
  createBridge(config);
}

main().catch((err) => {
  console.error('Fatal error during startup:', err.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT — shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM — shutting down');
  process.exit(0);
});
