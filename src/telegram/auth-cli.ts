import dotenv from 'dotenv';
import { mtprotoService } from './mtproto.js';
import { logger } from '../logger.js';

// Load existing environment variables
dotenv.config();

async function runAuthCLI() {
  console.log('=====================================================');
  console.log(' Telegram MTProto User Authorization (GramJS)        ');
  console.log('=====================================================\n');

  const config = mtprotoService.getConfig();

  if (!config.apiId || !config.apiHash) {
    console.error('ERROR: TELEGRAM_API_ID and TELEGRAM_API_HASH must be configured.');
    console.error('Please add them to your .env file or export them in your shell:');
    console.error('  export TELEGRAM_API_ID="123456"');
    console.error('  export TELEGRAM_API_HASH="your_api_hash"');
    console.error('  export TELEGRAM_USER_PHONE="+1234567890"  # optional\n');
    process.exit(1);
  }

  console.log(`Using Telegram API ID: ${config.apiId}`);
  if (config.userPhone) {
    console.log(`Using configured phone: ${config.userPhone}`);
  }

  try {
    console.log('\nStarting authorization flow with Telegram servers...');
    const sessionString = await mtprotoService.authorizeUser();

    console.log('\n-----------------------------------------------------');
    console.log(' AUTHORIZATION SUCCESSFUL!');
    console.log('-----------------------------------------------------');
    console.log('\nGenerated TELEGRAM_SESSION:');
    console.log(sessionString);
    console.log('\nSaving TELEGRAM_SESSION to .env file...');

    mtprotoService.saveSessionToEnvFile(sessionString, '.env');

    console.log('Done! Your MTProto client is now authenticated.');
    console.log('Target bot for voice transcription: @' + config.targetBot);
    console.log('=====================================================\n');

    process.exit(0);
  } catch (error) {
    console.error('\nAuthorization failed:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

runAuthCLI();
