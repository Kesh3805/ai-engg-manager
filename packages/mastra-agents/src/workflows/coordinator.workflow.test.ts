import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { coordinatePrReview, renderPrComment } from './coordinator.workflow.js';
import type { DesignReviewInput } from '../agents/design-review.agent.js';
import type { ScannerFinding } from '../agents/security.agent.js';

/**
 * Phase 4C gate: PR event fixture → both agents invoked in parallel, results
 * merged, single comment produced. The LLM endpoint is stubbed at the fetch
 * layer; the stub routes on the system prompt so agent order doesn't matter.
 */

const DESIGN_RESPONSE = {
  violations: [{ rule: 'ADR-7 layering', filePath: 'apps/web/x.ts', detail: 'HTTP layer contains domain logic', severity: 'high' }],
  circularDeps: [],
  blastScore: 42,
  refactor: [],
};

const SECURITY_RESPONSE = {
  findings: [
    {
      scanner: 'semgrep',
      ruleId: 'javascript.express.security.audit.xss',
      filePath: 'apps/web/x.ts',
      severity: 'high',
      explanation: 'Unescaped user input rendered into HTML.',
      suggestedFix: 'Escape or sanitize the value.',
    },
  ],
  summary: '1 high finding.',
};

const fetchCalls: string[] = [];

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  fetchCalls.length = 0;
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    const system = body.messages[0]?.content ?? '';
    fetchCalls.push(system.slice(0, 40));
    const payload = system.includes('principal architect') ? DESIGN_RESPONSE : SECURITY_RESPONSE;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    } as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const designInput: DesignReviewInput = {
  prTitle: 'PR #42',
  changedFiles: ['apps/web/x.ts'],
  blastRadius: [{ name: 'renderX', nodeType: 'function', filePath: 'apps/web/x.ts', depth: 1 }],
  totalGraphNodes: 100,
  adrs: [{ number: 7, title: 'Layering', status: 'accepted', excerpt: 'apps/ handles HTTP only' }],
  layerRules: ['apps/ handles HTTP only'],
  detectedCycles: [['a.ts', 'b.ts', 'a.ts']],
};

const scannerFindings: ScannerFinding[] = [
  {
    scanner: 'semgrep',
    ruleId: 'javascript.express.security.audit.xss',
    filePath: 'apps/web/x.ts',
    rawSeverity: 'high',
    description: 'XSS',
  },
];

describe('coordinatePrReview (4C gate)', () => {
  it('invokes both agents and merges results into a single comment', async () => {
    const result = await coordinatePrReview(designInput, scannerFindings);

    expect(fetchCalls).toHaveLength(2); // both agents ran

    // Merged, single comment contains BOTH agents' findings.
    expect(result.comment).toContain('ADR-7 layering');
    expect(result.comment).toContain('javascript.express.security.audit.xss');
    expect(result.comment).toContain('Blast score:** 42');
    expect(result.comment.match(/## 🤖 AI Review/g)).toHaveLength(1);

    // AST-detected cycles are authoritative even when the model omits them.
    expect(result.design.circularDeps.some((c) => c.cycle.join('→') === 'a.ts→b.ts→a.ts')).toBe(true);
  });

  it('security agent drops findings not traceable to scanner output', async () => {
    const result = await coordinatePrReview(designInput, []); // no scanner findings at all
    expect(result.security.findings).toHaveLength(0);
  });
});

describe('renderPrComment', () => {
  it('renders a clean pass when there are no findings', () => {
    const comment = renderPrComment(
      { violations: [], circularDeps: [], blastScore: 3, refactor: [] },
      { findings: [], summary: 'clean' },
    );
    expect(comment).toContain('No architecture or security findings');
  });
});
