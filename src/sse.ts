// /src/sse.ts

import EventSource from 'eventsource';
import type { RelayConfig } from './config.js';
import { spoolRawBytes } from './printer.js';

// NOTE: Using generic byte spooler supporting TM-U220 ESC/POS & ZPL

export type PrintJobData = {
    pieceId: string;
    orderNumber?: string;
    tagBarcode: string;
    pieceNumber?: number;
    totalPieces?: number;
    garmentLabel?: string;
    customerName?: string;
    dueDateIso?: string;
    zplCommand?: string;
    rawCommand?: string;
};

export type PrintPayload = {
    event?: string;
    data: PrintJobData;
};

// Formats timestamp as: 2026-10-01 17:36:58
function getTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// Clears in-place status line so standard logs print on a clean line
function clearLiveStatus(): void {
    if (process.stdout.isTTY) {
        process.stdout.write('\r\x1b[K');
    }
}

function logMessage(message: string): void {
    clearLiveStatus();
    console.log(`[${getTimestamp()}] ${message}`);
}

export function startRelayStream(config: RelayConfig): () => void {
    const streamUrl = `${config.serverUrl}/api/stations/${config.stationId}/stream`;
    logMessage(`[CZ-Relay v${config.version}] Connecting to ${streamUrl}...`);

    let es: EventSource | null = null;
    let isTerminated = false;
    let tickerTimer: NodeJS.Timeout | null = null;

    // Heartbeat & status tracking
    const EXPECTED_PING_INTERVAL_SEC = 45;
    let secondsUntilNextPing = EXPECTED_PING_INTERVAL_SEC;
    let connectionUptimeSec = 0;
    let isConnected = false;

    function renderStatusLine(): void {
        if (!process.stdout.isTTY || !isConnected) return;

        const uptimeMins = Math.floor(connectionUptimeSec / 60);
        const uptimeSecs = connectionUptimeSec % 60;
        const uptimeStr = `${uptimeMins}m ${uptimeSecs}s`;

        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        const spinner = frames[connectionUptimeSec % frames.length];

        const pingStatus =
            secondsUntilNextPing > 0
                ? `Next ping in: ${secondsUntilNextPing}s`
                : 'Heartbeat syncing...';

        process.stdout.write(
            `\r\x1b[K[${getTimestamp()}] ${spinner} [Active] Uptime: ${uptimeStr} | ${pingStatus} `,
        );
    }

    function startTicker(): void {
        if (tickerTimer) clearInterval(tickerTimer);
        tickerTimer = setInterval(() => {
            if (isConnected) {
                connectionUptimeSec++;
                if (secondsUntilNextPing > 0) {
                    secondsUntilNextPing--;
                }
                renderStatusLine();
            }
        }, 1000);
    }

    function stopTicker(): void {
        if (tickerTimer) {
            clearInterval(tickerTimer);
            tickerTimer = null;
        }
        clearLiveStatus();
    }

    function resetPingCountdown(): void {
        secondsUntilNextPing = EXPECTED_PING_INTERVAL_SEC;
    }

    function handleJobExecution(data: PrintJobData) {
        // Prioritize rawCommand (ESC/POS for TM-U220 impact printers) over zplCommand
        const command = data.rawCommand || data.zplCommand;

        if (!command) {
            logMessage(
                `[CZ-Relay] Received PRINT_JOB without print payload for piece: ${data.pieceId}`,
            );
            return;
        }

        const { pieceId, tagBarcode, garmentLabel } = data;
        const labelInfo = garmentLabel ? ` (${garmentLabel})` : '';
        logMessage(`[CZ-Relay] Incoming job -> ${tagBarcode}${labelInfo}`);

        // Asynchronously print and ACK back to the central gateway
        void (async () => {
            // Port defaults to 9100 inside spoolRawBytes if undefined
            const result = await spoolRawBytes(
                config.printerIp,
                config.printerPort,
                command,
            );

            if (result.success) {
                logMessage(
                    `[CZ-Relay] ✓ Printed: ${tagBarcode}. Sending ACK to cloud...`,
                );
                await sendJobStatus(config, pieceId, true);
            } else {
                logMessage(
                    `[CZ-Relay] ✗ Print Failed for ${tagBarcode}: ${result.error}`,
                );
                await sendJobStatus(config, pieceId, false, result.error);
            }
        })();
    }

    function initEventSource() {
        if (isTerminated) return;

        es = new EventSource(streamUrl, {
            headers: {
                'x-station-key': config.stationKey,
                'x-relay-version': config.version,
            },
        });

        es.onopen = () => {
            isConnected = true;
            connectionUptimeSec = 0;
            resetPingCountdown();
            logMessage('[CZ-Relay] Connected to stream. Ready for print jobs.');
            startTicker();
        };

        // Inspect error status for easier troubleshooting
        es.onerror = (err: any) => {
            isConnected = false;
            stopTicker();
            const status = err?.status || err?.message || 'Socket closed';
            logMessage(
                `[CZ-Relay] Connection interrupted (${status}). Reconnecting in ${config.reconnectIntervalMs / 1000}s...`,
            );
        };

        // 1. Handle unnamed standard messages
        es.onmessage = (event) => {
            if (!event.data || event.data === ': ping' || event.data === ': keep-alive') {
                resetPingCountdown();
                return;
            }

            try {
                const parsed = JSON.parse(event.data);

                // Ignore pings and heartbeats
                if (parsed.event === 'PING' || parsed.event === 'HEARTBEAT') {
                    resetPingCountdown();
                    return;
                }

                // If payload is wrapped in { event: 'PRINT_JOB', data: ... }
                if (parsed.event === 'PRINT_JOB' && parsed.data) {
                    handleJobExecution(parsed.data);
                } else if (parsed.pieceId || parsed.zplCommand || parsed.rawCommand) {
                    // Direct PrintJobData payload
                    handleJobExecution(parsed as PrintJobData);
                }
            } catch (err: unknown) {
                logMessage(`[CZ-Relay] Error parsing incoming print job payload: ${String(err)}`);
            }
        };

        // 2. Explicitly bind named 'PRINT_JOB' event if dispatched via `event: PRINT_JOB`
        es.addEventListener('PRINT_JOB', (event: any) => {
            if (!event.data) return;
            try {
                const parsed = JSON.parse(event.data);
                const jobData: PrintJobData = parsed.data || parsed;
                handleJobExecution(jobData);
            } catch (err: unknown) {
                logMessage(`[CZ-Relay] Error parsing named PRINT_JOB event: ${String(err)}`);
            }
        });

        // 3. Keepalive event listeners
        es.addEventListener('ping', resetPingCountdown);
        es.addEventListener('PING', resetPingCountdown);
        es.addEventListener('heartbeat', resetPingCountdown);
        es.addEventListener('HEARTBEAT', resetPingCountdown);
        es.addEventListener('keepalive', resetPingCountdown);
        es.addEventListener('keep-alive', resetPingCountdown);
    }

    initEventSource();

    return () => {
        isTerminated = true;
        isConnected = false;
        stopTicker();
        if (es) {
            es.close();
            es = null;
        }
    };
}

async function sendJobStatus(
    config: RelayConfig,
    pieceId: string,
    success: boolean,
    errorMessage?: string,
): Promise<void> {
    try {
        const response = await fetch(
            `${config.serverUrl}/api/stations/${config.stationId}/ack`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-station-key': config.stationKey,
                },
                body: JSON.stringify({
                    pieceIds: [pieceId],
                    pieceId,
                    status: success ? 'PRINTED' : 'FAILED',
                    success,
                    error: errorMessage,
                    errorMessage,
                    printedBy: `CZ_RELAY_V${config.version}`,
                }),
            },
        );

        if (!response.ok) {
            const errText = await response.text();
            logMessage(
                `[CZ-Relay] ACK endpoint returned HTTP ${response.status}: ${errText}`,
            );
        }
    } catch (err: unknown) {
        logMessage(`[CZ-Relay] Network error delivering job status to cloud: ${String(err)}`);
    }
}