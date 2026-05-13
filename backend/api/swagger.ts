import swaggerJSDoc from 'swagger-jsdoc';

const options: swaggerJSDoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'GoHybrid AI - Test Automation Platform API',
            version: '1.1.0',
            description:
                'AI-assisted web-automation testing platform. Covers Jira integration, ' +
                'test case generation, Playwright execution, and reporting.',
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Local development server',
            },
        ],
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'x-api-key',
                    description: 'API key set via the API_KEY environment variable.',
                },
            },
        },
    },
    apis: ['./api/**/*.ts', './src/routes/**/*.ts'],
};

export const swaggerSpec = swaggerJSDoc(options);
