const aedes = require('aedes');
const net = require('net');
const http = require('http');
const { WebSocketServer, createWebSocketStream } = require('ws');
const logger = require('./logger');

function createBroker(config) {
  return new Promise((resolve) => {
    const broker = aedes();
    const tcpPort = config.mqtt?.port || 1883;

    // TCP server — standard MQTT transport
    const tcpServer = net.createServer(broker.handle);
    tcpServer.listen(tcpPort, () => {
      logger.info(`MQTT broker listening on TCP port ${tcpPort}`);
      resolve(broker);
    });

    // Optional WebSocket transport (useful for browser clients)
    if (config.mqtt?.websocket_port) {
      const wsPort = config.mqtt.websocket_port;
      const httpServer = http.createServer();
      const wsServer = new WebSocketServer({ server: httpServer });

      wsServer.on('connection', (socket) => {
        broker.handle(createWebSocketStream(socket));
      });

      httpServer.listen(wsPort, () => {
        logger.info(`MQTT broker listening on WebSocket port ${wsPort}`);
      });
    }

    broker.on('client', (client) => {
      logger.info({ clientId: client.id }, 'Client connected');
    });

    broker.on('clientDisconnect', (client) => {
      logger.info({ clientId: client.id }, 'Client disconnected');
    });

    broker.on('clientError', (client, err) => {
      logger.warn({ clientId: client.id, err: err.message }, 'Client error');
    });

    broker.on('publish', (packet, client) => {
      if (client) {
        logger.debug({ topic: packet.topic, clientId: client.id }, 'Message published');
      }
    });
  });
}

module.exports = { createBroker };
