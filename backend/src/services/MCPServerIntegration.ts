import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

export interface MCPTool {
    name: string;
    description: string;
    inputSchema: any;
}

export interface MCPServerConfig {
    id: string;
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
}

export class MCPServerIntegration {
    // Map of server ID to connected SDK Client
    private static clients: Map<string, Client> = new Map();
    // Map of server ID to configuration
    private static configs: Map<string, MCPServerConfig> = new Map();
    // Cache of available tools per server
    private static toolsCache: Map<string, MCPTool[]> = new Map();

    static async initialize() {
        console.log('[MCP] Initializing integrations...');
        // TestMu AI integration removed (paid service)
    }

    /**
     * Set the list of MCP servers (e.g., from user settings) and initialize connections.
     */
    static async configureServers(configs: MCPServerConfig[]) {
        const newIds = new Set(configs.map(c => c.id));

        // Disconnect and remove removed servers
        for (const [id, client] of this.clients.entries()) {
            if (!newIds.has(id)) {
                console.log(`[MCP] Disconnecting removed server: ${id}`);
                await this.disconnectServer(id);
            }
        }

        // Add or update servers
        for (const config of configs) {
            this.configs.set(config.id, config);
            if (!this.clients.has(config.id)) {
                await this.connectServer(config);
            }
        }
    }

    /**
     * Get all connected MCP servers and their status.
     */
    static getServers() {
        return Array.from(this.configs.values()).map(config => ({
            ...config,
            connected: this.clients.has(config.id),
            toolCount: this.toolsCache.get(config.id)?.length || 0
        }));
    }

    /**
     * Get all available tools across all connected MCP servers.
     */
    static getAllTools(): Array<{ serverId: string; tool: MCPTool }> {
        const allTools: Array<{ serverId: string; tool: MCPTool }> = [];
        for (const [serverId, tools] of this.toolsCache.entries()) {
            for (const tool of tools) {
                allTools.push({ serverId, tool });
            }
        }
        return allTools;
    }

    /**
     * Connect to a specific MCP server via stdio.
     */
    private static async connectServer(config: MCPServerConfig): Promise<void> {
        try {
            console.log(`[MCP] Connecting to server ${config.id}: ${config.command} ${config.args.join(' ')}`);
            
            const transport = new StdioClientTransport({
                command: config.command,
                args: config.args,
                env: { ...process.env, ...config.env } as any
            });

            const client = new Client({
                name: 'GoHybridAI-Backend',
                version: '1.0.0'
            }, {
                capabilities: {}
            });

            await client.connect(transport);
            this.clients.set(config.id, client);

            // Fetch available tools and cache them
            const toolsResponse = await client.listTools();
            if (toolsResponse && toolsResponse.tools) {
                this.toolsCache.set(config.id, toolsResponse.tools as unknown as MCPTool[]);
                console.log(`[MCP] Server ${config.id} connected successfully. Discovered ${toolsResponse.tools.length} tools.`);
            } else {
                this.toolsCache.set(config.id, []);
                console.log(`[MCP] Server ${config.id} connected, but returned no tools.`);
            }

        } catch (error: any) {
            console.error(`[MCP] Failed to connect to server ${config.id}:`, error.message);
        }
    }

    /**
     * Disconnect a specific server.
     */
    private static async disconnectServer(serverId: string) {
        const client = this.clients.get(serverId);
        if (client) {
            try {
                // The SDK currently doesn't have a direct 'disconnect' on the client,
                // but closing the transport stops it. Since we don't hold the transport ref,
                // removing it from the map is the next best thing for garbage collection.
                // Depending on SDK version, you may be able to call `client.close()`.
                if (typeof (client as any).close === 'function') {
                    await (client as any).close();
                }
            } catch (e: any) {
                console.warn(`[MCP] Warning during disconnect of ${serverId}:`, e.message);
            }
            this.clients.delete(serverId);
        }
        this.configs.delete(serverId);
        this.toolsCache.delete(serverId);
    }

    /**
     * Call an MCP tool on a target server.
     */
    static async callTool(serverId: string, toolName: string, args: any): Promise<any> {
        const client = this.clients.get(serverId);
        if (!client) {
            throw new Error(`MCP Server ${serverId} is not connected.`);
        }

        console.log(`[MCP] Calling tool ${toolName} on server ${serverId}...`);
        try {
            const result = await client.callTool({
                name: toolName,
                arguments: args
            });
            return result;
        } catch (error: any) {
            console.error(`[MCP] Error calling tool ${toolName}:`, error.message);
            throw error;
        }
    }
}
