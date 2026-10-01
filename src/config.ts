// /src/config.ts

export type RelayConfig = {
    version: string;
    serverUrl: string;
    stationId: string;
    stationKey: string;
    printerIp: string;
    printerPort?: number;
    reconnectIntervalMs: number;
};

// Default to central platform gateway
const DEFAULT_SERVER_URL = 'https://cloudzillion.com';

export function loadConfig(): RelayConfig {
    const version = '1.0.0';

    const rawServerUrl =
        process.env.CZ_SERVER_URL ||
        process.env.CLOUD_BASE_URL ||
        DEFAULT_SERVER_URL;

    const stationId = process.env.CZ_STATION_ID || process.env.STATION_ID || '';
    const stationKey = process.env.CZ_STATION_KEY || process.env.STATION_API_KEY || '';
    const printerIp = process.env.PRINTER_IP || '192.168.4.200';

    const rawPort = process.env.PRINTER_PORT;
    const printerPort = rawPort && !isNaN(Number(rawPort)) ? Number(rawPort) : undefined;

    if (!rawServerUrl || !stationId || !stationKey) {
        console.error(
            '[CZ-Relay] FATAL: CZ_SERVER_URL (or CLOUD_BASE_URL), CZ_STATION_ID, and CZ_STATION_KEY are required.',
        );
        process.exit(1);
    }

    return {
        version,
        serverUrl: rawServerUrl.trim().replace(/\/+$/, ''),
        stationId,
        stationKey,
        printerIp,
        printerPort,
        reconnectIntervalMs: 5000,
    };
}