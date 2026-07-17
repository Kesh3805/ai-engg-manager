import { z } from 'zod';

/**
 * Declarative agent + tool definitions for the three specialized roles.
 * (Code Archaeologist, Doc Synthesizer, PM). In production these are wired into
 * Mastra's Agent runtime; the schemas double as Agentica's compiler-validated
 * tool contracts.
 */

export const codeAgent = {
  id: 'code-agent',
  description: 'Codebase Archaeologist — traverses the AST graph, computes blast radius and dependency chains.',
  model: 'claude-sonnet-4-6',
  tools: {
    blastRadius: {
      description: 'Compute the blast radius of changing a named entity.',
      parameters: z.object({ entityName: z.string(), maxDepth: z.number().int().min(1).max(12).default(8) }),
    },
    findSymbol: {
      description: 'Locate a symbol by name and return its file/line.',
      parameters: z.object({ name: z.string() }),
    },
  },
} as const;

export const docAgent = {
  id: 'doc-agent',
  description: 'Documentation synthesizer — turns graph + memory context into prose, ADRs and PR summaries.',
  model: 'claude-sonnet-4-6',
  tools: {},
} as const;

export const pmAgent = {
  id: 'pm-agent',
  description: 'Project manager — correlates Jira/Linear tickets with implementation status and sprint health.',
  model: 'claude-haiku-4-5-20251001',
  tools: {
    ticketStatus: {
      description: 'Fetch the status of a ticket by id.',
      parameters: z.object({ ticketId: z.string() }),
    },
  },
} as const;
