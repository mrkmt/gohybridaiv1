import { CloudAIService } from './CloudAIService';
import { SelfHealingService } from './SelfHealingService';
import { config } from './config';

export interface NavigatorAction {
    action: 'CLICK' | 'TYPE' | 'WAIT' | 'HOVER' | 'FINISH' | 'ERROR';
    target?: string;
    value?: string;
    reason: string;
}

export class VisionNavigatorService {
    private static MAX_STEPS = 10;

    /**
     * Autonomous Vision-based Navigation.
     * Decisions are made by "seeing" the page via screenshots and AI analysis.
     */
    static async navigate(page: any, goal: string): Promise<{ status: 'success' | 'failed'; reason?: string; steps: NavigatorAction[] }> {
        console.log(`[VisionNavigator] Starting autonomous mission: "${goal}"`);
        const executionSteps: NavigatorAction[] = [];

        for (let stepCount = 0; stepCount < this.MAX_STEPS; stepCount++) {
            console.log(`[VisionNavigator] --- Step ${stepCount + 1} ---`);

            // 1. Take a screenshot for the AI
            const screenshotBuffer = await page.screenshot();
            const imageBase64 = screenshotBuffer.toString('base64');

            // 2. Build the prompt for Gemini Vision
            const prompt = `
You are an autonomous web automation agent for GlobalHR Cloud.
Your GOAL: ${goal}

CURRENT STATE:
Attached is the current screenshot of the browser page.
The system uses Kendo UI (Angular-based).

TASK:
Analyze the image and determine the NEXT logical action to achieve the goal.
Available actions:
- CLICK(target): Click an element. Describe the target clearly (e.g., "Add New button", "Save icon").
- TYPE(target, value): Fill an input field.
- WAIT(ms): Wait if the page is loading or stabilizing.
- HOVER(target): Hover over an element (useful for menus).
- FINISH: The goal is successfully achieved.
- ERROR(reason): You are stuck or the goal is impossible.

IMPORTANT:
- Use clear, human-like names for targets. The system will resolve them to CSS selectors.
- For icon-only buttons (like the blue "+" or pencil), refer to them by their visual function (e.g., "Add button").
- Respond ONLY with a valid JSON object.

Example Output:
{
  "action": "CLICK",
  "target": "Add New button",
  "reason": "I need to open the creation form to add a new record."
}
            `.trim();

            // 3. Ask AI what to do (Prefer Groq Vision for free/fast analysis if keys exist)
            try {
                let aiResponse: string;
                
                // Get Groq keys from config
                const hasGroq = config.ai.groqApiKey || (config.ai as any).groqApiKeyChain?.length > 0;

                if (hasGroq) {
                    console.log(`[VisionNavigator] Using Groq Vision (Llama 3.2)...`);
                    aiResponse = await CloudAIService.generateWithGroqVision(prompt, imageBase64);
                } else {
                    console.log(`[VisionNavigator] Using Gemini Vision...`);
                    aiResponse = await CloudAIService.generateWithImage(prompt, imageBase64);
                }
                
                // Extract JSON from response
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                const actionData: NavigatorAction = JSON.parse(jsonMatch ? jsonMatch[0] : aiResponse);
                
                executionSteps.push(actionData);
                console.log(`[VisionNavigator] AI Action: ${actionData.action} - ${actionData.target || ''} (${actionData.reason})`);

                // 4. Handle results
                if (actionData.action === 'FINISH') {
                    console.log(`[VisionNavigator] ✅ Mission Accomplished: ${actionData.reason}`);
                    return { status: 'success', steps: executionSteps };
                }

                if (actionData.action === 'ERROR') {
                    console.error(`[VisionNavigator] ❌ AI Aborted: ${actionData.reason}`);
                    return { status: 'failed', reason: actionData.reason, steps: executionSteps };
                }

                // 5. Execute Action
                await this.executeAction(page, actionData);

                // Stabilization
                await page.waitForTimeout(1000);

            } catch (err: any) {
                console.error(`[VisionNavigator] Step failed: ${err.message}`);
                return { status: 'failed', reason: `Execution error: ${err.message}`, steps: executionSteps };
            }
        }

        return { status: 'failed', reason: 'Reached maximum steps (10) without finishing.', steps: executionSteps };
    }

    /**
     * Executes a logical action by translating it to Playwright commands.
     */
    private static async executeAction(page: any, actionData: NavigatorAction) {
        switch (actionData.action) {
            case 'CLICK':
                const clickSelector = await this.resolveSelector(actionData.target!);
                console.log(`[VisionNavigator] Executing CLICK on: ${clickSelector}`);
                await page.click(clickSelector, { timeout: 10000 });
                break;

            case 'TYPE':
                const typeSelector = await this.resolveSelector(actionData.target!);
                console.log(`[VisionNavigator] Executing TYPE "${actionData.value}" on: ${typeSelector}`);
                await page.fill(typeSelector, actionData.value!, { timeout: 10000 });
                break;

            case 'HOVER':
                const hoverSelector = await this.resolveSelector(actionData.target!);
                console.log(`[VisionNavigator] Executing HOVER on: ${hoverSelector}`);
                await page.hover(hoverSelector, { timeout: 10000 });
                break;

            case 'WAIT':
                const waitMs = parseInt(actionData.value || '2000');
                console.log(`[VisionNavigator] Executing WAIT for ${waitMs}ms`);
                await page.waitForTimeout(waitMs);
                break;
        }
    }

    /**
     * Resolves a natural language target name (e.g., "Add New button") into a CSS selector.
     * Uses the SAFE_FALLBACK_MAP from SelfHealingService.
     */
    private static async resolveSelector(target: string): Promise<string> {
        // 1. Check for common patterns in target name
        const lowerTarget = target.toLowerCase();
        
        // Map common names to keys in SAFE_FALLBACK_MAP
        let lookupKey = '';
        if (lowerTarget.includes('add new') || lowerTarget.includes('create')) lookupKey = "button:has-text('Add New')";
        else if (lowerTarget.includes('add')) lookupKey = "button:has-text('Add')";
        else if (lowerTarget.includes('save')) lookupKey = "button:has-text('Save')";
        else if (lowerTarget.includes('edit')) lookupKey = "button:has-text('Edit')";
        else if (lowerTarget.includes('delete')) lookupKey = "button:has-text('Delete')";
        else if (lowerTarget.includes('cancel')) lookupKey = "button:has-text('Cancel')";
        else if (lowerTarget.includes('search')) lookupKey = "button:has-text('Search')";
        
        // 2. If a key was found, get the most stable selector from fallbacks
        // (Accessing private static SAFE_FALLBACK_MAP via casting or if it were exported)
        // Since it's not exported in the original file, I'll provide a local version or use heuristics.
        
        if (lookupKey) {
            // Heuristic-based return if we can't access the map directly
            if (lookupKey.includes('Add New')) return '.k-button-add, .action-btn.addNew, button[title*="Add"]';
            if (lookupKey.includes('Save')) return 'button[type="submit"], .k-button-save, button[title*="Save"]';
            if (lookupKey.includes('Edit')) return '.k-button-edit, button[title*="Edit"]';
            if (lookupKey.includes('Delete')) return '.k-button-delete, button[title*="Delete"]';
        }

        // 3. Fallback: Use Playwright's role/text selectors for fuzzy matching
        // This is exactly what was suggested in the 1st video for robust automation.
        return `button:has-text("${target}"), input[placeholder*="${target}"], label:has-text("${target}") + input`;
    }
}
