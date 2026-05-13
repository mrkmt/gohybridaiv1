/**
 * JsonGenerationIntegrationTest.ts
 * 
 * Integration test for the new JSON-based test generation system.
 * Tests the complete flow: AI generates JSON → Validate → Enrich → Compile → Execute
 */

import { JsonTestGenerationService, JsonGenerationOptions } from '../../src/services/JsonTestGenerationService';
import { FailureClassificationService, FailureCategory } from '../../src/services/FailureClassificationService';
import { validateTestSpecification, TestSpecification, TestScenario, FillStep, ClickStep, GotoStep, WaitForSelectorStep, AssertUrl } from '../../src/services/TestSpecSchema';
import { JSONToPlaywrightCompiler, compileTestSpec } from '../../src/services/JSONToPlaywrightCompiler';
import { enrichTestSpec } from '../../src/services/SelectorEnrichmentService';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

class IntegrationTestRunner {
  private results: TestResult[] = [];
  private startTime: number = Date.now();

  async runAllTests() {
    console.log('🧪 Starting JSON Generation Integration Tests...\n');

    // Test 1: Schema Validation
    await this.test('Schema Validation', async () => {
      const validJson = `{
        "ticketId": "TEST-001",
        "feature": "Test Feature",
        "module": "test-module",
        "scenarios": [
          {
            "id": "SC-001",
            "name": "Test Scenario",
            "priority": "high",
            "steps": [
              { "type": "goto", "url": "https://example.com" }
            ],
            "assertions": [
              { "type": "assertUrl", "expected": "/home", "contains": true }
            ]
          }
        ]
      }`;

      const result = validateTestSpecification(validJson);
      if (!result.success) {
        throw new Error(`Validation failed: ${result.errors.message}`);
      }
      
      // Verify structure
      if (result.data.ticketId !== 'TEST-001') throw new Error('ticketId mismatch');
      if (result.data.scenarios.length !== 1) throw new Error('scenarios count mismatch');
      if (result.data.scenarios[0].steps.length !== 1) throw new Error('steps count mismatch');
    });

    // Test 2: Invalid JSON Rejection
    await this.test('Invalid JSON Rejection', async () => {
      const invalidJson = `{
        "ticketId": "TEST-001",
        "feature": "Test Feature",
        "module": "test-module",
        "scenarios": [
          {
            "id": "SC-001",
            "name": "Test Scenario",
            "priority": "invalid_priority",
            "steps": [],
            "assertions": []
          }
        ]
      }`;

      const result = validateTestSpecification(invalidJson);
      if (result.success) {
        throw new Error('Should have failed validation for invalid priority');
      }
    });

    // Test 3: Selector Enrichment
    await this.test('Selector Enrichment', async () => {
      const spec: TestSpecification = {
        ticketId: 'TEST-002',
        feature: 'Login Module',
        module: 'auth',
        scenarios: [
          {
            id: 'SC-001',
            name: 'Login Test',
            priority: 'high',
            steps: [
              { type: 'fill', field: 'username', value: 'testuser' },
              { type: 'fill', field: 'password', value: 'password123' },
              { type: 'click', element: 'Login' },
            ],
            assertions: [
              { type: 'assertUrl', expected: '/dashboard', contains: true }
            ]
          }
        ]
      };

      const enriched = enrichTestSpec(spec);
      
      // Check that selectors were added
      const firstStep = enriched.scenarios[0].steps[0];
      if (firstStep.type !== 'fill' || !('selectorHint' in firstStep) || !firstStep.selectorHint) {
        throw new Error('Selector was not enriched for username field');
      }
      
      const thirdStep = enriched.scenarios[0].steps[2];
      if (thirdStep.type !== 'click' || !('selectorHint' in thirdStep) || !thirdStep.selectorHint) {
        throw new Error('Selector was not enriched for Login button');
      }
    });

    // Test 4: JSON to Playwright Compilation
    await this.test('JSON to Playwright Compilation', async () => {
      const spec: TestSpecification = {
        ticketId: 'TEST-003',
        feature: 'Test Feature',
        module: 'test',
        scenarios: [
          {
            id: 'SC-001',
            name: 'Navigation Test',
            priority: 'medium',
            steps: [
              { type: 'goto', url: 'https://test.globalhr.com.mm/ook#/login' },
              { type: 'fill', field: 'username', value: 'testuser', selectorHint: '#username' },
              { type: 'click', element: 'Login', selectorHint: '#login-btn' },
            ],
            assertions: [
              { type: 'assertUrl', expected: '/dashboard', contains: true }
            ]
          }
        ]
      };

      const options = {
        baseUrl: 'https://test.globalhr.com.mm/ook',
        ticketId: 'TEST-003',
        recordVideo: false,
        recordTrace: false,
        viewport: { width: 1280, height: 720 },
      };

      const script = compileTestSpec(spec, options);
      
      // Verify script contains expected elements
      if (!script.includes("import { test, expect, Page } from '@playwright/test'")) {
        throw new Error('Missing Playwright import');
      }
      if (!script.includes('test.describe(')) {
        throw new Error('Missing test.describe');
      }
      if (!script.includes('await page.goto(')) {
        throw new Error('Missing page.goto');
      }
      if (!script.includes('await expect(page).toHaveURL(')) {
        throw new Error('Missing assertion');
      }
    });

    // Test 5: Failure Classification
    await this.test('Failure Classification', async () => {
      // Test selector error
      const selectorError = FailureClassificationService.classifyFailure(
        'Error: Timeout 30000ms exceeded. waiting for locator("#nonexistent")'
      );
      if (selectorError.category !== FailureCategory.SELECTOR_ERROR) {
        throw new Error(`Expected SELECTOR_ERROR, got ${selectorError.category}`);
      }
      if (!selectorError.isScriptIssue) {
        throw new Error('Selector error should be marked as script issue');
      }

      // Test assertion failure
      const assertionFailure = FailureClassificationService.classifyFailure(
        'Error: expect(received).toBe(expected)\nExpected: "Success"\nReceived: "Error"'
      );
      if (assertionFailure.category !== FailureCategory.ASSERTION_FAILURE) {
        throw new Error(`Expected ASSERTION_FAILURE, got ${assertionFailure.category}`);
      }
      if (assertionFailure.isScriptIssue) {
        throw new Error('Assertion failure should NOT be marked as script issue');
      }

      // Test network error
      const networkError = FailureClassificationService.classifyFailure(
        'Error: net::ERR_CONNECTION_REFUSED at https://api.example.com'
      );
      if (networkError.category !== FailureCategory.NETWORK_ERROR) {
        throw new Error(`Expected NETWORK_ERROR, got ${networkError.category}`);
      }
      if (networkError.suggestedAction !== 'skip') {
        throw new Error('Network error should be skipped');
      }
    });

    // Test 6: Full Pipeline (without AI - mock response)
    await this.test('Full Pipeline (Mock AI Response)', async () => {
      // Simulate AI response
      const mockAiResponse = `{
        "ticketId": "TEST-004",
        "feature": "Full Pipeline Test",
        "module": "test",
        "scenarios": [
          {
            "id": "SC-001",
            "name": "Complete Flow Test",
            "priority": "high",
            "steps": [
              { "type": "goto", "url": "https://test.globalhr.com.mm/ook#/login" },
              { "type": "fill", "field": "username", "value": "testuser" },
              { "type": "fill", "field": "password", "value": "password123" },
              { "type": "click", "element": "Login" },
              { "type": "waitForSelector", "selector": "[ng-app]", "state": "visible" }
            ],
            "assertions": [
              { "type": "assertUrl", "expected": "/dashboard", "contains": true }
            ]
          }
        ]
      }`;

      // Validate
      const validationResult = validateTestSpecification(mockAiResponse);
      if (!validationResult.success) {
        throw new Error(`Validation failed: ${validationResult.errors.message}`);
      }

      // Enrich
      const enriched = enrichTestSpec(validationResult.data);
      const secondStep = enriched.scenarios[0].steps[1];
      if (secondStep.type !== 'fill' || !('selectorHint' in secondStep) || secondStep.selectorHint === undefined) {
        throw new Error('Enrichment failed - no selector hint added');
      }

      // Compile
      const script = compileTestSpec(enriched, {
        baseUrl: 'https://test.globalhr.com.mm/ook',
        ticketId: 'TEST-004',
        recordVideo: false,
        recordTrace: false,
        viewport: { width: 1280, height: 720 },
      });

      if (!script || script.length === 0) {
        throw new Error('Compilation produced empty script');
      }
    });

    // Print Results
    this.printResults();
  }

  private async test(name: string, fn: () => Promise<void>) {
    const start = Date.now();
    try {
      await fn();
      this.results.push({ name, passed: true, duration: Date.now() - start });
      console.log(`✅ ${name} (${Date.now() - start}ms)`);
    } catch (error: any) {
      this.results.push({ name, passed: false, error: error.message, duration: Date.now() - start });
      console.log(`❌ ${name} (${Date.now() - start}ms)`);
      console.log(`   Error: ${error.message}`);
    }
  }

  private printResults() {
    const total = this.results.length;
    const passed = this.results.filter(r => r.passed).length;
    const failed = total - passed;
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Results Summary');
    console.log('='.repeat(60));
    console.log(`Total:  ${total}`);
    console.log(`Passed: ${passed} ✅`);
    console.log(`Failed: ${failed} ❌`);
    console.log(`Duration: ${duration}s`);
    console.log('='.repeat(60));

    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    } else {
      console.log('\n🎉 All tests passed!');
    }
  }
}

// Run the integration tests
if (require.main === module) {
  const runner = new IntegrationTestRunner();
  runner.runAllTests().catch(console.error);
}

export { IntegrationTestRunner };