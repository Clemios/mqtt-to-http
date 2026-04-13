const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function loadConfig() {
  const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), 'config', 'config.yml');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, 'utf8');

  // Interpolate ${ENV_VAR} placeholders with actual environment variables
  const interpolated = raw.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  });

  return yaml.load(interpolated);
}

module.exports = loadConfig();
