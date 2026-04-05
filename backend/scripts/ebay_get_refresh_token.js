/**
 * eBay Refresh Token Generator
 *
 * This script helps you generate an eBay OAuth refresh token.
 *
 * Usage:
 *   Step 1: Run without args to get the authorization URL
 *           node ebay_get_refresh_token.js
 *
 *   Step 2: Visit the URL in browser, sign in to eBay, authorize the app
 *
 *   Step 3: After redirect, copy the authorization code from the URL
 *           (the 'code' parameter in the redirected URL)
 *
 *   Step 4: Run with the auth code to exchange for refresh token
 *           node ebay_get_refresh_token.js --code "YOUR_AUTH_CODE_HERE"
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const http = require('http');
const url = require('url');

const APP_ID = process.env.CSP_EBAY_APP_ID;
const CERT_ID = process.env.CSP_EBAY_CERT_ID;
const LOCAL_PORT = 3456;
const REDIRECT_URI = `http://localhost:${LOCAL_PORT}/callback`;

// eBay OAuth endpoints (Production)
const AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

// Required scopes for order sync
const SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly'
].join(' ');

function getAuthUrl(ruName) {
  const params = new URLSearchParams({
    client_id: APP_ID,
    response_type: 'code',
    redirect_uri: ruName,
    scope: SCOPES
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken(authCode, ruName) {
  const authString = Buffer.from(`${APP_ID}:${CERT_ID}`).toString('base64');

  try {
    const response = await axios.post(TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: ruName
      }), {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Token exchange failed:', error.response?.data || error.message);
    throw error;
  }
}

async function startLocalServer(ruName) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);

      if (parsedUrl.pathname === '/callback') {
        const authCode = parsedUrl.query.code;

        if (authCode) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: Arial; padding: 40px; text-align: center;">
                <h2 style="color: green;">Authorization Code Received!</h2>
                <p>Exchanging for refresh token... Check your terminal.</p>
              </body>
            </html>
          `);

          console.log('\n--- Authorization code received! ---');
          console.log('Exchanging for refresh token...\n');

          try {
            const tokenData = await exchangeCodeForToken(authCode, ruName);

            console.log('='.repeat(60));
            console.log('SUCCESS! Here are your tokens:');
            console.log('='.repeat(60));
            console.log('\nREFRESH TOKEN (copy this to .env):');
            console.log('-'.repeat(60));
            console.log(tokenData.refresh_token);
            console.log('-'.repeat(60));
            console.log('\nRefresh token expires in:', tokenData.refresh_token_expires_in, 'seconds');
            console.log('(approximately', Math.round(tokenData.refresh_token_expires_in / 86400 / 30), 'months)');
            console.log('\nAccess token expires in:', tokenData.expires_in, 'seconds');
            console.log('\n='.repeat(60));
            console.log('\nAdd this to your backend/.env file:');
            console.log(`CSP_EBAY_REFRESH_TOKEN=${tokenData.refresh_token}`);
            console.log('='.repeat(60));
          } catch (err) {
            console.error('\nFailed to exchange code for token.');
            console.error('Error:', err.response?.data || err.message);
          }

          server.close();
          resolve();
        } else {
          const error = parsedUrl.query.error;
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: Arial; padding: 40px; text-align: center;">
                <h2 style="color: red;">Authorization Failed</h2>
                <p>Error: ${error || 'Unknown error'}</p>
              </body>
            </html>
          `);
          server.close();
          resolve();
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(LOCAL_PORT, () => {
      console.log(`Local callback server running on port ${LOCAL_PORT}`);
    });
  });
}

async function manualCodeExchange(authCode, ruName) {
  console.log('Exchanging authorization code for refresh token...\n');

  try {
    const tokenData = await exchangeCodeForToken(authCode, ruName);

    console.log('='.repeat(60));
    console.log('SUCCESS! Here are your tokens:');
    console.log('='.repeat(60));
    console.log('\nREFRESH TOKEN (copy this to .env):');
    console.log('-'.repeat(60));
    console.log(tokenData.refresh_token);
    console.log('-'.repeat(60));
    console.log('\nRefresh token expires in:', tokenData.refresh_token_expires_in, 'seconds');
    console.log('(approximately', Math.round(tokenData.refresh_token_expires_in / 86400 / 30), 'months)');
    console.log('\n='.repeat(60));
    console.log('\nAdd this to your backend/.env file:');
    console.log(`CSP_EBAY_REFRESH_TOKEN=${tokenData.refresh_token}`);
    console.log('='.repeat(60));
  } catch (err) {
    console.error('Failed to exchange code for token.');
    process.exit(1);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('eBay Refresh Token Generator');
  console.log('='.repeat(60));
  console.log(`\nApp ID: ${APP_ID}`);
  console.log(`Cert ID: ${CERT_ID ? CERT_ID.substring(0, 20) + '...' : 'NOT SET'}`);

  if (!APP_ID || !CERT_ID) {
    console.error('\nERROR: CSP_EBAY_APP_ID and CSP_EBAY_CERT_ID must be set in .env');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const codeIndex = args.indexOf('--code');
  const ruNameIndex = args.indexOf('--runame');
  const autoMode = args.includes('--auto');

  // RuName is required - it's configured in eBay Developer Portal
  let ruName = ruNameIndex !== -1 ? args[ruNameIndex + 1] : null;

  if (codeIndex !== -1 && args[codeIndex + 1]) {
    // Manual mode: exchange code for token
    if (!ruName) {
      console.error('\nERROR: --runame is required when using --code');
      console.error('Usage: node ebay_get_refresh_token.js --code "AUTH_CODE" --runame "YOUR_RUNAME"');
      process.exit(1);
    }
    await manualCodeExchange(args[codeIndex + 1], ruName);
  } else if (autoMode && ruName) {
    // Auto mode: start local server and open auth URL
    const authUrl = getAuthUrl(ruName);

    console.log('\n--- STEP 1: Open this URL in your browser ---');
    console.log('\n' + authUrl);
    console.log('\n--- STEP 2: Sign in to eBay and authorize the app ---');
    console.log('--- STEP 3: You will be redirected back, and the token will be captured automatically ---\n');

    await startLocalServer(ruName);
  } else {
    // Show instructions
    console.log('\n' + '='.repeat(60));
    console.log('HOW TO GET YOUR EBAY REFRESH TOKEN');
    console.log('='.repeat(60));
    console.log('\nOption 1: Use eBay Developer Portal (EASIEST)');
    console.log('-'.repeat(60));
    console.log('1. Go to: https://developer.ebay.com/my/keys');
    console.log('2. Find your Production keyset for app: ' + APP_ID);
    console.log('3. Under "OAuth" section, click "User Tokens" -> "Get a Token from eBay via Your Application"');
    console.log('4. Or go directly to: https://developer.ebay.com/my/auth/?env=production&index=0');
    console.log('5. Select scopes: sell.fulfillment');
    console.log('6. Click "Submit" to sign in with your eBay seller account');
    console.log('7. After authorization, copy the REFRESH TOKEN');
    console.log('8. Paste it into backend/.env as CSP_EBAY_REFRESH_TOKEN=<token>');

    console.log('\nOption 2: Use this script with RuName');
    console.log('-'.repeat(60));
    console.log('If you know your RuName (redirect URI name from eBay Developer Portal):');
    console.log('');
    console.log('  Auto mode (starts local server):');
    console.log('    node ebay_get_refresh_token.js --auto --runame "YOUR_RUNAME"');
    console.log('');
    console.log('  Manual mode (you provide the auth code):');
    console.log('    node ebay_get_refresh_token.js --code "AUTH_CODE" --runame "YOUR_RUNAME"');

    console.log('\nTo find your RuName:');
    console.log('  1. Go to https://developer.ebay.com/my/keys');
    console.log('  2. Click on your Production keyset');
    console.log('  3. Under "OAuth Accepted/Redirect URL", you\'ll see your RuName');
    console.log('');
  }
}

main().catch(console.error);
