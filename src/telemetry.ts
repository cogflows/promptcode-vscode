import * as vscode from 'vscode';
import TelemetryReporter from '@vscode/extension-telemetry';
import * as path from 'path';
import * as fs from 'fs';

// Function to get connection string
function getConnectionString(): string {
    // Only use the global TELEMETRY_CONNECTION_STRING
    if (typeof TELEMETRY_CONNECTION_STRING === 'string' && TELEMETRY_CONNECTION_STRING) {
        console.log('[TELEMETRY] Using globally defined connection string');
        return TELEMETRY_CONNECTION_STRING;
    }
    
    // If not available or empty, log a message and disable telemetry
    console.log('[TELEMETRY] No connection string found - telemetry will be disabled');
    return '';
}

export class TelemetryService {
    private static instance: TelemetryService;
    private reporter: TelemetryReporter | undefined;
    private extensionId: string = 'cogflows.promptcode';
    private extensionVersion: string = '0.0.0';
    private isEnabled: boolean = true; // Only used for our custom extension setting
    private connectionString: string;

    private constructor(context: vscode.ExtensionContext) {
        console.log('[TELEMETRY] Initializing TelemetryService');
        
        // Get the connection string at runtime
        this.connectionString = getConnectionString();
        
        // Get extension version from package.json
        try {
            const packageJsonPath = path.join(context.extensionPath, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                this.extensionId = `${packageJson.publisher}.${packageJson.name}`;
                this.extensionVersion = packageJson.version;
                console.log(`[TELEMETRY] Loaded extension info: ${this.extensionId}@${this.extensionVersion}`);
            }
        } catch (error) {
            console.error('[TELEMETRY] Failed to read package.json:', error);
        }

        // Initialize the telemetry reporter if we have a connection string
        if (this.connectionString) {
            try {
                console.log('[TELEMETRY] Connection string available, creating reporter');
                this.reporter = new TelemetryReporter(this.connectionString);
                context.subscriptions.push(this.reporter);
                console.log('[TELEMETRY] Reporter initialized successfully');
            } catch (error) {
                console.error('[TELEMETRY] Failed to initialize reporter:', error);
            }
        } else {
            console.log('[TELEMETRY] Telemetry disabled: No connection string available');
        }

        // Check if telemetry is disabled in extension settings
        // Note: VS Code's telemetry settings are automatically respected by the reporter
        this.updateExtensionTelemetrySetting();

        // Listen for changes to the extension's settings
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('promptcode.enableTelemetry')) {
                    this.updateExtensionTelemetrySetting();
                }
            })
        );
        
        console.log(`[TELEMETRY] TelemetryService initialization complete. Enabled: ${this.isEnabled}, Reporter: ${!!this.reporter}`);
    }

    private updateExtensionTelemetrySetting(): void {
        console.log('[TELEMETRY] Checking telemetry setting configuration');
        
        // Get the previous value to detect changes
        const previousValue = this.isEnabled;
        
        // Always check the current configuration value
        this.isEnabled = vscode.workspace.getConfiguration('promptcode').get<boolean>('enableTelemetry', true);
        
        if (previousValue !== this.isEnabled) {
            console.log(`[TELEMETRY] Setting changed: ${this.isEnabled ? 'enabled' : 'disabled'}`);
        } else {
            console.log(`[TELEMETRY] Setting unchanged: ${this.isEnabled ? 'enabled' : 'disabled'}`);
        }
    }

    public static getInstance(context?: vscode.ExtensionContext): TelemetryService {
        if (!TelemetryService.instance && context) {
            TelemetryService.instance = new TelemetryService(context);
        }
        return TelemetryService.instance;
    }

    /**
     * Send a telemetry event
     * @param eventName Name of the event
     * @param properties Additional properties to send with the event (optional)
     * @param measurements Numeric measurements to send with the event (optional)
     */
    public sendTelemetryEvent(
        eventName: string, 
        properties?: { [key: string]: string }, 
        measurements?: { [key: string]: number }
    ): void {
        // Add detailed logging for debugging
        console.log(`[TELEMETRY] Attempting to send event: ${eventName}`);
        
        // Check the current setting value before sending
        const currentSettingEnabled = vscode.workspace.getConfiguration('promptcode').get<boolean>('enableTelemetry', true);
        
        if (currentSettingEnabled && this.isEnabled && this.reporter) {
            console.log(`[TELEMETRY] Settings validated - sending event: ${eventName}`);
            
            // Add standard properties
            const allProperties = {
                ...properties,
                'timestamp': new Date().toISOString(),
                'extensionVersion': this.extensionVersion
            };
            
            try {
                this.reporter.sendTelemetryEvent(eventName, allProperties, measurements);
                console.log(`[TELEMETRY] Event sent successfully: ${eventName}`);
            } catch (error) {
                console.error(`[TELEMETRY] Failed to send event: ${eventName}`, error);
            }
        } else {
            console.log(`[TELEMETRY] Event not sent (disabled): ${eventName} | Reasons: Setting=${currentSettingEnabled}, Enabled=${this.isEnabled}, Reporter=${!!this.reporter}`);
        }
    }

    /**
     * Send a telemetry exception
     * @param error The error object or error name
     * @param properties Additional properties to send with the event (optional)
     * @param measurements Numeric measurements to send with the event (optional)
     */
    public sendTelemetryException(
        error: Error | string, 
        properties?: { [key: string]: string }, 
        measurements?: { [key: string]: number }
    ): void {
        // Add detailed logging for debugging
        console.log(`[TELEMETRY] Attempting to send error: ${typeof error === 'string' ? error : error.name}`);
        
        // Check the current setting value before sending
        const currentSettingEnabled = vscode.workspace.getConfiguration('promptcode').get<boolean>('enableTelemetry', true);
        
        if (currentSettingEnabled && this.isEnabled && this.reporter) {
            console.log(`[TELEMETRY] Settings validated - sending error: ${typeof error === 'string' ? error : error.name}`);
            
            try {
                if (typeof error === 'string') {
                    // Handle case where error is just a string
                    this.reporter.sendTelemetryErrorEvent(error, {
                        ...properties,
                        'timestamp': new Date().toISOString(),
                        'extensionVersion': this.extensionVersion
                    }, measurements);
                } else {
                    // Handle case where error is an Error object
                    this.reporter.sendTelemetryErrorEvent(error.name, {
                        ...properties,
                        'message': error.message,
                        'stack': error.stack || '',
                        'timestamp': new Date().toISOString(),
                        'extensionVersion': this.extensionVersion
                    }, measurements);
                }
                console.log(`[TELEMETRY] Error event sent successfully: ${typeof error === 'string' ? error : error.name}`);
            } catch (sendError) {
                console.error(`[TELEMETRY] Failed to send error event: ${typeof error === 'string' ? error : error.name}`, sendError);
            }
        } else {
            console.log(`[TELEMETRY] Error event not sent (disabled): ${typeof error === 'string' ? error : error.name} | Reasons: Setting=${currentSettingEnabled}, Enabled=${this.isEnabled}, Reporter=${!!this.reporter}`);
        }
    }

    /**
     * Check if our extension's telemetry is currently enabled
     * Note: This doesn't check VS Code's global setting, which is handled by the reporter
     */
    public isTelemetryEnabled(): boolean {
        // Always get the fresh value from settings
        return vscode.workspace.getConfiguration('promptcode').get<boolean>('enableTelemetry', true) && this.isEnabled;
    }
    
    /**
     * Get a diagnostic report of the telemetry system status
     * Useful for debugging telemetry issues
     */
    public getTelemetryStatus(): string {
        const vscodeTelemetrySetting = vscode.workspace.getConfiguration('telemetry').get<string>('telemetryLevel', 'all');
        const extensionTelemetrySetting = vscode.workspace.getConfiguration('promptcode').get<boolean>('enableTelemetry', true);
        
        return JSON.stringify({
            hasConnectionString: !!this.connectionString,
            connectionStringLength: typeof this.connectionString === 'string' ? this.connectionString.length : 0,
            reporterInitialized: !!this.reporter,
            extensionTelemetryEnabled: this.isEnabled,
            extensionSettingValue: extensionTelemetrySetting,
            vscodeTelemetryLevel: vscodeTelemetrySetting,
            effectivelyEnabled: this.isEnabled && !!this.reporter && !!this.connectionString && vscodeTelemetrySetting !== 'off',
            extensionInfo: {
                id: this.extensionId,
                version: this.extensionVersion
            }
        }, null, 2);
    }
    
    /**
     * Log telemetry status to console
     * Useful for debugging telemetry issues
     */
    public logTelemetryStatus(): void {
        console.log('[TELEMETRY] Status Report:');
        console.log(this.getTelemetryStatus());
    }
    
    /**
     * Dispose of the telemetry reporter
     * Should be called when the extension is deactivating
     */
    public dispose(): Promise<void> {
        if (this.reporter) {
            // The reporter's dispose method is async, so we return its promise
            const disposePromise = this.reporter.dispose();
            this.reporter = undefined;
            return disposePromise;
        }
        return Promise.resolve();
    }
} 