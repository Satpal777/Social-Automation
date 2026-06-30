import { env } from '../config/env.js';

function main() {
  const port = env.PORT;
  const baseUrl = env.NODE_ENV === 'development' ? `http://localhost:${port}` : env.APP_BASE_URL;
  const authUrl = `${baseUrl}/auth/linkedin`;

  console.log('\n======================================================');
  console.log('🔑 LinkedIn Official API OAuth Authentication');
  console.log('======================================================');
  console.log('\nTo authenticate this application with LinkedIn, please visit:');
  console.log(`\x1b[36m${authUrl}\x1b[0m`);
  console.log('\nOnce authorized, the server will capture the tokens and secure them.');
  console.log('Make sure the Fastify server (npm run dev) is running first!');
  console.log('======================================================\n');
}

main();
