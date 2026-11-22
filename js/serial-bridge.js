/**
 * SerialBridge.js - Universal Web Serial Telemetry Library
 * Supports custom selective telemetry packets (Key:Value, CSV, JSON)
 */
class SerialBridge {
    constructor(options = {}) {
        this.port = null;
        this.writer = null;
        this.reader = null;
        this.isConnected = false;
        this.baudRate = options.baudRate || 115200;
        this.sendIntervalMs = options.sendIntervalMs || 50; // 20Hz default
        this.lastSendTime = 0;
        this.txCount = 0;
        this.rxCount = 0;
        this.lastSentPayload = "";

        this.onStatusChange = options.onStatusChange || (() => {});
        this.onLog = options.onLog || (() => {});
        this.onReceive = options.onReceive || (() => {});
    }

    isSupported() {
        return 'serial' in navigator;
    }

    async connect(baudRate = this.baudRate) {
        if (!this.isSupported()) {
            this.onLog("[ERR] Web Serial API not supported in this browser (Use Chrome/Edge).", "error");
            alert("Web Serial API is not supported. Please use Google Chrome or Microsoft Edge.");
            return false;
        }

        try {
            this.baudRate = parseInt(baudRate, 10) || 115200;
            this.port = await navigator.serial.requestPort();
            await this.port.open({ baudRate: this.baudRate });

            this.isConnected = true;
            this.txCount = 0;
            this.rxCount = 0;
            this.onStatusChange(true, this.baudRate);
            this.onLog(`[UART] Port Opened @ ${this.baudRate} bps (8N1)`, "system");

            this.startReading();
            return true;
        } catch (err) {
            this.onLog(`[ERR] UART Open Failed: ${err.message}`, "error");
            this.isConnected = false;
            this.onStatusChange(false, this.baudRate);
            return false;
        }
    }

    async disconnect() {
        try {
            this.isConnected = false;
            if (this.reader) {
                await this.reader.cancel();
                this.reader.releaseLock();
                this.reader = null;
            }
            if (this.writer) {
                this.writer.releaseLock();
                this.writer = null;
            }
            if (this.port) {
                await this.port.close();
                this.port = null;
            }
            this.onStatusChange(false, this.baudRate);
            this.onLog("[UART] Port Closed.", "system");
        } catch (err) {
            this.onLog(`[ERR] UART Close Error: ${err.message}`, "error");
        }
    }

    async startReading() {
        const decoder = new TextDecoder();
        let buffer = "";

        while (this.port && this.port.readable && this.isConnected) {
            try {
                this.reader = this.port.readable.getReader();
                while (true) {
                    const { value, done } = await this.reader.read();
                    if (done) break;
                    if (value) {
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split(/\r?\n/);
                        buffer = lines.pop();
                        for (const line of lines) {
                            if (line.trim().length > 0) {
                                this.rxCount++;
                                this.onReceive(line.trim());
                                this.onLog(`RX < ${line.trim()}`, "rx");
                            }
                        }
                    }
                }
            } catch (err) {
                if (this.isConnected) {
                    this.onLog(`[ERR] RX Stream Error: ${err.message}`, "error");
                }
                break;
            } finally {
                if (this.reader) {
                    this.reader.releaseLock();
                    this.reader = null;
                }
            }
        }
    }

    async sendRaw(text, force = false) {
        if (!this.isConnected || !this.port || !this.port.writable) return false;

        const now = performance.now();
        if (!force && (now - this.lastSendTime < this.sendIntervalMs)) {
            return false;
        }

        try {
            this.writer = this.port.writable.getWriter();
            const payload = text.endsWith('\n') ? text : text + '\n';
            const encoder = new TextEncoder();
            await this.writer.write(encoder.encode(payload));
            this.writer.releaseLock();
            this.writer = null;

            this.lastSendTime = now;
            this.txCount++;
            this.lastSentPayload = payload.trim();
            this.onLog(`TX > ${this.lastSentPayload}`, "tx");
            return true;
        } catch (err) {
            if (this.writer) {
                this.writer.releaseLock();
                this.writer = null;
            }
            this.onLog(`[ERR] TX Write Error: ${err.message}`, "error");
            return false;
        }
    }
}

window.SerialBridge = SerialBridge;
