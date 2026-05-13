import { ElementInfo, ModalInfo, PageInventory, TabInfo } from './discovery/PageElementDiscoveryService';

export type FrontendTechnology =
  | 'angular'
  | 'kendo-ui'
  | 'bootstrap'
  | 'tinymce'
  | 'ckeditor'
  | 'react'
  | 'vue'
  | 'material'
  | 'plain-html';

export interface TechnologyDetection {
  technology: FrontendTechnology;
  confidence: number;
  evidence: string[];
  mlScore?: number;
}

export interface FrontendTechnologyReport {
  primary: FrontendTechnology;
  detected: TechnologyDetection[];
  timestamp: number;
}

export class FrontendTechnologyDetector {
  static detect(inventory: PageInventory): FrontendTechnologyReport {
    const detections: TechnologyDetection[] = [];

    this.pushIfMatched(detections, 'angular', this.detectAngular(inventory));
    this.pushIfMatched(detections, 'kendo-ui', this.detectKendo(inventory));
    this.pushIfMatched(detections, 'bootstrap', this.detectBootstrap(inventory));
    this.pushIfMatched(detections, 'tinymce', this.detectTinyMce(inventory));
    this.pushIfMatched(detections, 'ckeditor', this.detectCkEditor(inventory));
    this.pushIfMatched(detections, 'react', this.detectReact(inventory));
    this.pushIfMatched(detections, 'vue', this.detectVue(inventory));
    this.pushIfMatched(detections, 'material', this.detectMaterial(inventory));

    if (detections.length === 0) {
      detections.push({
        technology: 'plain-html',
        confidence: 0.4,
        evidence: ['No strong framework-specific evidence was detected'],
      });
    }

    detections.sort((a, b) => b.confidence - a.confidence);

    return {
      primary: detections[0].technology,
      detected: detections,
      timestamp: Date.now(),
    };
  }

  private static detectAngular(inventory: PageInventory): { confidence: number; evidence: string[] } | null {
    const evidence = this.collectEvidence(inventory, [
      'formcontrolname',
      'ng-reflect',
      'ng-version',
      'router-outlet',
      'angular-',
    ]);
    return evidence.length ? { confidence: this.score(evidence.length, 0.65), evidence } : null;
  }

  private static detectKendo(inventory: PageInventory): { confidence: number; evidence: string[] } | null {
    const evidence = this.collectEvidence(inventory, [
      'kendo-',
      'k-grid',
      'k-dialog',
      'k-window',
      'k-dropdown',
      'k-picker',
      'k-tabstrip',
      'k-animation-container',
    ]);
    return evidence.length ? { confidence: this.score(evidence.length, 0.78), evidence } : null;
  }

  private static detectBootstrap(inventory: PageInventory): { confidence: number; evidence: string[] } | null {
    const evidence = this.collectEvidence(inventory, [
      '.btn',
      'modal',
      'nav-tabs',
      'form-control',
      'btn-',
      'dropdown-menu',
    ]);
    return evidence.length ? { confidence: this.score(evidence.length, 0.55), evidence } : null;
  }

  private static detectTinyMce(inventory: PageInventory): { confidence: number; evidence: string[] } | null {
    const evidence = this.collectEvidence(inventory, [
      'tox',
      'tinymce',
      'mce-',
    ]);
    return evidence.length ? { confidence: this.score(evidence.length, 0.75), evidence } : null;
  }

  private static detectCkEditor(inventory: PageInventory): { confidence: number; evidence: string[] } | null {
    const evidence = this.collectEvidence(inventory, [
      'ck-editor',
      'ckeditor',
      'ck-content',
    ]);
    return evidence.length ? { confidence: this.score(evidence.length, 0.72), evidence } : null;
  }

  private static detectReact(inventory: PageInventory): { confidence: number; evidence: string[] } | null {
    const evidence = this.collectEvidence(inventory, [
      '__react',
      'react',
    ]);
    return evidence.length ? { confidence: this.score(evidence.length, 0.45), evidence } : null;
  }

  private static detectVue(inventory: PageInventory): { confidence: number; evidence: string[] } | null {
    const evidence = this.collectEvidence(inventory, [
      'data-v-',
      'vue',
    ]);
    return evidence.length ? { confidence: this.score(evidence.length, 0.45), evidence } : null;
  }

  private static detectMaterial(inventory: PageInventory): { confidence: number; evidence: string[] } | null {
    const evidence = this.collectEvidence(inventory, [
      'mat-',
      'cdk-',
      'mat-dialog',
      'mat-tab',
    ]);
    return evidence.length ? { confidence: this.score(evidence.length, 0.6), evidence } : null;
  }

  private static collectEvidence(inventory: PageInventory, patterns: string[]): string[] {
    const haystacks = [
      inventory.url,
      inventory.pageTitle,
      inventory.summary,
      ...this.flattenElementSignals(inventory),
    ].map(v => v.toLowerCase());

    const evidence = new Set<string>();
    for (const pattern of patterns) {
      const lower = pattern.toLowerCase();
      if (haystacks.some(h => h.includes(lower))) {
        evidence.add(pattern);
      }
    }
    return Array.from(evidence);
  }

  private static flattenElementSignals(inventory: PageInventory): string[] {
    const elementSignals = (elements: ElementInfo[]) =>
      elements.flatMap(el => [
        el.name,
        el.selector,
        ...el.altSelectors,
        el.type,
        ...Object.entries(el.attributes).flatMap(([k, v]) => [k, String(v)]),
      ]);

    const tabSignals = inventory.tabs.flatMap((tab: TabInfo) => [tab.selector, ...tab.tabs]);
    const modalSignals = inventory.modals.flatMap((modal: ModalInfo) => [modal.selector, modal.title]);
    const gridSignals = inventory.grids.flatMap(grid => [grid.selector, ...grid.columns]);
    const paginationSignals = inventory.pagination ? [inventory.pagination.selector] : [];

    return [
      ...elementSignals(inventory.buttons),
      ...elementSignals(inventory.inputs),
      ...elementSignals(inventory.dropdowns),
      ...elementSignals(inventory.checkboxes),
      ...elementSignals(inventory.radios),
      ...elementSignals(inventory.other),
      ...tabSignals,
      ...modalSignals,
      ...gridSignals,
      ...paginationSignals,
    ];
  }

  private static pushIfMatched(
    bucket: TechnologyDetection[],
    technology: FrontendTechnology,
    result: { confidence: number; evidence: string[] } | null
  ): void {
    if (!result) return;
    bucket.push({ technology, confidence: result.confidence, evidence: result.evidence });
  }

  private static score(evidenceCount: number, base: number): number {
    return Math.min(base + Math.min(evidenceCount, 4) * 0.06, 0.98);
  }
}
