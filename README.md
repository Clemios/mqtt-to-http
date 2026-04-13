# mqtt-to-http

IoT gateway that runs an **embedded MQTT broker** and forwards messages to HTTP endpoints. Designed to run natively on a Raspberry Pi (no Docker required on hardware).

## Architecture

```
IoT Devices  ──MQTT──►  [Embedded Broker]  ──subscribe──►  [Bridge]  ──HTTP POST──►  Cloud API
               TCP 1883       (aedes)                                     axios
```

- **Broker** (`aedes`): accepts MQTT connections from any device on the local network
- **Bridge**: subscribes to configured topics and forwards each message as an HTTP POST
- **Payload format**: every forwarded request contains `{ topic, payload, timestamp }`

## Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `config/config.yml` to define your topic → endpoint routes:

```yaml
mqtt:
  port: 1883

bridge:
  routes:
    - topic: "sensors/temperature"           # exact match
      url: "https://your-api.example.com/ingest/temperature"
      method: POST
      headers:
        Authorization: "Bearer ${API_TOKEN}" # interpolated from .env

    - topic: "sensors/+/humidity"            # + = one level wildcard
      url: "https://your-api.example.com/ingest/humidity"
      method: POST

    - topic: "devices/#"                     # # = multi-level wildcard
      url: "https://your-api.example.com/ingest/devices"
      method: POST
```

Environment variables referenced as `${VAR}` in the YAML are resolved at startup.

## HTTP payload format

```json
{
  "topic": "sensors/room1/humidity",
  "payload": { "value": 65.3 },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

If the MQTT message is not valid JSON, it is wrapped as `{ "raw": "..." }`.

---

## Development (Docker)

```bash
cp .env.example .env    # fill in your values
docker compose up --build
```

The broker is available at `localhost:1883`. Test with any MQTT client:

```bash
# publish a test message
mosquitto_pub -h localhost -t sensors/temperature -m '{"value": 22.5}'
```

## Deployment on Raspberry Pi

No Docker needed — Node.js runs natively and a systemd service handles auto-start.

### 1. Clone the repo on the Pi

```bash
git clone <repo-url> ~/mqtt-to-http
cd ~/mqtt-to-http
```

### 2. Configure

```bash
cp .env.example .env
nano .env              # set API_TOKEN, DEVICE_ID, etc.
nano config/config.yml # set your topic routes and URLs
```

### 3. Run the installer

```bash
bash deploy/install.sh
```

This will:
- Install Node.js 20 if not present
- Copy the app to `/opt/mqtt-to-http`
- Install dependencies
- Register and start a **systemd service** that survives reboots

### Useful commands on the Pi

```bash
sudo systemctl status mqtt-to-http      # check if running
sudo journalctl -fu mqtt-to-http        # follow live logs
sudo systemctl restart mqtt-to-http     # restart after config changes
```

## Project structure

```
mqtt-to-http/
├── src/
│   ├── index.js      # entry point
│   ├── broker.js     # aedes MQTT broker (TCP + optional WebSocket)
│   ├── bridge.js     # MQTT subscriber → HTTP forwarder
│   ├── config.js     # YAML config loader with env interpolation
│   └── logger.js     # pino logger
├── config/
│   └── config.yml    # topic → HTTP route definitions
├── deploy/
│   ├── install.sh            # Raspberry Pi installer
│   └── mqtt-to-http.service  # systemd unit file
├── Dockerfile
├── docker-compose.yml
└── .env.example
```
