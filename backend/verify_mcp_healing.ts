import { PlaywrightMcpClient } from './src/services/mcp/PlaywrightMcpClient';
import { appLogger } from './src/utils/logger';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(__dirname, '.env') });

async function run() {
  const client = await PlaywrightMcpClient.create({ headless: true });
  try {
    await client.login({
      url: process.env.BASE_URL,
      username: process.env.TEST_USERNAME,
      password: process.env.TEST_PASSWORD,
      idNumber: process.env.TEST_IDNUMBER
    });
    
    appLogger.info('Navigating to Dashboard first...');
    await client.navigate(process.env.BASE_URL + '#/app');
    await new Promise(r => setTimeout(r, 10000));
    console.log(`Current URL: ${await client.evaluate('() => window.location.href')}`);
    console.log(`Current Title: ${await client.evaluate('() => document.title')}`);
    
    appLogger.info('Attempting to navigate via Sidebar (Master -> Department)...');
    try {
      appLogger.info('Clicking "Master" menu...');
      await client.click('Master');
      await new Promise(r => setTimeout(r, 2000));
      console.log(`URL after Master: ${await client.evaluate('() => window.location.href')}`);
      
      appLogger.info('Clicking "Department" submenu...');
      await client.click('Department');
      await new Promise(r => setTimeout(r, 10000));
      console.log(`URL after Department: ${await client.evaluate('() => window.location.href')}`);
      console.log(`Title after Department: ${await client.evaluate('() => document.title')}`);
      
      appLogger.info('Dumping toolbar HTML...');
      const toolbarHtml = await client.evaluate(`() => {
        const toolbar = document.querySelector('.k-toolbar, .k-grid-toolbar');
        return toolbar ? toolbar.innerHTML : 'Toolbar not found';
      }`);
      console.log('--- TOOLBAR HTML ---');
      console.log(toolbarHtml);
      console.log('--- END TOOLBAR HTML ---');
      
      appLogger.info('Attempting to click "Add" via MCP Tool (AI Native Heal)...');
      const result = await client.click('Add New button');
      appLogger.info('Click Result: ' + JSON.stringify(result));

    } catch (err: any) {
      appLogger.error('Navigation/Click Failed: ' + err.message);
    }

    const finalSnapshot = await client.snapshot();
    if (finalSnapshot.text.includes('Save') || finalSnapshot.text.includes('Cancel')) {
      appLogger.info('SUCCESS: AI Native Heal found the Add button and opened the form.');
    } else {
      appLogger.warn('FAILED: Still no Add form visible.');
    }

  } finally {
    await client.close();
  }
}

run().catch(console.error);
