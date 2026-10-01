// /src/index.ts
import { loadConfig } from './config.js';
import { startRelayStream } from './sse.js';

console.log('====================================================');
console.log('      Cloudzillion Hardware Relay (cz-relay)        ');
console.log('====================================================');

const config = loadConfig();

const printerTarget = config.printerPort 
    ? `${config.printerIp}:${config.printerPort}` 
    : `${config.printerIp}`;

console.log(`[CZ-Relay] Version:       v${config.version}`);
console.log(`[CZ-Relay] Target Server: ${config.serverUrl}`);
console.log(`[CZ-Relay] Station ID:    ${config.stationId}`);
console.log(`[CZ-Relay] Local Printer: ${printerTarget}`);
console.log('====================================================');

const stopStream = startRelayStream(config);

function handleShutdown(signal: string) {
    console.log(`\n[CZ-Relay] Received ${signal}. Shutting down cleanly...`);
    stopStream();
    process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
    console.error('[CZ-Relay] Unhandled rejection:', reason);
});