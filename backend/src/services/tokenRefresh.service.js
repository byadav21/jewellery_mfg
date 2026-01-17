const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { getPythonCommand } = require('../utils/python.utils');

class TokenRefreshService {
  constructor() {
    this.scriptPath = path.join(__dirname, '../../scripts/refresh_amazon_token.py');
    this.logFile = path.join(__dirname, '../../logs/token_refresh.log');
    this.lastRefreshResult = null;
    this.cronJob = null;
  }

  /**
   * Initialize the token refresh service
   * @param {string} cronExpression - Cron expression for refresh schedule (default: every hour)
   */
  init(cronExpression = '0 * * * *') {
    console.log(`⚙️ Token refresh service initializing...`);
    console.log(`   Schedule: ${cronExpression}`);

    // Ensure logs directory exists
    const logsDir = path.dirname(this.logFile);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Check if Python script exists
    if (!fs.existsSync(this.scriptPath)) {
      console.error(`   ❌ Token refresh script not found at: ${this.scriptPath}`);
      return false;
    }

    // Start cron job
    if (cron.validate(cronExpression)) {
      this.cronJob = cron.schedule(cronExpression, () => {
        this.refreshTokens();
      }, {
        scheduled: true,
        timezone: "UTC"
      });
      console.log(`   ✓ Token refresh cron job started`);

      // Run initial refresh
      console.log(`   Running initial token refresh...`);
      this.refreshTokens();

      return true;
    } else {
      console.error(`   ❌ Invalid cron expression: ${cronExpression}`);
      return false;
    }
  }

  /**
   * Run the token refresh script
   */
  async refreshTokens() {
    console.log(`[TokenRefresh] Starting token refresh at ${new Date().toISOString()}`);

    try {
      // Determine Python command
      const pythonCmd = getPythonCommand();
      console.log(`[TokenRefresh] Using Python command: ${pythonCmd}`);

      const output = execSync(`${pythonCmd} "${this.scriptPath}"`, {
        encoding: 'utf8',
        timeout: 60000, // 1 minute timeout
        cwd: path.dirname(this.scriptPath),
        windowsHide: true,
        env: { ...process.env }
      });

      // Parse JSON output
      try {
        const result = JSON.parse(output.trim());
        this.lastRefreshResult = result;

        if (result.success) {
          console.log(`[TokenRefresh] ✓ Success: ${result.message}`);
          result.accounts?.forEach(acc => {
            if (acc.success) {
              console.log(`   [${acc.accountCode}] Token refreshed, expires in ${acc.expiresIn}s`);
            } else {
              console.warn(`   [${acc.accountCode}] Failed: ${acc.message}`);
            }
          });

          // Reload environment variables
          this.reloadEnvVariables();
        } else {
          console.error(`[TokenRefresh] ✗ Failed: ${result.message}`);
        }

        return result;
      } catch (parseError) {
        console.error(`[TokenRefresh] Failed to parse output:`, output);
        return { success: false, message: 'Invalid script output' };
      }
    } catch (error) {
      console.error(`[TokenRefresh] Script execution error:`, error.message);
      if (error.stderr) {
        console.error(`[TokenRefresh] stderr:`, error.stderr.toString());
      }

      this.lastRefreshResult = {
        success: false,
        message: error.message,
        timestamp: new Date().toISOString()
      };

      return this.lastRefreshResult;
    }
  }

  /**
   * Reload environment variables from .env file
   */
  reloadEnvVariables() {
    try {
      const envPath = path.join(__dirname, '../../.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex > 0) {
              const key = trimmed.substring(0, eqIndex);
              let value = trimmed.substring(eqIndex + 1);

              // Remove quotes
              if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
              }

              // Only update Amazon-related keys (ACCESS_TOKEN and TOKEN_REFRESHED_AT)
              if (key.includes('AMAZON') && (key.includes('ACCESS_TOKEN') || key.includes('TOKEN_REFRESHED_AT'))) {
                process.env[key] = value;
                console.log(`   [Env] Updated ${key}`);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`[TokenRefresh] Failed to reload env:`, error.message);
    }
  }

  /**
   * Get the last refresh result
   */
  getLastResult() {
    return this.lastRefreshResult;
  }

  /**
   * Get token refresh logs
   * @param {number} lines - Number of lines to return
   */
  getLogs(lines = 100) {
    try {
      if (fs.existsSync(this.logFile)) {
        const content = fs.readFileSync(this.logFile, 'utf8');
        const allLines = content.split('\n').filter(l => l.trim());
        return allLines.slice(-lines);
      }
    } catch (error) {
      console.error(`[TokenRefresh] Failed to read logs:`, error.message);
    }
    return [];
  }

  /**
   * Stop the cron job
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      console.log(`[TokenRefresh] Cron job stopped`);
    }
  }

  /**
   * Manually trigger a token refresh
   */
  async manualRefresh() {
    return this.refreshTokens();
  }
}

module.exports = new TokenRefreshService();
