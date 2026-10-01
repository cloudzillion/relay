// /src/printer.ts
import net from 'net';

export type PrintJobResult = {
    success: boolean;
    error?: string;
};

// Standard RAW JetDirect port used by Epson TM-U220, Star, and Zebra network cards
const DEFAULT_RAW_PORT = 9100;

export function spoolRawBytes(
    printerIp: string,
    printerPort?: number,
    payload?: string | Buffer,
    timeoutMs: number = 8000, // Slightly higher margin for mechanical TM-U220 impact heads
): Promise<PrintJobResult> {
    return new Promise((resolve) => {
        if (!payload) {
            resolve({ success: false, error: 'Empty print payload received.' });
            return;
        }

        // Port is never strictly required from the user; fallback to 9100 automatically
        const targetPort = printerPort && !isNaN(printerPort) ? printerPort : DEFAULT_RAW_PORT;
        const socket = new net.Socket();
        let resolved = false;

        const complete = (result: PrintJobResult) => {
            if (!resolved) {
                resolved = true;
                socket.removeAllListeners();
                socket.destroy();
                resolve(result);
            }
        };

        socket.setTimeout(timeoutMs);

        socket.connect(targetPort, printerIp, () => {
            socket.write(payload, () => {
                socket.end();
                complete({ success: true });
            });
        });

        socket.on('error', (err) => {
            complete({
                success: false,
                error: `Failed to connect to printer at ${printerIp}:${targetPort} - ${err.message}`,
            });
        });

        socket.on('timeout', () => {
            complete({
                success: false,
                error: `Connection to printer at ${printerIp}:${targetPort} timed out (${timeoutMs}ms).`,
            });
        });

        socket.on('close', (hadError) => {
            if (!resolved && hadError) {
                complete({
                    success: false,
                    error: 'Printer connection closed prematurely due to transmission error.',
                });
            }
        });
    });
}